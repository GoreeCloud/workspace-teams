# GoreeCloud Workspace Teams

**A self-hosted home for conversations, ideas, people, and the things you make together.**

GoreeCloud Workspace Teams is a personal-first collaboration platform designed for an individual, family, friends, community, or organization. The target platform includes messaging, voice/video, forums, files, documents, tasks, calendars and owner-controlled extensibility. The current implementation is a **limited web/API alpha**, not the completed platform or a production release.

## Implemented in this alpha

- **Private accounts and spaces:** local first-owner bootstrap, scrypt password hashing, HttpOnly session cookies, personal/family/community/team spaces, role checks and local SQLite data.
- **Invitations and membership:** one-use invitations, account creation through invites, existing-user invitation acceptance, a member directory, owner-managed removal and immediate revocation of active message streams for removed members.
- **Channels and real-time chat:** channel history, Server-Sent Events, message editing/deleting by authors or space owners, basic reply references, input validation and live changes.
- **Find your work:** permission-filtered, case-insensitive substring search of messages, tasks and notes in spaces you can access.
- **Tasks and shared notes:** create, update, delete and read personal or shared items within authorized spaces.
- **Web client:** responsive GoreeCloud UI-informed alpha layouts for messaging, tasks, notes, search and members; safe text-only user content and keyboard focus.
- **Backups:** a consistent, integrity-checked SQLite snapshot command that refuses to overwrite an existing destination.
- **Quality gates:** no external JavaScript dependencies/CDN, API authorization regression tests and GitHub Actions checks.

Not implemented: voice/video/screen sharing, direct-message UI, file uploads, rich editor, full forum/thread system, reactions, E2EE, enterprise identity, calendar, notification service, federated indexed search, automated encrypted backup, PostgreSQL, production security certification, native apps and offline sync. See the [28-area capability ledger](docs/CAPABILITIES.md) for precise target-vs-delivered distinctions.

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

The backup tool uses the SQLite backup API, verifies integrity and refuses to replace an existing destination. It is **not encrypted**: store backup files in a protected location; perform restore drills separately. See [deployment and recovery](docs/DEPLOYMENT.md).

## Documentation

- [Complete target and delivery status](docs/CAPABILITIES.md)
- [Architecture and internal API](docs/ARCHITECTURE.md)
- [Security model and open risks](docs/SECURITY.md)
- [Deployment and backup](docs/DEPLOYMENT.md)
- [Development history](docs/CHANGELOG.md)

**Design:** GoreeCloud UI is the authoritative design system. Current styles are a provisional `--gc-*` implementation, not proof of full integration or formal visual acceptance. No advertising, subscriptions, telemetry or external service dependency is included in the alpha. Public source visibility does **not** establish an open-source license; repository owner licensing remains undecided.
