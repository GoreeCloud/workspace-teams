# Encrypted backup scheduling — self-hosted alpha

**State:** A one-shot encrypted backup command and an *uninstalled* systemd timer/service example are included in the repository. No scheduler, backup destination, retention policy or offsite copy has been activated on a GoreeCloud host. This is not production recovery acceptance.

## Design and safeguards

The one-shot `scripts/scheduled-backup.mjs` calls the existing verified `GCWSENC1` archive implementation (Node.js `node:crypto` AES-256-GCM with scrypt key derivation). Each invocation saves a new uniquely named `workspace-teams-<UTC-timestamp>-<random>.gcws` archive containing the SQLite snapshot plus all referenced attachments. The archive is mode `0600` and its destination must be a nonsymlink, owner-owned private directory (mode `0700` on Unix).

The command uses an exclusive `.workspace-teams-backup.lock` to prevent overlapping runs. It **never overwrites, prunes, rotates, or deletes older archives**. After a successful or ordinary failed invocation it releases its own lock. A crash may leave the lock in place intentionally: inspect for an active process and any partial archive first, then remove it manually under authorized recovery procedures. A failed archive is removed by the encryption helper; never infer a successful run merely from a filename or timer state.

### Run one backup manually

On a trusted host with **Node.js 22.16+**, a readable database and files directory, create an exclusively owned destination. Store a strong, unique passphrase **outside** the repository and backup directory, in an owner-readable regular file restricted to mode `0600`; do not put secrets in command lines or environment variables.

```sh
node scripts/scheduled-backup.mjs \
  --db /var/lib/workspace-teams/workspace.sqlite \
  --output-dir /var/backups/goreecloud/workspace-teams \
  --passphrase-file /etc/goreecloud/workspace-teams-backup.key
```

For a custom attachment root, append `--files /path/to/files`. The script fails closed for inaccessible or insecure output directories, missing database, invalid passphrase, or an existing lock. It prints only the new archive path and aggregate count/size, never the key. Its exit status is nonzero on failure, suitable for a timer/cron alert or external monitoring. Treat paths and service user above as **illustrative**, not evidence of a configured installation.

### Optional systemd timer (not installed)

The reviewed examples are `deploy/systemd/workspace-teams-backup.service` and `.timer`. They specify a daily 03:30 host-local calendar trigger with randomized delay and `Persistent=true` for missed scheduled invocations. The service is an isolated oneshot operation rather than an always-running daemon. Before enabling it:

1. Verify the host installation path, Node.js version, actual dedicated service account (`workspace-teams` is a placeholder), readable database/attachment directories, and private output directory. Do not run the backup unit as root merely to bypass access errors.
2. Prepare `/etc/goreecloud/workspace-teams-backup.env` with **paths only**: `DATA_PATH`, `OUTPUT_DIR`, and `PASSPHRASE_FILE`. The private secret *contents* must stay in the separate key file, never in the environment file, unit or repository. Restrict environment-file permissions and validate paths against the service's `ReadWritePaths` sandbox rule.
3. Install and review the example unit/timer and service sandbox rules for the specific system, including `ProtectHome=true`, `PrivateTmp=true`, `ProtectSystem=strict` and the fixed output whitelist. Do not auto-install via application start or Docker build.
4. Run one manual backup, then a manual `systemctl start workspace-teams-backup.service` and inspect status/logs. **Restore a copy to a new isolated directory** using `npm run restore:encrypted -- --from ARCHIVE --dest NEW_DIR --passphrase-file KEY_FILE` and verify application login and attachments before considering a scheduled deployment.
5. Only after host review and authorization, enable the timer explicitly. Configure external failure alerts, offsite encrypted copies, independent key recovery, sufficient free space, and a separately approved retention/cleanup process.

**No scheduled deployment, pruning, remote upload or external notification was performed by adding these source files.**

## Offline archive verification (not a deployment)

Run `npm run backup:verify -- --from ARCHIVE.gcws --passphrase-file PRIVATE_KEY_FILE` after copying the archive and key to a trusted machine. The offline command temporarily restores a *new* private test instance, authenticates the archive, checks SQLite and attachment integrity, then deletes the temporary copy. Both plain SQLite and authenticated-encrypted restore paths share the same destination guard. The restore refuses linked destination ancestors and dangling destination symlinks; new parent directories are created privately, component by component. This is a static-path defense for a trusted single-user development host, not a guarantee against adversarial concurrent directory swaps. It never targets an existing database or starts a production service. Wrong keys and tampered archives return a nonzero exit status. Keep the key separate from archived copies and use encrypted temporary storage: plaintext exists temporarily during this check. Passing does not prove that a complete production recovery or cross-host login will work.

## Safety and limitations

The underlying encrypted snapshot temporarily stages **plaintext** database and attachments in an OS temporary directory protected by restrictive filesystem permissions. Deletion does not guarantee forensic erasure; use encrypted/secured temporary storage. The backup key must be held independently of offsite encrypted archives; losing it permanently prevents recovery. The snapshot is an application-consistent SQLite online backup, but may not capture an upload concurrently committed to storage at the exact instant of snapshot; the underlying backup helper will reject missing or mismatched attachments rather than silently claim consistency.

There is currently no automated retention, offsite replication, independently audited key escrow, system-level tested restore on GoreeCloud's VPS, production disaster recovery plan, RPO/RTO claim, or deployed backup scheduler. Explicit approval and tested recovery are required before modifying a production host or destroying old snapshots.
