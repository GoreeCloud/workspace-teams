# Development History

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
