# Owner-controlled JSON space export

A space owner can download one space's message text, tasks, notes, channel data, member information and attachment metadata using GET /api/spaces/{spaceId}/export. Only an authenticated space owner may export. Members receive 403 and outsiders receive 404; all exported tables are scoped to the selected space.

The versioned schema goreecloud.workspace-teams.space.v1 sets attachmentBytesIncluded to false: file contents are not included. Password hashes, sessions, invitations and invitation secrets are never included. Use full-instance encrypted archives for disaster recovery, not this endpoint.

Exports are unencrypted JSON. Handle them as confidential personal data: use trusted encrypted storage and remove unnecessary copies. Responses use attachment disposition and no-store cache headers. The alpha endpoint limits messages to 10000, JSON output to 8 MiB, and requests to 6 per user/IP per minute per process. It is not a public import API, comprehensive GDPR portability guarantee, or production-reviewed backup.

Regression coverage: tests/export.test.mjs. Full real-browser acceptance is pending.
