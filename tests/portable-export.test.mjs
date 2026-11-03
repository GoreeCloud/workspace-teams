import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApplication} from '../src/server.mjs';
const ORIGIN='http://localhost:3000';
async function api(base,path,method='GET',data,cookie){
  const r=await fetch(base+'/api'+path,{method,headers:{Origin:ORIGIN,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:data?JSON.stringify(data):undefined});
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
}
test('owner portable export includes verified file bytes, rejects outsiders and corrupt files',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'gcws-export-test-')),dbPath=join(dir,'workspace.sqlite');
  const app=createApplication({dbPath,origin:ORIGIN});
  t.after(async()=>{await new Promise(done=>app.server.close(done));app.close();rmSync(dir,{recursive:true,force:true});});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  const owner=await api(base,'/bootstrap','POST',{username:'owner',password:'owner-password-long-enough-1234'});
  assert.equal(owner.status,201);
  const space=(await api(base,'/spaces','GET',null,owner.cookie)).data.spaces[0];
  const other=await api(base,'/spaces','POST',{name:'other',kind:'personal'},owner.cookie);
  const foreign=await fetch(base+'/api/spaces/'+other.data.id+'/files?name=secret.txt',{method:'POST',headers:{Cookie:owner.cookie,Origin:ORIGIN,'Content-Type':'application/octet-stream'},body:'UNRELATED_SPACE_SECRET'});
  assert.equal(foreign.status,201);
  const bytes=Buffer.from([0,1,255,5,0,10]);
  const upload=await fetch(base+'/api/spaces/'+space.id+'/files?name=sample.bin',{method:'POST',headers:{Cookie:owner.cookie,Origin:ORIGIN,'Content-Type':'application/octet-stream'},body:bytes});
  assert.equal(upload.status,201);
  const file=(await upload.json()).file;
  const invitation=await api(base,'/spaces/'+space.id+'/invites','POST',{},owner.cookie);
  const member=await api(base,'/register','POST',{username:'member',password:'member-password-long-enough-1234',invite:invitation.data.invite});
  assert.equal(member.status,201);
  const path='/api/spaces/'+space.id+'/export?includeFiles=1';
  assert.equal((await fetch(base+path)).status,401);
  assert.equal((await fetch(base+path,{headers:{Cookie:member.cookie}})).status,403);
  const result=await fetch(base+path,{headers:{Cookie:owner.cookie}});
  assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');
  assert.match(result.headers.get('content-disposition'),/with-files/);
  const data=await result.json();
  assert.equal(data.schema,'goreecloud.workspace-teams.space.v2');
  assert.equal(data.attachmentEncoding,'base64');
  assert.equal(data.attachmentBytesIncluded,true);
  assert.equal(data.files.length,1);assert.equal(data.files[0].id,file.id);
  assert.deepEqual(Buffer.from(data.files[0].contentBase64,'base64'),bytes);
  for(const secret of ['UNRELATED_SPACE_SECRET','password_hash','token_hash',invitation.data.invite])
    assert.equal(JSON.stringify(data).includes(secret),false);
  const regular=await fetch(base+'/api/spaces/'+space.id+'/export',{headers:{Cookie:owner.cookie}});
  assert.equal((await regular.json()).attachmentBytesIncluded,false);
  assert.equal((await fetch(base+'/api/spaces/'+space.id+'/export?includeFiles=no',{headers:{Cookie:owner.cookie}})).status,400);
  const pathOnDisk=dbPath+'.files/'+file.id;
  writeFileSync(pathOnDisk,'tampered');assert.equal((await fetch(base+path,{headers:{Cookie:owner.cookie}})).status,500);
  rmSync(pathOnDisk);const unsafe=join(dir,'unsafe');writeFileSync(unsafe,bytes);symlinkSync(unsafe,pathOnDisk);
  assert.equal((await fetch(base+path,{headers:{Cookie:owner.cookie}})).status,500);
});
test('oversized portable attachment export is refused rather than truncated',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'gcws-export-limit-'));
  const app=createApplication({dbPath:join(dir,'db.sqlite'),origin:ORIGIN});
  t.after(async()=>{await new Promise(done=>app.server.close(done));app.close();rmSync(dir,{recursive:true,force:true});});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  const owner=await api(base,'/bootstrap','POST',{username:'owner',password:'owner-password-long-enough-1234'});
  const space=(await api(base,'/spaces','GET',null,owner.cookie)).data.spaces[0];
  for(let i=0;i<5;i++){
    const upload=await fetch(base+'/api/spaces/'+space.id+'/files?name=file'+i+'.bin',{method:'POST',headers:{Cookie:owner.cookie,Origin:ORIGIN,'Content-Type':'application/octet-stream'},body:Buffer.alloc(2*1024*1024,65)});
    assert.equal(upload.status,201);
  }
  const r=await fetch(base+'/api/spaces/'+space.id+'/export?includeFiles=1',{headers:{Cookie:owner.cookie}});
  assert.equal(r.status,413);
  assert.match((await r.json()).error,/8 MiB/);
});
