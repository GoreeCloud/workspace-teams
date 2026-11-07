# Owner-controlled JSON space export

A space owner can download one space's message text, tasks, notes, channel data, member information and attachment metadata using GET /api/spaces/{spaceId}/export. Only an authenticated space owner may export. Members receive 403 and outsiders receive 404; all exported tables are scoped to the selected space.

The versioned schema goreecloud.workspace-teams.space.v1 sets attachmentBytesIncluded to false: file contents are not included. Password hashes, sessions, invitations and invitation secrets are never included. Use full-instance encrypted archives for disaster recovery, not this endpoint.

Exports are unencrypted JSON. Handle them as confidential personal data: use trusted encrypted storage and remove unnecessary copies. Responses use attachment disposition and no-store cache headers. The alpha endpoint limits messages to 10000, JSON output to 8 MiB, and requests to 6 per user/IP per minute per process. It is not a public import API, comprehensive GDPR portability guarantee, or production-reviewed backup.

Regression coverage: tests/export.test.mjs. In the **opt-in development-only scan-hold mode**, both v1 metadata-only and v2 file-inclusive exports return **423** while any attachment in that space is pending, blocked or legacy-unreviewed. A previously pending attachment stays held even if the instance later runs in legacy mode; there is no silent partial export or public release route. See [Scan hold staging](SCAN_HOLD_STAGING.md). Full real-browser acceptance is pending.

## Attachment-inclusive portable JSON export (alpha)

A space owner can request `GET /api/spaces/{spaceId}/export?includeFiles=1` or select **Download including files** in the Members view. The versioned `goreecloud.workspace-teams.space.v2` JSON embeds verified bytes as `files[].contentBase64`, sets `attachmentBytesIncluded: true` and `attachmentEncoding: "base64"`. The default export stays v1 without file contents. Passwords, password hashes, session credentials and invitation bearer secrets remain excluded.

The optional export refuses more than **100 files, 8 MiB of attachment bytes or 20 MiB total JSON** instead of returning an incomplete file. Symlinked, unreadable, missing or corrupted attachments fail closed. Owner authorization and session validity are checked before releasing the document; requests are rate-limited. The download is **unencrypted** and can contain sensitive data—store it privately. An offline isolated v2 import exists (see [import guidance](IMPORT.md)); no in-place migration or production portability acceptance is available. Full-instance `GCWSENC1` encrypted archives remain the preferred disaster-recovery route.

## Read-only offline validation

Use `npm run export:verify -- --file /path/to/private-export.json` to validate an existing v1 or v2 space export before considering future migration. The validator uses no network access and **does not write, import, restore, or alter any data**. For v2, it verifies strict canonical Base64, declared sizes, SHA-256 digests, file-ID uniqueness, filenames, known credential-field exclusions, message-channel references and size/count limits. A v1 export has metadata only, so no attachment bytes can be verified. Run this on a trusted machine; export files are unencrypted and may contain sensitive personal data. Passing validation does not guarantee migration compatibility or a safe import.

## Isolated v2 import

`npm run import:isolated -- --file PRIVATE-V2.json --dest NEW_DIRECTORY --owner NEW_USERNAME --password-file PRIVATE_PASSWORD_FILE` creates a separate, exclusive offline instance after full v2 verification. It does not alter or merge an existing installation, nor restore original user credentials or memberships; only the newly created owner can access imported data. See [isolated import](IMPORT.md) for strict private-file and destination prerequisites, validation, attribution handling, and limitations.
