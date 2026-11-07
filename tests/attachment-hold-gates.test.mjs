import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../src/server.mjs';
import { backupDatabase } from '../scripts/backup.mjs';
import { restoreSnapshot } from '../scripts/restore.mjs';
import { importSpaceExport } from '../scripts/import-space-export.mjs';

const ORIGIN = 'http://localhost:3000';

async function launch(dbPath, attachmentHoldMode) {
  const app = createApplication({ dbPath, origin: ORIGIN, attachmentHoldMode });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return {
    base: 'http://127.0.0.1:' + app.server.address().port,
    async close() {
      await new Promise(resolve => app.server.close(resolve));
      app.close();
    }
  };
}

async function request(base, path, { method = 'GET', cookie, data, binary } = {}) {
  const headers = {
    ...(method !== 'GET' ? { Origin: ORIGIN } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(binary !== undefined ? { 'Content-Type': 'application/octet-stream' } : {}),
    ...(data !== undefined ? { 'Content-Type': 'application/json' } : {})
  };
  const response = await fetch(base + '/api' + path, {
    method, headers,
    body: binary !== undefined ? binary : data === undefined ? undefined : JSON.stringify(data)
  });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = raw; }
  return {
    status: response.status,
    data: result,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
    headers: response.headers
  };
}

test('opt-in hold mode blocks every ordinary attachment path until owner review', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-wst-held-'));
  const instance = await launch(join(dir, 'db.sqlite'), 'enforce');
  t.after(async () => { await instance.close(); rmSync(dir, { recursive: true, force: true }); });
  const { base } = instance;
  const owner = await request(base, '/bootstrap', {
    method: 'POST', data: { username: 'owner', password: 'owner-passphrase-for-test-2026' }
  });
  assert.equal(owner.status, 201);
  const space = (await request(base, '/spaces', { cookie: owner.cookie })).data.spaces[0];
  const invitation = await request(base, '/spaces/' + space.id + '/invites', {
    method: 'POST', data: {}, cookie: owner.cookie
  });
  assert.equal(invitation.status, 201);
  const member = await request(base, '/register', {
    method: 'POST',
    data: { username: 'member', password: 'member-passphrase-for-test-2026', invite: invitation.data.invite }
  });
  assert.equal(member.status, 201);

  const data = 'SYNTHETIC_HELD_ATTACHMENT_NOT_FOR_RELEASE_2026';
  const uploaded = await request(base, '/spaces/' + space.id + '/files?name=review.txt&scanState=released', {
    method: 'POST', cookie: owner.cookie, binary: data
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.data.file.scanState, 'pending');
  const id = uploaded.data.file.id;

  for (const cookie of [owner.cookie, member.cookie]) {
    const listing = await request(base, '/spaces/' + space.id + '/files', { cookie });
    assert.equal(listing.status, 200);
    assert.deepEqual(listing.data.files, [], 'pending file was exposed in ordinary listing');
    const download = await request(base, '/files/' + id + '/download', { cookie });
    assert.equal(download.status, 423, 'pending bytes must never be downloaded');
    assert.equal(JSON.stringify(download.data).includes(data), false);
  }

  for (const suffix of ['', '?includeFiles=0', '?includeFiles=1']) {
    const exported = await request(base, '/spaces/' + space.id + '/export' + suffix, {
      cookie: owner.cookie
    });
    assert.equal(exported.status, 423, 'pending files must block metadata and byte-inclusive exports');
    assert.equal(JSON.stringify(exported.data).includes(data), false);
  }
  assert.equal((await request(base, '/files/' + id + '/download')).status, 401);
  assert.equal((await request(base, '/files/' + id, {
    method: 'DELETE', cookie: member.cookie
  })).status, 403, 'members must not delete another uploader file');
  assert.equal((await request(base, '/files/' + id, {
    method: 'PATCH', cookie: owner.cookie, data: { scanState: 'released' }
  })).status, 404, 'no untrusted release endpoint may be created');
  assert.equal((await request(base, '/files/' + id, {
    method: 'DELETE', cookie: owner.cookie
  })).status, 200, 'source owner retains existing delete authority');
  assert.equal((await request(base, '/spaces/' + space.id + '/export', {
    cookie: owner.cookie
  })).status, 200, 'owner export should work again with no held files');
});

