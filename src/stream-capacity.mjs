/** Bounded in-process admission for authorized Server-Sent Event connections. */
export const MAX_STREAMS_PER_USER = 8;
export const MAX_STREAMS_TOTAL = 128;

export function hasStreamCapacity(streams, userId, { perUser = MAX_STREAMS_PER_USER, total = MAX_STREAMS_TOTAL } = {}) {
  let activeTotal = 0;
  let activeUser = 0;
  for (const group of streams.values()) {
    for (const client of group) {
      // A stream that has been ended but not yet removed cannot consume a slot.
      if (client.res.writableEnded || client.res.destroyed) continue;
      activeTotal++;
      if (client.userId === userId) activeUser++;
      if (activeTotal >= total || activeUser >= perUser) return false;
    }
  }
  return true;
}
