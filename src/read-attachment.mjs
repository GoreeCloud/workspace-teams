/** Read only regular, unlinked, integrity-verified Workspace Teams attachments. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

export function readVerifiedAttachment(path, expectedSize, expectedSha256) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_ATTACHMENT_BYTES ||
      typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) {
    throw new Error('Invalid stored attachment metadata');
  }
  // An attacker with filesystem access must not be able to redirect reads to
  // arbitrary files or blocking devices. O_NOFOLLOW closes the final symlink
  // race on supporting platforms; O_NONBLOCK prevents FIFO-open stalls.
  const before = lstatSync(path);
  if (!before.isFile()) throw new Error('Stored attachment is not a regular file');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino ||
        opened.size !== expectedSize) throw new Error('Stored attachment file identity or size changed');
    const data = Buffer.alloc(expectedSize);
    let read = 0;
    while (read < expectedSize) {
      const size = readSync(fd, data, read, expectedSize - read, read);
      if (!size) throw new Error('Incomplete stored attachment');
      read += size;
    }
    const after = fstatSync(fd);
    if (after.size !== expectedSize || after.dev !== opened.dev || after.ino !== opened.ino ||
        createHash('sha256').update(data).digest('hex') !== expectedSha256) {
      throw new Error('Stored attachment integrity mismatch');
    }
    return data;
  } finally {
    closeSync(fd);
  }
}
