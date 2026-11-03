#!/usr/bin/env node
/** Create a consistent, non-overwriting SQLite snapshot without stopping the application. */
import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, chmodSync, copyFileSync, mkdirSync, rmSync, statSync, constants } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export async function backupDatabase({dbPath, outputPath}) {
  if (!dbPath || !outputPath) throw new Error('Both dbPath and outputPath are required');
  const sourcePath=resolve(dbPath), targetPath=resolve(outputPath);
  if (sourcePath===targetPath) throw new Error('Backup destination must differ from source');
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error('Source database not found');
  if (existsSync(targetPath)) throw new Error('Backup destination already exists; refusing to overwrite');
  mkdirSync(dirname(targetPath),{recursive:true,mode:0o700});
  const tempPath=resolve(dirname(targetPath),`.${basename(targetPath)}.${randomBytes(8).toString('hex')}.partial`);
  const db=new DatabaseSync(sourcePath,{readOnly:true});
  try {
    await backup(db,tempPath);
    const verified=new DatabaseSync(tempPath,{readOnly:true});
    try {
      const result=verified.prepare('PRAGMA integrity_check').get();
      if(result.integrity_check!=='ok')throw new Error('SQLite backup integrity verification failed');
    } finally { verified.close(); }
    chmodSync(tempPath,0o600);
    copyFileSync(tempPath,targetPath,constants.COPYFILE_EXCL);
    chmodSync(targetPath,0o600);
    return {path:targetPath,bytes:statSync(targetPath).size};
  } finally {
    db.close();
    rmSync(tempPath,{force:true});
  }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const value=flag=>{const at=args.indexOf(flag);return at>=0?args[at+1]:undefined;};
  const dbPath=value('--db') || process.env.DATA_PATH || './data/workspace.sqlite';
  const outputPath=value('--output');
  if (!outputPath || !outputPath.trim()) {
    console.error('Usage: node scripts/backup.mjs --db ./data/workspace.sqlite --output ./backups/workspace-YYYY-MM-DD.sqlite');
    process.exitCode=2;
  } else {
    try { const result=await backupDatabase({dbPath,outputPath}); console.log(`Verified backup: ${result.path} (${result.bytes} bytes)`); }
    catch(error) { console.error(`Backup failed: ${error.message}`); process.exitCode=1; }
  }
}
