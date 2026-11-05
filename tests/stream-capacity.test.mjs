import test from 'node:test';
import assert from 'node:assert/strict';
import { hasStreamCapacity } from '../src/stream-capacity.mjs';

const stream = (userId, ended = false) => ({ userId, res: { writableEnded: ended, destroyed: false } });

test('accepts available slots and restricts a user with eight live streams', () => {
  const clients = new Set(Array.from({ length: 7 }, () => stream('owner')));
  const streams = new Map([['general', clients]]);
  assert.equal(hasStreamCapacity(streams, 'owner'), true);
  clients.add(stream('owner'));
  assert.equal(hasStreamCapacity(streams, 'owner'), false);
  assert.equal(hasStreamCapacity(streams, 'friend'), true);
  clients.add(stream('owner', true));
  assert.equal(hasStreamCapacity(streams, 'friend'), true);
});

test('global cap prevents opening the 129th live stream', () => {
  const clients = new Set(Array.from({ length: 128 }, (_, i) => stream('user-' + i)));
  const streams = new Map([['general', clients]]);
  assert.equal(hasStreamCapacity(streams, 'new-user'), false);
  const last = [...clients].at(-1);
  last.res.writableEnded = true;
  assert.equal(hasStreamCapacity(streams, 'new-user'), true);
});

test('counts across multiple channels, not only the requested channel', () => {
  const streams = new Map([
    ['a', new Set(Array.from({ length: 4 }, () => stream('alice')))],
    ['b', new Set(Array.from({ length: 4 }, () => stream('alice')))],
  ]);
  assert.equal(hasStreamCapacity(streams, 'alice'), false);
  assert.equal(hasStreamCapacity(streams, 'bob'), true);
});
