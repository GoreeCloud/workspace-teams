import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';

const origin = 'http://localhost:3000';

test('owner can inspect and revoke active invitations without disclosing bearer tokens', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'goree-invite-'));
  const app = createApplication({ dbPath: join(folder,'workspace.sqlite'), origin });
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{ await new Promise(resolve=>app.server.close(resolve)); app.close(); rmSync(folder,{recursive:true,force:true}); });
  const call = async (path,method='GET',cookie=null,data=null) => {
    const headers = data ? {'Content-Type':'application/json'} : {};
    if(cookie)headers.Cookie=cookie;
    if(method!=='GET')headers.Origin=origin;
    const response=await fetch(base+'/api'+path,{method,headers,body:data?JSON.stringify(data):undefined});
    return {status:response.status, body:await response.json(), cookie:response.headers.get('set-cookie')?.split(';')[0]};
  };
  const owner=await call('/bootstrap','POST',null,{username:'owner',password:'local-long-password'});
  assert.equal(owner.status,201);
  const space=(await call('/spaces','GET',owner.cookie)).body.spaces[0];
  const a=await call(`/spaces/${space.id}/invites`,'POST',owner.cookie,{});
  assert.equal(a.status,201);
  const listed=await call(`/spaces/${space.id}/invites`,'GET',owner.cookie);
  assert.equal(listed.status,200);
  assert.equal(listed.body.invites.length,1);
  assert.match(listed.body.invites[0].id,/^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(listed.body).includes(a.body.invite),false,'never list the bearer token');
  assert.equal((await call(`/spaces/${space.id}/invites/${listed.body.invites[0].id}`,'DELETE')).status,401);
  assert.equal((await call(`/spaces/${space.id}/invites/${listed.body.invites[0].id}`,'DELETE',owner.cookie)).status,200);
  assert.deepEqual((await call(`/spaces/${space.id}/invites`,'GET',owner.cookie)).body.invites,[]);
  assert.equal((await call(`/spaces/${space.id}/invites/${listed.body.invites[0].id}`,'DELETE',owner.cookie)).status,404);
  assert.equal((await call('/register','POST',null,{username:'friend',password:'different-long-password',invite:a.body.invite})).status,400);
  const b=await call(`/spaces/${space.id}/invites`,'POST',owner.cookie,{});
  const friend=await call('/register','POST',null,{username:'friend',password:'different-long-password',invite:b.body.invite});
  assert.equal(friend.status,201);
  assert.equal((await call(`/spaces/${space.id}/invites`,'GET',friend.cookie)).status,403);
  assert.equal((await call(`/spaces/${space.id}/invites`,'POST',friend.cookie,{})).status,403);
  const c=await call(`/spaces/${space.id}/invites`,'POST',owner.cookie,{});
  const active=(await call(`/spaces/${space.id}/invites`,'GET',owner.cookie)).body.invites;
  assert.equal(active.length,1);
  assert.equal((await call(`/spaces/${space.id}/invites/${active[0].id}`,'DELETE',friend.cookie)).status,403);
  assert.equal((await call(`/spaces/${space.id}/invites/${active[0].id}`,'DELETE',owner.cookie)).status,200);
  assert.equal((await call('/invites/accept','POST',friend.cookie,{invite:c.body.invite})).status,400);
});

test('previous invite table migrates additively without dropping records', async () => {
  const {DatabaseSync}=await import('node:sqlite');
  const folder=mkdtempSync(join(tmpdir(),'goree-invite-migrate-'));
  const dbPath=join(folder,'existing.sqlite');
  let app;
  try {
    const legacy=new DatabaseSync(dbPath);
    legacy.exec('CREATE TABLE invites (token_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL, created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_by TEXT)');
    legacy.exec("INSERT INTO invites(token_hash,space_id,created_by,expires_at) VALUES('legacy-secret-hash','old-space','old-user',123456789)");
    legacy.close();
    app=createApplication({dbPath,origin});
    const inspect=new DatabaseSync(dbPath,{readOnly:true});
    try {
      assert.ok(inspect.prepare('PRAGMA table_info(invites)').all().some(column=>column.name==='revoked_at'));
      assert.equal(inspect.prepare("SELECT token_hash FROM invites WHERE token_hash='legacy-secret-hash'").get().token_hash,'legacy-secret-hash');
    } finally { inspect.close(); }
  } finally {if(app)app.close();rmSync(folder,{recursive:true,force:true});}
});
