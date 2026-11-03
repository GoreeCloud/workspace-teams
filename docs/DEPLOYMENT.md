# Development, Deployment and Recovery — Alpha

## Local development

Requires Node.js 22.16.0 or newer. `node:sqlite` is experimental in this runtime.

```sh
npm run check
npm test
npm start
```

Default listener: `127.0.0.1:3000`; database: `./data/workspace.sqlite`; public origin: `http://localhost:3000`. For a different host/port, set both `HOST`/`PORT` and `APP_ORIGIN` carefully. The first web visitor on a private instance can create the owner account—keep the initial listener confined to a trusted local environment. Password minimum is 12 characters.

## Container preview

```sh
APP_ORIGIN=http://localhost:3000 docker compose up --build -d
docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
```

Named `workspace-data` volume stores SQLite. The container has a non-root user, read-only root filesystem, limited temporary storage, dropped Linux capabilities, and localhost-only host port binding. Verify writable volume ownership and health on the actual container host; no Docker runtime test was performed as part of initial source creation.

### Private HTTPS reverse proxy

For owner-managed remote access, terminate TLS at an audited reverse proxy. Point it to `127.0.0.1:3000`, preserve long-running `text/event-stream` connections, set `APP_ORIGIN=https://your-private-host.example`, and keep backend ports inaccessible on untrusted interfaces. Use strict HTTPS and suitable firewall/VPN rules; never directly expose this preview app as production internet service.

## Recovery and upgrade guidance

**Do not copy an active WAL-mode SQLite database as a backup.** A tested snapshot command is now available:

```sh
npm run backup -- --db ./data/workspace.sqlite --output ./backups/workspace-2026-11-03.sqlite
```

It uses SQLite's online backup API, verifies database integrity, refuses overwrite and writes the final file with restrictive permissions. Backups are **not encrypted**, scheduled or restore-drill certified. Keep them in protected storage. The provided container image does not include the scripts directory; run maintenance with a compatible trusted Node runtime and authorized filesystem access. Restore only to an isolated disposable test instance before considering any live replacement. Automated upgrades and recovery remain pending.

Changes to `src/server.mjs` schema require compatible, versioned migrations before upgrades are supported. Do not overwrite unknown preexisting data or promote this alpha to a production release.

## Build and test gates

CI performs `npm run check` and `npm test` on Node 22.16.0. These cover syntax, first-user bootstrap, access control, messages, task and note flows, invitation use, and origin rejection. They do not cover frontend browsers, mobile/native packaging, Docker runtime, accessibility audit, load, or production security acceptance.
