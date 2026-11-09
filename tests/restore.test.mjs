import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, unlinkSync, writeFileSync, symlinkSync, lstatSync, statSync, mkdirSync } from 'node:fs';
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


test('restore refuses symlinked destination ancestors and final dangling links', async t => {
  if (process.platform === 'win32') return t.skip('Symlink creation requires privileges on Windows');
  const root = mkdtempSync(join(tmpdir(), 'ws-restore-ancestor-'));
  let app;
  try {
    const fixture = await setup(root);
    app = fixture.app;
    const snapshot = join(root, 'backup.sqlite');
    await backupDatabase({ dbPath: fixture.source, outputPath: snapshot });
    await stop(app);
    app = null;

    const unrelated = join(root, 'unrelated');
    const realParent = join(root, 'private-destination-parent');
    const linkedParent = join(root, 'linked-parent');
    const danglingDest = join(root, 'dangling-restore');
    const nested = join(realParent, 'nested', 'still-new', 'restore');
    const empty = join(root, 'no-existing-file');
    // The checked ancestor is a link, not the final destination.
    mkdirSync(realParent, { mode: 0o700 });
    writeFileSync(unrelated, 'preserved-notes', { mode: 0o600 });
    symlinkSync(realParent, linkedParent, 'dir');
    symlinkSync(empty, danglingDest, 'dir');

    assert.throws(
      () => restoreSnapshot({ source: snapshot, destination: join(linkedParent, 'restore') }),
      /ancestry.*real directories/,
    );
    assert.equal(existsSync(join(realParent, 'restore')), false);
    assert.equal(readFileSync(unrelated, 'utf8'), 'preserved-notes');

    assert.throws(
      () => restoreSnapshot({ source: snapshot, destination: danglingDest }),
      /new, nonexistent/,
    );
    assert.equal(lstatSync(danglingDest).isSymbolicLink(), true);
    assert.equal(existsSync(empty), false);

    const accepted = restoreSnapshot({ source: snapshot, destination: nested });
    assert.equal(accepted.files, 1);
    assert.equal(statSync(join(realParent, 'nested')).isDirectory(), true);
    assert.equal(readFileSync(join(nested, 'workspace.sqlite.files', fixture.file.id), 'utf8'),
      'restored-content');
    if (process.platform !== 'win32') {
      assert.equal(statSync(join(realParent, 'nested')).mode & 0o077, 0);
      assert.equal(statSync(join(realParent, 'nested', 'still-new')).mode & 0o077, 0);
    }
  } finally {
    if (app) await stop(app);
    rmSync(root, { recursive: true, force: true });
  }
});
