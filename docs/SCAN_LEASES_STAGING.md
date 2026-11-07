# Workspace Teams — Private Owner-Held Scan Lease Prototype

| Property | Status |
| --- | --- |
| Stage | **Development-only proposal**, not merged, deployed or connected to Wardveil |
| Source | `src/held-scan-source.mjs` |
| Tests | `tests/held-scan-source.test.mjs` |
| Depends on | [Workspace pending-file gate](SCAN_HOLD_STAGING.md); Wardveil scan coordinator and advisory contract |
| Data owner | Workspace Teams |
| Date | November 7, 2026 |

## Purpose and authority

This standalone *internal* Node.js module is a source-owner preparation step for the Wardveil Scan `HeldSourceOwner` contract. It deliberately exposes **no HTTP endpoint, RPC transport, scanner daemon connection, browser control, CLI, environment variable, file-release API or external Identity adapter**. It cannot make a file downloadable. No signed malware signatures or real scan result are consulted by this module. Simply importing it does not activate or connect a scanner.

Workspace Teams owns its files and pending/released states. Wardveil is a cybersecurity adviser, not a file owner. GoreeShield governs privacy, minimization and retention, while GoreeCloud Mesh must eventually govern authenticated cross-product connectivity. A clean verdict may become **eligible for source-owner review** only, never automatic release.

## Trusted constructor — not a public API

```js
import { createHeldScanLeaseStore } from './src/held-scan-source.mjs';

// Pseudocode for a trusted in-process integration; the real validators
// must be designed and approved independently before any deployment.
const source = createHeldScanLeaseStore({
  dbPath: '/trusted/disposable/workspace.sqlite',
  authorizeIssue: trustedOwnerAuthorization,
  authenticateScanner: trustedIdentityAuthentication
});
```

`dbPath` and optional `filesPath` must be trusted administrator configuration and point to an **existing Workspace database/storage directory**. The application schema must already contain `files.scan_state` and the persistent `attachment_hold_policy` latch. The module creates only its private `scan_source_leases` table and index when constructed; it does not change ordinary Workspace routes.

Both authorization callbacks are **mandatory**. `authorizeIssue(ownerProof, {spaceId,fileId,operation})` must independently authorize the actual source owner for this exact space/file and action; returning `true` unconditionally is **not acceptable security**. `authenticateScanner(credential)` must authenticate a trusted Wardveil service principal via an approved Identity-backed mechanism and return an internal `{ownerProduct:'workspace-teams',subject:'...'}` mapping. These callback types are **not actual Identity integration**: a caller can inject test doubles or build insecure callbacks. Do not expose this constructor or methods to untrusted HTTP inputs. The synthetic tests use fixed proof values only.

## Lease lifecycle

1. `issueLease({fileId,ownerProof,ttlMs})` requires a canonical UUID file ID, a trusted owner authorization callback, the persistent hold-policy latch, and `files.scan_state='pending'`. It refuses legacy-unreviewed, released, blocked, missing and unauthorized files. `ttlMs` must be 1–300 seconds, default 60. No second **unexpired issued lease** can coexist for the same file. Existing expired/claimed/revoked rows are retained as history, not deleted automatically.
2. The owner creates a random UUID `leaseId` and independent random UUID `requestId` bound in SQLite to the *exact current immutable file ID, space ID, SHA-256, byte size, issue time and expiration*. The returned metadata-only `request` uses Wardveil scan contract fields `schema_version`, `request_id`, `owner_product`, `object_id` (`file:<uuid>`), `sha256`, `size_bytes` and `requested_at`. Neither the request nor lease ID grants file read rights alone.
3. `claimHeld({request,credential})` authenticates the scanner **before any lease lookup**. It requires exact owner-product, request ID, file ID, SHA-256, byte size and issuance timestamp binding, an unexpired **issued** lease, a still-pending file and an active policy latch. Under an atomic SQLite `BEGIN IMMEDIATE` transaction, it marks the lease **claimed** before reading the **source-owner's** bounded, regular, no-symlink, size/SHA-256-verified file. It rechecks pending state and file metadata before returning a private `Buffer`. The future transport adapter must stream the bytes safely to Wardveil and immediately zero the private Buffer after processing.
4. If source content is missing, corrupt or changes during verification, the claim is **consumed** and returns only an error; no bytes, clean verdict or release follows. Failed authentication and mismatched metadata do **not** consume a valid lease. Replay across multiple SQLite connections is rejected. A new claim requires a fresh owner-authorized lease.
5. `revokeLease({leaseId,ownerProof})` checks the owner-scoped callback and changes an **issued** lease to `revoked`; a claimed/revoked lease cannot be reused. Revocation does not delete or release the file.

The store retains file IDs and SHA-256 within the private owner database so it can independently verify exact file binding. It never stores raw credentials, bearer tokens, file bytes, user identity secrets, or remote paths. **UUIDs are correlation identifiers, not authentication credentials.** Lease rows currently have **no automatic retention limit**; trusted operators must define privacy retention and cleanup with evidence before production.

## Validation and limits

The six dedicated synthetic integration tests cover end-to-end pending upload to source-owner issuance and one authenticated claim, malformed/cross-product credentials, wrong owner authorization, one active lease per file, request field tampering, expiry and revocation, replay across two SQLite connections, exact-size/hash corruption with consumed lease, owner file removal/reclassification, and refusal on legacy unlatched installations. Ordinary Workspace download remains HTTP 423 throughout a successful scan-lease claim; no scanner verdict or release route is created.

Run in the disposable development checkout:

```sh
npm run check
NODE_OPTIONS=--max-old-space-size=384 node --test --test-concurrency=2 tests/*.test.mjs
git diff --check
```

This **does not** establish a secure standalone identity provider or inter-service protocol. Security still depends on trusted callbacks, exclusive control of the administrator-configured database/filesystem, a trustworthy clock, host/key isolation, SQLite transactional behavior, backup/rollback governance and authorized operator controls. Database administrators could alter lease rows, restore old snapshots, or bypass pending state. Do not call this a production quarantine or audit service.

## Mandatory next steps

- Integrate **real** GoreeCloud Identity service authentication and per-owner authorization with least-privilege, purpose-bound credentials and documented revocation. The current callbacks are test/draft interfaces only.
- Implement a reviewed secure Wardveil↔Workspace transport that converts the claimed private `Buffer` into Wardveil's stream-based `HeldObject`, supplies exact metadata, passes one-time owner-generated lease IDs, and enforces queue limits/timeouts. No external network endpoint exists yet.
- Reverify the scanned **same file object version, content digest, valid lease, current identity and GoreeShield rules** in a separate audited source-owner release transaction after a clean result and authorized owner review. There is **no** such implementation.
- Resolve cross-process release races and global queueing, durable receipts, lease retention, trusted time, official ClamAV signatures/FreshClam CLD provenance, backup rollback, staging acceptance and VPS deployment approval.

See [Wardveil Scan issue #2](https://github.com/GoreeCloud/wardveil/issues/2), [Wardveil coordinator](https://github.com/GoreeCloud/wardveil/blob/feat/scan-held-object-coordinator-20261106/docs/scan-coordinator.md) and [Workspace hold gate](SCAN_HOLD_STAGING.md). Keep the draft PRs unmerged until reviewed and all production acceptance gates are met.
