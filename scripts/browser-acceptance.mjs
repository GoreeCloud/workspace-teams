#!/usr/bin/env node
/**
 * Opt-in real-browser acceptance against a temporary, loopback-only Workspace Teams instance.
 * Requires a preinstalled, trusted Puppeteer module and Chromium. Never touches production data.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApplication } from '../src/server.mjs';

const require = createRequire(import.meta.url);
const browserModule = process.env.PUPPETEER_MODULE || 'puppeteer';
let puppeteer;
try {
  puppeteer = require(browserModule);
} catch {
  console.error('Puppeteer is unavailable. Set PUPPETEER_MODULE to an already reviewed, installed Puppeteer module.');
  process.exit(2);
}
const executablePath = process.env.CHROMIUM_PATH || undefined;
const screenshotDir = process.env.QA_SCREENSHOT_DIR ? resolve(process.env.QA_SCREENSHOT_DIR) : null;
const credentials = { username: 'gcws_qa_owner', password: 'synthetic-isolated-qa-password-9482' };
const temp = mkdtempSync(join(tmpdir(), 'gcws-acceptance-'));
let app = null;
let browser = null;
let page = null;
const errors = [];
const completed = [];
const mark = label => { completed.push(label); console.log('PASS', label); };
async function freePort() {
  return new Promise((resolve, reject) => {
    const socket = createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}
async function capture(label) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true, mode: 0o700 });
  await page.screenshot({ path: join(screenshotDir, label + '.png'), fullPage: true });
}
try {
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  app = createApplication({ dbPath: join(temp, 'workspace.sqlite'), origin });
  await new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve));
  browser = await puppeteer.launch({ executablePath, headless: true, args: ['--disable-dev-shm-usage'] });
  page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewport({ width: 1366, height: 850 });
  const response = await page.goto(origin, { waitUntil: 'networkidle2', timeout: 25000 });
  assert.equal(response.status(), 200);
  await page.waitForSelector('#auth:not([hidden])', { timeout: 12000 });
  assert.match(await page.title(), /GoreeCloud Workspace Teams/);
  mark('live browser loaded first-run experience');

  await page.type('#username', credentials.username);
  await page.type('#password', credentials.password);
  await page.click('#auth-submit');
  await page.waitForSelector('#app:not([hidden])', { timeout: 12000 });
  mark('first-owner setup, cookie session and app shell');

  await page.type('#message-input', 'BROWSER_REAL_MESSAGE_73');
  await page.click('#message-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#messages')?.textContent.includes('BROWSER_REAL_MESSAGE_73'), { timeout: 12000 });
  mark('message creation and live DOM');

  await page.click('[data-tool="tasks"]');
  await page.type('#task-title', 'BROWSER_REAL_TASK_73');
  await page.click('#task-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#task-list')?.textContent.includes('BROWSER_REAL_TASK_73'), { timeout: 12000 });
  mark('task creation and rendering');

  await page.click('[data-tool="search"]');
  await page.type('#search-input', 'BROWSER_REAL_MESSAGE_73');
  await page.click('#search-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#search-results')?.textContent.includes('BROWSER_REAL_MESSAGE_73'), { timeout: 12000 });
  mark('authenticated, space-scoped search');

  const attachment = join(temp, 'synthetic-browser-file.txt');
  writeFileSync(attachment, 'PRIVATE_TEST_FILE_73', { mode: 0o600 });
  await page.click('[data-tool="files"]');
  await (await page.$('#file-input')).uploadFile(attachment);
  await page.click('#file-form button[type=submit]');
  await page.waitForFunction(() => document.querySelector('#file-list')?.textContent.includes('synthetic-browser-file.txt'), { timeout: 12000 });
  mark('private file upload and list');

  await page.click('[data-tool="members"]');
  await page.waitForSelector('#space-export:not([hidden])', { timeout: 12000 });
  const href = await page.$eval('#space-export-files-link', element => element.getAttribute('href'));
  assert.match(href, /includeFiles=1/);
  const exported = await page.evaluate(async relative => {
    const response = await fetch(relative);
    return { status: response.status, json: await response.json() };
  }, href);
  assert.equal(exported.status, 200);
  assert.equal(exported.json.schema, 'goreecloud.workspace-teams.space.v2');
  assert.equal(exported.json.files.length, 1);
  assert.equal(Buffer.from(exported.json.files[0].contentBase64, 'base64').toString(), 'PRIVATE_TEST_FILE_73');
  mark('owner-only attachment-inclusive export');

  await page.click('#profile-menu');
  await page.waitForSelector('#account-dialog[open]', { timeout: 12000 });
  assert.match(await page.$eval('#account-session-count', element => element.textContent), /session/i);
  await page.click('#account-close');
  mark('account security dialog');
  await capture('workspace-desktop');

  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#app:not([hidden])', { timeout: 12000 });
  const viewport = await page.evaluate(() => ({
    width: innerWidth, scroll: document.documentElement.scrollWidth,
    authenticated: !document.querySelector('#app').hidden,
  }));
  assert.equal(viewport.authenticated, true);
  assert.ok(viewport.scroll <= viewport.width + 2, 'Horizontal overflow: ' + JSON.stringify(viewport));
  await capture('workspace-mobile');
  mark('mobile layout and authenticated state without overflow');

  await page.click('#profile-menu');
  await page.waitForSelector('#account-dialog[open]', { timeout: 12000 });
  await page.waitForSelector('#account-signout', { visible: true, timeout: 12000 });
  await page.click('#account-signout');
  await page.waitForSelector('#auth:not([hidden])', { timeout: 12000 });
  mark('mobile sign-out via account dialog');

  await page.setViewport({ width: 1366, height: 850 });
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForSelector('#auth:not([hidden])', { timeout: 12000 });
  await page.type('#username', credentials.username);
  await page.type('#password', credentials.password);
  await page.click('#auth-submit');
  await page.waitForSelector('#app:not([hidden])', { timeout: 12000 });
  await page.click('#logout');
  await page.waitForSelector('#auth:not([hidden])', { timeout: 12000 });
  mark('desktop sign-out and subsequent session invalidation');

  assert.deepEqual(errors, [], 'Browser JavaScript errors: ' + errors.join(' | '));
  mark('no uncaught browser JavaScript errors');
  console.log('SUMMARY', completed.length + '/' + completed.length, 'real-browser checks passed');
} finally {
  try { await page?.close(); } catch {}
  try { await browser?.close(); } catch {}
  if (app) {
    try { await new Promise(resolve => app.server.close(resolve)); } catch {}
    try { app.close(); } catch {}
  }
  rmSync(temp, { recursive: true, force: true });
}