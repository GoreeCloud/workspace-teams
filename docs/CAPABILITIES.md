# GoreeCloud Workspace Teams — Capability Specification and Delivery Ledger

**Document owner:** GoreeCloud. **Product intent:** self-hosted personal-first communication and collaboration for individuals, families, friends, communities, teams, and organizations. **Design authority:** GoreeCloud UI. **Status:** proposed product specification with a limited working alpha, November 2026.

This document organizes all **28 capability areas** from the founder's supplied product requirements. A listed target is **not** an implemented feature. The delivery ledger prevents planning language from being confused with release evidence.

**Legend:** **Alpha** = implementation exists in this repository and is covered by indicated source/API tests; **Partial** = some underlying functionality exists but broader scope remains unbuilt; **Planned** = not implemented in this repository. Real-world production/security acceptance remains pending even for Alpha functionality.

| # | Area | Delivery | Reference |
|---|---|---|---|
| 1 | Self-hosting and deployment | Partial | Node local server, SQLite and Docker Compose preview |
| 2 | Personal, family, community, organization modes | Partial | Four space kinds and owner/member membership |
| 3 | Accounts, authentication, profiles | Partial | Bootstrap, local password authentication, cookie sessions, display names |
| 4 | Spaces, servers, workspace management | Partial | Space creation, membership and invitations |
| 5 | Channels and discussion organization | Partial | Text channels, owner creation |
| 6 | Messaging and conversations | Partial | Persistent text, edit/delete, basic threaded replies, SSE live updates |
| 7 | Rich text and interactive messages | Planned | Plain text only; untrusted text is displayed without HTML execution |
| 8 | Threads, forums, discussion boards | Partial | Reply-to-message references, not full forum/thread UI |
| 9 | Voice communication | Planned | — |
| 10 | Video calling and screen sharing | Planned | — |
| 11 | Live events, stages, presentations | Planned | — |
| 12 | Calendars, scheduling, reminders | Planned | — |
| 13 | Friends, contacts, social interaction | Planned | — |
| 14 | Community onboarding and management | Partial | Private single-use invitations |
| 15 | Moderation and trust controls | Partial | Owner-driven member removal, access checks; moderation suite pending |
| 16 | File sharing and storage | Partial | Membership-scoped local file uploads, list/download/delete, 2 MiB per file and 32 MiB per space; no image preview, versioning, external storage or virus scanner |
| 17 | Collaborative documents, notes, knowledge bases | Partial | Shared plain-text notes only |
| 18 | Tasks and project management | Partial | Shared checklist-style tasks only |
| 19 | Search, navigation, discovery | Partial | Scoped substring search of accessible messages, notes, tasks; advanced search pending |
| 20 | Notifications and attention management | Partial | Live message updates inside open channel only |
| 21 | Workflow automation | Planned | — |
| 22 | Bots, applications, integrations | Planned | — |
| 23 | Developer APIs and extensibility | Partial | Versionless internal JSON API; no supported third-party SDK |
| 24 | Security, identity, privacy | Partial | scrypt, sessions, same-origin writes, membership enforcement, CSP |
| 25 | Data governance and administration | Partial | Owner-controlled membership and invitations; scoped v1/v2 JSON exports, offline verification and isolated v2-only import; broader governance pending |
| 26 | GoreeCloud UI and accessibility | Partial | Semantic tokens, responsive UI, keyboard/focus/reduced-motion basics |
| 27 | Cross-platform and offline | Partial | Responsive web; browser offline and native clients pending |
| 28 | Backup, recovery, migration, reliability | Partial | Integrity-checked SQLite/attachments, encrypted archive, isolated restore, one-shot scheduler, and non-overwriting offline v2 space import; no production recovery automation |

## 1. Self-hosting and deployment

Target: fully self-hosted web, messaging, voice/video media, storage, database, search, collaboration, workflow, notification and application services. Run on personal computer, NAS, home server, VM, bare metal, VPS or private cloud with x86-64/ARM64 Linux options. Support Docker Compose, optional Kubernetes, reverse proxy, TLS certificates, customizable ports/domains, local filesystem and S3-compatible storage, PostgreSQL, secrets management, volume persistence, health checks, updates, migrations, recoverability and appropriate isolated-network operation. **Current:** Node/SQLite localhost and Compose alpha; the other deployment/service options remain planned.

## 2. Personal, family, community and organization modes

Target: single-user/private spaces with journals, notes, projects, calendars, reminders and automations; family/friends spaces with group communication, shared media, responsibilities and gaming; community spaces with public/private channels, forums, rules, onboarding and events; organizational spaces with departments, external guests, approvals, projects and governance. A single account must work without teams. **Current:** personal/family/community/team space types with shared messages, tasks and notes; member removal and reusing invitations for existing users are supported; richer modes are planned.

## 3. Accounts, authentication, profiles and presence

