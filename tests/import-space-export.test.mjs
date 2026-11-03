import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';
import { importSpaceExport } from '../scripts/import-space-export.mjs';

const ORIGIN='http://localhost:3000';
const password='a-brand-new-owner-password-1234';
function fixture(t){
  const dir=mkdtempSync(join(tmpdir(),'gcws-import-test-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const parent=join(dir,'private');mkdirSync(parent,{mode:0o700});
  const owner=randomUUID(),member=randomUUID(), outsider=randomUUID(),spaceId=randomUUID(),channelId=randomUUID(), firstId=randomUUID(),replyId=randomUUID();
  const stamp=new Date('2026-11-01T15:06:15.000Z').toISOString();
  const bytes=Buffer.from([0,7,255,32,0,49]);
  const data={
    schema:'goreecloud.workspace-teams.space.v2',exportedAt:stamp,attachmentBytesIncluded:true,attachmentEncoding:'base64',
    space:{id:spaceId,name:'Imported team',kind:'team',createdAt:stamp},
    members:[{id:owner,username:'oldowner',displayName:'Old Owner',role:'owner'},
             {id:member,username:'oldmember',displayName:'Old Collaborator',role:'member'}],
    channels:[{id:channelId,name:'general',createdAt:stamp}],
    messages:[{id:firstId,channelId,authorId:member,body:'message by old collaborator',createdAt:stamp,updatedAt:null,parentId:null},
      {id:replyId,channelId,authorId:outsider,body:'old removed contributor replied',createdAt:stamp,updatedAt:stamp,parentId:firstId}],
    tasks:[{id:randomUUID(),authorId:member,title:'Prior task',done:1,createdAt:stamp}],
    notes:[{id:randomUUID(),authorId:owner,title:'Prior note',body:'PRIVATE IMPORT BODY',updatedAt:stamp}],
    files:[{id:randomUUID(),uploaderId:member,name:'bytes.bin',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),uploadedAt:stamp,contentBase64:bytes.toString('base64')}]
  };
  const source=join(parent,'source.json'),passphrase=join(parent,'owner-password.txt');
  writeFileSync(source,JSON.stringify(data),{mode:0o600});
  writeFileSync(passphrase,password+'\n',{mode:0o600});
  const destination=join(parent,'new-instance');
  return {dir,parent,source,passphrase,destination,data,bytes,save:()=>writeFileSync(source,JSON.stringify(data),{mode:0o600}),owner,member,outsider};
}
async function start(app){app.server.listen(0,'127.0.0.1');await once(app.server,'listening');return 'http://127.0.0.1:'+app.server.address().port;}
async function stop(app){await new Promise(r=>app.server.close(r));app.close();}

test('isolated v2 import restores messages, replies, tasks, notes and binary files without access regrant',async t=>{
  const f=fixture(t);
  const result=importSpaceExport({source:f.source,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase});
  assert.equal(result.messages,2);assert.equal(result.files,1);assert.equal(result.archivedAccounts,2);
  assert.ok(existsSync(result.database));assert.ok(existsSync(f.source));
  assert.equal(existsSync(join(f.destination,'.verified-source.json')),false);
  const db=new DatabaseSync(result.database,{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memberships').get().n,1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM invites').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE parent_id IS NOT NULL').get().n,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    const data=db.prepare('SELECT id,sha256 FROM files').get();
    assert.deepEqual(readFileSync(join(result.database+'.files',data.id)),f.bytes);
    assert.equal(createHash('sha256').update(f.bytes).digest('hex'),data.sha256);
  }finally{db.close();}
  const app=createApplication({dbPath:result.database,origin:ORIGIN});
  const base=await start(app);
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({username:'newowner',password})});
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const spaces=await fetch(base+'/api/spaces',{headers:{Cookie:cookie}});
    assert.equal(spaces.status,200);
    const found=(await spaces.json()).spaces.find(s=>s.id===result.spaceId);
    assert.equal(found.role,'owner');
    const notes=await fetch(base+'/api/spaces/'+found.id+'/notes',{headers:{Cookie:cookie}});
    assert.equal((await notes.json()).notes[0].body,'PRIVATE IMPORT BODY');
    const tasks=await fetch(base+'/api/spaces/'+found.id+'/tasks',{headers:{Cookie:cookie}});
    assert.equal((await tasks.json()).tasks[0].done,1);
    const channels=await fetch(base+'/api/spaces/'+found.id+'/channels',{headers:{Cookie:cookie}});
    const channel=(await channels.json()).channels[0];
    const messages=await fetch(base+'/api/channels/'+channel.id+'/messages',{headers:{Cookie:cookie}});
    const history=(await messages.json()).messages;
    assert.equal(history.length,2);
    const original=history.find(m=>m.body==='message by old collaborator');
    const reply=history.find(m=>m.body==='old removed contributor replied');
    assert.equal(original.author,'Old Collaborator');
    assert.equal(reply.author,'Former contributor');
    assert.equal(reply.parentId,original.id);
    const files=await fetch(base+'/api/spaces/'+found.id+'/files',{headers:{Cookie:cookie}});
    const file=(await files.json()).files[0];
    const dl=await fetch(base+'/api/files/'+file.id+'/download',{headers:{Cookie:cookie}});
    assert.deepEqual(Buffer.from(await dl.arrayBuffer()),f.bytes);
    assert.equal((await fetch(base+'/api/files/'+file.id+'/download')).status,401);
    const old=await fetch(base+'/api/login',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({username:'oldmember',password:'old-member-password'})});
    assert.equal(old.status,401);
  }finally{await stop(app);}
  const report=JSON.parse(readFileSync(join(f.destination,'import-report.json'),'utf8'));
  assert.equal(report.files,1);
  assert.equal(statSync(f.destination).mode & 0o077,0);
});

