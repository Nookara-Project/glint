const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createSigner(dataDir) {
  const f = path.join(dataDir, 'secret');
  let secret;
  try { secret = fs.readFileSync(f, 'utf8').trim(); } catch {}
  if (!secret || secret.length < 32) {
    secret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(f, secret, { mode: 0o600 });
  }
  const mac = (p, exp) => crypto.createHmac('sha256', secret).update(`${p}|${exp}`).digest('base64url').slice(0, 32);
  return {
    query(p, ttlSec) {
      const exp = Math.ceil((Date.now() / 1000 + ttlSec) / 3600) * 3600;
      return `exp=${exp}&sig=${mac(p, exp)}`;
    },
    verify(p, exp, sig) {
      const e = Number(exp);
      if (!Number.isFinite(e) || e < Date.now() / 1000 || typeof sig !== 'string') return false;
      const want = Buffer.from(mac(p, e));
      const got = Buffer.from(sig);
      return want.length === got.length && crypto.timingSafeEqual(want, got);
    },
  };
}

module.exports = { createSigner };
