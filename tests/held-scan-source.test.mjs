import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../src/server.mjs';
import { createHeldScanLeaseStore } from '../src/held-scan-source.mjs';

const ORIGIN = 'http://localhost:3000';
const CREDENTIAL = Buffer.from('synthetic-scan-service-secret-for-tests');
const OWNER_PROOF = 'synthetic-owner-proof';
const CONTENT = Buffer.from('SYNTHETIC_OWNER_HELD_BYTES_FOR_WARDVEIL_LEASE');

async function fixture(t, mode = 'enforce') {
  const dir = mkdtempSync(join(tmpdir(), 'gc-scan-lease-'));
  const dbPath = join(dir, 'workspace.sqlite');
  const app = createApplication({ dbPath, attachmentHoldMode: mode, origin: ORIGIN });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = 'http://127.0.0.1:' + app.server.address().port;
  t.after(async () => {
    await new Promise(resolve => app.server.close(resolve));
    app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  async function api(path, { method = 'GET', cookie, data, bytes } = {}) {
    const res = await fetch(base + '/api' + path, {
      method, headers: {
        ...(method === 'POST' ? { Origin: ORIGIN } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
        ...(bytes ? { 'Content-Type': 'application/octet-stream' } : {})
      },
      body: bytes || (data ? JSON.stringify(data) : undefined)
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  const owner = await api('/bootstrap', {
    method: 'POST', data: { username: 'owner', password: 'synthetic-test-owner-password-2026' }
  });
  assert.equal(owner.status, 201);
  const cookie = owner.cookie;
  const space = (await api('/spaces', { cookie })).data.spaces[0];
  const upload = await api('/spaces/' + space.id + '/files?name=held.txt', { method: 'POST', cookie, bytes: CONTENT });
  assert.equal(upload.status, 201);
  const file = upload.data.file;

  function store(overrides = {}) {
    return createHeldScanLeaseStore({
      dbPath,
      authorizeIssue: (proof, scope) => proof === OWNER_PROOF &&
        scope.spaceId === space.id && scope.fileId === file.id &&
        scope.operation === 'issue_or_revoke_scan_lease',
      authenticateScanner: credential =>
        Buffer.isBuffer(credential) && credential.equals(CREDENTIAL) ?
          { ownerProduct: 'workspace-teams', subject: 'service:wardveil' } : null,
      ...overrides
    });
  }
  return { dir, dbPath, app, api, cookie, space, file, store };
}

test('owner-bound pending lease yields exactly one verified source read and no release', async t => {
  const f = await fixture(t);
  const worker = f.store();
  t.after(() => worker.close());
  const lease = worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  assert.match(lease.leaseId, /^[0-9a-f-]{36}$/);
  assert.equal(lease.request.schema_version, '1');
  assert.equal(lease.request.owner_product, 'workspace-teams');
  assert.equal(lease.request.object_id, 'file:' + f.file.id);
  assert.equal(lease.request.size_bytes, CONTENT.length);
  assert.match(lease.request.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(lease.request).includes('held.txt'));

  const held = worker.claimHeld({ request: lease.request, credential: CREDENTIAL });
  assert.equal(held.pending, true);
  assert.equal(held.leaseId, lease.leaseId);
  assert.equal(held.ownerProduct, 'workspace-teams');
  assert.equal(held.objectId, lease.request.object_id);
  assert.equal(held.sha256, lease.request.sha256);
  assert.deepEqual(held.content, CONTENT);
  held.content.fill(0); // The trusted future adapter must clear private buffers after scanning.

  assert.throws(() => worker.claimHeld({ request: lease.request, credential: CREDENTIAL }), /rejected/);
  assert.throws(() => worker.revokeLease({ leaseId: lease.leaseId, ownerProof: OWNER_PROOF }), /rejected/);
  assert.equal((await f.api('/files/' + f.file.id + '/download', { cookie: f.cookie })).status, 423);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT scan_state FROM files WHERE id=?').get(f.file.id).scan_state, 'pending');
  assert.equal(db.prepare('SELECT state FROM scan_source_leases WHERE lease_id=?').get(lease.leaseId).state, 'claimed');
  const rows = JSON.stringify(db.prepare('SELECT * FROM scan_source_leases').all());
  assert.equal(rows.includes(OWNER_PROOF), false);
  assert.equal(rows.includes(CREDENTIAL.toString()), false);
  assert.equal(rows.includes(CONTENT.toString()), false);
  db.close();
});

test('cannot issue outside pending hold or with unauthorized owner credentials', async t => {
  const f = await fixture(t);
  const worker = f.store();
  t.after(() => worker.close());
  assert.throws(() => worker.issueLease({ fileId: f.file.id, ownerProof: 'wrong' }), /rejected/);
  assert.throws(() => worker.issueLease({ fileId: '../escape', ownerProof: OWNER_PROOF }), /rejected/);
  assert.throws(() => worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF, ttlMs: 999999 }), /rejected/);
  assert.throws(() => worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF, ttlMs: 0 }), /rejected/);
  const lease = worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  assert.throws(() => worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF }), /rejected/,
    'concurrent unexpired active leases for the same source must be refused');
  for (const credential of [undefined, Buffer.alloc(0), Buffer.alloc(4097), Buffer.from('unknown')]) {
    assert.throws(() => worker.claimHeld({ request: lease.request, credential }), /rejected/);
  }
  const badIdentity = f.store({ authenticateScanner: () => ({ ownerProduct: 'another-product', subject: 'service:wardveil' }) });
  t.after(() => badIdentity.close());
  assert.throws(() => badIdentity.claimHeld({ request: lease.request, credential: CREDENTIAL }), /rejected/);
  const request = lease.request;
  for (const patch of [
    { request_id: 'other-request-id' }, { object_id: 'file:other' },
    { sha256: '0'.repeat(64) }, { size_bytes: request.size_bytes + 1 },
    { owner_product: 'other-product' }, { schema_version: '2' },
    { requested_at: new Date(Date.now() - 60_000).toISOString() }
  ]) {
    assert.throws(() => worker.claimHeld({ request: { ...request, ...patch }, credential: CREDENTIAL }), /rejected/);
  }
  // Failed auth and failed metadata checks do not consume the one-time owner lease.
  const held = worker.claimHeld({ request, credential: CREDENTIAL });
  held.content.fill(0);
});

