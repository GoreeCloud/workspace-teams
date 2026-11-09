# Architecture — Alpha Implementation

## System overview

- **Client:** `public/` zero-build browser app, semantic tokens under the `--gc-` namespace, no CDN or external fonts.
- **API:** `src/server.mjs`, dependency-free Node.js `node:http` routes serving static assets and JSON.
- **Persistence:** Node.js `node:sqlite` synchronous SQLite database at `DATA_PATH` (experimental in Node 22.16.0). WAL journaling and foreign key constraints enabled.
- **Live messages:** Server-Sent Events (SSE) per authorized channel, with message persistence before broadcast, heartbeat and 30-minute connection recycling.
- **Identity:** scrypt salted password hash, random session secret stored only as SHA-256 digest server-side; HttpOnly SameSite Strict cookie.
- **Authorization:** all space-scoped operations verify membership; owner checks protect channel creation/invitations; task/note mutation allows creator or owner.
- **Bootstrap:** a new installation creates the first owner and personal space; further registrations require a one-time 24-hour invitation.

## Persistence model

`users`, `sessions`, `spaces`, `memberships`, `channels`, `messages`, `tasks`, `notes`, `invites`. Message schema is additively migrated at startup with `updated_at` and `parent_id` fields, preserving existing rows. IDs are random UUIDs; invitations and sessions are random 256-bit secrets represented by SHA-256 digests in storage. Session expiration is checked on each authenticated HTTP request. SSE streams also validate session and space membership before broadcast and on periodic heartbeat; member removal terminates active streams immediately. The authoritative database is owned by the running server; do not directly edit tables while serving traffic.

## Security boundaries

HTTP only on localhost during development. In production, HTTPS reverse proxy must terminate TLS and `APP_ORIGIN` must equal the browser-visible **exact** scheme, host and port. State-changing routes reject missing/mismatched `Origin`. Reverse proxy must not expose internal server management or raw database files. Browser data is inserted via `textContent` rather than unsafe HTML. No client-held bearer token or local-storage credential exists.

## Known design debts and migration gates

1. Experimental built-in SQLite is an **alpha convenience**, not the specified eventual PostgreSQL implementation. Do not call it production stable.
2. Single-process SSE means horizontally scaled instances need a cross-node event bus and durable cursor replay.
3. In-memory request throttles are basic and do not replace coordinated abuse defenses.
4. Task/note editing has no conflict resolution, history or live collaborative model.
5. No end-to-end encryption, media plane, object storage, full-text search, or migration CLI is implemented.
6. Integration with versioned `@goreecloud/gc-ui` Foundations is pending; provisional theme tokens are not an accepted certified UI implementation.
7. Do not use this alpha as a service for external members or sensitive data before thorough security, recovery, accessibility and load verification.

## API overview (unstable internal contract)

- `GET /api/health`, `GET /api/me`
- `POST /api/bootstrap`, `POST /api/register`, `POST /api/login`, `POST /api/logout`
- `GET/POST /api/spaces`
- `GET/POST /api/spaces/:id/channels`, `GET/POST /api/spaces/:id/tasks`, `GET/POST /api/spaces/:id/notes`
- `GET /api/spaces/:id/members`, `DELETE /api/spaces/:id/members/:memberId` (owner only)
- `POST /api/invites/accept` (existing accounts)
- `GET /api/search?q=...&spaceId=...` (space-filtered, membership-scoped substring results)
- `POST /api/spaces/:id/invites`
- `GET/POST /api/channels/:id/messages`, `GET /api/channels/:id/stream`
- `PATCH/DELETE /api/messages/:id` (author or space owner)
- `PATCH/DELETE /api/tasks/:id`, `PATCH/DELETE /api/notes/:id`

No `/api/v1` interface has been promised; support policies and compatibility versioning must be established before third-party clients depend on these paths.

## Iteration 2: messaging, revocation, search and backup

