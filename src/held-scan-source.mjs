// Development-only trusted source-owner lease prototype.
// Not an HTTP endpoint, Identity integration, scanner transport or release API.
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readVerifiedAttachment } from './read-attachment.mjs';

const OWNER_PRODUCT = 'workspace-teams';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const MAX_LEASE_MS = 5 * 60 * 1000;
const REQUEST_FIELDS = Object.freeze([
  'schema_version', 'request_id', 'owner_product', 'object_id',
  'sha256', 'size_bytes', 'requested_at'
]);
function rejected() { return new Error('Held scan source authorization or pending lease rejected'); }

// Wardveil metadata crosses a service trust boundary. Read only inert, own
// data descriptors: getters, inherited fields, symbols and extra fields may
// never influence claim identity or owner file lookup.
function trustedRequestSnapshot(input) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw rejected();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw rejected();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== REQUEST_FIELDS.length ||
        keys.some(key => typeof key !== 'string' || !REQUEST_FIELDS.includes(key))) throw rejected();
    const result = Object.create(null);
    for (const key of REQUEST_FIELDS) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) throw rejected();
      result[key] = descriptor.value;
    }
    return result;
  } catch { throw rejected(); }
}

export function createHeldScanLeaseStore({ dbPath, filesPath, authorizeIssue, authenticateScanner, nowMs = () => Date.now() } = {}) {
  if (typeof dbPath !== 'string' || !dbPath.trim() || typeof authorizeIssue !== 'function' ||
      typeof authenticateScanner !== 'function' || typeof nowMs !== 'function') {
    throw new Error('Trusted owner/scan callbacks and existing database path required');
  }
  const databasePath = resolve(dbPath);
  if (!existsSync(databasePath)) throw new Error('Existing trusted Workspace database required');
  const directory = resolve(filesPath || databasePath + '.files');
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA foreign_keys = ON');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='attachment_hold_policy'").get() ||
      !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'").get()) {
    db.close();
    throw new Error('Workspace attachment-hold schema required');
  }
  db.exec("CREATE TABLE IF NOT EXISTS scan_source_leases (" +
    "lease_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, file_id TEXT NOT NULL, space_id TEXT NOT NULL," +
    "source_sha256 TEXT NOT NULL, source_size INTEGER NOT NULL, issued_at INTEGER NOT NULL," +
    "expires_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('issued','claimed','revoked'))," +
    "claimed_at INTEGER, revoked_at INTEGER);" +
    "CREATE INDEX IF NOT EXISTS idx_scan_source_lease_file ON scan_source_leases(file_id,state,expires_at);");
  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const run = (sql, ...params) => db.prepare(sql).run(...params);
  function clock() {
    const value = nowMs();
    if (!Number.isSafeInteger(value) || value < 1) throw new Error('Trusted scan lease clock unavailable');
    return value;
  }
  function holdLatched() {
    return !!get('SELECT activated_at FROM attachment_hold_policy WHERE singleton=1');
  }
  // These callbacks MUST check real caller authorization, not caller-supplied
  // identity strings. Test doubles do not constitute Identity integration.
  function verifyIssue(ownerProof, file) {
    let authorized = false;
    try {
      authorized = authorizeIssue(ownerProof, Object.freeze({
        spaceId: file.space_id, fileId: file.id, operation: 'issue_or_revoke_scan_lease'
      })) === true;
    } catch { /* Never expose authorization internals. */ }
    if (!authorized) throw rejected();
  }
  function verifyScanner(credential) {
    if (!Buffer.isBuffer(credential) || credential.length < 1 || credential.length > 4096) throw rejected();
    let identity;
    try { identity = authenticateScanner(credential); }
    catch { throw rejected(); }
    if (!identity || identity.ownerProduct !== OWNER_PRODUCT ||
        typeof identity.subject !== 'string' || !IDENTIFIER.test(identity.subject)) throw rejected();
  }
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    let done = false;
    try {
      const value = fn();
      db.exec('COMMIT');
      done = true;
      return value;
    } finally {
      if (!done) {
        try { db.exec('ROLLBACK'); } catch { /* Retain first failure. */ }
      }
    }
  }
  function issueLease({ fileId, ownerProof, ttlMs = 60_000 } = {}) {
    if (typeof fileId !== 'string' || !UUID.test(fileId) || !Number.isSafeInteger(ttlMs) ||
        ttlMs < 1000 || ttlMs > MAX_LEASE_MS) throw rejected();
    const issuedAt = clock();
    return transaction(() => {
      if (!holdLatched()) throw rejected();
      const file = get('SELECT id,space_id,sha256,size,scan_state FROM files WHERE id=?', fileId);
      if (!file || file.scan_state !== 'pending') throw rejected();
      verifyIssue(ownerProof, file);
      const existing = get("SELECT lease_id FROM scan_source_leases WHERE file_id=? AND state='issued' AND expires_at>?",
        file.id, issuedAt);
      if (existing) throw rejected();
      const leaseId = randomUUID(), requestId = randomUUID();
      run("INSERT INTO scan_source_leases " +
          "(lease_id,request_id,file_id,space_id,source_sha256,source_size,issued_at,expires_at,state)" +
          " VALUES(?,?,?,?,?,?,?,?, 'issued')",
        leaseId, requestId, file.id, file.space_id, file.sha256, file.size, issuedAt, issuedAt + ttlMs);
      return { leaseId, expiresAt: new Date(issuedAt + ttlMs).toISOString(), request: {
        schema_version: '1', request_id: requestId, owner_product: OWNER_PRODUCT,
        object_id: 'file:' + file.id, sha256: file.sha256, size_bytes: file.size,
        requested_at: new Date(issuedAt).toISOString()
      } };
    });
  }
  // Source owner can revoke an issued lease, never release the source file.
  function revokeLease({ leaseId, ownerProof } = {}) {
    if (typeof leaseId !== 'string' || !UUID.test(leaseId)) throw rejected();
    return transaction(() => {
      const lease = get('SELECT * FROM scan_source_leases WHERE lease_id=?', leaseId);
      if (!lease) throw rejected();
      verifyIssue(ownerProof, { id: lease.file_id, space_id: lease.space_id });
      const result = run("UPDATE scan_source_leases SET state='revoked',revoked_at=? WHERE lease_id=? AND state='issued'",
        clock(), leaseId);
      if (result.changes !== 1) throw rejected();
      return { revoked: true };
    });
  }
  // Input is the Wardveil metadata-only request, not a client-provided path.
  // Authentication occurs BEFORE querying the lease or reading source bytes.
  // Consumes a lease before content delivery; failed integrity retains hold.
  function claimHeld({ request, credential } = {}) {
    verifyScanner(credential);
    request = trustedRequestSnapshot(request);
    if (request.schema_version !== '1' ||
        request.owner_product !== OWNER_PRODUCT || typeof request.request_id !== 'string' || !UUID.test(request.request_id) ||
        typeof request.object_id !== 'string' ||
        typeof request.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(request.sha256) ||
        !Number.isSafeInteger(request.size_bytes) || request.size_bytes < 1) throw rejected();
    const result = transaction(() => {
      const at = clock();
      if (!holdLatched()) throw rejected();
      const lease = get('SELECT * FROM scan_source_leases WHERE request_id=?', request.request_id);
      if (!lease || lease.state !== 'issued' || lease.expires_at <= at || lease.issued_at > at ||
          request.object_id !== 'file:' + lease.file_id ||
          request.requested_at !== new Date(lease.issued_at).toISOString() ||
          request.sha256 !== lease.source_sha256 || request.size_bytes !== lease.source_size) throw rejected();
      const file = get('SELECT id,space_id,sha256,size,scan_state FROM files WHERE id=?', lease.file_id);
      if (!file || file.scan_state !== 'pending' || file.space_id !== lease.space_id ||
          file.sha256 !== lease.source_sha256 || file.size !== lease.source_size) throw rejected();
      const updated = run("UPDATE scan_source_leases SET state='claimed',claimed_at=? WHERE lease_id=? AND state='issued' AND expires_at>?",
        at, lease.lease_id, at);
      if (updated.changes !== 1) throw rejected();
      let content;
      try {
        content = readVerifiedAttachment(join(directory, file.id), file.size, file.sha256);
      } catch {
        return { denied: true }; // Commit consumption before throwing outside transaction.
      }
      const fresh = get('SELECT space_id,sha256,size,scan_state FROM files WHERE id=?', file.id);
      if (!fresh || fresh.scan_state !== 'pending' || fresh.space_id !== lease.space_id ||
          fresh.sha256 !== lease.source_sha256 || fresh.size !== lease.source_size) {
        content.fill(0);
        return { denied: true };
      }
      return { leaseId: lease.lease_id, ownerProduct: OWNER_PRODUCT,
        objectId: 'file:' + lease.file_id, sha256: lease.source_sha256,
        sizeBytes: lease.source_size, pending: true, content };
    });
    if (result.denied) throw rejected();
    return result;
  }
  return Object.freeze({ issueLease, revokeLease, claimHeld, close: () => db.close() });
}
