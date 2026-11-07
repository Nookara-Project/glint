const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MANIFEST = 'https://clips.nookara.cc/download/latest.json';
const EVERY = 30 * 60 * 1000;

function newer(a, b) {
  const pa = String(a).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}
const sha256 = file => new Promise((ok, bad) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', bad);
});
async function download(url, dest, onProgress) {
  const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { headers: { 'User-Agent': `Glint/${app.getVersion()}` } });
  if (!r.ok || !r.body) throw new Error(`download ${r.status}`);
  const total = Number(r.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let got = 0, last = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(ok => out.once('drain', ok));
      if (Date.now() - last > 300) { last = Date.now(); onProgress?.(got, total); }
    }
  } finally { await new Promise(ok => out.end(ok)); }
}

class Updater {
  constructor(tell) { this.tell = tell; this.state = { state: 'idle', version: app.getVersion() }; this.ready = null; this.busy = false; }
  set(s) { this.state = { ...s, current: app.getVersion() }; this.tell(this.state); }
  async check(manual = false) {
    if (!app.isPackaged) { if (manual) this.set({ state: 'dev' }); return this.state; }
    if (this.busy) return this.state;
    this.busy = true;
    try {
      const m = await fetch(`${MANIFEST}?t=${Date.now()}`).then(r => (r.ok ? r.json() : null)).catch(() => null);
      if (!m?.version || !m.url || !newer(m.version, app.getVersion())) { this.set({ state: 'latest' }); return this.state; }
      if (this.ready?.version === m.version) { this.set({ state: 'ready', version: m.version, notes: m.notes || '' }); return this.state; }
      const url = /^https?:/i.test(m.url) ? m.url : new URL(m.url, MANIFEST).href;
      const file = path.join(os.tmpdir(), `Glint-Setup-${String(m.version).replace(/[^\w.-]/g, '')}.exe`);
      this.set({ state: 'downloading', version: m.version, progress: 0 });
      await download(url, file, (got, total) => this.set({ state: 'downloading', version: m.version, progress: total ? Math.round((got / total) * 100) : 0 }));
      if (m.sha256 && (await sha256(file)).toLowerCase() !== String(m.sha256).toLowerCase()) { fs.rmSync(file, { force: true }); throw new Error('checksum mismatch'); }
      this.ready = { version: m.version, file };
      this.set({ state: 'ready', version: m.version, notes: m.notes || '' });
    } catch (e) {
      this.set({ state: 'error', error: e.message });
    } finally { this.busy = false; }
    return this.state;
  }
  start() { setTimeout(() => this.check(false), 15000); setInterval(() => this.check(false), EVERY); }
  run(relaunch) {
    if (!this.ready) return false;
    spawn(this.ready.file, relaunch ? ['/S', '--force-run'] : ['/S'], { detached: true, stdio: 'ignore' }).unref();
    this.ready = null;
    return true;
  }
}

module.exports = { Updater, newer };
