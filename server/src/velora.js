const crypto = require('crypto');

class VeloraError extends Error {
  constructor(status, code, detail) {
    super(code || `velora_${status}`);
    this.status = status;
    this.code = code || `velora_${status}`;
    this.detail = detail;
  }
}

function createVelora(cfg) {
  const tokenCache = new Map();
  const lookupCache = new Map();
  const mediaListCache = new Map();

  const keyOf = t => crypto.createHash('sha256').update(String(t)).digest('hex');
  const appOrigin = new URL(cfg.publicBase).origin;

  async function call(method, pathname, { token, ip, body, timeoutMs = 8000 } = {}) {
    const headers = { Accept: 'application/json', 'User-Agent': 'Glint/1.0 (+https://clips.nookara.cc)', Origin: appOrigin };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ip) headers['X-Forwarded-For'] = ip;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(cfg.veloraApi + pathname, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs), redirect: 'manual',
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  }

  async function validate(token, ip) {
    if (!token || typeof token !== 'string' || token.length > 512) return null;
    const k = keyOf(token);
    const hit = tokenCache.get(k);
    if (hit && hit.exp > Date.now()) {
      if (hit.invalid) return null;
      if (hit.error) throw hit.error;
      return hit.user;
    }
    let r;
    try { r = await call('POST', '/auth/validate', { token, ip }); }
    catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
    if (r.status === 401) { tokenCache.set(k, { invalid: true, exp: Date.now() + 30_000 }); return null; }
    if (r.status === 403 && r.data && r.data.tos_required) {
      const error = new VeloraError(403, 'tos_required');
      tokenCache.set(k, { error, exp: Date.now() + 30_000 });
      throw error;
    }
    if (r.status !== 200 || !r.data || !r.data.valid || !r.data.user) throw new VeloraError(502, 'velora_bad_response', r.status);
    const u = r.data.user;
    const user = {
      id: Number(u.id), username: String(u.username), rank: u.paid_rank || u.rank || 'free',
      pfp_url: u.pfp_url || null, color: u.color || null,
      scopes: Number(u.scopes ?? 0), project: u.project_name || null,
    };
    if (user.rank === 'banned') {
      const error = new VeloraError(403, 'banned');
      tokenCache.set(k, { error, exp: Date.now() + 60_000 });
      throw error;
    }
    tokenCache.set(k, { user, exp: Date.now() + cfg.tokenTtlMs });
    if (tokenCache.size > 5000) for (const [kk, v] of tokenCache) if (v.exp < Date.now()) tokenCache.delete(kk);
    return user;
  }

  const MEDIA_NAME = /^[A-Za-z0-9._-]+\.(mp4|webm|mov|mkv)$/i;
  function parseMedia(u) {
    if (typeof u !== 'string') return null;
    u = canonUrl(u);
    const cdnPrefix = cfg.cdnPublic + '/uploads/videos/';
    for (const [prefix, cdn] of [[cfg.mediaPrefix, false], [cdnPrefix, true]]) {
      if (u.startsWith(prefix) && MEDIA_NAME.test(u.slice(prefix.length))) return { name: u.slice(prefix.length), cdn };
    }
    return null;
  }
  function mediaKey(u) { const p = parseMedia(u); return p ? '/uploads/videos/' + p.name : null; }
  function sameMedia(a, b) { const k = mediaKey(a); return !!k && k === mediaKey(b); }
  function sourceOf(p) { return p.cdn ? (cfg.cdnFetchBase || cfg.cdnPublic) + '/uploads/videos/' + p.name : cfg.veloraApi + '/uploads/videos/' + p.name; }
  async function fetchMedia(p, init) {
    let res = await fetch(sourceOf(p), { ...init, redirect: 'manual' });
    if (!p.cdn && [301, 302, 303, 307, 308].includes(res.status)) {
      let loc = null;
      try { loc = new URL(res.headers.get('location') || '', cfg.veloraApi + '/uploads/videos/' + p.name); } catch {  }
      if (loc && loc.origin + loc.pathname === cfg.cdnPublic + '/uploads/videos/' + p.name) {
        try { await res.body?.cancel(); } catch {  }
        res = await fetch((cfg.cdnFetchBase || cfg.cdnPublic) + loc.pathname, { ...init, redirect: 'manual' });
      }
    }
    return res;
  }

  function canonUrl(u) { return u.startsWith(cfg.legacyPublic + '/') ? cfg.veloraPublic + u.slice(cfg.legacyPublic.length) : u; }

  async function mediaList(token, ip, { fresh = false } = {}) {
    const k = keyOf(token);
    const hit = mediaListCache.get(k);
    if (!fresh && hit && hit.exp > Date.now()) return hit.uploads;
    let r;
    try { r = await call('GET', '/media/list', { token, ip }); }
    catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
    if (r.status === 401) throw new VeloraError(401, 'unauthorized');
    if (r.status !== 200 || !r.data || !Array.isArray(r.data.uploads)) throw new VeloraError(502, 'velora_bad_response', r.status);
    const uploads = r.data.uploads.map(u => (u && typeof u.url === 'string' ? { ...u, url: canonUrl(u.url) } : u));
    mediaListCache.set(k, { uploads, exp: Date.now() + cfg.mediaListTtlMs });
    if (mediaListCache.size > 2000) for (const [kk, v] of mediaListCache) if (v.exp < Date.now()) mediaListCache.delete(kk);
    return uploads;
  }

  async function deleteMedia(token, ip, mediaId) {
    let r;
    try { r = await call('DELETE', `/media/${encodeURIComponent(mediaId)}`, { token, ip }); }
    catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
    mediaListCache.delete(keyOf(token));
    if (r.status === 200 || r.status === 404) return true;
    if (r.status === 401) throw new VeloraError(401, 'unauthorized');
    throw new VeloraError(502, 'media_delete_failed', r.status);
  }

  async function lookup(username, ip) {
    const lc = String(username).toLowerCase();
    const hit = lookupCache.get(lc);
    if (hit && hit.exp > Date.now()) return hit.data;
    let r;
    try { r = await call('GET', `/account/lookup/${encodeURIComponent(username)}`, { ip }); }
    catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
    let data;
    if (r.status === 404) data = null;
    else if (r.status === 200 && r.data && r.data.username) data = r.data;
    else throw new VeloraError(502, 'velora_bad_response', r.status);
    lookupCache.set(lc, { data, exp: Date.now() + cfg.lookupTtlMs });
    if (lookupCache.size > 2000) for (const [kk, v] of lookupCache) if (v.exp < Date.now()) lookupCache.delete(kk);
    return data;
  }

  async function headMedia(videoUrl) {
    const p = parseMedia(videoUrl);
    if (!p) return 'unknown';
    try {
      const res = await fetchMedia(p, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      if (res.status === 200 || res.status === 206 || res.status === 304) return 'ok';
      if (res.status === 404 || res.status === 410) return 'gone';
      return 'unknown';
    } catch { return 'unknown'; }
  }

  async function download(videoUrl, dest, { maxBytes = 1.1 * 1024 ** 3 } = {}) {
    const p = parseMedia(videoUrl);
    if (!p) throw new VeloraError(400, 'invalid_video_url');
    const fs = require('fs');
    const { Readable } = require('stream');
    const { pipeline } = require('stream/promises');
    let res;
    try { res = await fetchMedia(p, { signal: AbortSignal.timeout(10 * 60_000) }); }
    catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
    if (res.status === 404 || res.status === 410) throw new VeloraError(404, 'source_missing');
    if (res.status !== 200 || !res.body) throw new VeloraError(502, 'velora_bad_response', res.status);
    if (Number(res.headers.get('content-length')) > maxBytes) throw new VeloraError(413, 'source_too_large');
    let n = 0;
    const tmp = dest + '.part';
    const body = Readable.fromWeb(res.body);
    body.on('data', c => { n += c.length; if (n > maxBytes) body.destroy(new VeloraError(413, 'source_too_large')); });
    await pipeline(body, fs.createWriteStream(tmp));
    fs.renameSync(tmp, dest);
    return n;
  }

  // upload a local mp4 as the caller (POST /media/video/chunk x N + finalize) -> url. Throws VeloraError with a job error code.
  async function uploadVideo(token, ip, filePath, { originalName = 'glint-clip.mp4', chunkSize = 10 * 1024 * 1024, onProgress } = {}) {
    const fs = require('fs');
    const size = fs.statSync(filePath).size;
    const total = Math.max(1, Math.ceil(size / chunkSize));
    const sessionId = 'glint_' + crypto.randomBytes(12).toString('hex');
    const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'Glint/1.1 (+https://clips.nookara.cc)', Origin: appOrigin };
    if (ip) headers['X-Forwarded-For'] = ip;
    const fd = fs.openSync(filePath, 'r');
    const mapErr = async (res, stage) => {
      let data = null; try { data = await res.json(); } catch {}
      const code = data && data.error;
      if (res.status === 401) return new VeloraError(401, 'token_rejected');
      if (res.status === 413) return new VeloraError(413, code === 'storage_limit_exceeded' ? 'storage_limit_exceeded' : 'file_too_large');
      if (res.status === 403) return new VeloraError(403, code === 'pro_only' ? 'pro_only' : 'upload_forbidden');
      return new VeloraError(502, 'upload_failed', `${stage} ${res.status} ${code || ''}`);
    };
    try {
      for (let i = 0; i < total; i++) {
        const len = Math.min(chunkSize, size - i * chunkSize);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, i * chunkSize);
        const form = new FormData();
        form.append('sessionId', sessionId);
        form.append('chunkIndex', String(i));
        form.append('totalChunks', String(total));
        form.append('chunk', new Blob([buf], { type: 'application/octet-stream' }), originalName);
        let res;
        try { res = await fetch(cfg.veloraApi + '/media/video/chunk', { method: 'POST', headers, body: form, signal: AbortSignal.timeout(5 * 60_000) }); }
        catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
        if (res.status !== 200) throw await mapErr(res, 'chunk');
        await res.arrayBuffer().catch(() => {});
        if (onProgress) onProgress((i + 1) / total);
      }
    } finally { fs.closeSync(fd); }
    let res;
    try {
      res = await fetch(cfg.veloraApi + '/media/video/finalize', {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, mimeType: 'video/mp4', originalName }), signal: AbortSignal.timeout(10 * 60_000),
      });
    } catch (e) { throw new VeloraError(502, 'velora_unreachable', e.message); }
    if (res.status !== 200) throw await mapErr(res, 'finalize');
    const data = await res.json().catch(() => null);
    if (!data || typeof data.url !== 'string') throw new VeloraError(502, 'upload_failed', 'no url');
    mediaListCache.delete(keyOf(token));
    return data.url;
  }

  return { validate, mediaList, canonUrl, parseMedia, mediaKey, sameMedia, deleteMedia, lookup, headMedia, download, uploadVideo, VeloraError, _caches: { tokenCache, lookupCache, mediaListCache } };
}

module.exports = { createVelora, VeloraError };
