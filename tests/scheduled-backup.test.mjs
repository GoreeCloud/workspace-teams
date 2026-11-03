import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync,
  readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/server.mjs';
import { restoreEncryptedArchive } from '../scripts/secure-archive.mjs';
import { runScheduledBackup } from '../scripts/scheduled-backup.mjs';

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'gcws-scheduler-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dbPath = join(root, 'active.sqlite');
  const app = createApplication({ dbPath, origin: 'http://localhost:3000' });
  app.close();
  const passphraseFile = join(root, 'secret');
  writeFileSync(passphraseFile, 'random-unique-test-key-for-backup-123456789\n', { mode: 0o600 });
  const outputDir = join(root, 'backups');
  return { root, dbPath, passphraseFile, outputDir };
}

test('scheduled invocation produces a private restorable encrypted archive without overwriting older archives', async t => {
  const f = setup(t);
  const now = new Date('2026-11-03T09:00:00.000Z');
  const first = await runScheduledBackup({ ...f, now });
  const second = await runScheduledBackup({ ...f, now });
  assert.notEqual(first.archive, second.archive);
  assert.ok(existsSync(first.archive));
  assert.ok(existsSync(second.archive));
  assert.equal(readFileSync(first.archive).subarray(0, 8).toString('ascii'), 'GCWSENC1');
  assert.equal(lstatSync(first.archive).mode & 0o077, 0);
  assert.equal(lstatSync(f.outputDir).mode & 0o077, 0);
  assert.equal(readdirSync(f.outputDir).length, 2);
  const result = await restoreEncryptedArchive({
    source: first.archive, destination: join(f.root, 'restored'), passphraseFile: f.passphraseFile,
  });
  assert.ok(existsSync(result.database));
  assert.equal(result.files, 0);
});

test('backup lock prevents concurrent invocation and is never silently removed', async t => {
  const f = setup(t);
  const first = await runScheduledBackup(f);
  const lock = join(f.outputDir, '.workspace-teams-backup.lock');
  writeFileSync(lock, 'simulated in-progress backup', { flag: 'wx', mode: 0o600 });
  await assert.rejects(() => runScheduledBackup(f), /Backup lock exists/);
  assert.equal(readFileSync(lock, 'utf8'), 'simulated in-progress backup');
  assert.deepEqual(readdirSync(f.outputDir).sort(), [lock.split('/').pop(), first.archive.split('/').pop()].sort());
});

test('private directory and symlink guard reject unsafe backup destinations', async t => {
  const f = setup(t);
  const outside = join(f.root, 'outside');
  const linked = join(f.root, 'shortcut');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(outside, { mode: 0o700 });
  symlinkSync(outside, linked);
  await assert.rejects(() => runScheduledBackup({ ...f, outputDir: linked }), /not a symlink/);
  const directory = join(f.root, 'insecure');
  mkdirSync(directory, { mode: 0o755 });
  if (process.platform !== 'win32') {
    chmodSync(directory, 0o755);
    await assert.rejects(() => runScheduledBackup({ ...f, outputDir: directory }), /chmod 700/);
  }
  assert.equal(readdirSync(outside).length, 0);
});

test('failed backup leaves no archive or stale owned lock and preserves original data', async t => {
  const f = setup(t);
  await assert.rejects(() => runScheduledBackup({ ...f, dbPath: join(f.root, 'missing.sqlite') }), /Source database not found/);
  assert.equal(readdirSync(f.outputDir).length, 0);
  assert.ok(existsSync(f.dbPath));
});
