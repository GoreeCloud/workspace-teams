import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');

test('narrow-screen profile dialog offers an accessible local sign-out action',()=>{
  assert.match(css,/@media\(max-width:540px\)\{[\s\S]*?\.nav-footer\{display:none\}/);
  assert.match(html,/<button[^>]*id="profile-menu"[^>]*aria-label="Account options"/);
  assert.match(html,/<dialog[^>]*id="account-dialog"/);
  assert.match(html,/<button[^>]*id="account-signout"[^>]*type="button"[^>]*>Sign out of this device<\/button>/);
  assert.match(js,/\$\('#profile-menu'\)\.addEventListener\('click'/);
  assert.match(js,/\$\('#account-signout'\)\.addEventListener\('click',signOut\)/);
  assert.match(js,/\$\('#logout'\)\.addEventListener\('click',signOut\)/);
  assert.match(js,/if\(accountDialog\.open\)accountDialog\.close\(\)/);
});
