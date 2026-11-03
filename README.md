# GoreeCloud Workspace Teams

**A self-hosted home for conversations, ideas, people, and the things you make together.**

GoreeCloud Workspace Teams is a personal-first communication and collaboration platform for one person, families, friends, communities, and organizations. The complete product vision includes messaging, voice and video, forums, documents, tasks, calendars, events, social features, secure integrations, and extensibility—operated on infrastructure controlled by its owner.

> **Status: early alpha foundation (November 2026).** This repository contains a **working web/API prototype**, **not** the complete 28-area platform, a public deployment, or a production-ready release. See [Capability tracker](docs/CAPABILITIES.md) for explicit delivered/planned distinctions.

## What works today

- Local first-owner bootstrap with password hashing (scrypt), cookie sessions, and private-by-default access.
- Personal, family, community, and team spaces with per-space owner/member membership checks.
- Text channels with persistent channel messages and live Server-Sent Events updates.
- Invitation-based signup using single-use, 24-hour invitations; no open public registration after bootstrap.
- Per-space task lists (create, complete, remove) and shared notes (create, edit, remove).
- Responsive web interface with mobile layouts, keyboard navigation, visible focus, and reduced-motion support.
- Dependency-free Node.js API, local SQLite persistence, automated API tests, and container configuration.

**Not implemented:** voice/video/screen sharing, end-to-end encryption, uploads, full-text search, comprehensive moderation, calendars/events, real-time collaborative documents, bots, extensions, native desktop/mobile apps, offline sync, PostgreSQL, and production backup/restore automation. Do not store sensitive or irreplaceable data in this alpha.

## Local development

Requires Node.js **22.16.0 or later** (the built-in `node:sqlite` API is experimental in this release).

```sh
npm run check
npm test
APP_ORIGIN=http://localhost:3000 npm start
```

Open [http://localhost:3000](http://localhost:3000). On first run, create the instance owner with a password of at least 12 characters. By default, the server binds to `127.0.0.1` and stores application data in `./data/workspace.sqlite` (ignored by Git).

### Container preview

```sh
docker compose up --build -d
```

The example binds to **localhost only**. For remote access, use an owner-managed HTTPS reverse proxy and set `APP_ORIGIN` to its exact HTTPS origin, keeping the service privately bound; see [Deployment](docs/DEPLOYMENT.md). Do **not** expose the alpha service directly to the public internet.

## Documents

- [Complete 28-area capability map](docs/CAPABILITIES.md)
- [Architecture and persistence](docs/ARCHITECTURE.md)
- [Security and current limitations](docs/SECURITY.md)
- [Development, deployment, and recovery](docs/DEPLOYMENT.md)

**GoreeCloud UI** is the sole design authority. Current styles are a provisional product-specific semantic-token implementation, not a claim of formal visual acceptance or full integration with the authoritative `GoreeCloud/gc-ui` Foundations package.

## Current delivery and ownership

Self-hosting is the intended operating model. No external account is required for the implemented functions, no external SDK or CDN is used, and there is no advertising or analytics collection in this alpha. Source code visibility does not, by itself, establish a software license; a distribution license must be selected separately by the repository owner.
