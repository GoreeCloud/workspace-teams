import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readVerifiedAttachment } from '../src/read-attachment.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'gcws-file-reader-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const path = join(folder, 'attachment');
  const data = Buffer.from([1, 0, 254, 28, 255, 0]);
  writeFileSync(path, data, { mode: 0o600 });
  return { folder, path, data };
}

test('reads a regular attachment with exact size and SHA-256 integrity', t => {
  const { path, data } = fixture(t);
  assert.deepEqual(readVerifiedAttachment(path, data.length, hash(data)), data);
});

test('rejects symlinks even when target contents have a matching digest', t => {
  const { folder, path, data } = fixture(t);
  const shortcut = join(folder, 'shortcut');
  symlinkSync(path, shortcut);
  assert.throws(() => readVerifiedAttachment(shortcut, data.length, hash(data)), /regular file|ELOOP/);
});

test('rejects directories, missing content, mismatched digests and metadata', t => {
  const { folder, path, data } = fixture(t);
  const directory = join(folder, 'directory');
  mkdirSync(directory);
  assert.throws(() => readVerifiedAttachment(directory, data.length, hash(data)), /regular file/);
  assert.throws(() => readVerifiedAttachment(join(folder, 'missing'), data.length, hash(data)), /ENOENT/);
  assert.throws(() => readVerifiedAttachment(path, data.length + 1, hash(data)), /size changed/);
  assert.throws(() => readVerifiedAttachment(path, data.length, hash(Buffer.from('wrong'))), /integrity/);
  assert.throws(() => readVerifiedAttachment(path, 3 * 1024 * 1024, hash(data)), /metadata/);
});
