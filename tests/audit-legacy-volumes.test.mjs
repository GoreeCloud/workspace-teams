import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/audit-legacy-volumes.sh');
const mock = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_DOCKER_CALLS"
case "$1 $2" in
  'volume ls')
    printf '%s\\n' 'goreecloud-workspace-teams_mm_client_plugins' 'goreecloud-workspace-teams_mm_config' 'goreecloud-workspace-teams_mm_data' 'goreecloud-workspace-teams_mm_logs' 'goreecloud-workspace-teams_mm_plugins'
    if [ "$FAKE_DOCKER_CASE" != 'missing' ]; then echo goreecloud-workspace-teams_pg_data; fi
    if [ "$FAKE_DOCKER_CASE" = 'extra' ]; then echo goreecloud-workspace-teams_unauthorized; fi
    ;;
  'volume inspect')
    if [ "$FAKE_DOCKER_CASE" = 'inspect-fails' ]; then exit 1; fi
    case "$*" in
      *com.docker.compose.volume*)
        if [ "$FAKE_DOCKER_CASE" = 'wrong-volume-label' ]; then echo other_volume; else echo "\${3#goreecloud-workspace-teams_}"; fi
        ;;
      *) if [ "$FAKE_DOCKER_CASE" = 'wrong-label' ]; then echo 'other-project'; else echo 'goreecloud-workspace-teams'; fi ;;
    esac
    ;;
  'ps -a')
    if [ "$FAKE_DOCKER_CASE" = 'ps-fails' ]; then exit 1; fi
    if [ "$FAKE_DOCKER_CASE" = 'in-use' ]; then echo 'container-123'; fi
    ;;
  *) echo 'Unsafe/unexpected Docker command' >&2; exit 66;;
esac
`;

function invoke(t, variant = 'normal', args = []) {
  const tmp = mkdtempSync(join(tmpdir(), 'gcws-legacy-audit-test-'));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const binary = join(tmp, 'docker');
  const calls = join(tmp, 'calls');
  writeFileSync(binary, mock, { mode: 0o700 });
  chmodSync(binary, 0o700);
  writeFileSync(calls, '');
  const result = spawnSync('sh', [script, ...args], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env: { ...process.env, PATH: tmp + ':' + process.env.PATH, FAKE_DOCKER_CASE: variant, FAKE_DOCKER_CALLS: calls },
  });
  assert.equal(result.error, undefined);
  const records = readFileSync(calls, 'utf8').trim().split('\n').filter(Boolean);
  for (const record of records) {
    assert.match(record, /^(volume ls |volume inspect |ps -a )/);
    assert.doesNotMatch(record, /\b(?:rm|prune|create|start|stop|run|exec)\b/);
  }
  return { ...result, records };
}

test('expected six-volume inventory reports preservation, never recovery certification', t => {
  const r = invoke(t);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /six expected legacy/);
  assert.match(r.stdout, /STILL BLOCKED/);
  assert.equal(r.records.length, 20);
});
test('missing preserved volume fails closed', t => {
  const r = invoke(t, 'missing');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /differs/);
  assert.equal(r.records.length, 1);
});
test('unexpected additional Compose-labeled volume fails closed', t => {
  const r = invoke(t, 'extra');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /differs/);
  assert.equal(r.records.length, 1);
});
test('altered project labels fail closed', t => {
  const r = invoke(t, 'wrong-label');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unexpected Compose project label/);
});
test('altered Compose volume-key labels fail closed', t => {
  const r = invoke(t, 'wrong-volume-label');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unexpected Compose volume-key label/);
});
test('preexisting container reference blocks the audit', t => {
  const r = invoke(t, 'in-use');
  assert.equal(r.status, 3);
  assert.match(r.stderr, /container references/);
});
test('Docker metadata read errors fail closed', t => {
  const inspect = invoke(t, 'inspect-fails');
  assert.equal(inspect.status, 4);
  const ps = invoke(t, 'ps-fails');
  assert.equal(ps.status, 4);
});
test('no unexpected arguments may modify the fixed scope', t => {
  const r = invoke(t, 'normal', ['--force']);
  assert.equal(r.status, 64);
  assert.equal(r.records.length, 0);
});
