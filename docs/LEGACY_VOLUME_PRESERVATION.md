# Historical Workspace Teams Docker volumes - preservation gate

**Status: read-only metadata audit; NOT a recovery, migration, or production release approval.**

The current native GoreeCloud Workspace Teams alpha uses Node.js/SQLite and declares a separate workspace-data volume in compose.yaml. A prior, distinct Docker Compose project named goreecloud-workspace-teams left historical volumes on the authorized goreecloud-vps-01 host. Names suggest Mattermost and PostgreSQL origins, but Docker labels alone do **not** verify exact application versions, contents, ownership history, data value, or backup integrity.

On November 5, 2026, a metadata-only check verified these six Compose-labeled volumes:

- goreecloud-workspace-teams_mm_client_plugins
- goreecloud-workspace-teams_mm_config
- goreecloud-workspace-teams_mm_data
- goreecloud-workspace-teams_mm_logs
- goreecloud-workspace-teams_mm_plugins
- goreecloud-workspace-teams_pg_data

At that check, docker ps -a reported zero containers referencing these volumes and no containers carrying the old Compose project label. **Zero container references do not imply zero data, no historical dependencies, or safe deletion.**

## Repeat the read-only metadata check

Run this from an authorized host with access to the relevant Docker daemon:

    npm run audit:legacy-volumes
    # Or without npm:
    sh scripts/audit-legacy-volumes.sh

The script runs only docker volume ls, docker volume inspect, and docker ps -a with metadata-format arguments. It does not enumerate directory contents, open databases, mount volumes, create containers, run images, or make Docker state changes. It does not request elevated privileges. Review the script's source and permissions before executing on another host.

Exit status 0 means only that the six-volume metadata baseline matches and there are no current container references; 2 indicates unexpected or missing volumes/labels; 3 indicates container references; 4 indicates missing Docker access or a metadata-read error; and 64 indicates unsupported arguments. **Even an exit status of 0 explicitly keeps recovery readiness BLOCKED.** The baseline reflects one host's verified state and must not be reused blindly for unrelated deployments.

## Required gates before any migration or cleanup

1. Establish the original Compose configuration, operators, and ownership through authorized historical records. Identify service dependencies without changing running systems.
2. Confirm whether historical application and PostgreSQL data are valuable. Preserve permissions, identities, and retention obligations; do not interpret names as proof of contents.
3. Inventory independently protected backups and access to recovery credentials, then prove restoration in a separately authorized isolated environment. An archive name or successful backup command is not evidence of a usable restore.
4. Verify the native Workspace Teams release's still-open first-owner setup, backup destination, access control, UI, and host-specific recovery gates before introducing it onto this VPS.
5. Obtain explicit approval before production deployment, migration, volume mount, permissions changes, retention actions, deletion, or cleanup. Preserve recoverability and prepare rollback steps.

For native encrypted archives, see [backup scheduling](BACKUP_SCHEDULING.md) and [deployment/recovery guidance](DEPLOYMENT.md). This legacy audit is **not** a substitute for those workflows.