Target: local signup, administrator creation, invitation-only signup, strong passwords, passwordless/passkeys, MFA, recovery, optional OAuth/OIDC/SAML/LDAP, device/session controls, identity federation, account switching, configurable profiles/avatars/banners/status/pronouns/links, per-space nicknames, privacy controls, user blocking and presence (online, away, busy, invisible, custom and game activity). **Current:** local bootstrap, invitation signup, local password sessions, display names.

## 4. Spaces and workspace management

Target: instance → spaces → optional categories → channels → threads. Space creation, roles, ownership, directories, public/private types, member invitation/approval/guest policy, custom branding, templates, configurable navigation, favorites, exports, archive and restore. **Current:** space creation, owner/member roles, 24-hour one-time invitations, owner listing/revocation, existing-user acceptance, member listing and owner removal; no category/archive interfaces.

## 5. Channels and discussion organization

Target: public/private/restricted text, voice, video, announcement, forum, stage, read-only, help, support, resource, media, topic and project channels; categories, topics, descriptions, search, channel permissions, tabs/resources, bookmarks, channel templates, notifications, archive and linking. **Current:** text channels with inherited space membership and owner-only creation.

## 6. Messaging and conversations

Target: one-to-one and group direct messages, public/private conversations, threaded replies, persistent history, edit/delete, pin/save/bookmark/forward/quote, mentions, reactions, custom emoji/GIF/stickers, polls, scheduled messages, drafts, read/unread, receipts, typing, audio/video clips, voice messages, text-to-speech, configurable retention and optional E2EE. **Current:** plain-text channel messages, persistent history, live SSE updates, edit/delete with author/owner checks, and reply-to-message references; reactions, direct messages and the rest remain planned.

## 7. Rich text and interactive messages

Target: Markdown, rich text, code blocks with syntax highlighting, headings, checklists, links, spoilers, embeds, interactive message controls and templates, accessible formatting. **Current:** plain text only to reduce unsafe markup risk.

## 8. Threads, forums and discussion boards

Target: private/public threads, following, notifications, locking, archiving, forum posts/categories/tags, filtering/sorting, moderation and answered/resolved state. **Current:** basic reply references exist; dedicated thread browsing, archiving, forums and moderation are planned.

## 9. Voice communication

Target: self-hosted low-latency one-to-one and group calling, voice rooms, push-to-talk, volume controls, device selection, noise suppression, echo cancellation, speaking indicators, moderator controls, bitrates, room limits and streamer support. **Current:** planned.

## 10. Video and screen sharing

Target: self-hosted WebRTC video meetings, grid/speaker views, device controls, background effects, application/window/full-screen sharing with audio, multiple streams, annotations, moderation, owner-managed signaling/STUN/TURN and consent-based recordings. **Current:** planned.

## 11. Live events, stages and presentations

Target: host/speaker/audience roles, speaker requests, stage moderation, live polls and chat, scheduled event registration, reminders, invites, announcements, cancellation and attachments. **Current:** planned.

## 12. Calendars, scheduling and reminders

Target: personal/family/shared/team calendars, recurring events, RSVP, time zones, reminders, meeting scheduling, availability, iCalendar/CalDAV, external calendar opt-in, focus time, deadlines and scheduled messages. **Current:** planned.

## 13. Friends, contacts and social interactions

Target: friends/contacts, requests, mutual connections, presence/game activity, joining sessions, gaming groups, watch parties, multiplayer activities, trivia, shared whiteboards, emojis, soundboards, badges and social events. **Current:** planned.

## 14. Community management and onboarding

Target: public/private membership, welcome guides, rules acceptance, questionnaires, interest roles, channel suggestions, announcements, FAQs, polls, resource libraries, moderator assignments and safety controls. **Current:** one-time invitation creation and redemption.

## 15. Moderation and trust

Target: granular roles and channel permissions, verification, keyword/spam/link filtering, rate limiting and slow mode, anti-raid controls, reviews/reports/appeals, timeouts, kicks, bans, alert channels and audit history. **Current:** basic space-role enforcement, owner-directed membership removal with immediate SSE closure, and write rate limits; comprehensive moderation is pending.

## 16. Files and storage

Target: images, video, audio, documents, code, archives and other attachments; preview, folders, metadata, tags, permissions, expiring links, revisions, quotas, WebDAV, local and S3-compatible storage, secure transfers and import/export. **Current:** private space file uploads, list/download/delete, 2 MiB single-file/32 MiB space limits, SHA-256 integrity checks and attachment-only downloads; other features pending.

## 17. Documents, notes and knowledge bases

Target: private/shared rich-text and Markdown documents, live collaborative editing, comments, templates, version history, document navigation, embeds, canvases, wiki pages, journals and meeting notes. **Current:** shared text notes with create/edit/delete and space access checks.

## 18. Tasks and projects

Target: personal/family/team tasks, subtasks, due dates, priorities, custom fields, assignees, comments, recurrence, Kanban/table/calendar views, milestones, dependencies, saved filters, imports and workflow triggers. **Current:** shared create/complete/remove task lists.

## 19. Search and discovery

