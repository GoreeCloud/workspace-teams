import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApplication} from '../src/server.mjs';

async function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),'goree-teams-'));
  const app=createApplication({dbPath:join(directory,'db.sqlite'),origin:'http://localhost:3000'});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.close();rmSync(directory,{recursive:true,force:true});});
  async function request(path,{method='GET',data,cookie}={}){const response=await fetch(base+'/api'+path,{method,headers:{...(method!=='GET'?{'Origin':'http://localhost:3000'}:{}),...(data?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});const json=await response.json();const setCookie=response.headers.get('set-cookie');return {status:response.status,data:json,cookie:setCookie?.split(';')[0]};}
  return {request,base};
}

test('owner bootstrap, private access, messaging, tasks and notes',async t=>{
  const {request}=await fixture(t);
  assert.equal((await request('/me')).data.initialized,false);
  assert.equal((await request('/spaces')).status,401);
  const owner=await request('/bootstrap',{method:'POST',data:{username:'owner',displayName:'Owner',password:'correct-horse-battery'}});
  assert.equal(owner.status,201);assert.ok(owner.cookie?.startsWith('gc_session='));
  assert.equal((await request('/bootstrap',{method:'POST',data:{username:'next',password:'correct-horse-battery'}})).status,409);
  const spaces=await request('/spaces',{cookie:owner.cookie});assert.equal(spaces.status,200);assert.equal(spaces.data.spaces.length,1);
  const space=spaces.data.spaces[0];const channels=await request(`/spaces/${space.id}/channels`,{cookie:owner.cookie});
  assert.equal(channels.data.channels.length,1);const channelId=channels.data.channels[0].id;
  assert.equal((await request(`/channels/${channelId}/messages`)).status,401);
  const message=await request(`/channels/${channelId}/messages`,{cookie:owner.cookie,method:'POST',data:{body:'Hello, private world!'}});assert.equal(message.status,201);
  const messages=await request(`/channels/${channelId}/messages`,{cookie:owner.cookie});assert.equal(messages.data.messages[0].body,'Hello, private world!');
  assert.equal((await request(`/channels/${channelId}/messages`,{cookie:owner.cookie,method:'POST',data:{body:'  '}})).status,400);
  const task=await request(`/spaces/${space.id}/tasks`,{cookie:owner.cookie,method:'POST',data:{title:'Pick up supplies'}});assert.equal(task.status,201);
  assert.equal((await request(`/tasks/${task.data.id}`,{cookie:owner.cookie,method:'PATCH',data:{done:true}})).status,200);
  assert.equal((await request(`/spaces/${space.id}/tasks`,{cookie:owner.cookie})).data.tasks[0].done,1);
  const note=await request(`/spaces/${space.id}/notes`,{cookie:owner.cookie,method:'POST',data:{title:'Private note',body:'Saved on this server'}});assert.equal(note.status,201);
  assert.equal((await request(`/spaces/${space.id}/notes`,{cookie:owner.cookie})).data.notes[0].body,'Saved on this server');
  assert.equal((await request(`/notes/${note.data.id}`,{cookie:owner.cookie,method:'PATCH',data:{title:'Updated',body:'New text'}})).status,200);
  assert.equal((await request('/logout',{cookie:owner.cookie,method:'POST'})).status,200);
  assert.equal((await request('/spaces',{cookie:owner.cookie})).status,401);
});

test('one-time invitations permit shared access but not other private spaces',async t=>{
  const {request}=await fixture(t);
  const owner=await request('/bootstrap',{method:'POST',data:{username:'owner',password:'correct-horse-battery'}});
  const space=(await request('/spaces',{cookie:owner.cookie})).data.spaces[0];
  const invite=await request(`/spaces/${space.id}/invites`,{cookie:owner.cookie,method:'POST',data:{}});
  assert.equal(invite.status,201);
  const member=await request('/register',{method:'POST',data:{username:'friend',displayName:'My Friend',password:'another-strong-password',invite:invite.data.invite}});
  assert.equal(member.status,201);
  assert.equal((await request('/register',{method:'POST',data:{username:'third',password:'another-strong-password',invite:invite.data.invite}})).status,400);
  const memberSpaces=(await request('/spaces',{cookie:member.cookie})).data.spaces;assert.equal(memberSpaces.length,2);
  const shared=memberSpaces.find(s=>s.id===space.id);assert.equal(shared.role,'member');
  const other=memberSpaces.find(s=>s.id!==space.id);
  assert.equal((await request(`/spaces/${other.id}/channels`,{cookie:owner.cookie})).status,404);
  assert.equal((await request(`/spaces/${space.id}/invites`,{cookie:member.cookie,method:'POST',data:{}})).status,403);
  const fakeId='00000000-0000-0000-0000-000000000001';
  assert.equal((await request(`/channels/${fakeId}/messages`,{cookie:member.cookie})).status,404);
});

test('unsafe cross-origin writes are rejected',async t=>{
 const {base}=await fixture(t);
 const response=await fetch(base+'/api/bootstrap',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({username:'bad',password:'correct-horse-battery'})});
 assert.equal(response.status,403);
});
