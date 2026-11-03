import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApplication } from '../src/server.mjs';
import { backupDatabase } from '../scripts/backup.mjs';
import { restoreSnapshot } from '../scripts/restore.mjs';

async function listen(app) {
  app.server.listen(0,'127.0.0.1');
  await once(app.server,'listening');
  return 'http://127.0.0.1:' + app.server.address().port;
}
async function stop(app) {await new Promise(done=>app.server.close(done));app.close();}
async function setup(folder) {
  const source=join(folder,'source.sqlite');
  const app=createApplication({dbPath:source,origin:'http://localhost:3000'});
  const url=await listen(app);
  const bootstrap=await fetch(url+'/api/bootstrap',{method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'strong-test-password-1234'})});
  assert.equal(bootstrap.status,201);
  const cookie=bootstrap.headers.get('set-cookie').split(';')[0];
  const spaces=await fetch(url+'/api/spaces',{headers:{Cookie:cookie}});
  const space=(await spaces.json()).spaces[0];
  const upload=await fetch(url+'/api/spaces/'+space.id+'/files?name=restored.txt',{method:'POST',headers:{Cookie:cookie,Origin:'http://localhost:3000','Content-Type':'application/octet-stream'},body:'restored-content'});
  assert.equal(upload.status,201);
  return {app,source,cookie,file:(await upload.json()).file};
}

test('isolated restore preserves authenticated attachment downloads and refuses existing paths',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'ws-restore-'));
  let original,recovered;
  try {
    const s=await setup(folder);original=s.app;
    const snapshot=join(folder,'backup.sqlite');await backupDatabase({dbPath:s.source,outputPath:snapshot});
    await stop(original);original=null;
    const dest=join(folder,'restored'),result=restoreSnapshot({source:snapshot,destination:dest});
    assert.equal(result.files,1);
    assert.equal(readFileSync(join(dest,'workspace.sqlite.files',s.file.id),'utf8'),'restored-content');
    assert.throws(()=>restoreSnapshot({source:snapshot,destination:dest}),/new, nonexistent/);
    recovered=createApplication({dbPath:result.database,origin:'http://localhost:3000'});
    const endpoint=await listen(recovered);
    const authorized=await fetch(endpoint+'/api/files/'+s.file.id+'/download',{headers:{Cookie:s.cookie}});
    assert.equal(authorized.status,200);
    assert.equal(await authorized.text(),'restored-content');
    assert.equal((await fetch(endpoint+'/api/files/'+s.file.id+'/download')).status,401);
  } finally {
    if(original)await stop(original);if(recovered)await stop(recovered);
    rmSync(folder,{recursive:true,force:true});
  }
});

test('invalid or missing attachment aborts restore without creating target',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'ws-restore-bad-'));let original;
  try{
    const s=await setup(folder);original=s.app;
    const snapshot=join(folder,'backup.sqlite');await backupDatabase({dbPath:s.source,outputPath:snapshot});
    await stop(original);original=null;
    const attachment=join(snapshot+'.files',s.file.id),dest=join(folder,'not-created');
    writeFileSync(attachment,'not-the-file');
    assert.throws(()=>restoreSnapshot({source:snapshot,destination:dest}),/integrity check failed/);
    assert.equal(existsSync(dest),false);
    unlinkSync(attachment);
    assert.throws(()=>restoreSnapshot({source:snapshot,destination:dest}),/Missing or unsafe attachment/);
    assert.equal(existsSync(dest),false);
  } finally {
    if(original)await stop(original);
    rmSync(folder,{recursive:true,force:true});
  }
});
