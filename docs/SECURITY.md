# Security Model and Open Risks

**Status:** security work in progress, **not** production security acceptance.

## Implemented controls

- Closed registration after atomic one-owner bootstrap; one-use invitation registration with 24-hour expiry.
- `scrypt` password hashing with independently generated 128-bit random salt; minimum password length 12.
- 256-bit random session and invitation values; SHA-256 digests persisted instead of raw tokens.
- `HttpOnly`, `SameSite=Strict`, scoped session cookies; `Secure` when `APP_ORIGIN` is HTTPS.
- State-changing request `Origin` checking and no permissive CORS response headers.
- Space membership required for retrieving/sending messages and reading/mutating tasks and notes; ownership gates for invitations and channel creation.
- Parameterized SQL queries, max JSON request size (32 KiB), bounded text inputs, restrained CSP, `nosniff`, denied frames and strict referrer policy.
- Client renders all user-authored text using `textContent`, not dynamic HTML insertion.
- Simple in-memory login and message rate limits; no analytics/telemetry or external service connections.
- Space owner can revoke another member; their open SSE streams are closed and future channel reads and search are denied. Sessions and membership are rechecked on event delivery and heartbeat.
- Message edits and removals are author- or owner-restricted; reply targets must belong to the same channel.
- Search is restricted to spaces joined by the current account and escapes wildcard characters.
- Backups use a consistent SQLite snapshot and integrity verification, refuse overwrites and set restrictive file permissions.

## Open issues before wider use

- **No completed independent security assessment, threat model, fuzzing, dependency review or production penetration testing.**
- **No at-rest encryption or E2EE.** Database contents are readable to anyone with host/storage access.
- **Snapshot backups exist, but no encrypted backup schedule or full recovery drill.** The on-demand backup CLI is tested for consistency and integrity with a running server; keep alpha data disposable and do not treat raw file snapshots of running SQLite as consistent backups.
- **No 2FA, passkeys, account recovery, moderation suite, retention enforcement, or admin audit interface.**
- **No distributed lockout or session anomaly detection.** Basic memory rate limit resets on restart and is per process.
- **No durable SSE replay cursor or horizontally scaled stream coordination.** Stream authorization is now rechecked on broadcast/heartbeat and member-removal or logout streams are closed, but connection replay and multiple-node event routing remain unbuilt.
- **Invite link is a bearer secret.** Share privately. Avoid public URLs, logs and link preview crawlers. Invitation registration removes the query from browser history after successful submission, but previously emitted URLs may remain in intermediaries.
- **HTTP must remain localhost-only.** Use HTTPS for remote connections, with trusted reverse-proxy configuration and exact `APP_ORIGIN`.
- **Static file serving uses an explicit allowlist**, but administrative filesystem protections, container isolation and reverse proxy settings still require testing.

## Reporting

Do not post secrets, personal database files, authentication cookies or private installation addresses in public issues. Report reproducible non-sensitive defects through repository issues. Coordinate sensitive vulnerability details privately with the repository owner.

## Backup and search residual risks

- Backups are **not encrypted** and may include password hashes, session digests and all workspace content; retain and protect the files like the live database.
- The SQLite snapshot command does not validate the restored application, cross-version migrations, credentials or filesystem restore operations. Perform a full isolated restore drill before relying on it.
- Query search scans eligible rows using SQLite `LIKE`; bounded limits protect responses, not worst-case CPU or database growth. Implement indexing and search abuse defenses before scaling.
- The UI smoke test in a managed headless browser was blocked by browser administration policy. Syntax/API tests do not count as a complete visual/accessibility audit.
