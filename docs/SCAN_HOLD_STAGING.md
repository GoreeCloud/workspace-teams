# Workspace Teams — Wardveil Scan Pending-File Gate (Draft / Development Only)

| Attribute | Verified status |
| --- | --- |
| Scope | `src/server.mjs`, `public/app.js`, `tests/attachment-hold-gates.test.mjs` |
| Ownership | Workspace Teams owns its files, access decisions, and any future release; Wardveil returns cybersecurity scan advice only |
| Current integration | **No real Wardveil / GoreeCloud Identity connection; no scan worker or owner-authorized release endpoint** |
| Deployment | Draft GitHub work only; no migration, production setting, or live attachment permission changed |
| Date | November 7, 2026 |

## Why this gate exists

Workspace Teams currently accepts private space attachments up to 2 MiB, checks member access, stores SHA-256 metadata, and offers member download and owner-controlled space exports. Those checks do **not** demonstrate malware scanning or a pre-release hold. A future Wardveil Scan integration must keep owner-held bytes unavailable to *ordinary* file access until a **source-owner-controlled** release decision.

This is a deliberately opt-in, local development implementation. It does not connect to, trust, or pretend to invoke the existing Wardveil scanner. Do **not** merge or deploy as a completed scanning feature.

## Safe development configuration

The `createApplication` factory now accepts an **in-process** option:

```js
const app = createApplication({
  dbPath: '/path/to/disposable-test/workspace.sqlite',
  attachmentHoldMode: 'enforce'
});
```

This programmatic option is for isolated development/QA only. There is **no environment-variable, CLI, REST, cookie or query-parameter switch** that authorizes bypassing or enabling this mode, and no production scanner activation path. Invalid values fail startup. When omitted, `attachmentHoldMode` defaults to `'legacy'` to preserve the current alpha behavior for preexisting users **until a separate deployment/migration decision is approved**. Legacy mode must never be presented as scanned or security-certified.

A previously pending or blocked file remains inaccessible **even if the application is later reopened in legacy mode**. Only `released` is readable in enforcement mode. The `released` value is a reserved source-owned state, **not a scanner verdict**; this PR deliberately does not expose any endpoint that changes it.

## Stored state and migration

The `files` table adds a `scan_state` column with an additive idempotent SQLite migration and a constrained set of values:

| State | Meaning | Ordinary read/export |
| --- | --- | --- |
| `legacy_unreviewed` | Old/legacy-mode bytes; not asserted scanned | Legacy mode: allowed as before. Enforce mode: denied. |
| `pending` | New upload awaiting trusted scan and owner policy review | Denied in **both** modes |
| `blocked` | Reserved for future owner hold/revocation enforcement | Denied in **both** modes |
| `released` | Future owner-authorized state transition (not implemented) | Allowed subject to existing identity, membership and byte integrity checks |

A migration from a prior database maps old files to `legacy_unreviewed`, **not** `released`. Starting enforcement against such a database holds legacy files rather than silently grandfathering them. No rows are reclassified, scanned, deleted or made public automatically by migration. In legacy mode, new uploads receive `legacy_unreviewed`; in enforcement mode, new uploads receive `pending`. A caller-supplied query parameter or JSON field cannot request a release.

## Access-path review

The same server-side state rule is enforced on ordinary routes; changing browser UI is not a security boundary.

