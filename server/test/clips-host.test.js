const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PUBLIC = 'https://clips.nookara.cc';
let server, base, fakeNookara, tmp;

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-host-'));
  fakeNookara = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{}'); });
  await new Promise(r => fakeNookara.listen(0, '127.0.0.1', r));
  const webDir = path.join(__dirname, '..', '..', 'web');
  const cfg = { ...require('../src/config'), dataDir: tmp, downloadDir: path.join(tmp, 'dl'), webDir, veloraApi: `http://127.0.0.1:${fakeNookara.address().port}`, apiRateMax: 1e6 };
  assert.strictEqual(cfg.basePath, '');
  assert.strictEqual(cfg.publicBase, PUBLIC);
  const { open } = require('../src/db');
  const { createVelora } = require('../src/velora');
  const { createApp } = require('../src/app');
  const quiet = { info() {}, warn() {}, error() {} };
  const made = createApp({ cfg, db: open(tmp), velora: createVelora(cfg), log: quiet });
  server = made.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  server.closeAllConnections?.(); server.close(); fakeNookara.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
});

test('pages and assets answer at the root, with root links', async () => {
  const r = await fetch(`${base}/`);
  assert.strictEqual(r.status, 200);
  const html = await r.text();
  assert.match(html, /<link rel="stylesheet" href="\/static\/glint\.css/);
  assert.match(html, /<script src="\/static\/app\.js/);
  assert.ok(!/\/glint\//.test(html.replace(/glint\.css|glint-[\w.-]+/g, '')), 'no /glint/ paths left in the page');
  const boot = JSON.parse(/id="boot">(.*?)<\/script>/s.exec(html)[1]);
  assert.strictEqual(boot.base, '');
  assert.strictEqual(boot.publicBase, PUBLIC);
  assert.match(boot.appId, /^app_[0-9a-f]{20}$/);
  assert.strictEqual((await fetch(`${base}/static/app.js`)).status, 200);
  assert.strictEqual((await fetch(`${base}/api/games`)).status, 200);
  assert.strictEqual((await fetch(`${base}/download`)).status, 200);
});

test('the web client signs in with the app id, never with a legacy project', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', '..', 'web', 'app.js'), 'utf8');
  assert.match(js, /app_id: BOOT\.appId/);
  assert.match(js, /nookara_app_grant/);
  assert.ok(!/project_name|permissions_integer|project=Glint/.test(js));
});
