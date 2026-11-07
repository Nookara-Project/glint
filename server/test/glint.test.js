const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { open } = require('../src/db');
const { createVelora } = require('../src/velora');
const { createApp } = require('../src/app');

const PUB = 'https://nookara.cc';
const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString('base64');

const fake = { origins: new Set(),
  users: {
    tokA: { id: 7, username: 'alice', rank: 'pro', pfp_url: `${PUB}/uploads/pfp/a.png`, color: '#cb865d', scopes: 4097 },
    tokB: { id: 8, username: 'bob', rank: 'free', pfp_url: null, color: null, scopes: 4097 },
    tokTos: 'tos',
  },
  media: { 7: [], 8: [] },
  files: new Set(),
  deleteFails: false,
  deletes: [],
  profiles: {
    alice: { id: 7, username: 'alice', pfp_url: `${PUB}/uploads/pfp/a.png`, color: '#cb865d', bio: 'hi', banner_url: null, created_at: '2025-01-01T00:00:00Z' },
    carol: { username: 'carol', pfp_url: null, color: '#123456', private: true, visibility: 'friends' },
  },
  calls: [],
};
function addMedia(uid, id, filename) {
  const url = `${PUB}/uploads/videos/${filename}`;
  fake.media[uid].push({ id, type: 'video', filename, url, size: 1000, created_at: new Date().toISOString() });
  fake.files.add(filename);
  return url;
}
function userOf(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? fake.users[h.slice(7)] : undefined;
}
const fakeServer = http.createServer((req, res) => {
  fake.calls.push(`${req.method} ${req.url} xff=${req.headers['x-forwarded-for'] || ''}`);
  if (req.headers.authorization) fake.origins.add(req.headers.origin);
  const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const u = userOf(req);
  let m;
  if (req.method === 'POST' && req.url === '/auth/validate') {
    if (u === 'tos') return send(403, { valid: false, tos_required: true });
    if (!u) return send(401, { valid: false, error: 'invalid_token' });
    return send(200, { valid: true, user: u });
  }
  if (req.method === 'GET' && req.url === '/media/list') {
    if (!u || u === 'tos') return send(401, { error: 'unauthorized' });
    return send(200, { uploads: fake.media[u.id] });
  }
  if (req.method === 'DELETE' && (m = /^\/media\/(\d+)$/.exec(req.url))) {
    if (!u) return send(401, {});
    if (fake.deleteFails) return send(500, { error: 'boom' });
    const list = fake.media[u.id];
    const i = list.findIndex(x => x.id === Number(m[1]));
    if (i < 0) return send(404, { error: 'not_found' });
    fake.files.delete(list[i].filename);
    list.splice(i, 1);
    fake.deletes.push(Number(m[1]));
    return send(200, { success: true });
  }
  if (req.method === 'GET' && (m = /^\/account\/lookup\/([^/]+)$/.exec(req.url))) {
    const p = fake.profiles[decodeURIComponent(m[1]).toLowerCase()];
    return p ? send(200, p) : send(404, { error: 'not_found' });
  }
  if ((req.method === 'HEAD' || req.method === 'GET') && (m = /^\/uploads\/videos\/(.+)$/.exec(req.url))) {
    if (fake.files.has(m[1])) { res.writeHead(200, { 'Content-Type': 'video/mp4' }); return res.end(); }
    res.writeHead(404); return res.end();
  }
  send(404, { error: 'not_found' });
});

let base, appServer, clipsApi, db, tmp;
const quiet = { info() {}, warn() {}, error() {} };

