#!/bin/sh
# Read-only Docker metadata preflight for historical GoreeCloud Workspace Teams volumes.
# This command NEVER certifies recovery readiness, reads volume files, or changes Docker state.
set -eu

if [ "$#" -ne 0 ]; then
  echo 'Usage: sh scripts/audit-legacy-volumes.sh (no arguments)' >&2
  exit 64
fi

project='goreecloud-workspace-teams'
expected='goreecloud-workspace-teams_mm_client_plugins
goreecloud-workspace-teams_mm_config
goreecloud-workspace-teams_mm_data
goreecloud-workspace-teams_mm_logs
goreecloud-workspace-teams_mm_plugins
goreecloud-workspace-teams_pg_data'

if ! command -v docker >/dev/null 2>&1; then
  echo 'BLOCKED: Docker CLI unavailable; legacy volume status cannot be verified.' >&2
  exit 4
fi

# Only metadata commands. The sorted exact inventory is critical: a missing volume,
# unexpected extra volume or altered Compose label must never be silently ignored.
if ! current=$(docker volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}'); then
  echo 'BLOCKED: could not list Docker volume metadata.' >&2
  exit 4
fi
current=$(printf '%s\n' "$current" | LC_ALL=C sort)
expected=$(printf '%s\n' "$expected" | LC_ALL=C sort)
if [ "$current" != "$expected" ]; then
  echo 'BLOCKED: legacy volume inventory differs from the preserved six-volume baseline.' >&2
  printf 'Observed Compose-labeled names:\n%s\n' "$current" >&2
  exit 2
fi

active=0
for volume in $expected; do
  if ! label=$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.project"}}'); then
    echo "BLOCKED: cannot inspect metadata of $volume." >&2
    exit 4
  fi
  if [ "$label" != "$project" ]; then
    echo "BLOCKED: unexpected Compose project label on $volume." >&2
    exit 2
  fi
  if ! volume_key=$(docker volume inspect "$volume" --format '{{index .Labels "com.docker.compose.volume"}}'); then
    echo "BLOCKED: cannot inspect Compose volume-key label for $volume." >&2
    exit 4
  fi
  expected_key=${volume#"$project"_}
  if [ "$volume_key" != "$expected_key" ]; then
    echo "BLOCKED: unexpected Compose volume-key label on $volume." >&2
    exit 2
  fi
  if ! references=$(docker ps -a --filter "volume=$volume" --format '{{.ID}}'); then
    echo "BLOCKED: cannot inspect container references for $volume." >&2
    exit 4
  fi
  if [ -n "$references" ]; then
    active=1
    printf 'ACTIVE_REFERENCE: %s has one or more Docker container references.\n' "$volume" >&2
  fi
  printf 'PRESERVED: %s (metadata verified)\n' "$volume"
done

if ! containers=$(docker ps -a --filter "label=com.docker.compose.project=$project" --format '{{.ID}}'); then
  echo 'BLOCKED: cannot inspect Compose-project container references.' >&2
  exit 4
fi
if [ -n "$containers" ]; then
  active=1
  echo 'ACTIVE_REFERENCE: the legacy Compose project has existing containers.' >&2
fi
if [ "$active" -ne 0 ]; then
  echo 'BLOCKED: container references are present; confirm live ownership before maintenance.' >&2
  exit 3
fi

echo 'PASS: all six expected legacy Compose-labeled volumes are present and have no current container references.'
echo 'RECOVERY READINESS: STILL BLOCKED. Data value, backup integrity, independent key recovery and migration safety are UNVERIFIED.'
