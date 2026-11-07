const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const PUB = 'https://nookara.cc';

function hasFfmpeg() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType || '');
  if (!m) return {};
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const out = {};
  let pos = buf.indexOf(boundary);
  while (pos >= 0) {
    const next = buf.indexOf(boundary, pos + boundary.length);
    if (next < 0) break;
    const part = buf.subarray(pos + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    if (sep > 0) {
      const head = part.subarray(0, sep).toString();
      const name = /name="([^"]+)"/.exec(head);
      if (name) out[name[1]] = /filename=/.test(head) ? part.subarray(sep + 4) : part.subarray(sep + 4).toString();
    }
    pos = next;
  }
  return out;
}

function createFake(tmp) {
  const fake = {
    users: {
      tokA: { id: 7, username: 'alice', rank: 'pro', pfp_url: `${PUB}/uploads/pfp/a.png`, color: '#cb865d', scopes: 4097 },
      tokB: { id: 8, username: 'bob', rank: 'free', pfp_url: null, color: null, scopes: 4097 },
      tokC: { id: 9, username: 'carol', rank: 'free', pfp_url: null, color: null, scopes: 4097 },
    },
    media: { 7: [], 8: [], 9: [] },
    files: new Map(),
    sessions: new Map(),
    nextMediaId: 5000,
    deleteFails: false,
    redirects: new Map(),
    chunkStatus: 200,
    revoked: new Set(),
    deletes: [],
    profiles: {
      alice: { id: 7, username: 'alice', pfp_url: `${PUB}/uploads/pfp/a.png`, color: '#cb865d', bio: 'hi', created_at: '2025-01-01T00:00:00Z' },
      bob: { id: 8, username: 'bob', pfp_url: null, color: null, bio: '', created_at: '2025-01-01T00:00:00Z' },
    },
  };
  fake.addMedia = (uid, filename, localPath = '') => {
    const id = fake.nextMediaId++;
    const url = `${PUB}/uploads/videos/${filename}`;
    fake.media[uid].push({ id, type: 'video', filename, url, size: 1000, created_at: new Date().toISOString() });
    fake.files.set(filename, localPath);
    return { id, url };
  };
  const userOf = req => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? fake.users[h.slice(7)] : undefined; };
  const tokOf = req => (req.headers.authorization || '').slice(7);

  fake.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
      const u = userOf(req);
      let m;
      if (req.method === 'POST' && req.url === '/auth/validate') return u ? send(200, { valid: true, user: u }) : send(401, { valid: false });
      if (req.method === 'GET' && req.url === '/media/list') return u ? send(200, { uploads: fake.media[u.id] }) : send(401, {});
      if (req.method === 'POST' && req.url === '/media/video/chunk') {
        if (!u || fake.revoked.has(tokOf(req))) return send(401, { error: 'invalid_token' });
        if (fake.chunkStatus === 413) return send(413, { error: 'storage_limit_exceeded' });
        if (fake.chunkStatus !== 200) return send(fake.chunkStatus, { error: 'nope' });
        const f = parseMultipart(body, req.headers['content-type']);
        if (!f.sessionId || !Buffer.isBuffer(f.chunk)) return send(400, { error: 'missing_fields' });
        const s = fake.sessions.get(f.sessionId) || { user: u.id, parts: [] };
        s.parts[Number(f.chunkIndex)] = f.chunk; s.total = Number(f.totalChunks);
        fake.sessions.set(f.sessionId, s);
        return send(200, { success: true });
      }
      if (req.method === 'POST' && req.url === '/media/video/finalize') {
        if (!u || fake.revoked.has(tokOf(req))) return send(401, { error: 'invalid_token' });
        const j = JSON.parse(body.toString() || '{}');
        const s = fake.sessions.get(j.sessionId);
        if (!s || s.user !== u.id) return send(404, { error: 'session_not_found' });
        const name = `up_${fake.nextMediaId}.mp4`;
        const p = path.join(tmp, name);
        fs.writeFileSync(p, Buffer.concat(s.parts));
        const { url } = fake.addMedia(u.id, name, p);
        fake.sessions.delete(j.sessionId);
        return send(200, { success: true, url });
      }
      if (req.method === 'DELETE' && (m = /^\/media\/(\d+)$/.exec(req.url))) {
        if (!u) return send(401, {});
        if (fake.deleteFails) return send(500, {});
        const list = fake.media[u.id];
        const i = list.findIndex(x => x.id === Number(m[1]));
        if (i < 0) return send(404, {});
        fake.files.delete(list[i].filename);
        list.splice(i, 1);
        fake.deletes.push(Number(m[1]));
        return send(200, { success: true });
      }
      if (req.method === 'GET' && (m = /^\/account\/lookup\/([^/]+)$/.exec(req.url))) {
        const p = fake.profiles[decodeURIComponent(m[1]).toLowerCase()];
        return p ? send(200, p) : send(404, {});
      }
      if ((m = /^\/uploads\/videos\/([^?]+)$/.exec(req.url))) {
        if (fake.redirects.has(m[1])) { res.writeHead(302, { Location: fake.redirects.get(m[1]) }); return res.end(); }
        if (!fake.files.has(m[1])) { res.writeHead(404); return res.end(); }
        const p = fake.files.get(m[1]);
        const size = p ? fs.statSync(p).size : 0;
        res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': size });
        if (req.method === 'HEAD' || !p) return res.end();
        return fs.createReadStream(p).pipe(res);
      }
      send(404, {});
    });
  });
  return fake;
}

