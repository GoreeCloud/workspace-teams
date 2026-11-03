#!/usr/bin/env node
/** Import one authenticated v2 space export to an exclusively new, offline alpha instance. */
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from '../src/server.mjs';
import { verifySpaceExport } from './verify-space-export.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_OK = value => typeof value === 'string' && UUID.test(value);
const item = value => value && typeof value === 'object' && !Array.isArray(value);
const word = (value, max, min=1) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(value) && !Number.isNaN(Date.parse(value));
const unique = (rows, kind) => {
  if (!Array.isArray(rows) || rows.length > 10000) throw Error(`Invalid ${kind} collection`);
  const ids = new Set();
  for (const row of rows) {
    if (!item(row) || !UUID_OK(row.id) || ids.has(row.id)) throw Error(`Invalid or duplicate ${kind} ID`);
    ids.add(row.id);
  }
  return ids;
};
const regular = file => { try {return lstatSync(file).isFile();} catch (e) { if(e.code==='ENOENT') return false; throw e; } };
const exists = file => { try { lstatSync(file); return true; } catch(e) {if(e.code==='ENOENT') return false; throw e;} };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function safePrivateFile(file, label, maxBytes) {
  if (!regular(file)) throw Error(`${label} must be a regular, nonsymlink file`);
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw Error(`${label} size is invalid`);
    if (process.platform !== 'win32' && (stat.mode & 0o077)) throw Error(`${label} must be private (chmod 600)`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function validate(data) {
  if (data.schema !== 'goreecloud.workspace-teams.space.v2' || data.attachmentBytesIncluded !== true)
    throw Error('Only complete v2 exports with attachment bytes can be imported');
  if (!item(data.space) || !UUID_OK(data.space.id) || !word(data.space.name,80) ||
      !['personal','family','community','team'].includes(data.space.kind) || !timestamp(data.space.createdAt))
    throw Error('Invalid space information');
  const members = unique(data.members,'member'), channels = unique(data.channels,'channel');
  const messages = unique(data.messages,'message'); unique(data.tasks,'task'); unique(data.notes,'note');
  if(data.members.length>1000 || data.channels.length>1000)throw Error('Member or channel limit exceeded');
  const owners=data.members.filter(m=>m.role==='owner');
  if(owners.length!==1)throw Error('Export must contain exactly one source space owner');
  for (const m of data.members) {
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(m.username || '') || !word(m.displayName,80) ||
        !['member','owner'].includes(m.role))throw Error('Invalid member identity');
  }
  for (const c of data.channels) if(!word(c.name,80)||!timestamp(c.createdAt))throw Error('Invalid channel');
  for (const m of data.messages) {
    if(!channels.has(m.channelId)||!UUID_OK(m.authorId)||!word(m.body,4000)||!timestamp(m.createdAt)||
       (m.updatedAt!==null && m.updatedAt!==undefined && !timestamp(m.updatedAt)) ||
       (m.parentId!==null && m.parentId!==undefined && !messages.has(m.parentId)))throw Error('Invalid message data');
  }
  const messageMap = new Map(data.messages.map(m=>[m.id,m]));
  for (const m of data.messages) if(m.parentId && messageMap.get(m.parentId).channelId!==m.channelId)
    throw Error('Message reply crosses channel boundary');
  for (const t of data.tasks) if(!UUID_OK(t.authorId)||!word(t.title,300)||![0,1].includes(t.done)||!timestamp(t.createdAt))
    throw Error('Invalid task data');
  for (const n of data.notes) if(!UUID_OK(n.authorId)||!word(n.title,120)||typeof n.body!=='string'||n.body.length>20000||!timestamp(n.updatedAt))
    throw Error('Invalid note data');
  for (const f of data.files) if(!UUID_OK(f.uploaderId)||!timestamp(f.uploadedAt)||!word(f.name,128)||
     /[\\/\x00-\x1f\x7f]/.test(f.name)||typeof f.contentBase64!=='string')throw Error('Invalid attachment data');
  return owners[0].id;
}

export function importSpaceExport({ source, destination, ownerUsername, ownerPasswordFile }={}) {
  if (!source || !destination || !ownerPasswordFile || !/^[a-zA-Z0-9_-]{3,32}$/.test(ownerUsername||''))
    throw Error('Required: --file, --dest, --owner, --password-file (username 3–32 safe characters)');
  const input=resolve(source), output=resolve(destination), credential=resolve(ownerPasswordFile);
  if (new Set([input,output,credential]).size !== 3) throw Error('Import source, output and password must differ');
  if (exists(output)) throw Error('Destination already exists; refusing to overwrite');
  const parent=dirname(output), parentStat=lstatSync(parent);
  if (!parentStat.isDirectory() || (process.platform!=='win32' && (parentStat.mode & 0o077)))
    throw Error('Destination parent must be a real private directory (chmod 700)');
  const passwordBytes=safePrivateFile(credential,'Owner password file',4096);
  const password=passwordBytes.toString('utf8').replace(/\r?\n$/,'');passwordBytes.fill(0);
  if (password.length < 12 || password.length > 256) throw Error('New owner password must be 12–256 characters');
  const sourceBytes=safePrivateFile(input,'Portable export',20*1024*1024);
  mkdirSync(output,{mode:0o700}); // Exclusive, never overwrite an existing installation.
  const snapshot=join(output,'.verified-source.json'),dbPath=join(output,'workspace.sqlite');
  let db;
  try {
    writeFileSync(snapshot,sourceBytes,{flag:'wx',mode:0o600});sourceBytes.fill(0);
    const verified=verifySpaceExport(snapshot);
    if(!verified.includesFiles)throw Error('Only attachment-inclusive v2 exports may be imported');
    const data=JSON.parse(readFileSync(snapshot,'utf8'));
    const formerOwner=validate(data);
    const app=createApplication({dbPath,origin:'http://localhost:3000'});
    app.close();
    db=new DatabaseSync(dbPath);db.exec('PRAGMA foreign_keys = ON');
    const run=(sql,...args)=>db.prepare(sql).run(...args);
    const stamp=new Date().toISOString();
    const ownerId=randomUUID(),spaceId=randomUUID();
    const salt=randomBytes(16).toString('hex');
    const ownHash=scryptSync(password,salt,64).toString('hex');
    const people=new Map([[formerOwner,ownerId]]);
    const members=new Map(data.members.map(m=>[m.id,m]));
    function person(sourceId) {
      if(people.has(sourceId))return people.get(sourceId);
      const id=randomUUID(), archived=members.get(sourceId);
      const fakeSalt=randomBytes(16).toString('hex');
      const unknownCredential=randomBytes(32);
      const fakeHash=scryptSync(unknownCredential,fakeSalt,64).toString('hex');unknownCredential.fill(0);
      // Locked placeholders retain attribution but intentionally have no space membership.
      const username='archived_'+id.replace(/-/g,'').slice(0,20);
      run('INSERT INTO users(id,username,display_name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',
        id,username,archived?.displayName||'Former contributor',fakeSalt,fakeHash,stamp);
      people.set(sourceId,id);return id;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      run('INSERT INTO users(id,username,display_name,salt,password_hash,created_at) VALUES(?,?,?,?,?,?)',ownerId,ownerUsername,'Imported space owner',salt,ownHash,stamp);
      run('INSERT INTO spaces(id,name,kind,owner_id,created_at) VALUES(?,?,?,?,?)',spaceId,data.space.name,data.space.kind,ownerId,data.space.createdAt);
      run("INSERT INTO memberships(space_id,user_id,role) VALUES(?,?,'owner')",spaceId,ownerId);
      for(const member of data.members)person(member.id);
      const channelIds=new Map();
      for(const channel of data.channels){const id=randomUUID();channelIds.set(channel.id,id);
        run('INSERT INTO channels(id,space_id,name,created_at) VALUES(?,?,?,?)',id,spaceId,channel.name,channel.createdAt);}
      const messageIds=new Map(data.messages.map(message=>[message.id,randomUUID()]));
      for(const message of data.messages)run('INSERT INTO messages(id,channel_id,author_id,body,created_at,updated_at,parent_id) VALUES(?,?,?,?,?,?,NULL)',
        messageIds.get(message.id),channelIds.get(message.channelId),person(message.authorId),message.body,message.createdAt,message.updatedAt??null);
      for(const message of data.messages)if(message.parentId)run('UPDATE messages SET parent_id=? WHERE id=?',messageIds.get(message.parentId),messageIds.get(message.id));
      for(const task of data.tasks)run('INSERT INTO tasks(id,space_id,author_id,title,done,created_at) VALUES(?,?,?,?,?,?)',
        randomUUID(),spaceId,person(task.authorId),task.title,task.done,task.createdAt);
      for(const note of data.notes)run('INSERT INTO notes(id,space_id,author_id,title,body,updated_at) VALUES(?,?,?,?,?,?)',
        randomUUID(),spaceId,person(note.authorId),note.title,note.body,note.updatedAt);
      for(const file of data.files){const id=randomUUID(),bytes=Buffer.from(file.contentBase64,'base64');
        if(bytes.length!==file.size || sha256(bytes)!==file.sha256)throw Error('Attachment verification failed during import');
        writeFileSync(join(dbPath+'.files',id),bytes,{flag:'wx',mode:0o600});
        run('INSERT INTO files(id,space_id,uploader_id,filename,size,sha256,created_at) VALUES(?,?,?,?,?,?,?)',
          id,spaceId,person(file.uploaderId),file.name,bytes.length,file.sha256,file.uploadedAt);}
      if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Imported foreign-key validation failed');
      if(db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok')throw Error('Imported SQLite validation failed');
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
    db.close();db=null;
    const report={schema:'goreecloud.workspace-teams.import.v1',importedAt:stamp,sourceSchema:data.schema,
      spaceId,channels:data.channels.length,messages:data.messages.length,tasks:data.tasks.length,
      notes:data.notes.length,files:data.files.length,archivedAccounts:people.size-1,
      access:'Only the new owner has a membership; historical contributors have no usable login credentials.'};
    writeFileSync(join(output,'import-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
    unlinkSync(snapshot);
    return {directory:output,database:dbPath,...report};
  } catch(error) {
    if(db){try{db.close();}catch{}}
    rmSync(output,{recursive:true,force:true});
    throw error;
  }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  const option=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined;};
  try{
    const result=importSpaceExport({source:option('--file'),destination:option('--dest'),
      ownerUsername:option('--owner'),ownerPasswordFile:option('--password-file')});
    console.log(`Verified isolated import: ${result.directory}; ${result.messages} messages, ${result.files} files. No existing instance was changed.`);
  }catch(error){console.error('Import failed: '+error.message);process.exitCode=1;}
}