- **Upload `POST /api/spaces/:id/files`:** after session/membership, size, filename and quota checks, stores bytes and explicitly sets `pending` when enforcement is selected; the uploading caller sees that pending status in the success response. The web client says held uploads are not yet downloadable.
- **List `GET /api/spaces/:id/files`:** SQL returns only eligible records. Pending/blocked files never appear in the normal downloadable list. This is not a privileged pending-case dashboard.
- **Download `GET /api/files/:id/download`:** after membership check, refuse any state not eligible for ordinary read with HTTP 423. Recheck current state, file version metadata, membership and session immediately before sending the verified bytes. This guards against a state/identity change while reading.
- **Owner export `GET /api/spaces/:id/export`:** if any file in the requested space is held, **both metadata-only and attachment-inclusive** exports return HTTP 423 without partial contents. Recheck the hold before responding, after building the export. A hold must never be silently omitted from an apparently complete export.
- **Delete `DELETE /api/files/:id`:** retains existing uploader/owner permission checks and source-owner deletion behavior. Retention, evidence preservation and legal holds are **not** implemented; production deletion of held/quarantined content needs separate owner-approved policy.
- **Backup/restore:** offline backup still includes authorized private attachment bytes; it preserves the SQLite `scan_state` values when restored. A restored `pending` file remains inaccessible even in legacy mode. Backups are **not** a member-facing export and may be plaintext; they require operator protection and GoreeShield retention controls.
- **Isolated v2 import:** existing importer assigns its existing default `legacy_unreviewed` to imported bytes; it **does not fabricate a scan verdict or release**. When an imported instance is opened in enforcement mode, imported bytes are blocked. Do not promote an imported/restored instance into an exposed environment without approved hold-state transition and revalidation.
- **Preview/stream/public sharing:** no additional attachment preview or public share routes are currently implemented in this alpha. Every future path must apply the same source-owned policy, including downloads from background tasks, cache, backup promotion, or new clients.

## Tests and acceptance

The standalone `tests/attachment-hold-gates.test.mjs` suite exercises:

1. Pending new uploads hidden from both member and owner lists and downloads; both export modes denied, including query attempts to supply a release state.
2. Existing membership, authentication, and deletion rights; no unauthenticated or user-controlled release endpoint.
3. Additive old-schema migration and explicit `legacy_unreviewed` classification; enforced mode rejects old files. Restarting in legacy mode **does not** expose a previously pending file.
4. Test-only direct SQLite state transition to `released`, followed by ordinary read/export after reopening in enforcement mode. **This is only a synthetic fixture, not a production release implementation or authorization example.**
5. Offline backup/restoration preserving `pending` and denying normal access in both modes.
6. Isolated v2 import preserving unreviewed status and denying normal access under enforcement.

Run on an authorized development checkout:

```sh
npm run check
NODE_OPTIONS=--max-old-space-size=384 node --test --test-concurrency=2 tests/*.test.mjs
git diff --check
```

Existing default-alpha tests must remain green. CI should independently verify the exact final draft-PR commit. These tests contain only disposable synthetic files, no live Workspace or Wardveil user data.

## Remaining mandatory gates before any authorized rollout

1. **Real source-owner authority:** authenticated Identity-backed `HeldSourceOwner` adapter, independently proven upload hold, version/size/SHA-256, scope-limited content opening, owner-generated single-use lease, revocation, expiry and fraud/race checks. Never accept caller-controlled filesystem paths or scan claims.
2. **Complete routing coverage:** document and test every source-file read/list/preview/export/restore/share/backup promotion and new client path. Prevent race windows across processes and require an explicit migration plan for legacy files.
3. **Owner-controlled release:** no release on a clean verdict alone. Build a separate privileged, auditable source-owner transaction that independently verifies the scanned **exact file version**, pending lease, authorized policy decision, user access and current Wardveil/GoreeShield controls. Deny on malicious, stale, error, inconclusive, timeout or missing recorder.
4. **Scanner readiness:** verify real signed ClamAV signatures, FreshClam CLD update provenance, engine isolation, bounded resource use, transport authentication and error/degraded mode. Current draft Wardveil PRs only provide development prototypes.
5. **Operations and governance:** backup encryption, privacy retention, legal hold/deletion rules, integration rollback, monitored queues and multi-host replay, reviewed release authorization and staged acceptance. No actual VPS deployment or production migration without explicit owner approval.

**Authority boundary:** Wardveil owns malware classification and security controls; GoreeShield owns privacy and retention policy; GoreeCloud Mesh coordinates the eventual authenticated integration. Workspace Teams remains the sole file owner and release authority. The project’s verified GoreeCloud UI design system must guide any future review-state UX; this draft only changes truthful status messaging.

Related: [Wardveil Scan issue #2](https://github.com/GoreeCloud/wardveil/issues/2).
