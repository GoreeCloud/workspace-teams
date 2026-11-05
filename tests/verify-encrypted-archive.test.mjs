import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';
import { createEncryptedArchive } from '../scripts/secure-archive.mjs';
import { verifyEncryptedArchive } from '../scripts/verify-encrypted-archive.mjs';

const ORIGIN = 'http://localhost:3000';

async function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'gcws-archive-verify-test-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const dbPath = join(folder, 'active.sqlite'), passphraseFile = join(folder, 'private-key');
  writeFileSync(passphraseFile, 'long-test-only-key-not-a-real-secret-1234\n', { mode: 0o600 });
  const app = createApplication({ dbPath, origin: ORIGIN });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const request = async (path, { method = 'GET', cookie, data, type = 'application/json' } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(method !== 'GET' ? { Origin: ORIGIN } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data === undefined ? {} : { 'Content-Type': type }) },
      body: data,
    });
    return response;
  };
  try {
    const owner = await request('/api/bootstrap', {
      method: 'POST', data: JSON.stringify({ username: 'owner', password: 'long-password-for-verified-backup' }),
    });
    assert.equal(owner.status, 201);
    const cookie = owner.headers.get('set-cookie').split(';')[0];
    const spaces = await (await request('/api/spaces', { cookie })).json();
    const spaceId = spaces.spaces[0].id;
    const upload = await request('/api/spaces/' + spaceId + '/files?name=sample.bin', {
      method: 'POST', cookie, type: 'application/octet-stream', data: Buffer.from([2, 3, 255, 0]),
    });
    assert.equal(upload.status, 201);
  } finally {
    await new Promise(done => app.server.close(done));
    app.close();
  }
  const source = join(folder, 'private-archive.gcws');
  await createEncryptedArchive({ dbPath, outputPath: source, passphraseFile });
  return { source, passphraseFile, folder, dbPath };
}

test('verification restores and checks attachments offline without changing archive or live data', async t => {
  const f = await fixture(t);
  const original = readFileSync(f.source);
  const dbOriginal = readFileSync(f.dbPath);
  const result = await verifyEncryptedArchive({ source: f.source, passphraseFile: f.passphraseFile });
  assert.equal(result.verified, true);
  assert.equal(result.files, 1);
  assert.deepEqual(readFileSync(f.source), original);
  assert.deepEqual(readFileSync(f.dbPath), dbOriginal);
  assert.deepEqual(readdirSync(f.folder).filter(n => n.startsWith('verified-instance')), []);
});

test('wrong passphrase and tampered bytes are rejected without touching original archives', async t => {
  const f = await fixture(t);
  const invalidKey = join(f.folder, 'other-key');
  writeFileSync(invalidKey, 'another-completely-different-strong-test-key', { mode: 0o600 });
  await assert.rejects(
    () => verifyEncryptedArchive({ source: f.source, passphraseFile: invalidKey }), /authentication failed/,
  );
  const tampered = join(f.folder, 'tampered.gcws');
  const altered = readFileSync(f.source);
  altered[altered.length - 25] ^= 1;
  writeFileSync(tampered, altered, { mode: 0o600 });
  await assert.rejects(
    () => verifyEncryptedArchive({ source: tampered, passphraseFile: f.passphraseFile }), /authentication failed/,
  );
  assert.equal(existsSync(f.source), true);
  assert.equal(existsSync(tampered), true);
});

test('verification rejects missing archive and key options', async () => {
  await assert.rejects(() => verifyEncryptedArchive({}), /required/);
});
