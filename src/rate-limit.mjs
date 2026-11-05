/**
 * Bounded in-process request limiter.
 *
 * When capacity is exhausted, fail closed for new keys while preserving the
 * rate-limit history of clients already tracked. Prune expired windows first.
 * This is not a distributed rate limiter or durable account lockout.
 */
export function createRateLimiter({ maxKeys = 10_000, clock = Date.now } = {}) {
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError('maxKeys must be a positive integer');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');

  const windows = new Map();
  return function limit(client, action, maxRequests, intervalMs) {
    if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 ||
        !Number.isSafeInteger(intervalMs) || intervalMs < 1) {
      throw new TypeError('Rate limit window and request count must be positive integers');
    }
    const time = clock();
    if (!Number.isFinite(time)) throw new TypeError('Clock must return a finite timestamp');
    const key = client + ':' + action;
    const previous = windows.get(key);
    if (previous) {
      const recent = previous.timestamps.filter(timestamp => time >= timestamp && time - timestamp < intervalMs);
      previous.timestamps = recent;
      previous.intervalMs = intervalMs;
      if (recent.length >= maxRequests) return false;
      recent.push(time);
      return true;
    }

    if (windows.size >= maxKeys) {
      for (const [trackedKey, state] of windows) {
        // The last accepted attempt is no longer within this key's window.
        if (!state.timestamps.length || time - state.timestamps[state.timestamps.length - 1] >= state.intervalMs) {
          windows.delete(trackedKey);
        }
      }
      if (windows.size >= maxKeys) return false;
    }
    windows.set(key, { intervalMs, timestamps: [time] });
    return true;
  };
}
