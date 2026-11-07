const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { safeStorage, shell } = require('electron');
const gnet = require('./net');

const VELORA = 'https://nookara.cc';
const GLINT = 'https://clips.nookara.cc/api';
const APP_ID = 'app_7c41e9b02fd86a35c1e7';
const APP_ORIGIN = 'https://clips.nookara.cc';
const CHUNK = 10 * 1024 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitForGrant(flow) {
  let found = null;
  const page = `<!doctype html><meta charset="utf-8"><title>Glint</title><body style="background:#0e0e12;color:#e8e8ee;font:15px system-ui;display:grid;place-items:center;height:90vh"><p id="m">Signing you in to Glint...</p><script>
var p = new URLSearchParams(location.hash.slice(1)); history.replaceState(null, '', location.pathname);
fetch('/grant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: p.get('nookara_code'), grant: p.get('nookara_grant') }) })
  .then(function (r) { if (!r.ok) throw 0; document.getElementById('m').textContent = "You're signed in. You can close this tab and go back to Glint."; window.close(); })
  .catch(function () { document.getElementById('m').textContent = 'That did not work. Go back to Glint and try again.'; });
</script>`;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); return res.end(page); }
    if (req.method === 'POST' && req.url === '/grant' && /^application\/json/.test(req.headers['content-type'] || '')) {
      let b = '';
      req.on('data', d => { if (b.length < 4096) b += d; });
      req.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch {  }
        if (j?.code && j?.grant) found = { code: String(j.code), grant: String(j.grant) };
        res.writeHead(found ? 204 : 400).end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((ok, bad) => { server.once('error', bad); server.listen(0, '127.0.0.1', ok); });
  return {
    url: `http://127.0.0.1:${server.address().port}/`,
    async grant(code, ms) {
      const until = Date.now() + ms;
      while (!flow.cancelled && Date.now() < until) {
        if (found?.code === code) return found.grant;
        await sleep(250);
      }
      return null;
    },
    close() { server.close(); server.closeAllConnections?.(); },
  };
}

class ApiError extends Error { constructor(code, status, body) { super(code); this.code = code; this.status = status; this.body = body; } }

class Velora {
  constructor(dir, version) {
    this.file = path.join(dir, 'session.bin');
    this.ua = `Glint/${version} (Windows)`;
    this.token = this.load();
    this.me = null;
    this.flow = null;
  }
  load() {
    try {
      const buf = fs.readFileSync(this.file);
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : null;
    } catch { return null; }
  }
  store(token) {
    this.token = token || null;
    try {
      if (!token) fs.rmSync(this.file, { force: true });
      else if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(this.file, safeStorage.encryptString(token));
    } catch {  }
  }

  async req(base, p, { method = 'GET', body, auth = true, form, raw, signal, timeout = 20000, viaNode = false } = {}) {
    const nookara = base === VELORA;
    const headers = { 'User-Agent': this.ua, ...(nookara ? { Origin: APP_ORIGIN } : {}) };
    if (auth && this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (raw) { headers['Content-Type'] = raw.contentType; payload = raw.body; }
    else if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    if (signal?.aborted) throw new ApiError('cancelled', 0);
    let r, text;
    try {
      if (raw || nookara) { const x = await gnet.sendBuffer(base + p, { method, headers, body: payload, signal, timeout, node: viaNode }); r = { ok: x.status >= 200 && x.status < 300, status: x.status }; text = x.text; }
      else { r = await fetch(base + p, { method, headers, body: payload, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) }); text = await r.text(); }
    } catch (e) { if (signal?.aborted || e?.code === 'cancelled') throw new ApiError('cancelled', 0); throw e; }
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    if (!r.ok) {
      if (r.status === 401 && base === VELORA && auth) { this.store(null); this.me = null; }
      throw new ApiError((j && (j.error || j.code)) || `http_${r.status}`, r.status, j);
    }
    return j;
  }

  async signIn(onState) {
    if (this.flow) this.flow.cancelled = true;
    const flow = { cancelled: false };
    this.flow = flow;
    try {
      const back = await waitForGrant(flow);
      try {
        let r;
        try { r = await gnet.retry(() => this.req(VELORA, '/auth/ext-code', { method: 'POST', auth: false, body: { app_id: APP_ID, redirect_uri: back.url }, timeout: 15000 })); }
        catch (e) { return { ok: false, error: e.status ? `http_${e.status}` : 'network', reason: gnet.reasonOf(e) }; }
        if (!r?.code) return { ok: false, error: 'no_code' };
        await shell.openExternal(`${VELORA}/login?code=${encodeURIComponent(r.code)}`);
        onState?.({ state: 'waiting' });
        const got = await back.grant(r.code, 5 * 60 * 1000);
        if (!got) return { ok: false, error: flow.cancelled ? 'cancelled' : 'expired' };
        let x;
        try { x = await gnet.retry(() => this.req(VELORA, '/auth/ext-code/exchange', { method: 'POST', auth: false, body: { code: r.code, grant: got }, timeout: 15000 })); }
        catch (e) { return { ok: false, error: e.status ? `http_${e.status}` : 'network', reason: gnet.reasonOf(e) }; }
        if (!x?.token) return { ok: false, error: 'no_code' };
        this.store(x.token);
        await this.account(true);
        return { ok: true };
      } finally { back.close(); }
    } finally { if (this.flow === flow) this.flow = null; }
  }
  cancelSignIn() { if (this.flow) this.flow.cancelled = true; }
  signOut() { this.store(null); this.me = null; }

