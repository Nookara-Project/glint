function createLimiter({ windowMs, max }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, Math.max(windowMs, 30_000));
  timer.unref();
  return {
    hit(key) {
      const now = Date.now();
      let e = hits.get(key);
      if (!e || e.reset <= now) { e = { n: 0, reset: now + windowMs }; hits.set(key, e); }
      e.n++;
      return { ok: e.n <= max, retryAfter: Math.ceil((e.reset - now) / 1000) };
    },
    reset() { hits.clear(); },
  };
}

function createSeen(ttlMs) {
  const m = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, exp] of m) if (exp <= now) m.delete(k);
  }, 60_000);
  timer.unref();
  return {
    first(key) {
      const now = Date.now();
      const exp = m.get(key);
      if (exp && exp > now) return false;
      m.set(key, now + ttlMs);
      return true;
    },
    reset() { m.clear(); },
  };
}

module.exports = { createLimiter, createSeen };
