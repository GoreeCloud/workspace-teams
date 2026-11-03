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

test('editing, deleting, and replying to messages obey author and space permissions', async t=>{
  const {request}=await fixture(t);
  const owner=await request('/bootstrap',{method:'POST',data:{username:'owner',password:'correct-horse-battery'}});
  const shared=(await request('/spaces',{cookie:owner.cookie})).data.spaces[0];
  const channel=(await request(`/spaces/${shared.id}/channels`,{cookie:owner.cookie})).data.channels[0];
  const invite=(await request(`/spaces/${shared.id}/invites`,{cookie:owner.cookie,method:'POST',data:{}})).data.invite;
  const friend=await request('/register',{method:'POST',data:{username:'friend',password:'another-strong-password',invite}});
  const other=(await request('/spaces',{cookie:friend.cookie})).data.spaces.find(s=>s.id!==shared.id);
  const otherChannel=(await request(`/spaces/${other.id}/channels`,{cookie:friend.cookie})).data.channels[0];
  const msg=(await request(`/channels/${channel.id}/messages`,{cookie:owner.cookie,method:'POST',data:{body:'First version'}})).data.message;
  assert.equal((await request(`/messages/${msg.id}`,{cookie:friend.cookie,method:'PATCH',data:{body:'Tamper'}})).status,403);
  assert.equal((await request(`/messages/${msg.id}`,{cookie:friend.cookie,method:'DELETE'})).status,403);
  assert.equal((await request(`/channels/${otherChannel.id}/messages`,{cookie:friend.cookie,method:'POST',data:{body:'Cross-space',parentId:msg.id}})).status,400);
  const reply=await request(`/channels/${channel.id}/messages`,{cookie:friend.cookie,method:'POST',data:{body:'A reply',parentId:msg.id}});
  assert.equal(reply.status,201);assert.equal(reply.data.message.parentId,msg.id);
  assert.equal((await request(`/messages/${msg.id}`,{cookie:owner.cookie,method:'PATCH',data:{body:'Edited copy'}})).status,200);
  const messages=(await request(`/channels/${channel.id}/messages`,{cookie:friend.cookie})).data.messages;
  assert.equal(messages[0].body,'Edited copy');assert.ok(messages[0].updatedAt);
  assert.equal(messages[1].parentId,msg.id);
  assert.equal((await request(`/messages/${reply.data.message.id}`,{cookie:owner.cookie,method:'DELETE'})).status,200);
  assert.equal((await request(`/messages/${msg.id}`,{cookie:owner.cookie,method:'DELETE'})).status,200);
  assert.equal((await request(`/channels/${channel.id}/messages`,{cookie:friend.cookie})).data.messages.length,0);
});

test('private search excludes other spaces and treats LIKE wildcards literally',async t=>{
  const {request}=await fixture(t);
  const owner=await request('/bootstrap',{method:'POST',data:{username:'owner',password:'correct-horse-battery'}});
  const space=(await request('/spaces',{cookie:owner.cookie})).data.spaces[0];
  const channel=(await request(`/spaces/${space.id}/channels`,{cookie:owner.cookie})).data.channels[0];
  const invite=(await request(`/spaces/${space.id}/invites`,{cookie:owner.cookie,method:'POST',data:{}})).data.invite;
  const member=await request('/register',{method:'POST',data:{username:'friend',password:'another-strong-password',invite}});
  const privateSpace=(await request('/spaces',{cookie:member.cookie})).data.spaces.find(s=>s.id!==space.id);
  const privateChannel=(await request(`/spaces/${privateSpace.id}/channels`,{cookie:member.cookie})).data.channels[0];
  await request(`/channels/${channel.id}/messages`,{cookie:owner.cookie,method:'POST',data:{body:'Shared bluejay discussion'}});
  await request(`/spaces/${space.id}/notes`,{cookie:owner.cookie,method:'POST',data:{title:'Bluejay notes',body:'Shared'} });
  await request(`/spaces/${space.id}/tasks`,{cookie:owner.cookie,method:'POST',data:{title:'Bluejay plan'}});
  await request(`/channels/${privateChannel.id}/messages`,{cookie:member.cookie,method:'POST',data:{body:'Private bluejay entry'}});
  const ownerSearch=await request('/search?q=bluejay',{cookie:owner.cookie});
  assert.equal(ownerSearch.status,200);assert.equal(ownerSearch.data.messages.length,1);
  assert.equal(ownerSearch.data.notes.length,1);assert.equal(ownerSearch.data.tasks.length,1);
  const memberSearch=await request('/search?q=bluejay',{cookie:member.cookie});
  assert.equal(memberSearch.data.messages.length,2);
  const scoped=await request(`/search?q=bluejay&spaceId=${space.id}`,{cookie:member.cookie});
  assert.equal(scoped.data.messages.length,1);
  assert.equal((await request(`/search?q=bluejay&spaceId=${privateSpace.id}`,{cookie:owner.cookie})).status,404);
  assert.equal((await request('/search?q=%25a',{cookie:owner.cookie})).data.messages.length,0);
  assert.equal((await request('/search?q=b',{cookie:owner.cookie})).status,400);
});