before(async () => {
  await new Promise(r => fakeServer.listen(0, '127.0.0.1', r));
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-test-'));
  const cfg = {
    ...require('../src/config'),
    dataDir: tmp, downloadDir: path.join(tmp, 'dl'),
    veloraApi: `http://127.0.0.1:${fakeServer.address().port}`,
    veloraPublic: PUB, mediaPrefix: `${PUB}/uploads/videos/`,
    publicBase: 'https://ikelene.net/glint', basePath: '/glint',
    headTtlMs: 0, mediaListTtlMs: 0,
  };
  db = open(tmp);
  const made = createApp({ cfg, db, velora: createVelora(cfg), log: quiet });
  clipsApi = made.clips;
  appServer = made.app.listen(0, '127.0.0.1');
  await new Promise(r => appServer.once('listening', r));
  base = `http://127.0.0.1:${appServer.address().port}/glint`;
});
after(() => { appServer.close(); fakeServer.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function req(method, p, { token, body, ip, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (ip) headers['CF-Connecting-IP'] = ip;
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
const clipBody = (videoUrl, extra = {}) => ({ videoUrl, title: 'Big play', game: 'Minecraft', durationSec: 12.5, width: 1920, height: 1080, visibility: 'public', thumbnail: JPEG, ...extra });

test('auth: missing / invalid / tos tokens', async () => {
  assert.strictEqual((await req('POST', '/api/clips', { body: {} })).status, 401);
  assert.strictEqual((await req('POST', '/api/clips', { token: 'nope', body: {} })).status, 401);
  assert.strictEqual((await req('GET', '/api/me/clips')).status, 401);
  const tos = await req('GET', '/api/me', { token: 'tokTos' });
  assert.strictEqual(tos.status, 403);
  assert.strictEqual(tos.json.error, 'tos_required');
  const me = await req('GET', '/api/me', { token: 'tokA' });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.json.user.username, 'alice');
});

test('create: validation + ownership via /media/list', async () => {
  const url = addMedia(7, 101, 'aaa.mp4');
  addMedia(8, 201, 'bbb.mp4');
  let r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody('https://evil.example/x.mp4') });
  assert.deepStrictEqual([r.status, r.json.error], [400, 'invalid_video_url']);
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(`${PUB}/uploads/videos/../../etc.mp4`) });
  assert.strictEqual(r.json.error, 'invalid_video_url');
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { thumbnail: 'data:image/jpeg;base64,AAAA' }) });
  assert.strictEqual(r.json.error, 'invalid_thumbnail');
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { durationSec: -1 }) });
  assert.strictEqual(r.json.error, 'invalid_duration');
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { visibility: 'private' }) });
  assert.strictEqual(r.json.error, 'invalid_visibility');
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { width: 1.5 }) });
  assert.strictEqual(r.json.error, 'invalid_dimensions');
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(`${PUB}/uploads/videos/bbb.mp4`) });
  assert.deepStrictEqual([r.status, r.json.error], [400, 'media_not_found']);
  const big = 'data:image/jpeg;base64,' + Buffer.alloc(310 * 1024, 0xff).toString('base64');
  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { thumbnail: big }) });
  assert.strictEqual(r.status, 413);
});

let clipA;
test('create: success, idempotent re-register, fetch, thumb, list, games', async () => {
  const url = `${PUB}/uploads/videos/aaa.mp4`;
  let r = await req('POST', '/api/clips', { token: 'tokA', ip: '1.2.3.4', body: clipBody(url, { title: '  Big\u0000 play\n ', gameIcon: PNG }) });
  assert.strictEqual(r.status, 201, r.text);
  assert.match(r.json.id, /^[0-9A-Za-z]{10}$/);
  assert.strictEqual(r.json.url, `https://ikelene.net/glint/c/${r.json.id}`);
  clipA = r.json.id;
  assert.ok(fake.calls.some(c => c.startsWith('GET /media/list xff=1.2.3.4')), 'forwards the client ip to velora');

  r = await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url) });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.id, clipA);
  assert.strictEqual(r.json.existing, true);

  r = await req('GET', `/api/clips/${clipA}`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.title, 'Big play');
  assert.strictEqual(r.json.user.username, 'alice');
  assert.strictEqual(r.json.mediaId, undefined, 'media id not exposed publicly');
  assert.match(r.json.gameIcon, /\/api\/icon\/[0-9a-f]{24}\.png$/);

  r = await req('GET', `/api/thumb/${clipA}.jpg`);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');
  r = await req('GET', '/api/icon/' + (await req('GET', `/api/clips/${clipA}`)).json.gameIcon.split('/').pop());
  assert.strictEqual(r.status, 200);

  r = await req('GET', '/api/clips');
  assert.ok(r.json.clips.some(c => c.id === clipA));
  r = await req('GET', '/api/clips?q=big&game=minecraft&sort=top');
  assert.strictEqual(r.json.clips.length, 1);
  r = await req('GET', '/api/clips?q=%25');
  assert.strictEqual(r.json.clips.length, 0, 'LIKE wildcards are escaped');
  r = await req('GET', '/api/games');
  assert.deepStrictEqual(r.json.games.map(g => [g.name, g.count]), [['Minecraft', 1]]);
});

test('unknown / malformed ids are 404 (api + page)', async () => {
  assert.strictEqual((await req('GET', '/api/clips/AAAAAAAAAA')).status, 404);
  assert.strictEqual((await req('GET', '/api/clips/../../x')).status, 404);
  const p = await req('GET', '/c/AAAAAAAAAA');
  assert.strictEqual(p.status, 404);
  assert.match(p.text, /"page":"404"/);
  assert.strictEqual((await req('GET', '/nope/really')).status, 404);
  assert.strictEqual((await req('GET', '/api/nope')).status, 404);
});

