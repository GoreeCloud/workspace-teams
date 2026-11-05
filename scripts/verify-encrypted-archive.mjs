#!/usr/bin/env node
/** Verify one encrypted backup by restoring it into an isolated, disposable directory. */
import { chmodSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreEncryptedArchive } from './secure-archive.mjs';

/**
 * Reuse the complete authenticated decryption, manifest, SQLite integrity,
 * foreign-key, and attachment-digest checks of the isolated restore path.
 * Never modify the supplied archive, key, or an existing application database.
 * Plaintext is temporarily present on the local filesystem: use trusted,
 * encrypted temporary storage for sensitive backups.
 */
export async function verifyEncryptedArchive({ source, passphraseFile } = {}) {
  if (!source || !passphraseFile) throw new Error('Archive source and private passphrase file are required');
  const staging = mkdtempSync(join(tmpdir(), 'gcws-verify-'));
  try {
    chmodSync(staging, 0o700);
    const restored = await restoreEncryptedArchive({
      source, destination: join(staging, 'verified-instance'), passphraseFile,
    });
    return Object.freeze({ verified: true, files: restored.files });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = flag => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
  const source = value('--from'), passphraseFile = value('--passphrase-file');
  if (!source || !passphraseFile || args.includes('--help')) {
    console.error('Usage: node scripts/verify-encrypted-archive.mjs --from ARCHIVE.gcws --passphrase-file PRIVATE_KEY_FILE');
    process.exitCode = args.includes('--help') ? 0 : 2;
  } else {
    try {
      const result = await verifyEncryptedArchive({ source, passphraseFile });
      console.log('Authenticated archive and isolated recovery verified (' + result.files + ' attachments)');
    } catch (error) {
      console.error('Encrypted archive verification failed: ' + error.message);
      process.exitCode = 1;
    }
  }
}
