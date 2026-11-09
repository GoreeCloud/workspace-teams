#!/usr/bin/env node
/** Create a consistent, non-overwriting SQLite snapshot without stopping the application. */
import { backup, DatabaseSync } from 'node:sqlite';
import { existsSync, chmodSync, copyFileSync, writeFileSync, mkdirSync, rmSync, statSync, constants, renameSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readVerifiedAttachment } from '../src/read-attachment.mjs';
import { fileURLToPath } from 'node:url';

export async function backupDatabase({dbPath, outputPath, filesPath}) {
  if (!dbPath || !outputPath) throw new Error('Both dbPath and outputPath are required');
  const sourcePath=resolve(dbPath), targetPath=resolve(outputPath);
  if (sourcePath===targetPath) throw new Error('Backup destination must differ from source');
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error('Source database not found');
  const sourceFiles=resolve(filesPath || `${sourcePath}.files`),targetFiles=`${targetPath}.files`;
  if (existsSync(targetPath)||existsSync(targetFiles)) throw new Error('Backup destination already exists; refusing to overwrite');
  mkdirSync(dirname(targetPath),{recursive:true,mode:0o700});
  const tempPath=resolve(dirname(targetPath),`.${basename(targetPath)}.${randomBytes(8).toString('hex')}.partial`);
  const db=new DatabaseSync(sourcePath,{readOnly:true});
  const tempFiles=`${tempPath}.files`;let stagedSidecar=false;
  try {
    await backup(db,tempPath);
    const verified=new DatabaseSync(tempPath,{readOnly:true});
    try {
      const result=verified.prepare('PRAGMA integrity_check').get();
      if(result.integrity_check!=='ok')throw new Error('SQLite backup integrity verification failed');
      const records=verified.prepare('SELECT id,size,sha256 FROM files ORDER BY id').all();
      if(records.length){
        mkdirSync(tempFiles,{recursive:false,mode:0o700});
        for(const file of records){
          if(!/^[0-9a-f-]{36}$/.test(file.id))throw new Error('Invalid stored attachment ID');
          // Verify a single opened descriptor, then snapshot precisely those bytes.
          // Never reopen the source between digest verification and copy.
          let data;
          try { data=readVerifiedAttachment(join(sourceFiles,file.id),file.size,file.sha256); }
          catch { throw new Error(`Attachment integrity verification failed: ${file.id}`); }
          try {
            writeFileSync(join(tempFiles,file.id),data,{flag:'wx',mode:0o600});
          } finally { data.fill(0); }
          chmodSync(join(tempFiles,file.id),0o600);
        }
        renameSync(tempFiles,targetFiles);stagedSidecar=true;
      }
      chmodSync(tempPath,0o600);
      copyFileSync(tempPath,targetPath,constants.COPYFILE_EXCL);
      chmodSync(targetPath,0o600);
      return {path:targetPath,bytes:statSync(targetPath).size,files:records.length};
    } finally { verified.close(); }
  } catch(e) {
    if(stagedSidecar && !existsSync(targetPath))rmSync(targetFiles,{recursive:true,force:true});
    throw e;
  } finally {
    db.close();
    rmSync(tempPath,{force:true});rmSync(tempFiles,{recursive:true,force:true});
  }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  const value=flag=>{const at=args.indexOf(flag);return at>=0?args[at+1]:undefined;};
  const dbPath=value('--db') || process.env.DATA_PATH || './data/workspace.sqlite';
  const outputPath=value('--output');
  const filesPath=value('--files') || process.env.FILES_PATH;
  if (!outputPath || !outputPath.trim()) {
    console.error('Usage: node scripts/backup.mjs --db ./data/workspace.sqlite --output ./backups/workspace-YYYY-MM-DD.sqlite');
    process.exitCode=2;
  } else {
    try { const result=await backupDatabase({dbPath,outputPath,filesPath}); console.log(`Verified backup: ${result.path} (${result.bytes} bytes; ${result.files} attachments)`); }
    catch(error) { console.error(`Backup failed: ${error.message}`); process.exitCode=1; }
  }
}