test('clip page has OpenGraph + twitter player meta', async () => {
  const p = await req('GET', `/c/${clipA}`);
  assert.strictEqual(p.status, 200);
  assert.match(p.text, /<meta property="og:video" content="https:\/\/nookara\.cc\/uploads\/videos\/aaa\.mp4">/);
  assert.match(p.text, /<meta name="twitter:card" content="player">/);
  assert.match(p.text, new RegExp(`twitter:player" content="https://ikelene.net/glint/embed/${clipA}"`));
  assert.match(p.text, /og:image" content="https:\/\/ikelene\.net\/glint\/api\/thumb\//);
  assert.match(p.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const e = await req('GET', `/embed/${clipA}`);
  assert.strictEqual(e.status, 200);
  assert.match(e.headers.get('content-security-policy'), /frame-ancestors \*/);
});

test('patch: owner only, validation, unlisted hidden from listings but viewable', async () => {
  let r = await req('PATCH', `/api/clips/${clipA}`, { token: 'tokB', body: { title: 'mine now' } });
  assert.strictEqual(r.status, 403);
  r = await req('PATCH', `/api/clips/${clipA}`, { token: 'tokA', body: { title: '   ' } });
  assert.strictEqual(r.json.error, 'invalid_title');
  r = await req('PATCH', `/api/clips/${clipA}`, { token: 'tokA', body: {} });
  assert.strictEqual(r.json.error, 'nothing_to_update');
  r = await req('PATCH', `/api/clips/${clipA}`, { token: 'tokA', body: { title: 'Renamed', visibility: 'unlisted' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.visibility, 'unlisted');
  assert.ok(!(await req('GET', '/api/clips')).json.clips.some(c => c.id === clipA));
  assert.strictEqual((await req('GET', `/api/clips/${clipA}`)).status, 200);
  const page = await req('GET', `/c/${clipA}`);
  assert.match(page.text, /<meta name="robots" content="noindex">/);
  assert.ok((await req('GET', '/api/me/clips', { token: 'tokA' })).json.clips.some(c => c.id === clipA && c.visibility === 'unlisted'));
  await req('PATCH', `/api/clips/${clipA}`, { token: 'tokA', body: { visibility: 'public' } });
});

test('views: once per ip per clip', async () => {
  const before = (await req('GET', `/api/clips/${clipA}`)).json.views;
  let r = await req('POST', `/api/clips/${clipA}/view`, { ip: '9.9.9.9' });
  assert.strictEqual(r.json.counted, true);
  r = await req('POST', `/api/clips/${clipA}/view`, { ip: '9.9.9.9' });
  assert.strictEqual(r.json.counted, false);
  r = await req('POST', `/api/clips/${clipA}/view`, { ip: '8.8.8.8' });
  assert.strictEqual(r.json.views, before + 2);
  assert.strictEqual((await req('POST', '/api/clips/AAAAAAAAAA/view')).status, 404);
});

test('profiles: public, friends-only (limited), unknown', async () => {
  let r = await req('GET', '/api/users/alice');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.user.private, false);
  assert.strictEqual(r.json.user.bio, 'hi');
  assert.ok(r.json.clips.some(c => c.id === clipA));
  r = await req('GET', '/api/users/carol');
  assert.strictEqual(r.json.user.private, true);
  assert.strictEqual(r.json.user.bio, undefined);
  assert.strictEqual((await req('GET', '/api/users/nobody')).status, 404);
  assert.strictEqual((await req('GET', '/api/users/bad%20name')).status, 404);
  assert.strictEqual((await req('GET', '/u/alice')).status, 200);
  assert.strictEqual((await req('GET', '/u/nobody')).status, 404);
});

test('deletion detection: HEAD 404 drops the clip everywhere', async () => {
  const url = addMedia(7, 102, 'ccc.mp4');
  const id = (await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { title: 'Doomed' }) })).json.id;
  assert.strictEqual((await req('GET', `/api/clips/${id}`)).status, 200);
  fake.files.delete('ccc.mp4');
  assert.strictEqual((await req('GET', `/api/clips/${id}`)).status, 404);
  assert.strictEqual((await req('GET', `/c/${id}`)).status, 404);
  assert.ok(!(await req('GET', '/api/clips')).json.clips.some(c => c.id === id));
  assert.strictEqual((await req('GET', `/api/thumb/${id}.jpg`)).status, 404);
});

