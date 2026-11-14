import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('OpenRoom has consistent public-facing product identity', async () => {
  const [html, readme, pkg, server, compose] = await Promise.all([
    read('public/index.html'), read('README.md'), read('package.json'),
    read('src/server.mjs'), read('compose.yaml'),
  ]);
  assert.match(html, /<title>GoreeCloud OpenRoom<\/title>/);
  assert.match(html, /GOREECLOUD \/ OPENROOM/);
  assert.match(html, /title="GoreeCloud OpenRoom"/);
  assert.doesNotMatch(html, /GoreeCloud Workspace Teams|WORKSPACE TEAMS/);
  assert.match(readme, /^# GoreeCloud OpenRoom/m);
  assert.equal(JSON.parse(pkg).name, '@goreecloud/openroom');
  assert.match(server, /GoreeCloud OpenRoom listening/);
  assert.match(compose, /^  openroom:$/m);
  const browserAcceptance = await read('scripts/browser-acceptance.mjs');
  assert.match(browserAcceptance, /page\.title\(\), 'GoreeCloud OpenRoom'/);
  assert.doesNotMatch(browserAcceptance, /GoreeCloud Workspace Teams/);
});

test('rename retains versioned exports, encrypted backup and volume compatibility', async () => {
  const [server, compose, backup] = await Promise.all([
    read('src/server.mjs'), read('compose.yaml'), read('scripts/scheduled-backup.mjs'),
  ]);
  assert.match(server, /goreecloud\.workspace-teams\.space\.v1/);
  assert.match(server, /goreecloud\.workspace-teams\.space\.v2/);
  assert.match(compose, /^  workspace-data:$/m);
  assert.match(backup, /workspace-teams/);
});
