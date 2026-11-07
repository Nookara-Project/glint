const fs = require('fs');
const path = require('path');
const media = require('./media');
const { BadInput, KINDS } = require('./clips');

const PROXY_FILE = /^(video\.mp4|a[0-7]\.m4a|strip\.jpg)$/;

function createJobs({ cfg, db, velora, clips, signer, log = console }) {
  const draftsDir = path.join(cfg.dataDir, 'drafts');
  const workDir = path.join(cfg.dataDir, 'work');
  const proxies = new Map();
  const renders = new Map();
  const queue = [];
  let running = false;
  let lastRenderPeakKb = 0;

  function enqueue(name, fn) {
    return new Promise((resolve, reject) => {
      queue.push({ name, fn, resolve, reject });
      pump();
    });
  }
  async function pump() {
    if (running || !queue.length) return;
    running = true;
    const j = queue.shift();
    try { j.resolve(await j.fn()); } catch (e) { j.reject(e); }
    finally { running = false; setImmediate(pump); }
  }

  const dirOf = id => path.join(draftsDir, id);
  const rmDir = id => { try { fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch {} proxies.delete(id); };
  function readMeta(id) {
    try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'meta.json'), 'utf8')); } catch { return null; }
  }

  async function ensureSource(row) {
    const dir = dirOf(row.id);
    fs.mkdirSync(dir, { recursive: true });
    const src = path.join(dir, `source-${row.media_id}.mp4`);
    if (!fs.existsSync(src)) {
      for (const f of fs.readdirSync(dir)) if (f.startsWith('source-')) try { fs.unlinkSync(path.join(dir, f)); } catch {}
      await velora.download(row.video_url, src);
    }
    return src;
  }

  function guessKind(title) {
    const t = String(title || '').toLowerCase();
    return KINDS.find(k => k !== 'other' && k !== 'app' && t.includes(k)) || (t.includes('microphone') ? 'mic' : 'other');
  }

  function mergedTracks(row, audio) {
    const cur = clips.tracksOf(row) || [];
    return audio.map(a => {
      const c = cur.find(x => x.index === a.index);
      return c || { index: a.index, kind: guessKind(a.title), label: (a.title || `Track ${a.index + 1}`).slice(0, 40), enabled: true, volume: 1 };
    });
  }

  function proxyState(row) {
    const meta = readMeta(row.id);
    if (meta && meta.mediaId === row.media_id) return { status: 'ready', meta };
    const p = proxies.get(row.id);
    if (p) return p;
    const st = { status: 'queued', pct: 0 };
    proxies.set(row.id, st);
    enqueue(`proxy ${row.id}`, async () => {
      const cur = clips.getRow(row.id);
      if (!cur || cur.visibility !== 'draft' || cur.status !== 'ok') { proxies.delete(row.id); return; }
      st.status = 'building';
      const dir = dirOf(row.id);
      try {
        const src = await ensureSource(cur);
        const info = await media.probe(cfg, src);
        if (!info.hasVideo || !info.duration) throw Object.assign(new Error('no video'), { code: 'bad_source' });
        for (const f of fs.readdirSync(dir)) if (PROXY_FILE.test(f) || f === 'meta.json') fs.unlinkSync(path.join(dir, f));
        await media.buildProxies(cfg, src, dir, info, pct => { st.pct = Math.round(pct * 100); });
        fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ mediaId: cur.media_id, duration: info.duration, width: info.width, height: info.height,
          audio: info.audio, strip: fs.existsSync(path.join(dir, 'strip.jpg')), builtAt: Date.now() }));
        proxies.delete(row.id);
      } catch (e) {
        log.warn?.(`[glint] proxy build ${row.id} failed: ${e.code || ''} ${e.message}`);
        st.status = 'failed'; st.error = e.code === 'source_missing' ? 'source_missing' : e.code === 'velora_unreachable' ? 'velora_unreachable' : 'proxy_failed';
      }
    }).catch(() => {});
    return st;
  }

  const fileUrl = (id, f) => `${cfg.publicBase}/api/proxy/${id}/${f}?${signer.query(`proxy/${id}/${f}`, cfg.signTtlSec)}`;

  function editPayload(row, { retry = false } = {}) {
    if (row.visibility !== 'draft') throw new BadInput('not_a_draft', 409);
    db.prepare('UPDATE clips SET last_edit=? WHERE id=?').run(Date.now(), row.id);
    if (retry && proxies.get(row.id)?.status === 'failed') proxies.delete(row.id);
    const st = proxyState(row);
    let audioTracks = clips.tracksOf(row) || [];
    const proxy = { status: st.status, video: null, tracks: [], filmstrip: null };
    if (st.status === 'ready') {
      const m = st.meta;
      audioTracks = mergedTracks(row, m.audio);
      if (JSON.stringify(audioTracks) !== row.audio_tracks) db.prepare('UPDATE clips SET audio_tracks=? WHERE id=?').run(JSON.stringify(audioTracks), row.id);
      proxy.video = fileUrl(row.id, 'video.mp4');
      proxy.tracks = m.audio.map(a => ({ index: a.index, url: fileUrl(row.id, `a${a.index}.m4a`) }));
      proxy.filmstrip = m.strip ? fileUrl(row.id, 'strip.jpg') : null;
      proxy.duration = m.duration;
    } else {
      proxy.progress = st.pct || 0;
      if (st.status === 'queued') proxy.position = queue.findIndex(j => j.name === `proxy ${row.id}`) + 1;
      if (st.error) proxy.error = st.error;
    }
    const fresh = clips.getRow(row.id);
    const trim = fresh.trim_start !== null ? { start: fresh.trim_start, end: fresh.trim_end } : { start: 0, end: fresh.duration };
    return { clip: clips.serialize(fresh, { owner: true }), trim, crop: clips.cropOf(fresh), audioTracks, proxy };
  }

  function proxyFile(id, file, exp, sig) {
    if (!/^[0-9A-Za-z]{10}$/.test(id) || !PROXY_FILE.test(file)) return null;
    if (!signer.verify(`proxy/${id}/${file}`, exp, sig)) return null;
    const p = path.join(dirOf(id), file);
    return fs.existsSync(p) ? p : null;
  }

  function progressOf(id) {
    const r = renders.get(id);
    if (!r) return null;
    const out = { phase: r.phase, pct: Math.round(r.pct * 100) };
    if (r.phase === 'queued') {
      const i = queue.findIndex(j => j.name === `render ${id}`);
      if (i >= 0) out.position = i + 1 + (running ? 1 : 0);
    }
    return out;
  }

  function publish(user, token, ip, row, body) {
    if (row.visibility !== 'draft') throw new BadInput('not_a_draft', 409);
    if (row.job_status === 'rendering') throw new BadInput('rendering', 409);
    const b = body && typeof body === 'object' ? body : {};
    const visibility = b.visibility === undefined ? 'public' : b.visibility;
    if (visibility !== 'public' && visibility !== 'unlisted') throw new BadInput('invalid_visibility');
    let title = null;
    if (b.title !== undefined) {
      title = require('./clips').cleanText(b.title, 100);
      if (!title) throw new BadInput('invalid_title');
    }
    db.prepare("UPDATE clips SET job_status='rendering', job_error=NULL, job_updated=? WHERE id=? AND job_status!='rendering'").run(Date.now(), row.id);
    renders.set(row.id, { phase: 'queued', pct: 0 });
    let tok = token;
    enqueue(`render ${row.id}`, () => renderJob(row.id, user, () => tok, ip, { visibility, title }))
      .catch(e => log.error?.('[glint] render job crashed', e))
      .finally(() => { tok = null; renders.delete(row.id); });
    return { status: 'rendering' };
  }

  async function renderJob(id, user, getToken, ip, { visibility, title }) {
    const st = renders.get(id);
    const fail = code => {
      log.warn?.(`[glint] publish ${id} failed: ${code}`);
      db.prepare("UPDATE clips SET job_status='failed', job_error=?, job_updated=? WHERE id=?").run(code, Date.now(), id);
    };
    const row = clips.getRow(id);
    if (!row || row.visibility !== 'draft' || row.user_id !== user.id) return fail('not_found');
    const out = path.join(workDir, `${id}-${Date.now()}.mp4`);
    const thumbTmp = out + '.jpg';
    try {
      st.phase = 'downloading';
      let src;
      try { src = await ensureSource(row); }
      catch (e) { return fail(e.code === 'source_missing' ? 'source_missing' : 'velora_unreachable'); }
      const info = await media.probe(cfg, src);
      const tracks = mergedTracks(row, info.audio);
      const trim = row.trim_start !== null ? { start: row.trim_start, end: Math.min(row.trim_end, info.duration || row.duration) } : null;
      const duration = info.duration || row.duration;
      const trimmed = trim && (trim.start > 0.05 || trim.end < duration - 0.05);
      const on = tracks.filter(t => t.enabled && t.volume > 0);
      const now = () => Date.now();

      const crop = clips.cropOf(row);
      if (!trimmed && !crop && info.audio.length <= 1 && (info.audio.length === 0 || (on.length === 1 && Math.abs(on[0].volume - 1) < 0.001))) {
        db.prepare(`UPDATE clips SET visibility=@v, title=COALESCE(@t, title), trim_start=NULL, trim_end=NULL, audio_tracks=NULL, crop=NULL,
          job_status='ready', job_error=NULL, job_updated=@now WHERE id=@id`).run({ v: visibility, t: title, now: now(), id });
        rmDir(id);
        log.info?.(`[glint] published ${id} without re-render`);
        return;
      }

      st.phase = 'rendering'; st.pct = 0;
      let res;
      try { res = await media.render(cfg, src, out, { trim, tracks, duration, crop }, p => { st.pct = p; }); }
      catch (e) { log.warn?.(`[glint] render ${id}: ${e.message} (peak ${Math.round((e.peakKb || 0) / 1024)} MB)`); return fail('render_failed'); }
      log.info?.(`[glint] render ${id}: ${Math.round(res.duration)}s, ffmpeg peak ${Math.round(media.peakKb() / 1024)} MB`);
      lastRenderPeakKb = media.peakKb();
      let dims = { width: row.width, height: row.height };
      try { const oi = await media.probe(cfg, out); if (oi.width && oi.height) dims = { width: oi.width, height: oi.height }; } catch {}
      let thumbBuf = null;
      try {
        await media.thumbnail(cfg, out, thumbTmp, Math.min(0.5, res.duration / 2));
        const b = fs.readFileSync(thumbTmp);
        if (b.length <= 300 * 1024) thumbBuf = b;
      } catch {}

      st.phase = 'uploading'; st.pct = 0;
      const token = getToken();
      if (!token) return fail('token_rejected');
      let url;
      try { url = await velora.uploadVideo(token, ip, out, { originalName: `glint-${id}.mp4`, onProgress: p => { st.pct = p; } }); }
      catch (e) { return fail(e.code || 'upload_failed'); }

      st.phase = 'finishing'; st.pct = 1;
      let newMedia = null;
      try { newMedia = (await velora.mediaList(token, ip, { fresh: true })).find(u => u && velora.sameMedia(u.url, url)); }
      catch (e) {  }
      if (!newMedia) return fail('upload_failed');

      const oldMediaId = row.media_id;
      db.prepare(`UPDATE clips SET video_url=@url, media_id=@mid, visibility=@v, title=COALESCE(@t, title), duration=@d, width=@w, height=@h,
        trim_start=NULL, trim_end=NULL, audio_tracks=NULL, crop=NULL, has_thumb=CASE WHEN @thumb THEN 1 ELSE has_thumb END,
        status='ok', last_checked=@now, job_status='ready', job_error=NULL, job_updated=@now WHERE id=@id`)
        .run({ url, mid: Number(newMedia.id), v: visibility, t: title, d: Math.round(res.duration * 100) / 100, w: dims.width, h: dims.height, thumb: thumbBuf ? 1 : 0, now: now(), id });
      if (thumbBuf) fs.writeFileSync(path.join(clips.thumbDir, `${id}.jpg`), thumbBuf);
      try { await velora.deleteMedia(token, ip, oldMediaId); }
      catch (e) { log.warn?.(`[glint] publish ${id}: old draft media ${oldMediaId} not deleted (${e.code})`); }
      rmDir(id);
      log.info?.(`[glint] published ${id} (rendered, ${Math.round(res.duration)}s)`);
    } finally {
      try { fs.unlinkSync(out); } catch {}
      try { fs.unlinkSync(thumbTmp); } catch {}
    }
  }

  function sweepDrafts() {
    let removed = 0;
    let dirs = [];
    try { dirs = fs.readdirSync(draftsDir); } catch {}
    for (const id of dirs) {
      if (renders.has(id) || proxies.get(id)?.status === 'building') continue;
      const row = clips.getRow(id);
      const last = row ? Math.max(row.last_edit || 0, row.job_updated || 0, row.created_at) : 0;
      if (!row || row.visibility !== 'draft' || row.status !== 'ok' || Date.now() - last > cfg.proxyTtlMs) { rmDir(id); removed++; }
    }
    try { for (const f of fs.readdirSync(workDir)) if (Date.now() - fs.statSync(path.join(workDir, f)).mtimeMs > 6 * 3600e3) fs.unlinkSync(path.join(workDir, f)); } catch {}
    return removed;
  }

  async function replace(user, token, ip, row, body) {
    const { BadInput: BI, cleanText } = require('./clips');
    if (row.visibility !== 'draft') throw new BI('not_a_draft', 409);
    if (row.job_status === 'rendering' || renders.has(row.id)) throw new BI('rendering', 409);
    const v = clips.validateReplace(body);
    const uploads = await velora.mediaList(token, ip, { fresh: true });
    const media = uploads.find(u => u && u.type === 'video' && velora.sameMedia(u.url, v.videoUrl));
    if (!media) throw new BI('media_not_found');
    const mid = Number(media.id);
    if (mid === row.media_id) throw new BI('same_media');
    const other = db.prepare('SELECT id FROM clips WHERE media_id = ?').get(mid);
    if (other) throw new BI('media_in_use', 409);
    const now = Date.now();
    const oldMediaId = row.media_id;
    db.prepare(`UPDATE clips SET video_url=@url, media_id=@mid, visibility=@vis, title=COALESCE(@t, title), duration=@d, width=@w, height=@h,
      trim_start=NULL, trim_end=NULL, audio_tracks=NULL, crop=NULL, has_thumb=CASE WHEN @thumb THEN 1 ELSE has_thumb END,
      status='ok', last_checked=@now, job_status='ready', job_error=NULL, job_updated=@now WHERE id=@id AND job_status!='rendering'`)
      .run({ url: v.videoUrl, mid, vis: v.visibility, t: v.title, d: v.durationSec, w: v.width, h: v.height, thumb: v.thumb ? 1 : 0, now, id: row.id });
    if (v.thumb) fs.writeFileSync(path.join(clips.thumbDir, `${row.id}.jpg`), v.thumb);
    let oldMediaDeleted = false;
    try { await velora.deleteMedia(token, ip, oldMediaId); oldMediaDeleted = true; }
    catch (e) { log.warn?.(`[glint] replace ${row.id}: old draft media ${oldMediaId} not deleted (${e.code})`); }
    rmDir(row.id);
    log.info?.(`[glint] replaced draft ${row.id} with a desktop render (old media deleted: ${oldMediaDeleted})`);
    return { clip: clips.serialize(clips.getRow(row.id), { owner: true }), oldMediaDeleted };
  }

  clips.hooks.progressOf = progressOf;
  clips.hooks.onRemoved = id => { if (!renders.has(id)) rmDir(id); };

  return { editPayload, proxyFile, publish, replace, progressOf, sweepDrafts, lastRenderPeakKb: () => lastRenderPeakKb, idle: () => !running && !queue.length, _queue: queue };
}

module.exports = { createJobs };