test('legacy migration, held uploads, and explicit release fixtures survive restart', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-wst-hold-migration-'));
  const dbPath = join(dir, 'db.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => createApplication({ dbPath, attachmentHoldMode: 'bypass' }), /hold mode/);
  let app = await launch(dbPath, 'legacy');
  const owner = await request(app.base, '/bootstrap', {
    method: 'POST', data: { username: 'owner', password: 'owner-passphrase-for-test-2026' }
  });
  const cookie = owner.cookie;
  const space = (await request(app.base, '/spaces', { cookie })).data.spaces[0];
  const old = await request(app.base, '/spaces/' + space.id + '/files?name=legacy.bin', {
    method: 'POST', cookie, binary: 'LEGACY_SYNTHETIC_ATTACHMENT_2026'
  });
  assert.equal(old.status, 201);
  assert.equal(old.data.file.scanState, 'legacy_unreviewed');
  assert.equal((await request(app.base, '/files/' + old.data.file.id + '/download', { cookie })).status, 200);
  await app.close();

  // Simulate the earlier SQLite schema, not a live migration: remove the
  // newly added column from this disposable test database only.
  const earlier = new DatabaseSync(dbPath);
  earlier.exec('ALTER TABLE files DROP COLUMN scan_state');
  earlier.close();

  app = await launch(dbPath, 'enforce');
  assert.equal((await request(app.base, '/files/' + old.data.file.id + '/download', { cookie })).status, 423,
    'pre-migration legacy bytes cannot bypass new mandatory hold');
  assert.equal((await request(app.base, '/spaces/' + space.id + '/export', { cookie })).status, 423);
  let listing = await request(app.base, '/spaces/' + space.id + '/files', { cookie });
  assert.deepEqual(listing.data.files, []);

  const pending = await request(app.base, '/spaces/' + space.id + '/files?name=pending.bin&hold=0', {
    method: 'POST', cookie, binary: 'NEW_SYNTHETIC_ATTACHMENT_HELD_2026'
  });
  assert.equal(pending.status, 201);
  assert.equal(pending.data.file.scanState, 'pending');
  await app.close();

  // Switching to the old alpha's legacy mode must NEVER expose an
  // attachment that has already entered pending state.
  app = await launch(dbPath, 'legacy');
  assert.equal((await request(app.base, '/files/' + pending.data.file.id + '/download', { cookie })).status, 423);
  assert.equal((await request(app.base, '/files/' + old.data.file.id + '/download', { cookie })).status, 200);
  listing = await request(app.base, '/spaces/' + space.id + '/files', { cookie });
  assert.equal(listing.data.files.length, 1);
  assert.equal(listing.data.files[0].id, old.data.file.id);
  assert.equal((await request(app.base, '/spaces/' + space.id + '/export', { cookie })).status, 423);
  await app.close();

  // This is a synthetic DB fixture that models a future trusted owner
  // transaction after proper scanning and review. NO release HTTP/API
  // or authorization bypass is implemented by the application.
  const db = new DatabaseSync(dbPath);
  db.prepare("UPDATE files SET scan_state='released' WHERE space_id=?").run(space.id);
  db.close();

  app = await launch(dbPath, 'enforce');
  const after = await request(app.base, '/spaces/' + space.id + '/files', { cookie });
  assert.equal(after.status, 200);
  assert.equal(after.data.files.length, 2);
  for (const file of [old.data.file, pending.data.file]) {
    const response = await request(app.base, '/files/' + file.id + '/download', { cookie });
    assert.equal(response.status, 200, 'only test-authorized released files may be read');
  }
  const portable = await request(app.base, '/spaces/' + space.id + '/export?includeFiles=1', { cookie });
  assert.equal(portable.status, 200);
  assert.equal(portable.data.files.length, 2);
  assert.ok(portable.data.files.every(file => file.contentBase64));
  await app.close();
});

