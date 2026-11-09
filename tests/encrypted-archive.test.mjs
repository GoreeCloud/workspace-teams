import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';
import { createEncryptedArchive, restoreEncryptedArchive } from '../scripts/secure-archive.mjs';

const ORIGIN = 'http://localhost:3000';
const password = 'unique-backup-test-secret-passphrase-1234';

async function listen(app) {
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return `http://127.0.0.1:${app.server.address().port}`;
}
async function stop(app) { await new Promise(done => app.server.close(done)); app.close(); }
async function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'ws-encrypted-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const passphraseFile = join(folder, 'backup-passphrase');
  writeFileSync(passphraseFile, password + '\n', { mode: 0o600 });
  const dbPath = join(folder, 'active.sqlite');
  const app = createApplication({ dbPath, origin: ORIGIN });
  const endpoint = await listen(app);
  let stopped = false;
  t.after(async () => { if (!stopped) await stop(app); });
  const bootstrap = await fetch(endpoint + '/api/bootstrap', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'correct-horse-battery-1234' }),
  });
  assert.equal(bootstrap.status, 201);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const spaces = await fetch(endpoint + '/api/spaces', { headers: { Cookie: cookie } });
  const space = (await spaces.json()).spaces[0];
  const payload = 'ENCRYPTED_ONLY_' + 'file contents for recovery';
  const upload = await fetch(endpoint + `/api/spaces/${space.id}/files?name=personal.txt`, {
    method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/octet-stream' }, body: payload,
  });
  assert.equal(upload.status, 201);
  const file = (await upload.json()).file;
  return { folder, passphraseFile, dbPath, file, payload, cookie, endpoint,
    stop: async () => { await stop(app); stopped = true; } };
}

test('encrypted snapshot is self-contained and restores authenticated data and private attachment', async t => {
  const f = await fixture(t);
  const archive = join(f.folder, 'safe.gcws');
  const created = await createEncryptedArchive({ dbPath: f.dbPath, outputPath: archive, passphraseFile: f.passphraseFile });
  assert.equal(created.files, 1);
  assert.ok(statSync(archive).size > 120);
  const archiveBytes = readFileSync(archive);
  assert.equal(archiveBytes.subarray(0, 8).toString('ascii'), 'GCWSENC1');
  assert.equal(archiveBytes.includes(Buffer.from(f.payload)), false);
  assert.equal(archiveBytes.includes(Buffer.from('SQLite format 3')), false);
  assert.equal(existsSync(archive + '.files'), false);
  await f.stop();
  const restored = await restoreEncryptedArchive({ source: archive, destination: join(f.folder, 'restored'), passphraseFile: f.passphraseFile });
  assert.equal(restored.files, 1);
  assert.equal(readFileSync(join(f.folder, 'restored', 'workspace.sqlite.files', f.file.id), 'utf8'), f.payload);
  const newApp = createApplication({ dbPath: restored.database, origin: ORIGIN });
  try {
    const endpoint = await listen(newApp);
    const download = await fetch(endpoint + `/api/files/${f.file.id}/download`, { headers: { Cookie: f.cookie } });
    assert.equal(download.status, 200);
    assert.equal(await download.text(), f.payload);
    assert.equal((await fetch(endpoint + `/api/files/${f.file.id}/download`)).status, 401);
  } finally { await stop(newApp); }
  await assert.rejects(() => restoreEncryptedArchive({ source: archive, destination: join(f.folder, 'restored'), passphraseFile: f.passphraseFile }), /nonexistent/);
  await assert.rejects(() => createEncryptedArchive({ dbPath: f.dbPath, outputPath: archive, passphraseFile: f.passphraseFile }), /already exists/);
});

test('wrong passphrase and encrypted byte tampering fail before creating a restore destination', async t => {
  const f = await fixture(t);
  const archive = join(f.folder, 'safe.gcws');
  await createEncryptedArchive({ dbPath: f.dbPath, outputPath: archive, passphraseFile: f.passphraseFile });
  const different = join(f.folder, 'wrong-key');
  writeFileSync(different, 'a-totally-unrelated-passphrase-5678', { mode: 0o600 });
  const target = join(f.folder, 'never-created');
  await assert.rejects(() => restoreEncryptedArchive({ source: archive, destination: target, passphraseFile: different }), /authentication failed/);
  assert.equal(existsSync(target), false);
  const corrupted = join(f.folder, 'tampered.gcws');
  const bytes = readFileSync(archive);
  bytes[bytes.length - 22] ^= 0x20;
  writeFileSync(corrupted, bytes, { mode: 0o600 });
  await assert.rejects(() => restoreEncryptedArchive({ source: corrupted, destination: target, passphraseFile: f.passphraseFile }), /authentication failed/);
  assert.equal(existsSync(target), false);
  const truncated = join(f.folder, 'short.gcws');
  writeFileSync(truncated, bytes.subarray(0, 38), { mode: 0o600 });
  await assert.rejects(() => restoreEncryptedArchive({ source: truncated, destination: target, passphraseFile: f.passphraseFile }), /Incomplete encrypted archive/);
  assert.equal(existsSync(target), false);
});

test('weak or insecure passphrase files are rejected before creating encrypted output', async t => {
  const f = await fixture(t);
  const short = join(f.folder, 'too-short');
  writeFileSync(short, 'short', { mode: 0o600 });
  const output = join(f.folder, 'should-not-exist.gcws');
  await assert.rejects(() => createEncryptedArchive({ dbPath: f.dbPath, outputPath: output, passphraseFile: short }), /at least 16/);
  assert.equal(existsSync(output), false);
  if (process.platform !== 'win32') {
    const publicPath = join(f.folder, 'unsafe-key');
    writeFileSync(publicPath, 'long-enough-but-not-private-passphrase', { mode: 0o644 });
    // The process may have a restrictive umask (e.g. 077); make the fixture
    // demonstrably insecure rather than assuming create mode wins over umask.
    chmodSync(publicPath, 0o644);
    assert.equal(statSync(publicPath).mode & 0o077, 0o044);
    await assert.rejects(() => createEncryptedArchive({ dbPath: f.dbPath, outputPath: output, passphraseFile: publicPath }), /chmod 600/);
    assert.equal(existsSync(output), false);
    const link = join(f.folder, 'linked-secret');
    symlinkSync(f.passphraseFile, link);
    await assert.rejects(() => createEncryptedArchive({ dbPath: f.dbPath, outputPath: output, passphraseFile: link }), /regular file/);
    assert.equal(existsSync(output), false);
  }
  const oversized = join(f.folder, 'overlong-secret');
  writeFileSync(oversized, 'x'.repeat(4097), { mode: 0o600 });
  await assert.rejects(() => createEncryptedArchive({ dbPath: f.dbPath, outputPath: output, passphraseFile: oversized }), /exceeds the supported limit/);
  assert.equal(existsSync(output), false);
});