async function startAll() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-test-'));
  const fake = createFake(tmp);
  await new Promise(r => fake.server.listen(0, '127.0.0.1', r));
  const { open } = require('../src/db');
  const { createVelora } = require('../src/velora');
  const { createApp } = require('../src/app');
  const webDir = path.join(tmp, 'web');
  fs.mkdirSync(webDir, { recursive: true });
  const cfg = {
    ...require('../src/config'),
    dataDir: path.join(tmp, 'data'), downloadDir: path.join(tmp, 'dl'), webDir,
    veloraApi: `http://127.0.0.1:${fake.server.address().port}`,
    veloraPublic: PUB, mediaPrefix: `${PUB}/uploads/videos/`,
    cdnFetchBase: `http://127.0.0.1:${fake.server.address().port}`,
    publicBase: 'https://ikelene.net/glint', basePath: '/glint',
    headTtlMs: 0, mediaListTtlMs: 0, nice: 0, ffThreads: 2, apiRateMax: 1e6,
  };
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const db = open(cfg.dataDir);
  const quiet = { info() {}, warn() {}, error() {} };
  const made = createApp({ cfg, db, velora: createVelora(cfg), log: process.env.GLINT_TEST_LOG ? console : quiet });
  const server = made.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/glint`;
  async function req(method, p, { token, body, ip, headers: extra } = {}) {
    const headers = { ...(extra || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ip) headers['CF-Connecting-IP'] = ip;
    const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const buf = Buffer.from(await r.arrayBuffer());
    const text = buf.toString();
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, buf, headers: r.headers };
  }
  const stop = () => { server.close(); fake.server.close(); db.close(); fs.rmSync(tmp, { recursive: true, force: true }); };
  return { tmp, fake, cfg, db, made, base, req, stop };
}

function makeSample(dir, name = 'sample.mp4', { tracks = 2, seconds = 4 } = {}) {
  const out = path.join(dir, name);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=640x360:rate=30:duration=${seconds}`];
  for (let i = 0; i < tracks; i++) args.push('-f', 'lavfi', '-i', `sine=frequency=${440 * (i + 1)}:duration=${seconds}`);
  args.push('-map', '0:v');
  for (let i = 0; i < tracks; i++) args.push('-map', `${i + 1}:a`);
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k');
  const titles = ['Game', 'Mic', 'Discord'];
  for (let i = 0; i < tracks; i++) args.push(`-metadata:s:a:${i}`, `title=${titles[i]}`, `-metadata:s:a:${i}`, `handler_name=${titles[i]}`);
  args.push(out);
  execFileSync('ffmpeg', args);
  return out;
}

function ffprobeJson(file) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
}

const JPEG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');
const until = async (fn, ms = 90_000, step = 250) => {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, step)); }
};

module.exports = { PUB, createFake, startAll, makeSample, ffprobeJson, hasFfmpeg, JPEG, until };
