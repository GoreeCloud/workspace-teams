# GoreeCloud OpenRoom — product rename and compatibility

**Current name:** GoreeCloud OpenRoom  
**Repository:** https://github.com/GoreeCloud/openroom  
**Former name:** GoreeCloud Workspace Teams (`GoreeCloud/workspace-teams`)  
**Change scope:** source branding and development documentation; not a deployment, infrastructure migration or production readiness claim.

## Product identity

- Visible browser title, sign-in banner, app-rail tooltip, server startup log and package name use **GoreeCloud OpenRoom**.
- The private npm package identifier is `@goreecloud/openroom`. No public registry publication is implied.
- The example Compose service is now `openroom`; **the persistent volume key remains `workspace-data`**.
- Historical descriptions of the former product name are retained for provenance.

## Storage and wire-format preservation

These are **backward-compatibility identifiers**, not a brand endorsement. Do **not** replace them without an explicit versioned migration, verified backup and isolated restore:

| Identifier | Why it stays |
| --- | --- |
| `goreecloud.workspace-teams.space.v1` and `goreecloud.workspace-teams.space.v2` | Existing export schema readers and archives recognize these exact wire IDs |
| `GCWSENC1` | Existing encrypted archive format identifier |
| `workspace.sqlite` and `workspace-data` | SQLite filename and Compose named-volume key |
| `workspace-teams-*.gcws` and `.workspace-teams-backup.lock` | Existing scheduled-backup naming and exclusive-lock semantics |
| `workspace-teams-backup.service`, `workspace-teams-backup.timer` | Historical example systemd unit names and references |
| `goreecloud-workspace-teams_* ` legacy volume names | Historical Docker data whose contents and recovery status are unverified |

The six historical Mattermost/PostgreSQL-labelled volumes and previous `services/workspace-teams/` host paths are **not** the new alpha application's data migration targets. See [legacy preservation evidence](LEGACY_VOLUME_PRESERVATION.md).

## Upgrade considerations

1. Confirm the currently running Compose project/service and the actual volume-to-container binding. Do not assume the GitHub repo rename changes a running service or its data.
2. Verify an isolated restore from a valid encrypted backup before touching a stateful host.
3. Treat the new `openroom` service as a **service-key change**, not an automated migration. Confirm that it is attached to the intended `workspace-data` volume and that any previous container is handled without deleting volumes.
4. Preserve existing environment variables, API paths, user accounts, sessions, schemas and encrypted archives. Do not run `docker compose down -v`, remove historical volumes, or blindly rename filesystem directories.
5. Independently verify the UI, login, account permissions, uploads/downloads, exports and backups on a disposable deployment before a production cutover.
6. Keep all production rollout, data migration and external access changes gated by separate authorization and rollback planning.

## Verification scope

The source identity regression test checks the current labels, package and Compose service together with preserved legacy schema IDs and volume identity. Passing local tests or CI does **not** establish live UI compliance with the complete GoreeCloud UI design language, a working backup recovery plan, public access safety or a deployed release.
