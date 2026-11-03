#!/usr/bin/env node
/** Offline authenticated-encryption wrapper for verified Workspace Teams SQLite snapshots. */
import {
  createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync,
} from 'node:crypto';
import {
  chmodSync, closeSync, createReadStream, createWriteStream, existsSync, lstatSync,
  mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync,
  writeFileSync, writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { backupDatabase } from './backup.mjs';
import { restoreSnapshot } from './restore.mjs';

const MAGIC = Buffer.from('GCWSENC1', 'ascii');
const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + NONCE_BYTES;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_ENTRIES = 100000;
const KDF_OPTIONS = Object.freeze({ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

function regularFile(file) {
  return existsSync(file) && lstatSync(file).isFile();
}
function makeTemp() {
  const folder = mkdtempSync(join(tmpdir(), 'gcws-archive-'));
  chmodSync(folder, 0o700);
  return folder;
}
function secretFromFile(path) {
  if (!path) throw new Error('A --passphrase-file is required; secrets are never accepted in command-line arguments');
  const location = resolve(path);
  if (!regularFile(location)) throw new Error('Passphrase source must be a regular file (not a symlink)');
  if (process.platform !== 'win32' && (lstatSync(location).mode & 0o077)) {
    throw new Error('Passphrase file must not be accessible by group or others (chmod 600)');
  }
  const raw = readFileSync(location);
  if (raw.length > 4096) throw new Error('Passphrase file exceeds the supported limit');
  const passphrase = raw.toString('utf8').replace(/\r?\n$/, '');
  raw.fill(0);
  if (Buffer.byteLength(passphrase, 'utf8') < 16) throw new Error('Passphrase must contain at least 16 UTF-8 bytes');
  return passphrase;
}
function derive(passphrase, salt) {
  return scryptSync(passphrase, salt, 32, KDF_OPTIONS);
}
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
function fileEntries(snapshot) {
  const results = [{ path: 'workspace.sqlite', source: snapshot }];
  const sidecar = `${snapshot}.files`;
  if (existsSync(sidecar)) {
    // The backup helper writes only UUID-named referenced attachments, never symlinks.
    for (const id of readdirSync(sidecar).sort()) {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Unexpected file name in verified attachment backup');
      results.push({ path: `files/${id}`, source: join(sidecar, id) });
    }
  }
  if (results.length > MAX_ENTRIES) throw new Error('Backup contains too many files');
  return results;
}
export async function createEncryptedArchive({ dbPath, outputPath, filesPath, passphraseFile } = {}) {
  if (!dbPath || !outputPath) throw new Error('Both dbPath and outputPath are required');
  const archive = resolve(outputPath);
  const source = resolve(dbPath);
  if (archive === source || (passphraseFile && archive === resolve(passphraseFile))) {
    throw new Error('Archive cannot overwrite its database or passphrase source');
  }
  if (existsSync(archive)) throw new Error('Archive already exists; refusing to overwrite');
  const passphrase = secretFromFile(passphraseFile);
  const staging = makeTemp();
  const snapshot = join(staging, 'snapshot.sqlite');
  let archiveCreated = false;
  try {
    const backup = await backupDatabase({ dbPath: source, outputPath: snapshot, filesPath });
    const entries = [];
    for (const item of fileEntries(snapshot)) {
      if (!regularFile(item.source)) throw new Error('Unsafe backup entry');
      entries.push({ path: item.path, size: statSync(item.source).size,
        sha256: await sha256(item.source), source: item.source });
    }
    if (!backup || entries.length !== backup.files + 1) throw new Error('Attachment snapshot count changed');
    const manifest = Buffer.from(JSON.stringify({ version: 1, entries: entries.map(({ path, size, sha256: digest }) => ({ path, size, sha256: digest })) }), 'utf8');
    if (manifest.length > MAX_MANIFEST_BYTES) throw new Error('Backup manifest is too large');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(manifest.length);
    const salt = randomBytes(SALT_BYTES), nonce = randomBytes(NONCE_BYTES);
    const header = Buffer.concat([MAGIC, salt, nonce]);
    const key = derive(passphrase, salt);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    key.fill(0);
    cipher.setAAD(header);
    mkdirSync(dirname(archive), { recursive: true, mode: 0o700 });
    const fd = openSync(archive, 'wx', 0o600);
    archiveCreated = true;
    try {
      writeSync(fd, header);
      async function* plaintext() {
        yield length;
        yield manifest;
        for (const entry of entries) for await (const bytes of createReadStream(entry.source)) yield bytes;
      }
      await pipeline(Readable.from(plaintext()), cipher, createWriteStream(archive, { fd, autoClose: false }));
      writeSync(fd, cipher.getAuthTag());
    } finally {
      closeSync(fd);
    }
    chmodSync(archive, 0o600);
    return { archive, files: entries.length - 1, bytes: statSync(archive).size };
  } catch (error) {
    if (archiveCreated) rmSync(archive, { force: true });
    throw error;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

function loadManifest(payload) {
  const fd = openSync(payload, 'r');
  try {
    const prelude = Buffer.alloc(4);
    if (readSync(fd, prelude, 0, 4, 0) !== 4) throw new Error('Invalid decrypted archive length');
    const length = prelude.readUInt32BE(0);
    if (length < 10 || length > MAX_MANIFEST_BYTES) throw new Error('Invalid encrypted archive manifest size');
    const header = Buffer.alloc(length);
    if (readSync(fd, header, 0, length, 4) !== length) throw new Error('Incomplete encrypted archive manifest');
    let manifest;
    try { manifest = JSON.parse(header.toString('utf8')); } catch { throw new Error('Invalid encrypted archive manifest'); }
    if (manifest.version !== 1 || !Array.isArray(manifest.entries) || manifest.entries.length < 1 || manifest.entries.length > MAX_ENTRIES) {
      throw new Error('Unsupported encrypted archive structure');
    }
    const paths = new Set();
    let total = 4 + length;
    for (const [index, entry] of manifest.entries.entries()) {
      if (!entry || typeof entry.path !== 'string' ||
          !(index === 0 ? entry.path === 'workspace.sqlite' : /^files\/[0-9a-f-]{36}$/.test(entry.path)) ||
          paths.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size < 0 ||
          !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Invalid archive file metadata');
      paths.add(entry.path);
      total += entry.size;
      if (!Number.isSafeInteger(total)) throw new Error('Archive size out of range');
    }
    if (total !== statSync(payload).size) throw new Error('Encrypted archive payload size mismatch');
    return { entries: manifest.entries, offset: 4 + length };
  } finally {
    closeSync(fd);
  }
}

export async function restoreEncryptedArchive({ source, destination, passphraseFile } = {}) {
  if (!source || !destination) throw new Error('Both source and destination are required');
  const archive = resolve(source), dest = resolve(destination);
  if (!regularFile(archive)) throw new Error('Encrypted archive must be a regular file');
  if (existsSync(dest)) throw new Error('Destination must be a new, nonexistent directory');
  if (dest === archive || (passphraseFile && dest === resolve(passphraseFile))) throw new Error('Invalid restore destination');
  const passphrase = secretFromFile(passphraseFile);
  const size = statSync(archive).size;
  if (size < HEADER_BYTES + TAG_BYTES + 6) throw new Error('Incomplete encrypted archive');
  const fd = openSync(archive, 'r');
  const header = Buffer.alloc(HEADER_BYTES), tag = Buffer.alloc(TAG_BYTES);
  try {
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        readSync(fd, tag, 0, tag.length, size - TAG_BYTES) !== tag.length ||
        !header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Invalid encrypted archive header');
  } finally { closeSync(fd); }
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const nonce = header.subarray(MAGIC.length + SALT_BYTES);
  const key = derive(passphrase, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  key.fill(0);
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const staging = makeTemp(), payload = join(staging, 'payload.bin');
  try {
    try {
      await pipeline(
        createReadStream(archive, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }),
        decipher,
        createWriteStream(payload, { flags: 'wx', mode: 0o600 }),
      );
    } catch { throw new Error('Encrypted archive authentication failed (wrong passphrase or damaged archive)'); }
    const { entries, offset } = loadManifest(payload);
    const unpacked = join(staging, 'snapshot.sqlite');
    let at = offset;
    for (const entry of entries) {
      const target = entry.path === 'workspace.sqlite' ? unpacked : join(`${unpacked}.files`, basename(entry.path));
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      if (!entry.size) writeFileSync(target, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
      else await pipeline(createReadStream(payload, { start: at, end: at + entry.size - 1 }),
        createWriteStream(target, { flags: 'wx', mode: 0o600 }));
      at += entry.size;
      if (await sha256(target) !== entry.sha256) throw new Error('Decrypted archive file integrity check failed');
    }
    const restored = restoreSnapshot({ source: unpacked, destination: dest });
    return { ...restored, encrypted: true };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [verb, ...args] = process.argv.slice(2);
  const value = flag => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  try {
    if (verb === 'backup') {
      const result = await createEncryptedArchive({ dbPath: value('--db') || process.env.DATA_PATH || './data/workspace.sqlite',
        outputPath: value('--output'), filesPath: value('--files') || process.env.FILES_PATH,
        passphraseFile: value('--passphrase-file') });
      console.log(`Verified encrypted archive: ${result.archive} (${result.files} attachments)`);
    } else if (verb === 'restore') {
      const result = await restoreEncryptedArchive({ source: value('--from'), destination: value('--dest'),
        passphraseFile: value('--passphrase-file') });
      console.log(`Verified isolated encrypted restore: ${result.database} (${result.files} attachments)`);
    } else {
      console.error('Usage: secure-archive.mjs backup --db DATABASE --output ARCHIVE --passphrase-file SECRETFILE | restore --from ARCHIVE --dest NEWDIR --passphrase-file SECRETFILE');
      process.exitCode = 2;
    }
  } catch (error) { console.error(`Encrypted ${verb || 'archive'} failed: ${error.message}`); process.exitCode = 1; }
}
