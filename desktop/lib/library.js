const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { normalizeTracks } = require('./tracks');
const { cleanCrop } = require('./crop');

const newId = () => crypto.randomBytes(6).toString('hex');
const safeName = s => String(s || 'Desktop').replace(/[<>:"/\\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Desktop';
const stamp = (d = new Date()) => {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};
function clipPath(dir, gameName, date = new Date()) {
  const g = safeName(gameName);
  let f = path.join(dir, g, `${g} ${stamp(date)}.mp4`);
  for (let i = 2; fs.existsSync(f) && i < 100; i++) f = path.join(dir, g, `${g} ${stamp(date)} (${i}).mp4`);
  return f;
}
function cleanTrim(trim, duration) {
  if (!trim || typeof trim !== 'object') return null;
  const d = Number(duration) || 0;
  let a = Math.max(0, Number(trim.in) || 0), b = Number(trim.out);
  if (!Number.isFinite(b) || b <= 0 || (d && b > d)) b = d;
  if (b - a < 0.5) return null;
  if (a <= 0.05 && d && b >= d - 0.05) return null;
  return { in: Math.round(a * 1000) / 1000, out: Math.round(b * 1000) / 1000 };
}

class Library {
  constructor(dir) {
    this.file = path.join(dir, 'library.json');
    this.thumbs = path.join(dir, 'thumbs');
    fs.mkdirSync(this.thumbs, { recursive: true });
    try { const j = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.clips = Array.isArray(j.clips) ? j.clips : []; } catch { this.clips = []; }
    this.saveTimer = null;
  }
  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 200);
  }
  flush() {
    clearTimeout(this.saveTimer);
    try { fs.writeFileSync(this.file + '.tmp', JSON.stringify({ v: 1, clips: this.clips }, null, 1)); fs.renameSync(this.file + '.tmp', this.file); } catch {  }
  }
  thumbPath(id) { return path.join(this.thumbs, `${id}.jpg`); }
  stripPath(id) { return path.join(this.thumbs, `${id}-strip.jpg`); }
  get(id) { return this.clips.find(c => c.id === id) || null; }
  list() {
    return this.clips.slice().sort((a, b) => b.createdAt - a.createdAt).map(c => ({ ...c, audioTracks: normalizeTracks(c.audioTracks), missing: !fs.existsSync(c.file), hasThumb: fs.existsSync(this.thumbPath(c.id)) }));
  }
  add(c) {
    const clip = {
      id: newId(), file: c.file, createdAt: Date.now(), duration: Number(c.duration) || 0, width: c.width || 0, height: c.height || 0,
      game: { key: c.game?.key || 'desktop', name: c.game?.name || 'Desktop', icon: c.game?.icon || '' },
      title: c.title || `${c.game?.name || 'Desktop'} clip`, trim: cleanTrim(c.trim, c.duration), upload: null,
      audioTracks: normalizeTracks(c.audioTracks), session: c.session || null, crop: null,
      windowRect: c.windowRect || null,
    };
    this.clips.push(clip);
    this.save();
    return clip;
  }
  update(id, patch) {
    const c = this.get(id);
    if (!c) return null;
    if ('trim' in patch) c.trim = cleanTrim(patch.trim, c.duration);
    if ('crop' in patch) c.crop = cleanCrop(patch.crop, c.width, c.height);
    if (Array.isArray(patch.audioTracks)) {
      const now = normalizeTracks(c.audioTracks), byIdx = new Map(patch.audioTracks.map(t => [t && t.index, t]));
      c.audioTracks = normalizeTracks(now.map(t => (byIdx.has(t.index) ? { ...t, enabled: byIdx.get(t.index).enabled !== false, volume: byIdx.get(t.index).volume } : t)));
    }
    if (typeof patch.title === 'string') c.title = patch.title.trim().slice(0, 100) || c.title;
    if ('upload' in patch) c.upload = patch.upload ? { ...patch.upload } : null;
    if ('uploadGone' in patch) c.uploadGone = !!patch.uploadGone;
    this.save();
    return c;
  }
  async remove(id, deleteFile) {
    const c = this.get(id);
    if (!c) return false;
    if (deleteFile) {
      await fsp.rm(c.file, { force: true }).catch(() => {});
      try { const d = path.dirname(c.file); if (!(await fsp.readdir(d)).length) await fsp.rmdir(d); } catch {  }
    }
    await fsp.rm(this.thumbPath(id), { force: true }).catch(() => {});
    await fsp.rm(this.stripPath(id), { force: true }).catch(() => {});
    this.clips = this.clips.filter(x => x.id !== id);
    this.save();
    return true;
  }
  reconcile(remote) {
    const byId = new Map((remote || []).filter(r => r && r.id).map(r => [String(r.id), r]));
    let changed = 0;
    for (const c of this.clips) {
      if (!c.upload?.id) continue;
      const r = byId.get(String(c.upload.id));
      if (!r) { c.upload = null; c.uploadGone = true; changed++; continue; }
      const vis = ['unlisted', 'draft'].includes(r.visibility) ? r.visibility : 'public';
      const status = r.status && r.status !== 'ok' ? r.status : (c.upload.status === 'rendering' && vis !== 'draft' ? 'ready' : c.upload.status || null);
      if (vis !== c.upload.visibility || (r.title && r.title !== c.upload.title) || (r.url && r.url !== c.upload.url) || status !== (c.upload.status || null)) {
        c.upload = { ...c.upload, visibility: vis, title: r.title || c.upload.title, url: r.url || c.upload.url, status };
        changed++;
      }
    }
    if (changed) this.save();
    return changed;
  }
}

const contractTrim = (trim, duration) => { const t = cleanTrim(trim, duration); return t ? { start: t.in, end: t.out } : null; };

module.exports = { Library, clipPath, cleanTrim, contractTrim, safeName, stamp };