test('revocation, expiry and replay remain enforced across independent SQLite connections', async t => {
  const f = await fixture(t);
  let time = Date.now();
  const first = f.store({ nowMs: () => time });
  const second = f.store({ nowMs: () => time });
  t.after(() => { first.close(); second.close(); });
  const old = first.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF, ttlMs: 1000 });
  assert.throws(() => second.revokeLease({ leaseId: old.leaseId, ownerProof: 'unauthorized' }), /rejected/);
  assert.deepEqual(second.revokeLease({ leaseId: old.leaseId, ownerProof: OWNER_PROOF }), { revoked: true });
  assert.throws(() => first.claimHeld({ request: old.request, credential: CREDENTIAL }), /rejected/);
  const current = second.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF, ttlMs: 1000 });
  time += 1001;
  assert.throws(() => first.claimHeld({ request: current.request, credential: CREDENTIAL }), /rejected/);
  const fresh = first.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  const held = second.claimHeld({ request: fresh.request, credential: CREDENTIAL });
  assert.deepEqual(held.content, CONTENT);
  held.content.fill(0);
  assert.throws(() => first.claimHeld({ request: fresh.request, credential: CREDENTIAL }), /rejected/);
});

test('corrupt content permanently consumes that lease without opening public file access', async t => {
  const f = await fixture(t);
  const worker = f.store();
  t.after(() => worker.close());
  const lease = worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  const path = join(f.dbPath + '.files', f.file.id);
  writeFileSync(path, Buffer.alloc(CONTENT.length, 66));
  assert.throws(() => worker.claimHeld({ request: lease.request, credential: CREDENTIAL }), /rejected/);
  writeFileSync(path, CONTENT);
  assert.throws(() => worker.claimHeld({ request: lease.request, credential: CREDENTIAL }), /rejected/,
    'corrupt content must not be replayed under the same owner-created lease');
  assert.equal((await f.api('/files/' + f.file.id + '/download', { cookie: f.cookie })).status, 423);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT state FROM scan_source_leases WHERE lease_id=?').get(lease.leaseId).state, 'claimed');
  db.close();
});

