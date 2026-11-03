#!/usr/bin/env node
/** Run one non-destructive, encrypted, self-hosted backup for use with an external scheduler. */
import {
  chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync,
  openSync, rmSync, statSync, writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEncryptedArchive } from './secure-archive.mjs';

const LOCK_NAME = '.workspace-teams-backup.lock';

function ensurePrivateDirectory(directory) {
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('Backup directory must be a real directory, not a symlink');
  }
  if (process.platform !== 'win32') {
    if ((info.mode & 0o077) !== 0) {
      throw new Error('Backup directory must be private (chmod 700)');
    }
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) {
      throw new Error('Backup directory must belong to the current user');
    }
  }
  // The backup file and lock must remain private regardless of the invoking shell's umask.
  chmodSync(directory, 0o700);
}

export async function runScheduledBackup({ dbPath, outputDir, passphraseFile, filesPath, now = new Date() } = {}) {
  if (!dbPath || !outputDir || !passphraseFile) {
    throw new Error('Database, output directory and private passphrase file are required');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf())) {
    throw new Error('Invalid backup timestamp');
  }
  const directory = resolve(outputDir);
  const source = resolve(dbPath);
  const passphrase = resolve(passphraseFile);
  if (directory === source || directory === passphrase) {
    throw new Error('Backup directory cannot be a source file');
  }
  if (dirname(source) === directory || dirname(passphrase) === directory) {
    throw new Error('Keep the live database and backup key outside the backup destination directory');
  }
  ensurePrivateDirectory(directory);

  // Exclusive create: concurrent timers fail closed; a crash leaves a lock for manual review.
  const lockPath = join(directory, LOCK_NAME);
  let fd;
  try {
    fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error('Backup lock exists: check the previous run before removing it manually');
    }
    throw error;
  }
  try {
    writeSync(fd, `pid=${process.pid} started=${new Date().toISOString()}\n`);
    const datePart = now.toISOString().replace(/[:.]/g, '-');
    const suffix = randomBytes(8).toString('hex');
    const archivePath = join(directory, `workspace-teams-${datePart}-${suffix}.gcws`);
    const result = await createEncryptedArchive({
      dbPath: source, outputPath: archivePath, filesPath, passphraseFile: passphrase,
    });
    if (!statSync(archivePath).isFile()) throw new Error('Encrypted archive not found after backup');
    return result;
  } finally {
    closeSync(fd);
    rmSync(lockPath, { force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const dbPath = value('--db') || process.env.DATA_PATH;
  const outputDir = value('--output-dir');
  const passphraseFile = value('--passphrase-file');
  const filesPath = value('--files') || process.env.FILES_PATH;
  if (!dbPath || !outputDir || !passphraseFile || args.includes('--help')) {
    console.error('Usage: node scripts/scheduled-backup.mjs --db DATABASE --output-dir PRIVATE_DIRECTORY --passphrase-file PRIVATE_KEY_FILE [--files ATTACHMENT_DIRECTORY]');
    process.exitCode = args.includes('--help') ? 0 : 2;
  } else {
    try {
      const result = await runScheduledBackup({ dbPath, outputDir, passphraseFile, filesPath });
      console.log(`Verified encrypted backup: ${result.archive} (${result.files} attachments; ${result.bytes} bytes)`);
    } catch (error) {
      console.error(`Encrypted backup failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
