import { createServer } from 'node:http';
import { createRateLimiter } from './rate-limit.mjs';
import { readVerifiedAttachment } from './read-attachment.mjs';
import { hasStreamCapacity } from './stream-capacity.mjs';
import { readFileSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scryptSync, timingSafeEqual } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contentTypes = {'/':'text/html; charset=utf-8','/app.js':'text/javascript; charset=utf-8','/styles.css':'text/css; charset=utf-8','/favicon.svg':'image/svg+xml'};
const assetPaths = {'/':'index.html','/app.js':'app.js','/styles.css':'styles.css','/favicon.svg':'favicon.svg'};
const selectUser = 'SELECT id, username, display_name AS displayName FROM users WHERE id = ?';
const now = () => new Date().toISOString();
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const passwordHash = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const validText = (value, max, min = 1) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;

function init(db) {
  db.exec(`PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('personal','family','community','team')), owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS memberships (space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','member')), PRIMARY KEY(space_id,user_id));
    CREATE TABLE IF NOT EXISTS channels (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_id,created_at);
    CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, uploader_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, size INTEGER NOT NULL CHECK(size > 0 AND size <= 2097152), sha256 TEXT NOT NULL, created_at TEXT NOT NULL, scan_state TEXT NOT NULL DEFAULT 'legacy_unreviewed' CHECK(scan_state IN ('legacy_unreviewed','pending','released','blocked')));
    CREATE INDEX IF NOT EXISTS idx_files_space ON files(space_id, created_at);
    CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE, created_by TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, used_by TEXT REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS attachment_hold_policy (singleton INTEGER PRIMARY KEY CHECK(singleton=1), activated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id, space_id);
    CREATE INDEX IF NOT EXISTS idx_notes_space ON notes(space_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_space ON tasks(space_id, created_at);`);
  // Additive, idempotent alpha migrations preserve the previous SQLite data.
  const messageColumns = new Set(db.prepare('PRAGMA table_info(messages)').all().map(row => row.name));
  if (!messageColumns.has('updated_at')) db.exec('ALTER TABLE messages ADD COLUMN updated_at TEXT');
  if (!messageColumns.has('parent_id')) db.exec('ALTER TABLE messages ADD COLUMN parent_id TEXT REFERENCES messages(id) ON DELETE SET NULL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id)');
  const inviteColumns = new Set(db.prepare('PRAGMA table_info(invites)').all().map(row => row.name));
  if (!inviteColumns.has('revoked_at')) db.exec('ALTER TABLE invites ADD COLUMN revoked_at INTEGER');
  // Preserve old attachments as LEGACY/UNREVIEWED, never silently label them scanned.
  const fileColumns = new Set(db.prepare('PRAGMA table_info(files)').all().map(row => row.name));
  if (!fileColumns.has('scan_state')) db.exec("ALTER TABLE files ADD COLUMN scan_state TEXT NOT NULL DEFAULT 'legacy_unreviewed' CHECK(scan_state IN ('legacy_unreviewed','pending','released','blocked'))");
}