test('owner removal terminates a live stream and blocks future access',async t=>{
  const {request,base}=await fixture(t);
  const owner=await request('/bootstrap',{method:'POST',data:{username:'owner',password:'correct-horse-battery'}});
  const space=(await request('/spaces',{cookie:owner.cookie})).data.spaces[0];
  const channel=(await request(`/spaces/${space.id}/channels`,{cookie:owner.cookie})).data.channels[0];
  const invite=(await request(`/spaces/${space.id}/invites`,{cookie:owner.cookie,method:'POST',data:{}})).data.invite;
  const friend=await request('/register',{method:'POST',data:{username:'friend',password:'another-strong-password',invite}});
  const friendId=friend.data.user.id;
  assert.equal((await request(`/spaces/${space.id}/members`,{cookie:friend.cookie})).data.members.length,2);
  assert.equal((await request(`/spaces/${space.id}/members/${friendId}`,{cookie:friend.cookie,method:'DELETE'})).status,403);
  assert.equal((await request(`/spaces/${space.id}/members/${owner.data.user.id}`,{cookie:owner.cookie,method:'DELETE'})).status,403);
  const response=await fetch(`${base}/api/channels/${channel.id}/stream`,{headers:{Cookie:friend.cookie}});
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/connected/);
  assert.equal((await request(`/spaces/${space.id}/members/${friendId}`,{cookie:owner.cookie,method:'DELETE'})).status,200);
  const result=await Promise.race([reader.read(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('stream revocation timeout')),1500))]);
  assert.equal(result.done,true);
  assert.equal((await request(`/channels/${channel.id}/messages`,{cookie:friend.cookie})).status,404);
  assert.equal((await request(`/search?q=bluejay&spaceId=${space.id}`,{cookie:friend.cookie})).status,404);
});

test('existing users may accept an invitation once',async t=>{
  const {request}=await fixture(t);
  const owner=await request('/bootstrap',{method:'POST',data:{username:'owner',password:'correct-horse-battery'}});
  const ownerSpace=(await request('/spaces',{cookie:owner.cookie})).data.spaces[0];
  const invite1=(await request(`/spaces/${ownerSpace.id}/invites`,{cookie:owner.cookie,method:'POST',data:{}})).data.invite;
  const friend=await request('/register',{method:'POST',data:{username:'friend',password:'another-strong-password',invite:invite1}});
  const secondSpace=(await request('/spaces',{cookie:owner.cookie,method:'POST',data:{name:'Another family',kind:'family'}})).data.id;
  const invite2=(await request(`/spaces/${secondSpace}/invites`,{cookie:owner.cookie,method:'POST',data:{}})).data.invite;
  assert.equal((await request('/invites/accept',{cookie:friend.cookie,method:'POST',data:{invite:invite2}})).status,200);
  assert.equal((await request('/invites/accept',{cookie:friend.cookie,method:'POST',data:{invite:invite2}})).status,400);
  assert.equal((await request(`/spaces/${secondSpace}/channels`,{cookie:friend.cookie})).status,200);
});

test('consistent online backup preserves accounts, refuses overwrite, and verifies integrity',async t=>{
  const {backupDatabase}=await import('../scripts/backup.mjs');
  const dir=mkdtempSync(join(tmpdir(),'workspace-backup-'));
  const dbPath=join(dir,'active.sqlite'),dest=join(dir,'backup.sqlite');
  const app=createApplication({dbPath,origin:'http://localhost:3000'});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));app.close();rmSync(dir,{recursive:true,force:true});});
  const response=await fetch(`${base}/api/bootstrap`,{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({username:'backupowner',password:'correct-horse-battery'})});
  assert.equal(response.status,201);
  const backed=await backupDatabase({dbPath,outputPath:dest});
  assert.ok(backed.bytes>0);
  await assert.rejects(backupDatabase({dbPath,outputPath:dest}),/already exists/);
  const {DatabaseSync}=await import('node:sqlite');
  const restored=new DatabaseSync(dest,{readOnly:true});
  try {assert.equal(restored.prepare('SELECT username FROM users LIMIT 1').get().username,'backupowner');}
  finally{restored.close();}
});