test('offline attachment backups preserve pending state across restore and legacy-mode reopening', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-wst-hold-backup-'));
  const dbPath = join(dir, 'source.sqlite');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let app = await launch(dbPath, 'enforce');
  const owner = await request(app.base, '/bootstrap', {
    method: 'POST', data: { username: 'owner', password: 'owner-passphrase-for-test-2026' }
  });
  const cookie = owner.cookie;
  const space = (await request(app.base, '/spaces', { cookie })).data.spaces[0];
  const uploaded = await request(app.base, '/spaces/' + space.id + '/files?name=held.bin', {
    method: 'POST', cookie, binary: 'SYNTHETIC_HELD_BACKUP_2026'
  });
  assert.equal(uploaded.data.file.scanState, 'pending');
  await app.close();

  const source = join(dir, 'snapshot.sqlite');
  const snapshot = await backupDatabase({ dbPath, outputPath: source });
  assert.equal(snapshot.files, 1, 'offline backup must include held source bytes for authorized recovery');
  const result = restoreSnapshot({ source, destination: join(dir, 'restored') });
  assert.equal(result.files, 1);
  const restoredDb = new DatabaseSync(result.database);
  assert.equal(restoredDb.prepare('SELECT scan_state FROM files').get().scan_state, 'pending');
  restoredDb.close();

  for (const mode of ['legacy', 'enforce']) {
    app = await launch(result.database, mode);
    assert.equal((await request(app.base, '/files/' + uploaded.data.file.id + '/download', { cookie })).status, 423,
      'restored pending bytes exposed after mode change');
    assert.equal((await request(app.base, '/spaces/' + space.id + '/export?includeFiles=1', { cookie })).status, 423);
    assert.deepEqual((await request(app.base, '/spaces/' + space.id + '/files', { cookie })).data.files, []);
    await app.close();
  }
});

test('isolated imported attachment is unreviewed, and enforced mode denies live promotion', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-wst-hold-import-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const sourceDb = join(dir, 'source.sqlite');
  let app = await launch(sourceDb, 'legacy');
  const oldOwner = await request(app.base, '/bootstrap', {
    method: 'POST', data: { username: 'owner', password: 'owner-passphrase-for-test-2026' }
  });
  const cookie = oldOwner.cookie;
  const space = (await request(app.base, '/spaces', { cookie })).data.spaces[0];
  assert.equal((await request(app.base, '/spaces/' + space.id + '/files?name=import.bin', {
    method: 'POST', cookie, binary: 'ISOLATED_UNSCANNED_IMPORT_FIXTURE'
  })).status, 201);
  const exportResponse = await request(app.base, '/spaces/' + space.id + '/export?includeFiles=1', { cookie });
  assert.equal(exportResponse.status, 200);
  await app.close();

  const source = join(dir, 'portable.json');
  const credential = join(dir, 'private-password.txt');
  writeFileSync(source, JSON.stringify(exportResponse.data), { mode: 0o600, flag: 'wx' });
  writeFileSync(credential, 'imported-owner-strong-test-password-2026', { mode: 0o600, flag: 'wx' });
  const destination = join(dir, 'isolated-import');
  const report = importSpaceExport({
    source, destination, ownerUsername: 'importedowner', ownerPasswordFile: credential
  });
  assert.equal(report.files, 1);
  const imported = new DatabaseSync(join(destination, 'workspace.sqlite'));
  const row = imported.prepare('SELECT id,scan_state FROM files').get();
  assert.equal(row.scan_state, 'legacy_unreviewed',
    'import must not fabricate a scanner verification or released state');
  imported.close();

  app = await launch(join(destination, 'workspace.sqlite'), 'enforce');
  const login = await request(app.base, '/login', {
    method: 'POST', data: {
      username: 'importedowner', password: 'imported-owner-strong-test-password-2026'
    }
  });
  assert.equal(login.status, 200);
  const importedSpace = (await request(app.base, '/spaces', { cookie: login.cookie })).data.spaces
    .find(item => item.name === space.name);
  assert.ok(importedSpace, 'imported space missing');
  assert.equal((await request(app.base, '/files/' + row.id + '/download', {
    cookie: login.cookie
  })).status, 423);
  assert.deepEqual((await request(app.base, '/spaces/' + importedSpace.id + '/files', {
    cookie: login.cookie
  })).data.files, []);
  assert.equal((await request(app.base, '/spaces/' + importedSpace.id + '/export', {
    cookie: login.cookie
  })).status, 423);
  await app.close();
});
