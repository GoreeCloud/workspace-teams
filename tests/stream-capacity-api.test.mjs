import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';

const ORIGIN = 'http://localhost:3000';

test('SSE endpoints cap connections per user and recover capacity after disconnect', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'gcws-stream-cap-api-'));
  const app = createApplication({ dbPath: join(folder, 'db.sqlite'), origin: ORIGIN });
  const controllers = [];
  t.after(async () => {
    for (const controller of controllers) controller.abort();
    await new Promise(done => app.server.close(done));
    app.close();
    rmSync(folder, { recursive: true, force: true });
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const owner = await fetch(base + '/api/bootstrap', {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'owner', password: 'strong-test-only-password-2026' }),
  });
  assert.equal(owner.status, 201);
  const cookie = owner.headers.get('set-cookie').split(';')[0];
  const space = (await (await fetch(base + '/api/spaces', { headers: { Cookie: cookie } })).json()).spaces[0];
  const channel = (await (await fetch(base + '/api/spaces/' + space.id + '/channels', {
    headers: { Cookie: cookie },
  })).json()).channels[0];
  const url = base + '/api/channels/' + channel.id + '/stream';
  const startStream = async () => {
    const controller = new AbortController();
    controllers.push(controller);
    return fetch(url, { headers: { Cookie: cookie }, signal: controller.signal });
  };
  for (let i = 0; i < 8; i++) assert.equal((await startStream()).status, 200);
  const denied = await fetch(url, { headers: { Cookie: cookie } });
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get('retry-after'), '30');
  controllers[0].abort();
  let admitted = null;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(done => setTimeout(done, 25));
    const result = await startStream();
    if (result.status === 200) { admitted = result; break; }
    assert.equal(result.status, 429);
  }
  assert.equal(admitted?.status, 200, 'closing a live connection should release one slot');
});
