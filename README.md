# GoreeCloud Workspace Teams

**A self-hosted home for conversations, ideas, people, and the things you make together.**

GoreeCloud Workspace Teams is a personal-first collaboration platform designed for an individual, family, friends, community, or organization. The target platform includes messaging, voice/video, forums, files, documents, tasks, calendars and owner-controlled extensibility. The current implementation is a **limited web/API alpha**, not the completed platform or a production release.

## Implemented in this alpha

- **Private accounts and spaces:** local first-owner bootstrap, scrypt password hashing, HttpOnly session cookies, personal/family/community/team spaces, role checks and local SQLite data.
- **Invitations and membership:** one-use, owner-revocable invitations, account creation through invites, existing-user invitation acceptance, a member directory, owner-managed removal and immediate revocation of active message streams for removed members.
- **Channels and real-time chat:** channel history, Server-Sent Events, message editing/deleting by authors or space owners, basic reply references, input validation and live changes.
- **Find your work:** permission-filtered, case-insensitive substring search of messages, tasks and notes in spaces you can access.
- **Private files:** upload, list, download and delete small space-owned files; downloads force attachment disposition and every request enforces space membership.
- **Space portability:** owners can download a scoped JSON export of conversations, notes, tasks, channels, members and attachment metadata (not file bytes). See [space export](docs/EXPORT.md).
- **Tasks and shared notes:** create, update, delete and read personal or shared items within authorized spaces.
- **Web client:** responsive GoreeCloud UI-informed alpha layouts for messaging, tasks, notes, search, members and files; safe text-only user content and keyboard focus.
- **Backups and recovery:** unencrypted integrity-checked SQLite-plus-attachment snapshots, optional encrypted GCWSENC1 archives, isolated restore, and a one-shot scheduled-backup runner with optional systemd examples. No production schedule or offsite backup is active.
- **Quality gates:** no external JavaScript dependencies/CDN, API authorization regression tests and GitHub Actions checks.

Not implemented: voice/video/screen sharing, direct-message UI, large files and previews, rich editor, full forum/thread system, reactions, E2EE, enterprise identity, calendar, notification service, federated indexed search, automatically enabled/offsite encrypted backups, PostgreSQL, production security certification, native apps and offline sync. See the [28-area capability ledger](docs/CAPABILITIES.md) for precise target-vs-delivered distinctions.


## Optional encrypted backup scheduling

A one-shot encrypted backup wrapper and example systemd timer are available for host administrators. They do **not** activate a schedule, rotate/delete existing archives, or configure production backups. See [Encrypted backup scheduling](docs/BACKUP_SCHEDULING.md) for setup, locking, private key storage, and isolated recovery checks.

## Start locally

Requires **Node.js 22.16+**. The built-in `node:sqlite` module remains experimental in Node 22.

```sh
npm run check
npm test
APP_ORIGIN=http://localhost:3000 npm start
```

Visit `http://localhost:3000` (the server listens on `127.0.0.1` by default). Create the first local account with a password of at least 12 characters. App data resides at `./data/workspace.sqlite`, excluded from version control. Keep the app on a trusted local/private network.

### Container preview

```sh
docker compose up --build -d
```

The example host port is **localhost only**. See [deployment guidance](docs/DEPLOYMENT.md) before configuring an owner-managed HTTPS proxy. **Do not expose this alpha directly to the public internet or use irreplaceable/sensitive data.**

### Back up a running instance

```sh
npm run backup -- --db ./data/workspace.sqlite --output ./backups/workspace-2026-11-03.sqlite
```

The basic backup command creates an **unencrypted** verified snapshot and refuses to overwrite previous files. The optional `backup:encrypted` and `restore:encrypted` commands support passphrase-protected GCWSENC1 archives. The `backup:scheduled` command and systemd examples exist but have **not** been enabled on a GoreeCloud host; see [encrypted backup scheduling](docs/BACKUP_SCHEDULING.md). Treat every unencrypted snapshot as private data. To restore into a **brand-new** isolated directory:

```sh
npm run restore -- --from ./backups/workspace-2026-11-03.sqlite --dest ./restored-test-instance
```

This checks the database and every attachment before creating `restored-test-instance/workspace.sqlite` and its `.files` directory. It never overwrites an existing destination. Use offline snapshots and a disposable test instance; host-level recovery acceptance is still pending. See [deployment guidance](docs/DEPLOYMENT.md).

### Optional encrypted recovery (alpha)

```sh
npm run backup:encrypted -- --db ./data/workspace.sqlite --output ./backups/workspace.gcws --passphrase-file /private/backup-key
npm run restore:encrypted -- --from ./backups/workspace.gcws --dest ./test-restored --passphrase-file /private/backup-key
```

A private passphrase file (`chmod 600` on Unix) is required. The self-contained AES-256-GCM archive includes verified SQLite and private attachments; it never overwrites existing output. **Keep the key in secure storage separate from the backups**. On-demand snapshot/decryption temporarily writes plaintext to restricted OS temporary storage; encrypted disk and a tested recovery plan remain necessary for sensitive data. No schedules or public deployment are configured.

## Documentation

- [Complete target and delivery status](docs/CAPABILITIES.md)
- [Architecture and internal API](docs/ARCHITECTURE.md)
- [Security model and open risks](docs/SECURITY.md)
- [Deployment and backup](docs/DEPLOYMENT.md)
- [Development history](docs/CHANGELOG.md)

**Design:** GoreeCloud UI is the authoritative design system. Current styles are a provisional `--gc-*` implementation, not proof of full integration or formal visual acceptance. No advertising, subscriptions, telemetry or external service dependency is included in the alpha. Public source visibility does **not** establish an open-source license; repository owner licensing remains undecided.


### Account security (alpha)

Use the account avatar to inspect the active session count, sign out other sessions, or change your password. Password rotation checks the old password, stores a new salted scrypt verifier, revokes every prior cookie, and issues a fresh cookie for this browser. This is basic account hygiene, not multi-factor authentication, device auditing, or production security assurance.

- **Portable space exports:** owners can optionally download a bounded attachment-inclusive JSON space export; this is unencrypted and not a substitute for full-instance encrypted recovery.

- **Read-only export verification:** `npm run export:verify -- --file PRIVATE-SPACE-EXPORT.json` checks metadata and optional attached bytes without importing or modifying data.