test('deleted, released or legacy-unreviewed files cannot be claimed as held pending sources', async t => {
  const f = await fixture(t);
  const first = f.store();
  t.after(() => first.close());
  const release = first.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  const db = new DatabaseSync(f.dbPath);
  db.prepare("UPDATE files SET scan_state='released' WHERE id=?").run(f.file.id);
  assert.throws(() => first.claimHeld({ request: release.request, credential: CREDENTIAL }), /rejected/);
  assert.throws(() => first.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF }), /rejected/);
  db.prepare("UPDATE files SET scan_state='pending' WHERE id=?").run(f.file.id);
  // The old lease remains issued after a rejected claim. Revoke it before
  // a trusted owner creates a fresh independent lease for the same version.
  assert.deepEqual(first.revokeLease({ leaseId: release.leaseId, ownerProof: OWNER_PROOF }), { revoked: true });
  const second = first.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  db.prepare('DELETE FROM files WHERE id=?').run(f.file.id);
  assert.throws(() => first.claimHeld({ request: second.request, credential: CREDENTIAL }), /rejected/);
  db.close();
});

test('unlatched legacy instance cannot issue pending scan leases', async t => {
  const f = await fixture(t, 'legacy');
  const w = f.store();
  t.after(() => w.close());
  assert.throws(() => w.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF }), /rejected/);
  const db = new DatabaseSync(f.dbPath);
  assert.equal(db.prepare('SELECT scan_state FROM files').get().scan_state, 'legacy_unreviewed');
  db.close();
});


test('untrusted metadata object shape never runs accessors or consumes a pending lease', async t => {
  const f = await fixture(t);
  const worker = f.store();
  t.after(() => worker.close());
  const issued = worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  const original = issued.request;
  let getterCalls = 0;
  const accessor = Object.defineProperty({ ...original }, 'sha256', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error('Never read a metadata accessor'); }
  });
  const hidden = Object.defineProperty({ ...original }, 'internal_path', {
    enumerable: false,
    value: '/tmp/private-untrusted-path'
  });
  const fields = [
    accessor,
    hidden,
    { ...original, unexpected: 'client-provided-privilege' },
    Object.assign(Object.create({ inherited: true }), original),
    Object.defineProperty({ ...original }, Symbol('private'), { value: 'secret' }),
    { ...original, request_id: { toString() { getterCalls += 1; return original.request_id; } } },
    { ...original, size_bytes: String(original.size_bytes) },
    Object.keys(original).filter(key => key !== 'requested_at').reduce(
      (result, key) => ({ ...result, [key]: original[key] }), {}),
    new Proxy({ ...original }, { ownKeys() { throw new Error('Hostile proxy'); } })
  ];
  for (const request of fields) {
    assert.throws(() => worker.claimHeld({ request, credential: CREDENTIAL }), /rejected/,
      'Only the exact seven inert metadata fields can be processed');
  }
  assert.equal(getterCalls, 0, 'Metadata accessors and id coercion must not be invoked');
  const taken = worker.claimHeld({ request: original, credential: CREDENTIAL });
  assert.deepEqual(taken.content, CONTENT);
  taken.content.fill(0);
});

test('object-coerced source and lease ids cannot bypass the canonical identifier boundary', async t => {
  const f = await fixture(t);
  const worker = f.store();
  t.after(() => worker.close());
  let conversions = 0;
  const spoof = { toString() { conversions += 1; return f.file.id; } };
  assert.throws(() => worker.issueLease({ fileId: spoof, ownerProof: OWNER_PROOF }), /rejected/);
  const issued = worker.issueLease({ fileId: f.file.id, ownerProof: OWNER_PROOF });
  assert.throws(() => worker.revokeLease({
    leaseId: { toString() { conversions += 1; return issued.leaseId; } },
    ownerProof: OWNER_PROOF
  }), /rejected/);
  assert.equal(conversions, 0);
  assert.deepEqual(worker.revokeLease({ leaseId: issued.leaseId, ownerProof: OWNER_PROOF }),
    { revoked: true });
});
