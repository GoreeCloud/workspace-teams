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

`users`, `sessions`, `spaces`, `memberships`, `channels`, `messages`, `tasks`, `notes`, `invites`. IDs are random UUIDs; invitations and sessions are random 256-bit secrets represented by SHA-256 digests in storage. Session expiration is checked for requests and SSE events; owner removal closes affected streams. The authoritative database is owned by the running server; do not directly edit tables while serving traffic.

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
- `POST /api/spaces/:id/invites`
- `GET/POST /api/channels/:id/messages`, `GET /api/channels/:id/stream`
- `PATCH/DELETE /api/tasks/:id`, `PATCH/DELETE /api/notes/:id`
- `GET /api/spaces/:id/members`, `DELETE /api/spaces/:id/members/:memberId`
- `POST /api/invites/accept`, `GET /api/search?q=...&spaceId=...`
- `PATCH/DELETE /api/messages/:id` (author or owner)

No `/api/v1` interface has been promised; support policies and compatibility versioning must be established before third-party clients depend on these paths.
