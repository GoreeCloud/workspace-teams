import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApplication} from '../src/server.mjs';
import {backupDatabase} from '../scripts/backup.mjs';

async function listen(app) {
  app.server.listen(0,'127.0.0.1');
  await once(app.server,'listening');
  return 'http://127.0.0.1:'+app.server.address().port;
}
async function stop(app) {await new Promise(done=>app.server.close(done)); app.close();}

test('attachment snapshots restore working private downloads and reject missing data',async()=>{
  const folder=mkdtempSync(join(tmpdir(),'goree-restore-'));
  let original,restored;
  try {
    const db=join(folder,'source.sqlite'),backup=join(folder,'snapshot.sqlite');
    original=createApplication({dbPath:db,origin:'http://localhost:3000'});
    const base=await listen(original);
    const first=await fetch(base+'/api/bootstrap',{
      method:'POST',headers:{Origin:'http://localhost:3000','Content-Type':'application/json'},
      body:JSON.stringify({username:'owner',password:'correct-horse-battery'})
    });
    assert.equal(first.status,201);
    const cookie=first.headers.get('set-cookie').split(';')[0];
    const spaces=await fetch(base+'/api/spaces',{headers:{Cookie:cookie}});
    const space=(await spaces.json()).spaces[0];
    const upload=await fetch(base+'/api/spaces/'+space.id+'/files?name=restored.txt',{
      method:'POST',headers:{Cookie:cookie,Origin:'http://localhost:3000','Content-Type':'application/octet-stream'},
      body:'recover-me'
    });
    assert.equal(upload.status,201);
    const file=(await upload.json()).file;
    const snapshot=await backupDatabase({dbPath:db,outputPath:backup});
    assert.equal(snapshot.files,1);
    assert.equal(readFileSync(backup+'.files/'+file.id,'utf8'),'recover-me');
    await stop(original);original=null;
    restored=createApplication({dbPath:backup,origin:'http://localhost:3000'});
    const recoveredBase=await listen(restored);
    const response=await fetch(recoveredBase+'/api/files/'+file.id+'/download',{headers:{Cookie:cookie}});
    assert.equal(response.status,200);
    assert.equal(await response.text(),'recover-me');
    assert.equal((await fetch(recoveredBase+'/api/files/'+file.id+'/download')).status,401);
    assert.equal(existsSync(backup+'.files/'+file.id),true);
  } finally {
    if(original)await stop(original);
    if(restored)await stop(restored);
    rmSync(folder,{recursive:true,force:true});
  }
});
