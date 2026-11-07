const { spawn } = require('child_process');
const EventEmitter = require('events');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const paths = require('./paths');
const ff = require('./ff');
const { captureArgs, concatArgs, concatList } = require('./ffargs');
const rb = require('./ringbuffer');
const tracks = require('./tracks');

const BUFFER_ROOT = path.join(os.tmpdir(), 'Glint', 'buffer');
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Recorder extends EventEmitter {
  constructor() {
    super();
    this.session = null;
    this.encoders = ['libx264'];
    this.failed = new Set();
    this.saving = 0;
    this.restartTimer = null;
    this.pruneTimer = null;
    this.wanted = null;
  }
  setEncoders(list, chains) {
    this.encoders = list && list.length ? list : ['libx264'];
    if (chains) this.chains = chains;
    if (this.session && this.wanted && this.pickEncoder(this.wanted.encoder) !== this.session.encoder) this._restart(0);
  }
  pickEncoder(pref) {
    const usable = this.encoders.filter(e => !this.failed.has(e));
    if (pref && pref !== 'auto' && usable.includes(pref)) return pref;
    return usable[0] || 'libx264';
  }
  get recording() { return !!this.session && !this.session.stopping; }
  status() {
    const s = this.session;
    if (!s) return { recording: false };
    const live = new Map();
    for (const e of s.events) live.set(e.index, e.on);
    const audio = (s.tracks || []).map((t, i) => ({ kind: t.kind, label: t.label, state: t.state, live: t.state === 'app' || t.state === 'waiting' ? (live.has(i) ? live.get(i) : t.state === 'app') : t.state !== 'none' }));
    return { recording: true, capture: s.cap ? { mode: s.cap.mode, width: s.cap.width, height: s.cap.height } : null, encoder: s.encoder, since: s.startedAt, size: s.size, fps: s.fps, kbps: s.kbps, audio, outputIdx: s.opts.outputIdx };
  }

  start(opts) {
    this.wanted = { ...opts };
    const same = this.session && !this.session.stopping && JSON.stringify(this.session.opts) === JSON.stringify(this.wanted);
    if (same) return;
    this._restart(0);
  }
  stop() {
    this.wanted = null;
    clearTimeout(this.restartTimer);
    this._kill(true);
  }
  _restart(delay) {
    clearTimeout(this.restartTimer);
    this._kill(true);
    this.restartTimer = setTimeout(() => { if (this.wanted) this._spawn(this.wanted).catch(e => this.emit('error', e)); }, delay);
  }

  async _spawn(opts) {
    if (!ff.ready()) { this.emit('error', new Error('ffmpeg or glint-helper is missing')); return; }
    const encoder = this.pickEncoder(opts.encoder);
    const dir = path.join(BUFFER_ROOT, `${Date.now().toString(36)}-${process.pid}`);
    await fsp.mkdir(dir, { recursive: true });
    const keepSec = Math.max(20, Number(opts.keepSec) || 130);
    const plan = Array.isArray(opts.tracks) && opts.tracks.length ? opts.tracks : [{ kind: 'desktop', label: 'Desktop audio', arg: 'desktop:sys' }];
    const c = captureArgs({ ...opts, encoder, chain: this.chains?.[encoder], audioTracks: plan.length, listSize: keepSec + 30 });
    const s = { dir, opts: { ...opts }, encoder, startedAt: Date.now(), audioT0: null, stopping: false, fps: c.fps, kbps: c.kbps, size: c.size, keepSec, err: '', plan, tracks: null, events: [], cap: opts.cap || null, outTime: 0, progressAt: Date.now() };
    this.session = s;

    const f = spawn(paths.ffmpeg, c.args, { cwd: dir, windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    s.ff = f;
    f.stdin.on('error', () => {});
    f.stderr.setEncoding('utf8');
    f.stderr.on('data', d => {
      for (const line of d.split(/\r?\n/)) {
        const ot = /^out_time_us=(\d+)/.exec(line);
        if (ot) { const v = Number(ot[1]); if (v > s.outTime) { s.outTime = v; s.progressAt = Date.now(); } continue; }
        if (!line || /^[a-z_0-9]+=/.test(line)) continue;
        s.err = (s.err + line + '\n').slice(-4000);
      }
    });
    const hargs = ['audio', ...plan.flatMap(t => ['--track', t.arg])];
    const h = spawn(paths.helper, hargs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    s.helper = h;
    h.stdin.on('error', () => {});
    h.stdout.pipe(f.stdin);
    h.stderr.setEncoding('utf8');
    let hbuf = '';
    h.stderr.on('data', d => {
      hbuf += d;
      let i;
      while ((i = hbuf.indexOf('\n')) >= 0) {
        const line = hbuf.slice(0, i).trim(); hbuf = hbuf.slice(i + 1);
        try {
          const j = JSON.parse(line);
          if (j.ok) { s.audioT0 = Number(j.t0) || null; s.tracks = tracks.applyStatus(plan, j); this.emit('status', this.status()); }
          if (j.attach != null || j.detach != null) {
            s.events.push({ index: Number(j.attach ?? j.detach), on: j.attach != null, t: Number(j.t) || Date.now() });
            if (s.events.length > 500) s.events.splice(0, 100);
            this.emit('status', this.status());
          }
        } catch {  }
      }
    });

    const died = who => code => {
      if (this.session !== s || s.stopping) return;
      const ranMs = Date.now() - s.startedAt;
      const why = who === 'ffmpeg' ? ff.lastLines(s.err) : 'audio helper stopped';
      this.emit('log', `[recorder] ${who} exited (${code}) after ${ranMs} ms: ${why}`);
      if (who === 'ffmpeg' && ranMs < 8000 && encoder !== 'libx264') {
        this.failed.add(encoder);
        this.emit('encoder-failed', { encoder, why });
      }
      this._kill(true);
      if (this.wanted) this._restart(ranMs < 8000 ? 3000 : 500);
    };
    f.on('exit', died('ffmpeg'));
    h.on('exit', died('helper'));
    f.on('error', e => this.emit('error', e));
    h.on('error', e => this.emit('error', e));

    clearInterval(this.pruneTimer);
    this.pruneTimer = setInterval(() => {
      this._prune().catch(() => {});
      if (s.cap?.mode === 'window' && this.session === s && Date.now() - s.startedAt > 8000 && Date.now() - s.progressAt > 7000 && !s.stallSent) {
        s.stallSent = true;
        this.emit('stalled', { hwnd: s.cap.hwnd });
      }
    }, 2000);
    this.emit('status', this.status());
  }

  _kill(removeFiles) {
    const s = this.session;
    clearInterval(this.pruneTimer);
    if (!s) return;
    s.stopping = true;
    this.session = null;
    try { s.helper?.stdin.end(); } catch {  }
    try { s.helper?.kill(); } catch {  }
    try { s.ff?.kill(); } catch {  }
    const rm = () => fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
    if (removeFiles) { if (this.saving) this.once('saved-any', () => setTimeout(rm, 1500)); else setTimeout(rm, 1500); }
    this.emit('status', this.status());
  }

  async _segments(dir) {
    let text = '';
    try { text = await fsp.readFile(path.join(dir, 'list.csv'), 'utf8'); } catch { return []; }
    const segs = rb.parseList(text);
    for (const sg of segs) {
      try { sg.wallEnd = (await fsp.stat(path.join(dir, sg.file))).mtimeMs; } catch { sg.wallEnd = NaN; }
    }
    return segs.filter(sg => Number.isFinite(sg.wallEnd));
  }
  async _prune() {
    const s = this.session;
    if (!s || this.saving) return;
    const segs = await this._segments(s.dir);
    let files = [];
    try { files = await fsp.readdir(s.dir); } catch { return; }
    for (const f of rb.filesToPrune(files, segs, s.keepSec)) await fsp.rm(path.join(s.dir, f), { force: true }).catch(() => {});
  }

  async saveClip(lengthSec, outFile, userOffsetMs = 0, pressMs = Date.now()) {
    const s = this.session;
    if (!s) throw new Error('not_recording');
    const press = pressMs;
    this.saving++;
    try {
      let segs = [];
      const until = press + 4000;
      for (;;) {
        segs = await this._segments(s.dir);
        if (segs.some(sg => sg.wallEnd >= press) || Date.now() > until || this.session !== s) break;
        await sleep(120);
      }
      const pick = rb.pickClip(segs, press, lengthSec);
      if (!pick) throw new Error('buffer_empty');
      const vT0 = rb.videoT0(segs, rb.encoderDelayMs(s.encoder, s.fps));
      const shift = rb.audioShift(vT0, s.audioT0, userOffsetMs);
      await fsp.mkdir(path.dirname(outFile), { recursive: true });
      const listFile = path.join(s.dir, `clip-${press}.txt`);
      await fsp.writeFile(listFile, concatList(pick.segments.map(sg => path.join(s.dir, sg.file))));
      const all = s.tracks || s.plan.map(t => ({ ...t, state: 'device' }));
      const keep = tracks.clipTracks(all, s.events, press - (Number(lengthSec) || 30) * 1000 - 1500, press);
      const audio = keep.map(i => ({ stream: i, title: all[i].label }));
      try { await ff.run(concatArgs(listFile, outFile, { audioShift: shift, audio })); }
      finally { fsp.rm(listFile, { force: true }).catch(() => {}); }
      const info = await ff.probe(outFile);
      const duration = info.duration || pick.total;
      return {
        file: outFile, duration, width: info.width || s.size.width, height: info.height || s.size.height,
        trim: { in: Math.min(pick.trimIn, duration), out: Math.min(pick.trimOut, duration) }, audioShift: shift, encoder: s.encoder,
        audioTracks: tracks.clipAudioTracks(all, keep),
      };
    } finally {
      this.saving--;
      if (!this.saving) this.emit('saved-any');
    }
  }
  static async cleanStale() {
    let dirs = [];
    try { dirs = await fsp.readdir(BUFFER_ROOT); } catch { return; }
    for (const d of dirs) await fsp.rm(path.join(BUFFER_ROOT, d), { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { Recorder, BUFFER_ROOT };
