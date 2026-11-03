#!/usr/bin/env node
/** Restore a verified offline snapshot to a new, private directory. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, lstatSync, mkdirSync, readFileSync, copyFileSync, chmodSync, rmSync, constants } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const regular = path => existsSync(path) && lstatSync(path).isFile();
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function verifyDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database foreign-key integrity check failed');
    return db.prepare('SELECT id,size,sha256 FROM files ORDER BY id').all();
  } finally { db.close(); }
}

export function restoreSnapshot({ source, destination } = {}) {
  if (!source || !destination) throw new Error('Both source and destination are required');
  const sourcePath = resolve(source), dest = resolve(destination);
  if (!regular(sourcePath)) throw new Error('Source snapshot must be a regular file');
  if (existsSync(dest)) throw new Error('Destination must be a new, nonexistent directory');
  if (dest === sourcePath || dest.startsWith(sourcePath + '/')) throw new Error('Invalid destination');
  if (existsSync(sourcePath + '-wal') && lstatSync(sourcePath + '-wal').size > 0)
    throw new Error('Source has uncheckpointed SQLite WAL content; restore an offline snapshot');

  const records = verifyDatabase(sourcePath);
  const attachmentDir = sourcePath + '.files';
  if (records.length && (!existsSync(attachmentDir) || !lstatSync(attachmentDir).isDirectory()))
    throw new Error('Attachment backup directory missing or unsafe');
  for (const file of records) {
    if (!/^[0-9a-f-]{36}$/.test(file.id)) throw new Error('Invalid attachment ID in snapshot');
    const filePath = join(attachmentDir, file.id);
    if (!regular(filePath)) throw new Error('Missing or unsafe attachment: ' + file.id);
    const bytes = readFileSync(filePath);
    if (bytes.length !== file.size || digest(bytes) !== file.sha256)
      throw new Error('Attachment integrity check failed: ' + file.id);
  }
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
  mkdirSync(dest, { mode: 0o700 }); // Exclusive destination; existing data is never overwritten.
  try {
    const restoredDb = join(dest, 'workspace.sqlite');
    copyFileSync(sourcePath, restoredDb, constants.COPYFILE_EXCL);
    chmodSync(restoredDb, 0o600);
    const restoredAttachments = restoredDb + '.files';
    if (records.length) {
      mkdirSync(restoredAttachments, { mode: 0o700 });
      for (const file of records) {
        const target = join(restoredAttachments, file.id);
        copyFileSync(join(attachmentDir, file.id), target, constants.COPYFILE_EXCL);
        chmodSync(target, 0o600);
      }
    }
    const after = verifyDatabase(restoredDb);
    if (after.length !== records.length) throw new Error('Restored attachment index changed');
    for (const file of after) {
      const bytes = readFileSync(join(restoredAttachments, file.id));
      if (bytes.length !== file.size || digest(bytes) !== file.sha256)
        throw new Error('Restored attachment integrity check failed: ' + file.id);
    }
    return { database: restoredDb, files: after.length, directory: dest };
  } catch (error) {
    rmSync(dest, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const source = value('--from'), destination = value('--dest');
  if (!source || !destination) {
    console.error('Usage: node scripts/restore.mjs --from ./backups/workspace.sqlite --dest ./restored-new-instance');
    process.exitCode = 2;
  } else {
    try {
      const result = restoreSnapshot({ source, destination });
      console.log('Verified isolated restore: ' + result.database + ' (' + result.files + ' attachments)');
    } catch (error) {
      console.error('Restore failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
