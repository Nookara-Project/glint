const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PUB, startAll, JPEG } = require('./helpers');

const CDN = 'https://cdn.nookara.cc';
let T, req, fake;
before(async () => { T = await startAll(); req = T.req; fake = T.fake; });
after(() => T.stop());

const body = videoUrl => ({ videoUrl, title: 'CDN play', game: 'Minecraft', durationSec: 4, width: 640, height: 360, thumbnail: JPEG });
const name = () => `cdn_${Math.random().toString(36).slice(2)}.mp4`;

test('a clip posted with the CDN url matches an upload the API lists on the home host (and the other way round)', async () => {
  const a = name();
  fake.addMedia(7, a);
  let r = await req('POST', '/api/clips', { token: 'tokA', body: body(`${CDN}/uploads/videos/${a}`) });
  assert.ok([200, 201].includes(r.status), r.text);
  assert.strictEqual((await req('GET', `/api/clips/${r.json.id}`, { token: 'tokA' })).json.videoUrl, `${CDN}/uploads/videos/${a}`);

  const b = name();
  const { id } = fake.addMedia(7, b);
  fake.media[7].find(m => m.id === id).url = `${CDN}/uploads/videos/${b}`;
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(`${PUB}/uploads/videos/${b}`) });
  assert.ok([200, 201].includes(r.status), r.text);
  assert.strictEqual((await req('GET', `/api/clips/${r.json.id}`, { token: 'tokA' })).json.videoUrl, `${PUB}/uploads/videos/${b}`);

  const c = name();
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(`${CDN}/uploads/videos/${c}`) });
  assert.strictEqual(r.json.error, 'media_not_found');
});

test('look-alike hosts and other paths are refused', async () => {
  const a = name();
  fake.addMedia(7, a);
  for (const u of [
    `https://cdn.nookara.cc.evil.example/uploads/videos/${a}`, `https://evilcdn.nookara.cc/uploads/videos/${a}`, `https://cdn.nookara.cc@evil.example/uploads/videos/${a}`,
    `http://cdn.nookara.cc/uploads/videos/${a}`, `${CDN}/uploads/images/${a}`, `${CDN}/uploads/videos/../${a}`, `${CDN}/uploads/videos/x/${a}`, `${CDN}/${a}`, `${CDN}/uploads/videos/${a}?x=1`,
  ]) {
    const r = await req('POST', '/api/clips', { token: 'tokA', body: body(u) });
    assert.strictEqual(r.json.error, 'invalid_video_url', u);
  }
});

test('sameMedia / parseMedia', () => {
  const v = T.made.velora || require('../src/velora').createVelora(T.cfg);
  assert.ok(v.sameMedia(`${CDN}/uploads/videos/a.mp4`, `${PUB}/uploads/videos/a.mp4`));
  assert.ok(v.sameMedia('https://velora.ikelene.net/uploads/videos/a.mp4', `${CDN}/uploads/videos/a.mp4`));
  assert.ok(!v.sameMedia(`${CDN}/uploads/videos/a.mp4`, `${PUB}/uploads/videos/b.mp4`));
  assert.ok(!v.sameMedia('nope', 'nope'));
  assert.strictEqual(v.parseMedia(`${CDN}/uploads/videos/a.mp4`).cdn, true);
  assert.strictEqual(v.parseMedia(`${PUB}/uploads/videos/a.mp4`).cdn, false);
});

test('headMedia / download: a CDN url is read from the CDN, a moved home-host file follows exactly one hop to the CDN', async () => {
  const velora = require('../src/velora').createVelora(T.cfg);
  const a = name();
  const f = path.join(T.tmp, a);
  fs.writeFileSync(f, 'hello cdn');
  fake.files.set(a, f);
  assert.strictEqual(await velora.headMedia(`${CDN}/uploads/videos/${a}`), 'ok');
  assert.strictEqual(await velora.headMedia(`${CDN}/uploads/videos/${name()}`), 'gone');
  const dest = path.join(T.tmp, 'dl_' + a);
  assert.strictEqual(await velora.download(`${CDN}/uploads/videos/${a}`, dest), 9);
  assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'hello cdn');

  const http = require('http');
  const cdn = http.createServer((q, s) => { s.writeHead(q.url === `/uploads/videos/${a}` ? 200 : 404, { 'Content-Length': 9 }); s.end(q.method === 'HEAD' ? undefined : 'hello cdn'); });
  await new Promise(r => cdn.listen(0, '127.0.0.1', r));
  const saved = T.cfg.cdnFetchBase;
  T.cfg.cdnFetchBase = `http://127.0.0.1:${cdn.address().port}`;
  try {
    fake.redirects.set(a, `${CDN}/uploads/videos/${a}`);
    assert.strictEqual(await velora.headMedia(`${PUB}/uploads/videos/${a}`), 'ok');
    const dest2 = path.join(T.tmp, 'dl2_' + a);
    assert.strictEqual(await velora.download(`${PUB}/uploads/videos/${a}`, dest2), 9);
    fake.redirects.set(a, `https://evil.example/uploads/videos/${a}`);
    assert.strictEqual(await velora.headMedia(`${PUB}/uploads/videos/${a}`), 'unknown');
    fake.redirects.set(a, `${CDN}/uploads/videos/other.mp4`);
    assert.strictEqual(await velora.headMedia(`${PUB}/uploads/videos/${a}`), 'unknown');
    await assert.rejects(velora.download(`${PUB}/uploads/videos/${a}`, dest2 + 'x'), /velora_bad_response/);
  } finally { T.cfg.cdnFetchBase = saved; fake.redirects.clear(); cdn.close(); }
});

test('the clip page allows the CDN for media and embeds the CDN video', async () => {
  const a = name();
  fake.addMedia(7, a);
  const r = await req('POST', '/api/clips', { token: 'tokA', body: body(`${CDN}/uploads/videos/${a}`) });
  const p = await req('GET', `/c/${r.json.id}`);
  assert.strictEqual(p.status, 200);
  const csp = p.headers.get('content-security-policy');
  assert.match(csp, /media-src [^;]*https:\/\/cdn\.nookara\.cc/);
  assert.match(csp, /connect-src [^;]*https:\/\/cdn\.nookara\.cc/);
  assert.match(p.text, new RegExp(`<meta property="og:video" content="https://cdn\\.nookara\\.cc/uploads/videos/${a}"`));
  const e = await req('GET', `/embed/${r.json.id}`);
  assert.strictEqual(e.status, 200);
});