Target: full-text permission-aware global and scoped search for messages, people, channels, spaces, documents, files, tasks, events, forums, saved searches and advanced filters. **Current:** space/channel navigation and case-insensitive, permission-filtered substring search across messages, notes and tasks within a space; no true indexed full-text search, advanced filters or federated search.

## 20. Notifications and attention

Target: desktop/mobile/in-app alerts, unified activity inbox, mentions, task/event/call alerts, badges, previews, quiet hours, DND, favorites, per-channel overrides, priority contacts and cross-device synchronization. **Current:** live updates in active channel while connected, no persistent notification subsystem.

## 21. Workflows

Target: owner-hosted rule-based no-code automation with scheduling, events/forms/buttons/webhooks, conditionals, approvals, routing, escalations, error handling, retries, execution history and scoped permissions. **Current:** planned.

## 22. Bots, apps and integrations

Target: owner-controlled optional extension directory, chat and moderation bots, slash/context commands, modals, utility integrations for email, calendars, cloud storage, Git, issue trackers, CRM, support, smart home and local applications. Core services must never require external connectors. **Current:** planned.

## 23. Developer APIs

Target: documented/versioned REST and WebSocket/event APIs, OAuth/OIDC app authorization, scoped tokens, SDKs, manifests, interactive message components, webhooks, extension APIs, CLI and testing tooling. **Current:** undocumented-for-third-parties JSON internal API and SSE; access is not a stable compatibility contract.

## 24. Security, identity and privacy

Target: secure authentication, MFA, passkeys, federated identity optionality, RBAC, least privilege, encryption in transit and at rest, optional E2EE, backups/keys, CSRF/XSS/SSRF/SQLi protections, secret management, app isolation, sensitive data access, recovery and full account export/deletion. **Current:** scrypt salted passwords, HttpOnly SameSite cookie, server-side sessions, write origin validation, query parameterization, HTML text-safe rendering, CSP and membership gates. Security review and production hardening are **not complete**.

## 25. Administration and data governance

Target: instance and delegated admin roles, group provisioning, space/channel/app/workflow management, policy enforcement, retention, holds, authorized exports, DLP, emergency controls, recovery and audit records. For personal users keep settings simple and optional. **Current:** owner/member permissions, owner-controlled invitations and membership removal; owner-only scoped v1/v2 JSON exports and offline verification; isolated v2-only import into a new instance with newly issued owner credentials. Full governance, retention and production migration remain pending.

## 26. GoreeCloud UI and accessibility

Target: unique polished GoreeCloud UI shell, flexible rails/sidebars, light/dark and accent themes, keyboard command palette, tabs, split views, screen readers, semantic controls, motion preference, scaling, RTL/localization, responsive desktop/tablet/mobile navigation. Follow `GoreeCloud/gc-ui` authoritative source. **Current:** provisional semantic style foundation, one responsive browser client, focus and reduced-motion basics. Design acceptance pending.

## 27. Cross-platform and offline

Target: Linux/Windows/macOS desktop, Android/iOS, PWA, tablet and browser clients; local drafts, offline notes/tasks/cache, sync retries, recoverable edits, conflict handling and low bandwidth mode. **Current:** responsive browser client requiring connection, no offline storage/sync, no native clients.

## 28. Backup, recovery, migration and reliability

Target: validated encrypted/full/incremental backups, restore drills, portable import/export, point-in-time recovery, configurable retention, migrations, rollback, health checks and operational diagnostics. **Current:** SQLite persistence, health endpoint and `npm run backup -- --output PATH` for a consistent, verified, non-overwriting SQLite snapshot with attachment sidecar. Existing files are verified by SHA-256 against database metadata. Unencrypted snapshots remain supported; optional authenticated encrypted archives and isolated decrypt/restore are implemented with automated tampering, wrong-key and attachment tests. A one-shot encrypted backup command and optional systemd examples exist but are not activated. Owner-scoped JSON v1 metadata and bounded v2 attachment-inclusive exports, read-only offline verification, and a v2-only non-overwriting isolated import into a new instance are available. There is no in-place merge or restoration of original user credentials/sessions/memberships. Independent key recovery, offsite replication, cross-version migration and production disaster-recovery acceptance are pending.

## Product structure and implementation order

Core, Identity, Spaces, Channels, Messenger, Realtime, Voice, Video, Events, Social, Files, Documents, Tasks, Search, Notifications, Workflows, Apps, Security, Administration and Operations remain separately definable domains. Prioritize: **(1)** storage/auth/security/backup foundation; **(2)** robust messaging and permissions; **(3)** tasks/notes collaboration and file safety; **(4)** search, moderation and notifications; **(5)** self-hosted voice/video; **(6)** events, forums, integrations and native clients. Promote capability status only with direct test and review evidence.


### Account security increment (2026-11-03)

Early alpha users can count active sessions, revoke other sessions, and change their password while invalidating previous cookies and live streams. Regression tests cover these limited controls. Passkeys, MFA, device inventory, account recovery and comprehensive security remain planned.
