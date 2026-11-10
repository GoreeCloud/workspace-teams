import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';

const ORIGIN = 'http://localhost:3000';

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gc-workspace-utf8-'));
  const app = createApplication({ dbPath: join(directory, 'workspace.sqlite'), origin: ORIGIN });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(async () => {
    await new Promise(done => app.server.close(done));
    app.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (path, payload, cookie = '') => fetch(base + '/api' + path, {
    method: 'POST',
    headers: { 'Origin': ORIGIN, 'Content-Type': 'application/json', ...(cookie ? {Cookie: cookie} : {}) },
    body: payload,
  });
  return { base, post };
}

function corruptText(value, substring) {
  const valid = Buffer.from(JSON.stringify(value), 'utf8');
  const at = valid.indexOf(Buffer.from(substring, 'utf8'));
  assert.ok(at > 0);
  valid[at] = 0xff;
  return valid;
}

test('malformed UTF-8 cannot silently alter or claim the first owner', async t => {
  const { base, post } = await fixture(t);
  const original = { username: 'owner', displayName: 'Café sécurisé',
    password: 'local-synthetic-password-1234' };
  const response = await post('/bootstrap', corruptText(original, 'é'));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /UTF-8/);
  const me = await (await fetch(base + '/api/me')).json();
  assert.equal(me.initialized, false, 'rejected invalid bytes cannot create an owner');

  const accepted = await post('/bootstrap', JSON.stringify(original));
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).user.displayName, original.displayName);
});

test('malformed UTF-8 cannot persist private messages, but real Unicode remains intact', async t => {
  const { base, post } = await fixture(t);
  const setup = await post('/bootstrap', JSON.stringify({
    username: 'owner', password: 'synthetic-local-password-1234'
  }));
  assert.equal(setup.status, 201);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const spaces = await (await fetch(base + '/api/spaces', { headers: { Cookie: cookie } })).json();
  const space = spaces.spaces[0];
  const channels = await (await fetch(base + '/api/spaces/' + space.id + '/channels', {
    headers: {Cookie: cookie}
  })).json();
  const endpoint = '/channels/' + channels.channels[0].id + '/messages';
  const invalid = await post(endpoint, corruptText({body: 'Confidentialité 🌷'}, '🌷'), cookie);
  assert.equal(invalid.status, 400);
  const empty = await (await fetch(base + '/api' + endpoint, { headers: {Cookie: cookie} })).json();
  assert.equal(empty.messages.length, 0);
  const good = await post(endpoint, JSON.stringify({body: 'Confidentialité 🌷'}), cookie);
  assert.equal(good.status, 201);
  const messages = await (await fetch(base + '/api' + endpoint, {headers: {Cookie: cookie}})).json();
  assert.equal(messages.messages[0].body, 'Confidentialité 🌷');
});