test('import refuses existing destinations, incomplete exports and unsafe credentials',t=>{
  const f=fixture(t);mkdirSync(f.destination);
  assert.throws(()=>importSpaceExport({source:f.source,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase}),/exists/);
  rmSync(f.destination,{recursive:true,force:true});
  f.data.schema='goreecloud.workspace-teams.space.v1';f.data.attachmentBytesIncluded=false;delete f.data.attachmentEncoding;
  delete f.data.files[0].contentBase64;f.save();
  assert.throws(()=>importSpaceExport({source:f.source,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase}),/Only complete v2|Only attachment-inclusive/);
  assert.equal(existsSync(f.destination),false);
  f.data.schema='goreecloud.workspace-teams.space.v2';f.data.attachmentBytesIncluded=true;f.data.attachmentEncoding='base64';f.data.files[0].contentBase64=f.bytes.toString('base64');f.save();
  const unsafe=join(f.parent,'link');symlinkSync(f.source,unsafe);
  assert.throws(()=>importSpaceExport({source:unsafe,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase}),/nonsymlink/);
  writeFileSync(f.passphrase,'bad',{mode:0o600});
  assert.throws(()=>importSpaceExport({source:f.source,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase}),/12–256/);
  assert.equal(existsSync(f.destination),false);
});

test('inconsistent reply references and tampered attachments fail without incomplete outputs',t=>{
  const f=fixture(t);
  f.data.messages[1].parentId=randomUUID();f.save();
  assert.throws(()=>importSpaceExport({source:f.source,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase}),/message data/);
  assert.equal(existsSync(f.destination),false);
  f.data.messages[1].parentId=f.data.messages[0].id;
  f.data.files[0].contentBase64=Buffer.from('wrong').toString('base64');f.save();
  assert.throws(()=>importSpaceExport({source:f.source,destination:f.destination,ownerUsername:'newowner',ownerPasswordFile:f.passphrase}),/integrity/);
  assert.equal(existsSync(f.destination),false);
});
