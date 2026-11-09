import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, renameSync, symlinkSync, unlinkSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';
import { backupDatabase } from '../scripts/backup.mjs';
import { restoreSnapshot } from '../scripts/restore.mjs';

const ORIGIN = 'http://localhost:3000';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gcws-verified-backup-'));
  const dbPath = join(directory, 'source.sqlite');
  const app = createApplication({ dbPath, origin: ORIGIN });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const url = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const registered = await fetch(url + '/api/bootstrap', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'testowner', password: 'long-synthetic-password-for-file-backup' }),
  });
  assert.equal(registered.status, 201);
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  const { spaces } = await (await fetch(url + '/api/spaces', { headers: { Cookie: cookie } })).json();
  const content = Buffer.from('VERIFIED_BINARY_\0_attachment\xff', 'latin1');
  const uploaded = await fetch(url + '/api/spaces/' + spaces[0].id + '/files?name=verified.bin', {
    method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/octet-stream' },
    body: content,
  });
  assert.equal(uploaded.status, 201);
  const id = (await uploaded.json()).file.id;
  return { directory, dbPath, content, id, sourceFile: dbPath + '.files/' + id };
}

test('backup snapshots the exact verified attachment bytes and restores them', async t => {
  const f = await fixture(t);
  const target = join(f.directory, 'snapshot.sqlite');
  const result = await backupDatabase({ dbPath: f.dbPath, outputPath: target });
  assert.equal(result.files, 1);
  assert.deepEqual(readFileSync(target + '.files/' + f.id), f.content);
  const restored = restoreSnapshot({ source: target, destination: join(f.directory, 'restored') });
  assert.equal(restored.files, 1);
  assert.deepEqual(readFileSync(restored.database + '.files/' + f.id), f.content);
});

test('backup refuses a symlinked attachment even if the target has identical bytes', async t => {
  const f = await fixture(t);
  const original = join(f.directory, 'same-bytes');
  renameSync(f.sourceFile, original);
  symlinkSync(original, f.sourceFile);
  const target = join(f.directory, 'must-not-publish.sqlite');
  await assert.rejects(backupDatabase({ dbPath: f.dbPath, outputPath: target }), /Attachment integrity verification failed/);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(target + '.files'), false);
  assert.deepEqual(readFileSync(original), f.content);
  unlinkSync(f.sourceFile);
  renameSync(original, f.sourceFile);
  const created = await backupDatabase({ dbPath: f.dbPath, outputPath: target });
  assert.equal(created.files, 1);
});

test('backup rejects modified attachment content and does not publish partial snapshots', async t => {
  const f = await fixture(t);
  writeFileSync(f.sourceFile, 'tampered-file-contents');
  const target = join(f.directory, 'damaged.sqlite');
  await assert.rejects(backupDatabase({ dbPath: f.dbPath, outputPath: target }), /Attachment integrity verification failed/);
  assert.equal(existsSync(target), false);
  assert.equal(existsSync(target + '.files'), false);
});
