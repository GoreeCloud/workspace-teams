import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {verifySpaceExport} from '../scripts/verify-space-export.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function setup(t) {
  const dir=mkdtempSync(join(tmpdir(),'gcws-verify-space-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'export.json'),channelId=randomUUID(),bytes=Buffer.from([0,8,255,33,0]);
  const data={schema:'goreecloud.workspace-teams.space.v2',exportedAt:new Date().toISOString(),
    attachmentBytesIncluded:true,attachmentEncoding:'base64',space:{id:randomUUID(),name:'Private'},
    members:[],channels:[{id:channelId,name:'general'}],messages:[{id:randomUUID(),channelId,body:'Hi'}],
    tasks:[],notes:[],files:[{id:randomUUID(),name:'binary.dat',size:bytes.length,
      sha256:digest(bytes),contentBase64:bytes.toString('base64')}]};
  const save=()=>writeFileSync(path,JSON.stringify(data));save();
  return {path,data,save,bytes,dir};
}
test('offline verifier checks v2 attachment bytes and accepts metadata-only v1',t=>{
  const f=setup(t),result=verifySpaceExport(f.path);
  assert.equal(result.includesFiles,true);assert.equal(result.verifiedAttachmentBytes,f.bytes.length);
  f.data.schema='goreecloud.workspace-teams.space.v1';f.data.attachmentBytesIncluded=false;
  delete f.data.attachmentEncoding;delete f.data.files[0].contentBase64;f.save();
  assert.equal(verifySpaceExport(f.path).verifiedAttachmentBytes,0);
});
test('offline verifier rejects tampering, duplicates, secret fields and symlinked source',t=>{
  const f=setup(t);f.data.files[0].contentBase64='AA==';f.save();
  assert.throws(()=>verifySpaceExport(f.path),/integrity/);
  f.data.files[0].contentBase64=f.bytes.toString('base64');f.data.files.push({...f.data.files[0]});f.save();
  assert.throws(()=>verifySpaceExport(f.path),/duplicate|metadata/);
  f.data.files.pop();f.data.password_hash='secret';f.save();
  assert.throws(()=>verifySpaceExport(f.path),/credential/);
  delete f.data.password_hash;f.data.messages[0].channelId=randomUUID();f.save();
  assert.throws(()=>verifySpaceExport(f.path),/channel reference/);
  f.data.messages[0].channelId=f.data.channels[0].id;f.save();
  const link=join(f.dir,'link');symlinkSync(f.path,link);
  assert.throws(()=>verifySpaceExport(link),/regular/);
});
