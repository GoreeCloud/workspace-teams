# Isolated portable space import — alpha

Use this offline tool to turn one **verified, attachment-inclusive v2** Workspace Teams space JSON export into a **new standalone instance** in an empty directory. It never connects to a deployed server or imports into an existing database. Do not confuse a portable space import with the full-instance `GCWSENC1` disaster-recovery tool.

## Prerequisites

- Node.js 22.16+; use a trusted machine and a filesystem with enough space for the imported database and decoded files.
- A trusted `goreecloud.workspace-teams.space.v2` export containing `attachmentBytesIncluded: true`. Metadata-only v1 exports are intentionally rejected to prevent incomplete file recovery.
- A new owner username (3–32 ASCII letters, digits, underscores or dashes) and an exclusive private password file with a **new** 12–256-character password. On Unix, restrict both export and password files to mode `0600`; the existing **destination parent** must be a real private directory (`0700`), not a symlink. Keep the password separate from exported records.
- **Destination must not exist.** Only run while the new destination is offline. This is a local administrative operation, not an upload endpoint or multi-tenant merge.

```sh
mkdir -m 700 /private/new-instance-parent
chmod 600 /private/my-space-with-files.json /private/new-owner-password.txt
npm run import:isolated -- \
  --file /private/my-space-with-files.json \
  --dest /private/new-instance-parent/restored-space \
  --owner newowner \
  --password-file /private/new-owner-password.txt
```

The command reads source files without following symlinks, copies the export into a private temporary source inside the exclusive destination, verifies the v2 schema, attachment hashes and reference structure, and creates a new SQLite database with the imported channels, messages, replies, tasks, notes, and files. It validates SQLite integrity and foreign keys before reporting success. On ordinary failure the new incomplete destination is removed; **no existing destination is ever overwritten**.

The result contains `workspace.sqlite`, `workspace.sqlite.files/`, and `import-report.json` under the new private directory. Before serving it, complete an offline review of the imported data, file permissions and access policy. Then set `DATA_PATH` to the new database and use the new owner credentials to log in. Use HTTPS for any nonlocal connection and complete security/deployment acceptance separately.

## Identity and access safety

The importer creates one new owner account and grants that account the **only space membership**. Historical participants and removed contributors are represented by **locked, uninvited attribution-only accounts** with randomly generated unknown credentials. No original credentials, login sessions, invitations, membership grants, or user IDs are restored. Other people must be reinvited explicitly by the new owner after review. Imported item, channel and file IDs are remapped to new UUIDs; message reply references are preserved.

The importer does **not** recreate other spaces, identity federation, external links, enterprise policies, original memberships, E2EE state, third-party integrations, or multiple-space relationships. It does not merge or upgrade an existing installation. Metadata and attachment bytes are plaintext on disk: apply encrypted storage, controlled access, and appropriate retention. This tool is alpha-grade and not a substitute for full backup/restore, production migration assurance, or a complete security review.
