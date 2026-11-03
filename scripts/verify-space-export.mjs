#!/usr/bin/env node
/** Offline read-only validation of private Workspace Teams portable space exports. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_JSON = 20 * 1024 * 1024, MAX_FILE = 2 * 1024 * 1024, MAX_FILES_TOTAL = 8 * 1024 * 1024;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validId = value => typeof value === 'string' && ID.test(value);
function rejectCredentials(object) {
  const stack = [object]; let visited = 0;
  while (stack.length) {
    const item = stack.pop();
    if (++visited > 120000) throw Error('Export structure too large');
    if (Array.isArray(item)) stack.push(...item);
    else if (record(item)) for (const [name, child] of Object.entries(item)) {
      if (/^(password|password_hash|salt|token_hash|tokenHash|session|sessions|invite|invites|recoveryCode)$/i.test(name))
        throw Error('Export contains forbidden credential fields');
      if (child !== null && typeof child === 'object') stack.push(child);
    }
  }
}
export function verifySpaceExport(source) {
  if (!source) throw Error('A JSON export file is required');
  const file = resolve(source), st = lstatSync(file);
  if (!st.isFile()) throw Error('Export source must be a regular, nonsymlink file');
  if (st.size < 30 || st.size > MAX_JSON) throw Error('Export JSON size is outside allowed range');
  let data;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file));
    data = JSON.parse(text);
  } catch { throw Error('Export JSON is invalid or not UTF-8'); }
  if (!record(data)) throw Error('Export must be a JSON object');
  const v2 = data.schema === 'goreecloud.workspace-teams.space.v2';
  if (!v2 && data.schema !== 'goreecloud.workspace-teams.space.v1') throw Error('Unsupported export schema');
  if (st.size > (v2 ? MAX_JSON : 8 * 1024 * 1024)) throw Error('Export exceeds schema size limit');
  if (data.attachmentBytesIncluded !== v2 || (v2 && data.attachmentEncoding !== 'base64'))
    throw Error('Inconsistent attachment encoding metadata');
  if (!record(data.space) || !validId(data.space.id)) throw Error('Invalid space identifier');
  for (const key of ['channels','messages','members','tasks','notes','files'])
    if (!Array.isArray(data[key])) throw Error('Missing export collection: ' + key);
  if (data.messages.length > 10000 || data.files.length > (v2 ? 100 : 5000))
    throw Error('Export exceeds collection limits');
  rejectCredentials(data);
  const channels = new Set();
  for (const item of data.channels) {
    if (!record(item) || !validId(item.id) || channels.has(item.id))
      throw Error('Invalid or duplicate channel ID');
    channels.add(item.id);
  }
  const messages = new Set();
  for (const item of data.messages) {
    if (!record(item) || !validId(item.id) || messages.has(item.id) ||
        !channels.has(item.channelId) || typeof item.body !== 'string')
      throw Error('Invalid message or channel reference');
    messages.add(item.id);
  }
  const files = new Set(); let total = 0;
  for (const item of data.files) {
    if (!record(item) || !validId(item.id) || files.has(item.id) ||
        !Number.isInteger(item.size) || item.size < 1 || item.size > MAX_FILE ||
        typeof item.sha256 !== 'string' || !SHA.test(item.sha256) ||
        typeof item.name !== 'string' || item.name.length < 1 || item.name.length > 128 ||
        /[\\/\x00-\x1f\x7f]/.test(item.name))
      throw Error('Invalid attachment metadata');
    files.add(item.id);
    if (!v2) {
      if (Object.hasOwn(item, 'contentBase64')) throw Error('Unexpected file bytes in metadata-only export');
      continue;
    }
    if (typeof item.contentBase64 !== 'string' || item.contentBase64.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(item.contentBase64))
      throw Error('Invalid base64 attachment');
    const bytes = Buffer.from(item.contentBase64, 'base64');
    if (bytes.toString('base64') !== item.contentBase64 || bytes.length !== item.size ||
        createHash('sha256').update(bytes).digest('hex') !== item.sha256)
      throw Error('Attachment integrity verification failed');
    total += bytes.length;
    if (total > MAX_FILES_TOTAL) throw Error('Export exceeds 8 MiB attachment cap');
  }
  return Object.freeze({schema:data.schema,spaceId:data.space.id,messages:data.messages.length,
    channels:channels.size,files:files.size,verifiedAttachmentBytes:total,includesFiles:v2});
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), at = args.indexOf('--file');
  if (at < 0 || !args[at + 1]) {
    console.error('Usage: node scripts/verify-space-export.mjs --file PRIVATE-SPACE-EXPORT.json');
    process.exitCode = 2;
  } else try {
    const info = verifySpaceExport(args[at + 1]);
    console.log('Validated ' + info.schema + ', ' + info.messages + ' messages, ' + info.files +
      ' files and ' + info.verifiedAttachmentBytes + ' attachment bytes. No data was imported.');
  } catch (error) { console.error('Export verification failed: ' + error.message); process.exitCode = 1; }
}