  async account(force = false) {
    if (!this.token) { this.me = null; return null; }
    if (!force && this.me && Date.now() - this.me.at < 5 * 60e3) return this.me;
    try {
      const j = await this.req(VELORA, '/account/me');
      const tier = Number(j?.tier) || 0;
      this.me = { username: j?.account?.username || '', color: j?.profile?.color || '', pfp: j?.profile?.pfp || '', tier, at: Date.now() };
    } catch (e) {
      if (e.status === 401) return null;
      if (!this.me) throw e;
    }
    return this.me;
  }

  async uploadVideo(file, name, onProgress, signal) {
    const size = fs.statSync(file).size;
    const total = Math.max(1, Math.ceil(size / CHUNK));
    const sessionId = `glint_${crypto.randomBytes(9).toString('hex')}`;
    const fd = fs.openSync(file, 'r');
    try {
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) throw new ApiError('cancelled', 0);
        const len = Math.min(CHUNK, size - i * CHUNK);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, i * CHUNK);
        const form = gnet.multipart({ sessionId, chunkIndex: String(i), totalChunks: String(total) }, { field: 'chunk', name: `chunk_${i}`, data: buf });
        for (let attempt = 0; ; attempt++) {
          try { await this.req(VELORA, '/media/video/chunk', { method: 'POST', raw: form, signal, timeout: 120000, viaNode: attempt > 0 }); break; }
          catch (e) {
            if (signal?.aborted) throw new ApiError('cancelled', 0);
            const retryable = !e.status || e.status >= 500 || e.status === 408 || e.status === 429 || (e.status === 400 && e.message === 'upload_error');
            if (!retryable || attempt >= 3) throw e;
            await sleep(1500 * (attempt + 1));
          }
        }
        onProgress?.((i + 1) / total, total, Math.min(size, (i + 1) * CHUNK));
      }
    } finally { fs.closeSync(fd); }
    const r = await this.req(VELORA, '/media/video/finalize', { method: 'POST', body: { sessionId, mimeType: 'video/mp4', originalName: name }, timeout: 180000, signal });
    if (!r?.url) throw new ApiError('no_url', 0, r);
    return r;
  }

  createClip(body, signal) { return this.req(GLINT, '/clips', { method: 'POST', body, timeout: 60000, signal }); }
  replaceClip(id, body, signal) { return this.req(GLINT, `/clips/${encodeURIComponent(id)}/replace`, { method: 'POST', body, timeout: 60000, signal }); }
  async storageUsage() {
    if (!this.token) return null;
    try {
      const j = await this.req(VELORA, '/storage/info/usage');
      if (Number.isFinite(Number(j?.limit))) return { usage: Number(j.usage) || 0, limit: Number(j.limit), remaining: Math.max(0, Number(j.remaining ?? (j.limit - j.usage))) };
    } catch (e) { if (e.status === 401) return null; }
    try {
      const j = await this.req(VELORA, '/account/me');
      const used = Number(j?.account?.storage_used), limit = Number(j?.storage_limit);
      if (Number.isFinite(used) && Number.isFinite(limit) && limit > 0) return { usage: used, limit, remaining: Math.max(0, limit - used), via: 'account' };
    } catch {  }
    return { needsSignIn: true };
  }
  async mediaList() { const j = await this.req(VELORA, '/media/list'); return Array.isArray(j?.uploads) ? j.uploads : []; }
  deleteMedia(id) { return this.req(VELORA, `/media/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
  patchClip(id, body) { return this.req(GLINT, `/clips/${encodeURIComponent(id)}`, { method: 'PATCH', body }); }
  publishClip(id, body) { return this.req(GLINT, `/clips/${encodeURIComponent(id)}/publish`, { method: 'POST', body, timeout: 60000 }); }
  getClip(id) { return this.req(GLINT, `/clips/${encodeURIComponent(id)}`); }
  deleteClip(id, media = true) { return this.req(GLINT, `/clips/${encodeURIComponent(id)}${media ? '?media=1' : ''}`, { method: 'DELETE' }); }
  async myClips() {
    const j = await this.req(GLINT, '/me/clips');
    return Array.isArray(j) ? j : Array.isArray(j?.clips) ? j.clips : [];
  }
}

module.exports = { Velora, ApiError, VELORA, GLINT, APP_ID, APP_ORIGIN, waitForGrant };
