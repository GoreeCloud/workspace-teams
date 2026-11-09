import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter } from '../src/rate-limit.mjs';

test('limits repeated requests and allows them once the interval expires', () => {
  let time = 5_000;
  const limit = createRateLimiter({ maxKeys: 2, clock: () => time });
  assert.equal(limit('one', 'login', 2, 1_000), true);
  assert.equal(limit('one', 'login', 2, 1_000), true);
  assert.equal(limit('one', 'login', 2, 1_000), false);
  time += 999;
  assert.equal(limit('one', 'login', 2, 1_000), false);
  time++;
  assert.equal(limit('one', 'login', 2, 1_000), true);
});

test('at capacity unknown clients fail closed without resetting hot-client restrictions', () => {
  let time = 1_000;
  const limit = createRateLimiter({ maxKeys: 3, clock: () => time });
  assert.equal(limit('victim', 'login', 1, 60_000), true);
  assert.equal(limit('other-1', 'login', 1, 60_000), true);
  assert.equal(limit('other-2', 'login', 1, 60_000), true);
  for (let i = 0; i < 100; i++) assert.equal(limit('flood-' + i, 'login', 1, 60_000), false);
  assert.equal(limit('victim', 'login', 1, 60_000), false);
  time = 61_001;
  assert.equal(limit('flood-100', 'login', 1, 60_000), true);
  assert.equal(limit('victim', 'login', 1, 60_000), true);
});

test('a 10,001st key does not clear the protected login history', () => {
  const limit = createRateLimiter({ clock: () => 42 });
  assert.equal(limit('protected', 'login', 1, 900_000), true);
  for (let i = 0; i < 9_999; i++) assert.equal(limit('source-' + i, 'search', 1, 900_000), true);
  assert.equal(limit('overflow', 'search', 1, 900_000), false);
  assert.equal(limit('protected', 'login', 1, 900_000), false);
});

test('independent actions remain scoped to their key', () => {
  const limit = createRateLimiter({ maxKeys: 2, clock: () => 2_000 });
  assert.equal(limit('localhost', 'login', 1, 10_000), true);
  assert.equal(limit('localhost', 'login', 1, 10_000), false);
  assert.equal(limit('localhost', 'messages', 1, 10_000), true);
  assert.equal(limit('localhost', 'messages', 1, 10_000), false);
});

test('invalid configurations are rejected', () => {
  assert.throws(() => createRateLimiter({ maxKeys: 0 }), /positive integer/);
  const limit = createRateLimiter();
  assert.throws(() => limit('x', 'login', 0, 1_000), /positive integers/);
  assert.throws(() => limit('x', 'login', 1, 0), /positive integers/);
});

test('colon-delimited client and action pairs never share a quota bucket', () => {
  const limit = createRateLimiter({ maxKeys: 2, clock: () => 2_000 });
  // These two pairs previously both produced the key "a:b:c".
  assert.equal(limit('a:b', 'c', 1, 10_000), true);
  assert.equal(limit('a', 'b:c', 1, 10_000), true);
  assert.equal(limit('a:b', 'c', 1, 10_000), false);
  assert.equal(limit('a', 'b:c', 1, 10_000), false);
  // Distinct identities really occupy distinct capacity slots.
  assert.equal(limit('other', 'action', 1, 10_000), false);
});

test('tuple encoding does not confuse JSON punctuation or unusual client strings', () => {
  const limit = createRateLimiter({ maxKeys: 3, clock: () => 2_000 });
  assert.equal(limit('x","y', 'z', 1, 10_000), true);
  assert.equal(limit('x', 'y","z', 1, 10_000), true);
  assert.equal(limit('["x","y"]', 'z', 1, 10_000), true);
  assert.equal(limit('x","y', 'z', 1, 10_000), false);
  assert.equal(limit('x', 'y","z', 1, 10_000), false);
});
