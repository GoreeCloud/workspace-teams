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

## Open issues before wider use

- **No completed independent security assessment, threat model, fuzzing, dependency review or production penetration testing.**
- **No at-rest encryption or E2EE.** Database contents are readable to anyone with host/storage access.
- **No automated backups or tested recovery tool.** Keep alpha data disposable; do not treat raw file snapshots of running SQLite as consistent backups.
- **No 2FA, passkeys, account recovery, moderation suite, retention enforcement, or admin audit interface.**
- **No distributed lockout or session anomaly detection.** Basic memory rate limit resets on restart and is per process.
- **No per-device or per-connection replay control for SSE.** Authorization is verified when a stream starts; membership revocation and token invalidation should actively terminate streams in later designs.
- **Invite link is a bearer secret.** Share privately. Avoid public URLs, logs and link preview crawlers. Invitation registration removes the query from browser history after successful submission, but previously emitted URLs may remain in intermediaries.
- **HTTP must remain localhost-only.** Use HTTPS for remote connections, with trusted reverse-proxy configuration and exact `APP_ORIGIN`.
- **Static file serving uses an explicit allowlist**, but administrative filesystem protections, container isolation and reverse proxy settings still require testing.

## Reporting

Do not post secrets, personal database files, authentication cookies or private installation addresses in public issues. Report reproducible non-sensitive defects through repository issues. Coordinate sensitive vulnerability details privately with the repository owner.