test('deletion detection: reconcile on /me/clips + revive', async () => {
  const url = addMedia(7, 103, 'ddd.mp4');
  const id = (await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { title: 'Reconciled' }) })).json.id;
  const saved = fake.media[7].find(m => m.id === 103);
  fake.media[7] = fake.media[7].filter(m => m.id !== 103);
  let mine = (await req('GET', '/api/me/clips', { token: 'tokA' })).json.clips;
  assert.ok(mine.some(c => c.id === id), 'the file still answers, so the clip stays');
  assert.strictEqual((await req('GET', `/api/clips/${id}`)).status, 200);
  fake.files.delete('ddd.mp4');
  mine = (await req('GET', '/api/me/clips', { token: 'tokA' })).json.clips;
  assert.ok(!mine.some(c => c.id === id));
  assert.strictEqual((await req('GET', `/api/clips/${id}`)).status, 404);
  fake.files.add('ddd.mp4');
  fake.media[7].push(saved);
  mine = (await req('GET', '/api/me/clips', { token: 'tokA' })).json.clips;
  assert.ok(mine.some(c => c.id === id));
});

test('every call to Nookara says it comes from the Glint app address', () => {
  assert.deepStrictEqual([...fake.origins], ['https://ikelene.net']);
});

test('sweep marks missing media gone', async () => {
  const url = addMedia(7, 104, 'eee.mp4');
  const id = (await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { title: 'Swept' }) })).json.id;
  fake.files.delete('eee.mp4');
  const s = await clipsApi.sweep();
  assert.ok(s.gone >= 1);
  assert.strictEqual(clipsApi.getRow(id).status, 'gone');
});

test('delete: owner only, media=1 deletes velora media, failures keep the clip', async () => {
  const url = addMedia(7, 105, 'fff.mp4');
  const id = (await req('POST', '/api/clips', { token: 'tokA', body: clipBody(url, { title: 'Bye' }) })).json.id;
  assert.strictEqual((await req('DELETE', `/api/clips/${id}?media=1`, { token: 'tokB' })).status, 403);
  fake.deleteFails = true;
  let r = await req('DELETE', `/api/clips/${id}?media=1`, { token: 'tokA' });
  assert.deepStrictEqual([r.status, r.json.error], [502, 'media_delete_failed']);
  assert.strictEqual((await req('GET', `/api/clips/${id}`)).status, 200, 'clip kept when velora refuses');
  fake.deleteFails = false;
  r = await req('DELETE', `/api/clips/${id}?media=1`, { token: 'tokA' });
  assert.deepStrictEqual(r.json, { ok: true, mediaDeleted: true });
  assert.ok(fake.deletes.includes(105));
  assert.strictEqual((await req('GET', `/api/clips/${id}`)).status, 404);
  r = await req('DELETE', `/api/clips/${clipA}`, { token: 'tokA' });
  assert.deepStrictEqual(r.json, { ok: true, mediaDeleted: false });
  assert.ok(!fake.deletes.includes(101));
  assert.strictEqual((await req('DELETE', `/api/clips/${clipA}`, { token: 'tokA' })).status, 404);
});

test('pages: browse, download coming-soon + release, base redirect', async () => {
  let r = await req('GET', '/');
  assert.strictEqual(r.status, 200);
  assert.match(r.text, /"page":"browse"/);
  r = await req('GET', '/download');
  assert.match(r.text, /"release":null/);
  fs.mkdirSync(path.join(tmp, 'dl'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'dl', 'latest.json'), JSON.stringify({ version: '0.1.0', url: 'https://ikelene.net/glint/download/Glint-Setup-0.1.0.exe', sha256: 'ab', size: 5, notes: '<b>x</b>' }));
  r = await req('GET', '/download');
  assert.match(r.text, /"version":"0.1.0"/);
  assert.ok(!r.text.includes('<b>x</b>'), 'boot json escapes html');
  r = await fetch(base.replace(/\/glint$/, '') + '/glint', { redirect: 'manual' });
  assert.strictEqual(r.status, 301);
});

test('bad json + oversized body', async () => {
  const r = await fetch(base + '/api/clips', { method: 'POST', headers: { Authorization: 'Bearer tokA', 'Content-Type': 'application/json' }, body: '{nope' });
  assert.strictEqual(r.status, 400);
  const big = await fetch(base + '/api/clips', { method: 'POST', headers: { Authorization: 'Bearer tokA', 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(1.2 * 1024 * 1024) }) });
  assert.strictEqual(big.status, 413);
});
