import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, renameSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';

const ORIGIN = 'http://localhost:3000';

test('downloads and file-inclusive exports refuse symlinked attachments even with matching contents', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'gcws-private-route-'));
  const dbPath = join(folder, 'db.sqlite');
  const app = createApplication({ dbPath, origin: ORIGIN });
  t.after(async () => {
    await new Promise(done => app.server.close(done));
    app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const bootstrap = await fetch(base + '/api/bootstrap', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'long-enough-synthetic-password' }),
  });
  assert.equal(bootstrap.status, 201);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const space = (await (await fetch(base + '/api/spaces', { headers: { Cookie: cookie } })).json()).spaces[0];
  const payload = Buffer.from([0, 1, 2, 255, 48]);
  const upload = await fetch(base + '/api/spaces/' + space.id + '/files?name=sample.bin', {
    method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/octet-stream' },
    body: payload,
  });
  assert.equal(upload.status, 201);
  const file = (await upload.json()).file;
  const downloadUrl = base + '/api/files/' + file.id + '/download';
  const exportUrl = base + '/api/spaces/' + space.id + '/export?includeFiles=1';
  const headers = { Cookie: cookie };
  const download = await fetch(downloadUrl, { headers });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), payload);
  const validExport = await fetch(exportUrl, { headers });
  assert.equal(validExport.status, 200);
  const path = dbPath + '.files/' + file.id;
  const sameBytes = join(folder, 'regular-copy');
  renameSync(path, sameBytes);
  symlinkSync(sameBytes, path);
  assert.equal((await fetch(downloadUrl, { headers })).status, 500);
  assert.equal((await fetch(exportUrl, { headers })).status, 500);
  unlinkSync(path);
  renameSync(sameBytes, path);
  const restoredDownload = await fetch(downloadUrl, { headers });
  assert.equal(restoredDownload.status, 200);
  assert.deepEqual(Buffer.from(await restoredDownload.arrayBuffer()), payload);
  assert.equal((await fetch(exportUrl, { headers })).status, 200);
});
