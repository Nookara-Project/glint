const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const emberDir = process.env.EMBER_DIR || path.join(root, '..', '..', 'bonfire-desktop');
const src = path.join(emberDir, 'lib', 'games.js');
const dest = path.join(root, 'lib', 'vendor', 'games.js');
const stamp = path.join(root, 'lib', 'vendor', 'games.sync.json');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const check = process.argv.includes('--check');

if (!fs.existsSync(src)) {
  if (!fs.existsSync(dest)) { console.error(`[sync-games] no Ember source at ${src} and no vendored copy`); process.exit(1); }
  console.warn(`[sync-games] Ember source not found at ${src} - using the vendored copy as-is`);
  process.exit(0);
}
const a = fs.readFileSync(src);
const b = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
if (check) {
  if (!b || sha(a) !== sha(b)) { console.error('[sync-games] lib/vendor/games.js is STALE - Ember\'s games.js changed. Run: node scripts/sync-games.js'); process.exit(1); }
  console.log('[sync-games] vendored games.js matches Ember');
  process.exit(0);
}
if (!b || sha(a) !== sha(b)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, a);
  fs.writeFileSync(stamp, JSON.stringify({ source: 'bonfire-desktop/lib/games.js', sha256: sha(a), syncedAt: new Date().toISOString() }, null, 2) + '\n');
  console.log('[sync-games] copied Ember\'s games.js into lib/vendor/');
} else console.log('[sync-games] up to date');