export function createApplication({dbPath = process.env.DATA_PATH || './data/workspace.sqlite', origin = process.env.APP_ORIGIN || 'http://localhost:3000', filesPath = process.env.FILES_PATH || null, attachmentHoldMode = 'legacy'} = {}) {
  // No environment or request override is exposed. This is a development-only
  // opt-in gate until a trusted owner-state/Identity integration is reviewed.
  if (!['legacy','enforce'].includes(attachmentHoldMode)) throw new Error('Invalid attachment hold mode');
  const enforceAttachmentHold = attachmentHoldMode === 'enforce';
  if (!/^https?:\/\//.test(origin)) throw new Error('APP_ORIGIN must be an HTTP(S) origin');
  const normalizedOrigin = new URL(origin).origin;
  mkdirSync(dirname(resolve(dbPath)), {recursive:true, mode:0o700});
  const fileDirectory = resolve(filesPath || `${resolve(dbPath)}.files`);
  mkdirSync(fileDirectory, {recursive:true, mode:0o700});
  const db = new DatabaseSync(dbPath);
  init(db);
  // A sticky database latch prevents a later legacy-mode restart from
  // exposing any unreviewed files once hold enforcement was enabled.
  const previouslyHeld = db.prepare('SELECT activated_at FROM attachment_hold_policy WHERE singleton=1').get();
  if (enforceAttachmentHold) {
    db.prepare('INSERT OR IGNORE INTO attachment_hold_policy(singleton,activated_at) VALUES(1,?)').run(now());
  } else if (previouslyHeld) {
    db.close();
    throw new Error('Attachment scan hold is latched for this database; legacy mode is denied');
  }
  const streams = new Map();
  const limit = createRateLimiter();
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  function send(res, status, body, extra={}) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', ...extra});
    res.end(JSON.stringify(body));
  }
  function error(res, status, message) { send(res,status,{error:message}); }
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if(size > 32_768) { const e = new Error('Request too large'); e.status=413; throw e; }
      chunks.push(chunk);
    }
    // Buffer.toString('utf8') silently inserts replacement characters when
    // bytes are malformed, potentially changing a stored display name, note,
    // task or message without the owner's knowledge. Reject before JSON.parse.
    try {
      const text = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks));
      const data = JSON.parse(text);
      if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error();
      return data;
    } catch { const e=new Error('Invalid UTF-8 JSON object'); e.status=400; throw e; }
  }
  async function binaryBody(req, maxBytes=2*1024*1024) {
    if (Number(req.headers['content-length']) > maxBytes) { const e=new Error('File exceeds 2 MiB'); e.status=413; throw e; }
    let size=0; const chunks=[];
    for await (const chunk of req) {
      size+=chunk.length;
      if (size>maxBytes) { const e=new Error('File exceeds 2 MiB'); e.status=413; throw e; }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function safeFilename(value) {
    return typeof value==='string' && value.length>=1 && value.length<=128 && value.trim()===value &&
      value!=='.' && value!=='..' && !/[\\/\x00-\x1f\x7f]/.test(value);
  }
  function storedFile(id) { return join(fileDirectory,id); }
  function fileById(id) {
    return get('SELECT id,space_id AS spaceId,uploader_id AS uploaderId,filename,size,sha256,created_at AS createdAt,scan_state AS scanState FROM files WHERE id=?',id);
  }
  function publicFile(file) {
    return {id:file.id,name:file.filename,size:file.size,uploadedAt:file.createdAt,uploaderId:file.uploaderId,scanState:file.scanState};
  }
  // A separately running legacy-mode instance must also observe a hold that
  // another process has latched since startup, not just its initial option.
  function holdActive() {
    return enforceAttachmentHold || !!get('SELECT activated_at FROM attachment_hold_policy WHERE singleton=1');
  }
  // Even the legacy mode never makes a previously held attachment public.
  // Only an explicit trusted owner release may mark a scanned file 'released'.
  // No release endpoint is implemented by this development-only increment.
  function ordinaryFileAccess(file) {
    return !!file && (file.scanState==='released' ||
      (!holdActive() && file.scanState==='legacy_unreviewed'));
  }
  function spaceHasHeldFiles(spaceId) {
    const permittedStates=holdActive()?['released']:['released','legacy_unreviewed'];
    const row=get('SELECT scan_state AS state FROM files WHERE space_id=? AND scan_state NOT IN ('+
      permittedStates.map(()=>'?').join(',')+') LIMIT 1',spaceId,...permittedStates);
    return !!row;
  }
  function sessionHash(req) {
    const value = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('gc_session='))?.slice(11);
    return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : null;
  }
  function getUser(req) {
    const hash = sessionHash(req);
    return hash ? get(`SELECT u.id,u.username,u.display_name AS displayName FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`, hash, Date.now()) : null;
  }
  function establishSession(res, userId) {
    const value=token(), sevenDays=7*24*3600;
    run('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)',digest(value),userId,Date.now()+sevenDays*1000);
    res.setHeader('Set-Cookie',`gc_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sevenDays}${normalizedOrigin.startsWith('https:')?'; Secure':''}`);
  }
  function membership(spaceId,userId) {return get('SELECT role FROM memberships WHERE space_id=? AND user_id=?',spaceId,userId)?.role || null;}
  function channelSpace(channelId) {return get('SELECT space_id AS spaceId FROM channels WHERE id=?',channelId)?.spaceId;}
  function streamIsAuthorized(channelId, client) {
    const spaceId = channelSpace(channelId);
    return !!(spaceId && membership(spaceId, client.userId) && get('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?', client.sessionHash, Date.now()));
  }
  function broadcast(channelId, type, payload) {
    for (const client of streams.get(channelId) || []) {
      if (!streamIsAuthorized(channelId, client)) { client.res.end(); continue; }
      try { client.res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`); }
      catch { client.res.end(); }
    }
  }
  function closeStreamsFor(userId, spaceId = null, onlySessionHash = null) {
    for (const [channelId, clients] of streams) {
      if (spaceId && channelSpace(channelId) !== spaceId) continue;
      for (const client of clients) if (client.userId === userId && (!onlySessionHash || client.sessionHash === onlySessionHash)) client.res.end();
    }
  }
  function closeOtherStreamsFor(userId, keepSessionHash) {
    for (const clients of streams.values()) for (const client of clients)
      if (client.userId === userId && client.sessionHash !== keepSessionHash) client.res.end();
  }
  const messageFields = 'm.id,m.channel_id AS channelId,m.author_id AS authorId,m.body,m.created_at AS createdAt,m.updated_at AS updatedAt,m.parent_id AS parentId,u.display_name AS author';
  function messageById(id) {
    return get(`SELECT ${messageFields} FROM messages m JOIN users u ON u.id=m.author_id WHERE m.id=?`, id);
  }
  function createSpace(userId, name,kind) {
    const spaceId=randomUUID(), channelId=randomUUID(), time=now();
    run('INSERT INTO spaces(id,name,kind,owner_id,created_at) VALUES(?,?,?,?,?)',spaceId,name,kind,userId,time);
    run("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'owner')",spaceId,userId);
    run('INSERT INTO channels(id,space_id,name,created_at) VALUES(?,?,?,?)',channelId,spaceId,'general',time);
    return spaceId;
  }
  const server=createServer(async (req,res) => {
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const method=req.method || 'GET';
    let path, searchParams;
    try {({pathname:path,searchParams}=new URL(req.url,normalizedOrigin));} catch {return error(res,400,'Invalid URL');}
    if (method==='GET' && Object.hasOwn(assetPaths,path)) {
      const file=resolve(root,'public',assetPaths[path]);
      res.writeHead(200,{'Content-Type':contentTypes[path], 'Cache-Control':path==='/'?'no-store':'public,max-age=3600'});
      return res.end(readFileSync(file));
    }
    if(path==='/api/health' && method==='GET') return send(res,200,{status:'ok'});
    if(!path.startsWith('/api/')) return error(res,404,'Not found');
    if(['POST','PATCH','DELETE'].includes(method) && req.headers.origin!==normalizedOrigin) return error(res,403,'Origin mismatch');
    const ip=req.socket.remoteAddress || 'unknown';
    try {
      if(path==='/api/me' && method==='GET') {
        const user=getUser(req);
        return send(res,200,{initialized:!!get('SELECT id FROM users LIMIT 1'),user:user||null});
      }
      if(path==='/api/bootstrap' && method==='POST') {
        if(!limit(ip,'login',12,15*60_000)) return error(res,429,'Too many attempts');
        if(get('SELECT id FROM users LIMIT 1')) return error(res,409,'Instance already initialized');
        const data=await body(req), name=data.username?.trim(), display=data.displayName?.trim()||name;
        if(!/^[a-zA-Z0-9_-]{3,32}$/.test(name||'')||!validText(display,80)||!validText(data.password,256,12)) return error(res,400,'Username (3–32), display name, and password (12+ chars) required');
        const id=randomUUID(), salt=randomBytes(16).toString('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          if(get('SELECT id FROM users LIMIT 1')) {db.exec('ROLLBACK');return error(res,409,'Instance already initialized');}
          run('INSERT INTO users(id,username,display_name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',id,name,display,salt,passwordHash(data.password,salt),now());
          createSpace(id,'My Space','personal');
          db.exec('COMMIT');
        } catch(e) {db.exec('ROLLBACK');throw e;}
        establishSession(res,id);
        return send(res,201,{user:get(selectUser,id)});
      }
      if(path==='/api/login' && method==='POST') {
        if(!limit(ip,'login',12,15*60_000)) return error(res,429,'Too many attempts');
        const data=await body(req); const record=typeof data.username==='string'?get('SELECT * FROM users WHERE username=?',data.username.trim()):null;
        const salt=record?.salt || '00000000000000000000000000000000';
        const supplied=passwordHash(typeof data.password==='string'?data.password:'',salt);
        if(!record || !timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(record.password_hash,'hex'))) return error(res,401,'Invalid credentials');
        establishSession(res,record.id);
        return send(res,200,{user:get(selectUser,record.id)});
      }
      if(path==='/api/register' && method==='POST') {
        if(!limit(ip,'login',12,15*60_000))return error(res,429,'Too many attempts');
        const data=await body(req), name=data.username?.trim(), display=data.displayName?.trim()||name;
        if(!/^[a-zA-Z0-9_-]{3,32}$/.test(name||'')||!validText(display,80)||!validText(data.password,256,12)||typeof data.invite!=='string')return error(res,400,'Valid invitation, username, display name, and password required');
        const invitation=get('SELECT * FROM invites WHERE token_hash=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?',digest(data.invite),Date.now());
        if(!invitation)return error(res,400,'Invitation invalid or expired');
        const id=randomUUID(),salt=randomBytes(16).toString('hex');
        db.exec('BEGIN IMMEDIATE');
        try {
          const active=get('SELECT * FROM invites WHERE token_hash=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?',digest(data.invite),Date.now());
          if(!active){db.exec('ROLLBACK');return error(res,409,'Invitation has already been used');}
          run('INSERT INTO users(id,username,display_name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',id,name,display,salt,passwordHash(data.password,salt),now());
          createSpace(id,'My Space','personal');
          run("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'member')",active.space_id,id);
          run('UPDATE invites SET used_by=? WHERE token_hash=?',id,digest(data.invite));
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');if(e?.code?.includes('CONSTRAINT'))return error(res,409,'Username already taken');throw e;}
        establishSession(res,id);return send(res,201,{user:get(selectUser,id)});
      }
      const user=getUser(req);
      if(!user) return error(res,401,'Sign in required');
      if (path==='/api/account/security' && method==='GET') {
        const activeSessions=get('SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND expires_at>?',user.id,Date.now()).count;
        return send(res,200,{activeSessions});
      }
      if (path==='/api/account/sessions/revoke-others' && method==='POST') {
        if(!limit(ip+':'+user.id,'revoke-sessions',12,15*60_000))return error(res,429,'Too many security requests');
        const current=sessionHash(req);
        const revoked=run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?',user.id,current).changes;
        closeOtherStreamsFor(user.id,current);
        return send(res,200,{ok:true,revoked});
      }
      if (path==='/api/account/password' && method==='POST') {
        if(!limit(ip+':'+user.id,'password-change',6,15*60_000))return error(res,429,'Too many security requests');
        const data=await body(req);
        if(typeof data.currentPassword!=='string' || !validText(data.newPassword,256,12))return error(res,400,'Current password and a new password (12–256 characters) required');
        if(data.currentPassword===data.newPassword)return error(res,400,'Choose a different new password');
        const record=get('SELECT salt,password_hash FROM users WHERE id=?',user.id);
        const candidate=passwordHash(data.currentPassword,record.salt);
        if(!timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(record.password_hash,'hex')))return error(res,403,'Current password is incorrect');
        const salt=randomBytes(16).toString('hex'), newHash=passwordHash(data.newPassword,salt);
        db.exec('BEGIN IMMEDIATE');
        try {
          if(!get('SELECT token_hash FROM sessions WHERE token_hash=? AND user_id=? AND expires_at>?',sessionHash(req),user.id,Date.now())) {
            db.exec('ROLLBACK');return error(res,401,'Session expired');
          }
          run('UPDATE users SET salt=?, password_hash=? WHERE id=?',salt,newHash,user.id);
          run('DELETE FROM sessions WHERE user_id=?',user.id);
          establishSession(res,user.id);
          db.exec('COMMIT');
        } catch(e) {db.exec('ROLLBACK');throw e;}
        closeStreamsFor(user.id);
        return send(res,200,{ok:true,otherSessionsRevoked:true});
      }
      if (path==='/api/search' && method==='GET') {
        const q=searchParams.get('q')?.trim();
        if (!validText(q,100,2)) return error(res,400,'Search must be 2–100 characters');
        const spaceId=searchParams.get('spaceId');
        if (spaceId && (!/^[0-9a-f-]{36}$/.test(spaceId) || !membership(spaceId,user.id))) return error(res,404,'Space not found');
        const like=`%${q.replace(/[!%_]/g, character => '!'+character)}%`;
        const msgSpace=spaceId?' AND c.space_id=?':'';
        const itemSpace=spaceId?' AND i.space_id=?':'';
        const msgParams=spaceId?[user.id,like,spaceId]:[user.id,like];
        const itemParams=spaceId?[user.id,like,spaceId]:[user.id,like];
        const messages=all(`SELECT m.id,m.channel_id AS channelId,c.name AS channel,m.body,m.created_at AS createdAt,s.name AS space FROM messages m JOIN channels c ON c.id=m.channel_id JOIN spaces s ON s.id=c.space_id JOIN memberships a ON a.space_id=s.id WHERE a.user_id=? AND m.body LIKE ? ESCAPE '!'${msgSpace} ORDER BY m.created_at DESC LIMIT 40`,...msgParams);
        const notes=all(`SELECT i.id,i.title,substr(i.body,1,240) AS excerpt,s.name AS space FROM notes i JOIN spaces s ON s.id=i.space_id JOIN memberships a ON a.space_id=s.id WHERE a.user_id=? AND (i.title LIKE ? ESCAPE '!' OR i.body LIKE ? ESCAPE '!')${itemSpace} ORDER BY i.updated_at DESC LIMIT 20`,...(spaceId?[user.id,like,like,spaceId]:[user.id,like,like]));
        const tasks=all(`SELECT i.id,i.title,i.done,s.name AS space FROM tasks i JOIN spaces s ON s.id=i.space_id JOIN memberships a ON a.space_id=s.id WHERE a.user_id=? AND i.title LIKE ? ESCAPE '!'${itemSpace} ORDER BY i.created_at DESC LIMIT 20`,...itemParams);
        return send(res,200,{messages,notes,tasks});
      }
      if (path==='/api/invites/accept' && method==='POST') {
        const data=await body(req);
        if(typeof data.invite!=='string'||!/^[-_A-Za-z0-9]{43}$/.test(data.invite))return error(res,400,'Invalid invitation');
        const hash=digest(data.invite);
        db.exec('BEGIN IMMEDIATE');
        try {
          const invite=get('SELECT space_id AS spaceId FROM invites WHERE token_hash=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>?',hash,Date.now());
          if(!invite){db.exec('ROLLBACK');return error(res,400,'Invitation invalid or expired');}
          if(membership(invite.spaceId,user.id)){db.exec('ROLLBACK');return error(res,409,'Already a member');}
          run("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'member')",invite.spaceId,user.id);
          run('UPDATE invites SET used_by=? WHERE token_hash=?',user.id,hash);
          db.exec('COMMIT');
          return send(res,200,{spaceId:invite.spaceId});
        } catch (e) {db.exec('ROLLBACK');throw e;}
      }
      if(path==='/api/logout' && method==='POST') {
        const hash = sessionHash(req);
        if (hash) run('DELETE FROM sessions WHERE token_hash=?', hash);
        closeStreamsFor(user.id,null,hash);
        res.setHeader('Set-Cookie','gc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return send(res,200,{ok:true});
      }
      if(path==='/api/spaces' && method==='GET') return send(res,200,{spaces:all(`SELECT s.id,s.name,s.kind,m.role FROM spaces s JOIN memberships m ON m.space_id=s.id WHERE m.user_id=? ORDER BY s.created_at`,user.id)});
      if(path==='/api/spaces' && method==='POST') {
        const data=await body(req);if(!validText(data.name,80)||!['personal','family','community','team'].includes(data.kind))return error(res,400,'Invalid space');
        const id=createSpace(user.id,data.name.trim(),data.kind);return send(res,201,{id});
      }
      // Owner-only space JSON export; never includes raw files or authentication secrets.
      const exportRoute=path.match(/^\/api\/spaces\/([0-9a-f-]{36})\/export$/);
      if(exportRoute && method==='GET') {
        const spaceId=exportRoute[1],role=membership(spaceId,user.id);
        if(!role)return error(res,404,'Space not found');
        if(role!=='owner')return error(res,403,'Owner access required');
        const includeFiles=searchParams.get('includeFiles');
        if(includeFiles!==null && includeFiles!=='0' && includeFiles!=='1')return error(res,400,'Invalid includeFiles option');
        const withFiles=includeFiles==='1';
        // Never create a partial owner export that bypasses a held file,
        // including metadata-only v1 and file-inclusive v2 exports.
        if(spaceHasHeldFiles(spaceId))return error(res,423,'Space contains attachments held for scan review');
        if(!limit(ip+':'+user.id,withFiles?'space-export-files':'space-export',withFiles?3:6,60_000))return error(res,429,'Too many export requests');
        const count=get('SELECT COUNT(*) AS total FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.space_id=?',spaceId).total;
        if(count>10000)return error(res,413,'Space export exceeds message limit');
        const data={
          schema:'goreecloud.workspace-teams.space.v1',exportedAt:now(),attachmentBytesIncluded:false,
          space:get('SELECT id,name,kind,created_at AS createdAt FROM spaces WHERE id=?',spaceId),
          members:all('SELECT u.id,u.username,u.display_name AS displayName,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY u.username',spaceId),
          channels:all('SELECT id,name,created_at AS createdAt FROM channels WHERE space_id=? ORDER BY created_at,id',spaceId),
          messages:all('SELECT m.id,m.channel_id AS channelId,m.author_id AS authorId,m.body,m.created_at AS createdAt,m.updated_at AS updatedAt,m.parent_id AS parentId FROM messages m JOIN channels c ON c.id=m.channel_id WHERE c.space_id=? ORDER BY m.created_at,m.id',spaceId),
          tasks:all('SELECT id,author_id AS authorId,title,done,created_at AS createdAt FROM tasks WHERE space_id=? ORDER BY created_at,id',spaceId),
          notes:all('SELECT id,author_id AS authorId,title,body,updated_at AS updatedAt FROM notes WHERE space_id=? ORDER BY updated_at,id',spaceId),
          files:all('SELECT id,uploader_id AS uploaderId,filename AS name,size,sha256,created_at AS uploadedAt FROM files WHERE space_id=? ORDER BY created_at,id',spaceId)
        };
        if(withFiles){
          if(data.files.length>100)return error(res,413,'Portable export exceeds 100 file limit');
          const total=data.files.reduce((sum,file)=>sum+file.size,0);
          if(total>8*1024*1024)return error(res,413,'Portable export exceeds 8 MiB attachment limit');
          for(const file of data.files){
            if(!/^[0-9a-f-]{36}$/.test(file.id))return error(res,500,'Stored attachment ID invalid');
            let bytes;
            try { bytes=readVerifiedAttachment(storedFile(file.id),file.size,file.sha256); }
            catch { return error(res,500,'Stored attachment integrity error'); }
            file.contentBase64=bytes.toString('base64');
          }
          data.schema='goreecloud.workspace-teams.space.v2';
          data.attachmentBytesIncluded=true;
          data.attachmentEncoding='base64';
        }
        const json=JSON.stringify(data), bytes=Buffer.byteLength(json);
        if(bytes>(withFiles?20:8)*1024*1024)return error(res,413,'Space JSON export exceeds size limit');
        if(membership(spaceId,user.id)!=='owner'||!get('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?',sessionHash(req),Date.now()))return error(res,403,'Export access revoked');
        if(spaceHasHeldFiles(spaceId))return error(res,423,'Space contains attachments held for scan review');
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="workspace-space-'+spaceId+(withFiles?'-with-files':'')+'.json"','Content-Length':bytes,'Cache-Control':'no-store'});
        return res.end(json);
      }
      const filesRoute=path.match(/^\/api\/spaces\/([0-9a-f-]{36})\/files$/);
      if(filesRoute && ['GET','POST'].includes(method)) {
        const spaceId=filesRoute[1];
        if(!membership(spaceId,user.id))return error(res,404,'Space not found');
        if(method==='GET')return send(res,200,{files:all(`SELECT id,filename AS name,size,created_at AS uploadedAt,uploader_id AS uploaderId,scan_state AS scanState FROM files WHERE space_id=? AND (scan_state='released' OR (?=1 AND scan_state='legacy_unreviewed')) ORDER BY created_at DESC,id DESC LIMIT 500`,spaceId,holdActive()?0:1)});
        if(!limit(`${ip}:${user.id}`,'file-upload',20,60_000))return error(res,429,'Upload rate limit');
        if(req.headers['content-type']!=='application/octet-stream')return error(res,415,'Use application/octet-stream');
        const filename=searchParams.get('name');
        if(!safeFilename(filename))return error(res,400,'Invalid filename');
        const data=await binaryBody(req);
        if(!membership(spaceId,user.id))return error(res,404,'Space not found');
        if(!get('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?',sessionHash(req),Date.now()))return error(res,401,'Session expired');
        if(!data.length)return error(res,400,'Empty files are not supported');
        const used=get('SELECT COALESCE(SUM(size),0) AS bytes FROM files WHERE space_id=?',spaceId).bytes;
        if(used+data.length>32*1024*1024)return error(res,413,'Space file limit (32 MiB) exceeded');
        const record={id:randomUUID(),spaceId,uploaderId:user.id,filename,size:data.length,sha256:digest(data),createdAt:now(),scanState:holdActive()?'pending':'legacy_unreviewed'};
        writeFileSync(storedFile(record.id),data,{flag:'wx',mode:0o600});
        try {run('INSERT INTO files(id,space_id,uploader_id,filename,size,sha256,created_at,scan_state) VALUES(?,?,?,?,?,?,?,?)',record.id,spaceId,user.id,filename,record.size,record.sha256,record.createdAt,record.scanState);}
        catch (e) {unlinkSync(storedFile(record.id));throw e;}
        return send(res,201,{file:publicFile(record)});
      }
      const fileRoute=path.match(/^\/api\/files\/([0-9a-f-]{36})(?:\/(download))?$/);
      if(fileRoute && (method==='GET'||method==='DELETE')) {
        const file=fileById(fileRoute[1]);
        if(!file||!membership(file.spaceId,user.id))return error(res,404,'File not found');
        if(method==='GET' && fileRoute[2]==='download') {
          if(!ordinaryFileAccess(file))return error(res,423,'Attachment held for scan review');
          let data;
          try { data=readVerifiedAttachment(storedFile(file.id),file.size,file.sha256); }
          catch { return error(res,500,'Stored file integrity error'); }
          // Recheck current owner-controlled state, membership, and session
          // immediately before transmitting any attachment bytes.
          const fresh=fileById(file.id);
          if(!ordinaryFileAccess(fresh) || fresh.sha256!==file.sha256 || fresh.size!==file.size)
            return error(res,423,'Attachment held for scan review');
          if(!membership(file.spaceId,user.id)||!get('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?',sessionHash(req),Date.now()))
            return error(res,403,'Attachment access revoked');
          res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':data.length,
            'Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
            'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
          return res.end(data);
        }
        if(method==='DELETE'&&!fileRoute[2]) {
          if(file.uploaderId!==user.id&&membership(file.spaceId,user.id)!=='owner')return error(res,403,'Not permitted');
          // Delete data before its index to avoid a silent orphan when the filesystem rejects removal.
          unlinkSync(storedFile(file.id));
          run('DELETE FROM files WHERE id=?',file.id);
          return send(res,200,{ok:true});
        }
      }
      const spaceRoute=path.match(/^\/api\/spaces\/([0-9a-f-]{36})\/(channels|tasks|notes|invites|members)$/);
      if(spaceRoute) {
        const [,spaceId,section]=spaceRoute, role=membership(spaceId,user.id);
        if(!role) return error(res,404,'Space not found');
        if (section==='members' && method==='GET') {
          return send(res,200,{members:all(`SELECT u.id,u.display_name AS displayName,u.username,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,u.username`,spaceId)});
        }
        if(section==='channels') {
          if(method==='GET')return send(res,200,{channels:all('SELECT id,name FROM channels WHERE space_id=? ORDER BY created_at',spaceId)});
          if(method==='POST'){
            if(role!=='owner')return error(res,403,'Owner access required');
            const data=await body(req);if(!/^[a-zA-Z0-9_-]{2,48}$/.test(data.name||''))return error(res,400,'Invalid channel name');
            const id=randomUUID();run('INSERT INTO channels(id,space_id,name,created_at) VALUES(?,?,?,?)',id,spaceId,data.name,now());return send(res,201,{id});
          }
        }
        if(section==='tasks') {
          if(method==='GET')return send(res,200,{tasks:all('SELECT id,title,done,created_at AS createdAt FROM tasks WHERE space_id=? ORDER BY created_at DESC',spaceId)});
          if(method==='POST'){
            const data=await body(req);if(!validText(data.title,300))return error(res,400,'Invalid title');
            const id=randomUUID();run('INSERT INTO tasks(id,space_id,author_id,title,created_at) VALUES(?,?,?,?,?)',id,spaceId,user.id,data.title.trim(),now());return send(res,201,{id});
          }
        }
        if(section==='notes') {
          if(method==='GET')return send(res,200,{notes:all('SELECT id,title,body,updated_at AS updatedAt FROM notes WHERE space_id=? ORDER BY updated_at DESC',spaceId)});
          if(method==='POST'){
            const data=await body(req);if(!validText(data.title,120)||typeof data.body!=='string'||data.body.length>20000)return error(res,400,'Invalid note');
            const id=randomUUID();run('INSERT INTO notes(id,space_id,author_id,title,body,updated_at) VALUES(?,?,?,?,?,?)',id,spaceId,user.id,data.title.trim(),data.body,now());return send(res,201,{id});
          }
        }
        if(section==='invites') {
          if(role!=='owner')return error(res,403,'Owner access required');
          if(method==='GET')return send(res,200,{invites:all('SELECT token_hash AS id,expires_at AS expiresAt FROM invites WHERE space_id=? AND used_by IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY expires_at DESC LIMIT 100',spaceId,Date.now())});
          if(method==='POST') {
            if(!limit(`${ip}:${user.id}`,'invitation',20,60_000))return error(res,429,'Invitation rate limit');
            const invite=token();run('INSERT INTO invites(token_hash,space_id,created_by,expires_at) VALUES(?,?,?,?)',digest(invite),spaceId,user.id,Date.now()+24*3600_000);
            return send(res,201,{invite,expiresInHours:24});
          }
        }
      }
      const inviteRoute=path.match(/^\/api\/spaces\/([0-9a-f-]{36})\/invites\/([0-9a-f]{64})$/);
      if(inviteRoute && method==='DELETE') {
        const [,spaceId,inviteId]=inviteRoute;
        if(membership(spaceId,user.id)!=='owner')return error(res,403,'Owner access required');
        const result=run('UPDATE invites SET revoked_at=? WHERE token_hash=? AND space_id=? AND used_by IS NULL AND revoked_at IS NULL',Date.now(),inviteId,spaceId);
        if(!result.changes)return error(res,404,'Active invitation not found');
        return send(res,200,{ok:true});
      }
      const memberRoute=path.match(/^\/api\/spaces\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/);
      if(memberRoute && method==='DELETE') {
        const [,spaceId,targetId]=memberRoute;
        if(membership(spaceId,user.id)!=='owner')return error(res,403,'Owner access required');
        if(targetId===user.id)return error(res,403,'Cannot remove the space owner');
        const target=membership(spaceId,targetId);
        if(!target)return error(res,404,'Member not found');
        if(target==='owner')return error(res,403,'Cannot remove a space owner');
        run('DELETE FROM memberships WHERE space_id=? AND user_id=?',spaceId,targetId);
        closeStreamsFor(targetId,spaceId);
        return send(res,200,{ok:true});
      }
      const messageRoute=path.match(/^\/api\/channels\/([0-9a-f-]{36})\/(messages|stream)$/);
      if(messageRoute) {
        const [,channelId,section]=messageRoute, spaceId=channelSpace(channelId);
        if(!spaceId || !membership(spaceId,user.id)) return error(res,404,'Channel not found');
        if(section==='messages'){
          if(method==='GET') {
            const before=searchParams.get('before');
            const messages=before&&/^[0-9TZ:.\-]{20,30}$/.test(before)?all(`SELECT ${messageFields} FROM messages m JOIN users u ON u.id=m.author_id WHERE m.channel_id=? AND m.created_at<? ORDER BY m.created_at DESC LIMIT 100`,channelId,before):all(`SELECT ${messageFields} FROM messages m JOIN users u ON u.id=m.author_id WHERE m.channel_id=? ORDER BY m.created_at DESC LIMIT 100`,channelId);
            return send(res,200,{messages:messages.reverse()});
          }
          if(method==='POST') {
            if(!limit(`${ip}:${user.id}`,'message',120,60_000))return error(res,429,'Message rate limit');
            const data=await body(req);if(!validText(data.body,4000))return error(res,400,'Message must be 1–4000 characters');
            const parentId=data.parentId||null;
            if(parentId && (!/^[0-9a-f-]{36}$/.test(parentId) || get('SELECT channel_id AS channelId FROM messages WHERE id=?',parentId)?.channelId!==channelId)) return error(res,400,'Reply must refer to a message in this channel');
            const message={id:randomUUID(),channelId,authorId:user.id,body:data.body.trim(),createdAt:now(),updatedAt:null,parentId,author:user.displayName};
            run('INSERT INTO messages(id,channel_id,author_id,body,created_at,parent_id) VALUES(?,?,?,?,?,?)',message.id,channelId,user.id,message.body,message.createdAt,parentId);
            broadcast(channelId,'message',message);return send(res,201,{message});
          }
        }
        if(section==='stream' && method==='GET') {
          if(!hasStreamCapacity(streams,user.id))return send(res,429,{error:'Too many live stream connections'},{'Retry-After':'30'});
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
          res.write(': connected\n\n');
          if(!streams.has(channelId))streams.set(channelId,new Set());
          const client={res,userId:user.id,sessionHash:sessionHash(req)};
          streams.get(channelId).add(client);
          const heartbeat=setInterval(()=>{
            if(!streamIsAuthorized(channelId,client)) {res.end();return;}
            try {res.write(': heartbeat\n\n');}catch {res.end();}
          },20_000);
          const maxAge=setTimeout(()=>res.end(),30*60_000);
          res.on('close',()=>{clearInterval(heartbeat);clearTimeout(maxAge);streams.get(channelId)?.delete(client);if(!streams.get(channelId)?.size)streams.delete(channelId);});
          return;
        }
      }
      const editMessageRoute=path.match(/^\/api\/messages\/([0-9a-f-]{36})$/);
      if(editMessageRoute && ['PATCH','DELETE'].includes(method)) {
        const message=messageById(editMessageRoute[1]);
        if(!message||!membership(channelSpace(message.channelId),user.id))return error(res,404,'Message not found');
        if(message.authorId!==user.id && membership(channelSpace(message.channelId),user.id)!=='owner')return error(res,403,'Not permitted');
        if(method==='DELETE'){
          run('DELETE FROM messages WHERE id=?',message.id);
          broadcast(message.channelId,'message-deleted',{id:message.id});
          return send(res,200,{ok:true});
        }
        const data=await body(req);
        if(!validText(data.body,4000))return error(res,400,'Message must be 1–4000 characters');
        run('UPDATE messages SET body=?,updated_at=? WHERE id=?',data.body.trim(),now(),message.id);
        const updated=messageById(message.id);
        broadcast(message.channelId,'message-updated',updated);
        return send(res,200,{message:updated});
      }
      const taskRoute=path.match(/^\/api\/tasks\/([0-9a-f-]{36})$/);
      if(taskRoute && ['PATCH','DELETE'].includes(method)) {
        const task=get('SELECT space_id AS spaceId,author_id AS authorId FROM tasks WHERE id=?',taskRoute[1]);
        if(!task||!membership(task.spaceId,user.id))return error(res,404,'Task not found');
        if(task.authorId!==user.id && membership(task.spaceId,user.id)!=='owner')return error(res,403,'Not permitted');
        if(method==='DELETE'){run('DELETE FROM tasks WHERE id=?',taskRoute[1]);return send(res,200,{ok:true});}
        const data=await body(req);if(typeof data.done!=='boolean')return error(res,400,'done must be boolean');
        run('UPDATE tasks SET done=? WHERE id=?',data.done?1:0,taskRoute[1]);return send(res,200,{ok:true});
      }
      const noteRoute=path.match(/^\/api\/notes\/([0-9a-f-]{36})$/);
      if(noteRoute && ['PATCH','DELETE'].includes(method)){
        const note=get('SELECT space_id AS spaceId,author_id AS authorId FROM notes WHERE id=?',noteRoute[1]);
        if(!note||!membership(note.spaceId,user.id))return error(res,404,'Note not found');
        if(note.authorId!==user.id && membership(note.spaceId,user.id)!=='owner')return error(res,403,'Not permitted');
        if(method==='DELETE'){run('DELETE FROM notes WHERE id=?',noteRoute[1]);return send(res,200,{ok:true});}
        const data=await body(req);if(!validText(data.title,120)||typeof data.body!=='string'||data.body.length>20000)return error(res,400,'Invalid note');
        run('UPDATE notes SET title=?,body=?,updated_at=? WHERE id=?',data.title.trim(),data.body,now(),noteRoute[1]);return send(res,200,{ok:true});
      }
      return error(res,404,'Not found');
    }catch(e){if(e.status)return error(res,e.status,e.message);console.error('Unhandled application error:',e?.message);return error(res,500,'Internal server error');}
  });
  return {server,close:()=>{for(const group of streams.values())for(const client of group)client.res.end();db.close();}};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 3000), host=process.env.HOST || '127.0.0.1';
  const app=createApplication();
  app.server.listen(port,host,()=>console.log(`GoreeCloud Workspace Teams listening on ${host}:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>app.server.close(()=>{app.close();process.exit(0);}));
}