- Message replies currently carry a single `parentId` reference, without a threaded-conversation navigation or a forum model.
- Message edits carry `updatedAt`; deletions are permanent and broadcast to active authorized channel clients. Message history remains limited to 100 records per request.
- Search uses SQL `LIKE` with escaped `%`, `_` and `!`, and membership joins. This is **not FTS5** or production-scale indexing; search results cap at 40 messages, 20 notes and 20 tasks per query.
- SSE clients carry the authenticated user's ID and the server-side session digest. Stream access is revalidated before every event and heartbeat. Owner removal closes affected streams; session logout closes streams for that specific session.
- `scripts/backup.mjs` uses SQLite's online backup API with `integrity_check`, restrictive output file modes and an exclusive final copy. Snapshots remain plaintext and do not supply continuous restore guarantees.

Future compatibility gates include migration version tracking, transaction-level conflict management, search indexing, audit history, media services, per-device session controls, and a full recovery test matrix.


## Private file storage (2026-11-03 alpha increment)

`files` stores per-space metadata, uploader identity, size, timestamp and SHA-256 digest. Binary bytes live in an owner-controlled local directory, by default `<DATA_PATH>.files`, keyed only by a random UUID. Uploaded names are metadata and are never used as filesystem paths. `FILES_PATH` optionally selects another trusted local directory. GET, upload, and delete endpoints enforce authenticated space membership; delete requires file uploader or space owner. Download responses force `Content-Disposition: attachment` and `application/octet-stream`, use `nosniff` and no-store, and verify content before sending. The feature deliberately lacks media previews, **actual malware scanning**, external storage, large file support, client-side encryption, or multipart uploads. A separate [development-only pending-attachment gate](SCAN_HOLD_STAGING.md) adds an additive `scan_state` field and a programmatic `attachmentHoldMode: 'enforce'` to stop ordinary listing, downloads and both export types until a **future source-owned release**. Default legacy mode preserves existing alpha access behavior **before activation**; activation writes a persistent SQLite latch, blocks legacy-mode restarts and is observed by other running app instances. A standalone [development-only owner-held scan lease store](SCAN_LEASES_STAGING.md) issues per-file request metadata and a single-use lease for exact pending UUID/SHA-256/size, with expiration, revocation, atomic claim and verified bytes. It requires mandatory injected owner and scanner authentication callbacks, but **none are backed by real Identity or secure transport**; it creates no HTTP endpoint and never releases files. No production scan/release integration exists.

The on-demand backup CLI snapshots SQLite first and copies only files referenced by that snapshot into `<output>.files` after matching each byte stream to SHA-256/size metadata; absent or corrupt files abort the backup. The basic backup is unencrypted; optional encrypted GCWSENC1 archives, an isolated restore command, and a non-destructive one-shot scheduling helper are implemented and tested locally/through CI. No active production schedule or automated host recovery rehearsal is established.


## Basic account-security APIs (alpha)

- `GET /api/account/security`: authenticated active-session count with no raw tokens or digests.
- `POST /api/account/sessions/revoke-others`: delete other session records and terminate their SSE streams.
- `POST /api/account/password`: verify the old password; in a transaction, rotate salted credentials, delete all prior sessions and create a fresh current-browser session; terminate all prior SSE streams.

These routes use the existing session cookie, strict request-Origin checks for writes, and in-process per-user/IP rate limits. GoreeCloud UI visual acceptance remains pending.


## Encrypted backup envelope (alpha)

`scripts/secure-archive.mjs` composes the existing verified online SQLite/attachment backup and isolated restore services. `GCWSENC1` consists of magic/version, per-file random scrypt salt and AES-GCM nonce, ciphertext over a length-prefixed manifest with SHA-256 digests followed by file bytes, and an authenticated GCM tag. Only a SQLite file and UUID-named attachment entries are accepted during extraction. Restore authenticates before parsing any decrypted data and invokes existing SQLite/foreign-key/attachment checks into a new directory. It is an offline maintenance path, **not** live database encryption.
