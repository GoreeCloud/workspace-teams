# Security Model and Open Risks

**Status:** security work in progress, **not** production security acceptance.

## Implemented controls

- Closed registration after atomic one-owner bootstrap; one-use, owner-revocable invitation registration with 24-hour expiry; invite listing reveals only token hashes (not reusable links), and revoked tokens cannot be redeemed.
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
- Private file APIs enforce membership for listing/downloading, owner/uploader checks for deletion, 2 MiB upload and 32 MiB per-space limits, SHA-256 file verification, no inline file serving, and non-executable opaque storage names.
- Backups use a consistent SQLite snapshot plus SHA-256-verified attachment copy, refuse overwrites and set restrictive file permissions.

## Open issues before wider use

- **No completed independent security assessment, threat model, fuzzing, dependency review or production penetration testing.**
- **No at-rest encryption or E2EE.** Database contents are readable to anyone with host/storage access.
- **On-demand database-plus-attachment snapshots and an isolated attachment restore/download test exist, but no encrypted backup schedule or production recovery drill.** The on-demand backup CLI is tested for consistency and integrity with a running server; keep alpha data disposable and do not treat raw file snapshots of running SQLite as consistent backups.
- **No 2FA, passkeys, account recovery, moderation suite, retention enforcement, or admin audit interface.**
- **No distributed lockout or session anomaly detection.** Basic memory rate limit resets on restart and is per process.
- **No durable SSE replay cursor or horizontally scaled stream coordination.** Stream authorization is now rechecked on broadcast/heartbeat and member-removal or logout streams are closed, but connection replay and multiple-node event routing remain unbuilt.
- **Invite link is a bearer secret.** Share privately. Avoid public URLs, logs and link preview crawlers. Invitation registration removes the query from browser history after successful submission, but previously emitted URLs may remain in intermediaries.
- **HTTP must remain localhost-only.** Use HTTPS for remote connections, with trusted reverse-proxy configuration and exact `APP_ORIGIN`.
- **Uploaded files are untrusted.** No malware scanner, content-type verification, content disarm, image previews or enterprise retention policies exist; browser downloads are forced as attachments (`application/octet-stream`).
- **Static file serving uses an explicit allowlist**, but administrative filesystem protections, container isolation and reverse proxy settings still require testing.

## Reporting

Do not post secrets, personal database files, authentication cookies or private installation addresses in public issues. Report reproducible non-sensitive defects through repository issues. Coordinate sensitive vulnerability details privately with the repository owner.

## Backup and search residual risks

- Backups are **not encrypted** and may include password hashes, session digests, messages and all uploaded attachments. The `.sqlite` file and optional `.sqlite.files` directory must be retained/restored **together** with private permissions.
- An isolated API-level snapshot/restore test verifies authenticated downloads after restoration, but broader cross-version migrations, real host filesystem restores and operational recovery procedures are unverified. Rehearse a full host-specific restore before relying on backups.
- Query search scans eligible rows using SQLite `LIKE`; bounded limits protect responses, not worst-case CPU or database growth. Implement indexing and search abuse defenses before scaling.
- The UI smoke test in a managed headless browser was blocked by browser administration policy. Syntax/API tests do not count as a complete visual/accessibility audit.


## Verified isolated restore (alpha)

`npm run restore -- --from BACKUP.sqlite --dest NEW_DIRECTORY` restores only to a nonexistent directory. It validates database integrity, foreign keys, attachment contents and nonempty WAL sidecars. This is not a production restore service, does not decrypt snapshots and does not establish complete disaster-recovery readiness. Keep all backups and restores private and never restore directly over a running instance.


## Account security controls (alpha)

Authenticated users can query `GET /api/account/security` for an aggregate active-session count, call `POST /api/account/sessions/revoke-others` to revoke other sessions, and call `POST /api/account/password` with `currentPassword` and `newPassword` to rotate credentials and all session cookies. Rotation requires the existing password, a different new password of 12–256 characters, and rate limiting. Both revocation actions close affected live channel streams; no raw session secrets are returned.

This is not a device inventory. Device names, login history, alerts, MFA and durable distributed abuse prevention are not implemented. In-flight requests may require further endpoint-specific invalidation checks. TLS, host security and a complete security review remain necessary before public exposure.
