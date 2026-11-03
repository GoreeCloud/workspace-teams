# Development History

## 2026-11-03 — Private files and attachment recovery increment

**Status:** local implementation and tests; remote CI and visual review require independent verification.

- Added owner-hosted per-space binary attachments with strict size, storage and filename bounds.
- Protected list/upload/download/delete with space membership, uploader/owner deletion controls, download-only content disposition and SHA-256 integrity checks.
- Added file navigation, upload form and file collection to web client.
- Extended online SQLite snapshot backup to include verified attachment sidecar and fail closed for missing/corrupt attached files.
- Added tests for cross-space privacy, origin controls, oversized requests, deletion rights, revocation and backup completeness.

**Remaining gaps:** malware scanning, attachment previews, encryption, production recovery drills, concurrent stress testing, full browser acceptance.

## 2026-11-03 — Alpha foundation follow-up

**Status:** implementation and local tests; repository CI and web-client visual acceptance must be checked separately.

- Added author/owner-guarded message editing and deletion with SSE events.
- Added same-channel reply references (`parentId`) and additive legacy message schema migration.
- Added permission-aware space-scoped substring search of channel messages, notes and tasks.
- Added member directory, owner-controlled removal, session and membership revalidation of active SSE, and immediate stream revocation.
- Added authenticated acceptance of one-time invitations for existing users.
- Extended responsive web client with search, members, message reply/edit/delete controls and invite-account switch.
- Added a consistent SQLite backup CLI with integrity checking, restrictive permissions and no-overwrite behavior.
- Expanded API regression tests and updated operational/security/capability documentation.

**Known gaps:** no full browser visual audit, production review, encryption, file uploads, voice/video, full-text index, offline clients, or real-time shared document engine.

## 2026-11-03 — Original working alpha

- Local bootstrap and invited accounts, SQLite spaces/channels, SSE messages, tasks, notes, browser shell, Compose preview, CI and 28-area capability ledger.
