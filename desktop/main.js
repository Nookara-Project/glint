const electron = require('electron');
const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, shell, dialog, protocol, screen } = electron;
const gnet = require('./lib/net');
gnet.installGlobalFetch(electron);
app.commandLine.appendSwitch('disable-quic');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('net.ikelene.glint');
protocol.registerSchemesAsPrivileged([{ scheme: 'glint-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: false } }]);

const { Settings } = require('./lib/settings');
const { Library, clipPath, contractTrim } = require('./lib/library');
const { Recorder } = require('./lib/recorder');
const { GameDetect } = require('./lib/gamedetect');
const { Velora } = require('./lib/velora');
const { Updater } = require('./lib/updater');
const { Sessions, uploadOnSave, onSessionEnd } = require('./lib/sessions');
const tracks = require('./lib/tracks');
const { cleanupAfterCancel, isCancel, draftEdits, draftSyncPayload } = require('./lib/uploadflow');
const overlay = require('./lib/overlay');
const ff = require('./lib/ff');
const ffargs = require('./lib/ffargs');
const compress = require('./lib/compress');
const hotkeyflow = require('./lib/hotkeyflow');
const capture = require('./lib/capture');

const DATA = app.getPath('userData');
const SOUNDS_DIR = path.join(DATA, 'sounds');
const APPICONS = path.join(DATA, 'appicons');
const LOG = path.join(DATA, 'glint.log');
function log(...a) {
  const line = `${new Date().toISOString()} ${a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { if (fs.existsSync(LOG) && fs.statSync(LOG).size > 2 << 20) fs.renameSync(LOG, LOG + '.old'); fs.appendFileSync(LOG, line); } catch {  }
}

let settings, library, recorder, games, velora, updater;
let win = null, tray = null, quitting = false;
let encoders = ['libx264'];
let monitor = null;
let lastGame = null;
let stopTimer = null, monitorTimer = null, reconcileTimer = null;
let hotkeyReg = null, hotkeyError = null;
let wantedSince = 0;
let idleOffer = null, idleToastAt = 0, forcePopupKey = null;
let pendingHighlight = null;
const sessions = new Sessions();
const uploads = new Map();

const clipsDir = () => settings.get().clipsDir || path.join(app.getPath('videos'), 'Glint');
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

function recordingWanted() { return !!games.current || settings.get().alwaysRecord; }
async function findMonitor() {
  const pids = games.current ? games.current.pids.join(',') : '';
  try { const m = await ff.helper('monitor', pids || '0'); if (m && m.w > 0) return m; } catch (e) { log('[monitor]', e.message); }
  const d = screen.getPrimaryDisplay();
  const sf = d.scaleFactor || 1;
  return { idx: 0, x: d.bounds.x * sf, y: d.bounds.y * sf, w: Math.round(d.bounds.width * sf), h: Math.round(d.bounds.height * sf) };
}
let hasGfx = null, gfxCheck = Promise.resolve();
const gfxStalled = new Set();
let lastCapLog = '';
function captureDecision() {
  const s = settings.get();
  const cur = recorder.session?.cap;
  const cap = capture.decideCapture({ setting: s.captureMode, mon: games.current ? monitor : null, hasGfx: !!hasGfx, stalled: monitor?.hwnd && gfxStalled.has(monitor.hwnd), sticky: cur?.mode === 'window' ? { hwnd: cur.hwnd, width: cur.width, height: cur.height } : null });
  const line = `${cap.mode} ${cap.width}x${cap.height}${cap.hwnd ? ` hwnd ${cap.hwnd}` : ''} - ${cap.reason}`;
  if (line !== lastCapLog) { lastCapLog = line; log('[capture]', line); }
  return cap;
}
function recorderOpts() {
  const s = settings.get();
  return {
    outputIdx: monitor?.idx || 0, monW: monitor?.w || 1920, monH: monitor?.h || 1080, cap: captureDecision(),
    resolution: s.resolution, fps: s.fps, bitrate: s.bitrate, encoder: s.encoder, cursor: s.cursor,
    tracks: tracks.planTracks(s, games.current?.root || 0),
    keepSec: Math.max(130, s.clipLength + 15),
  };
}
function refreshRecording() { doRefresh().catch(e => log('[recording]', e.message)); }
async function doRefresh() {
  if (recordingWanted()) {
    clearTimeout(stopTimer); stopTimer = null;
    const wasRecording = recorder.recording;
    if (!wantedSince) wantedSince = Date.now();
    monitor = await findMonitor();
    await gfxCheck;
    recorder.start(recorderOpts());
    setHotkey(settings.get().hotkey);
    overlay.warm(monitor, settings.get().overlayCorner);
    clearInterval(monitorTimer);
    monitorTimer = setInterval(async () => {
      if (!recorder.recording || !games.current) return;
      const m = await findMonitor();
      const moved = m.idx !== monitor?.idx || m.w !== monitor?.w || m.h !== monitor?.h;
      monitor = m;
      recorder.start(recorderOpts());
      if (moved) overlay.warm(monitor);
    }, 8000);
    return { started: !wasRecording };
  }
  if (recorder.recording && !stopTimer) {
    stopTimer = setTimeout(() => {
      stopTimer = null;
      if (!recordingWanted()) { recorder.stop(); clearInterval(monitorTimer); wantedSince = 0; pushStatus(); }
    }, 15000);
  } else if (!recorder.recording) wantedSince = 0;
  pushStatus();
  return {};
}
function status() {
  return {
    ...recorder.status(), wanted: recordingWanted(), stopping: !!stopTimer,
    game: games.current ? { key: games.current.key, name: games.current.name, image: games.current.image, source: games.current.source } : null,
    hotkey: settings.get().hotkey, hotkeyError, monitor,
  };
}
function voiceNote() {
  const v = tracks.planTracks(settings.get(), games.current?.root || 0).filter(tracks.isVoice).map(t => t.label);
  return v.length ? ` · Also recording: ${v.join(', ')}` : '';
}
function pushStatus() { send('glint:status', status()); updateTray(); }

function setHotkey(accel) {
  if (accel === hotkeyReg) return;
  if (hotkeyReg) { try { globalShortcut.unregister(hotkeyReg); } catch {  } hotkeyReg = null; }
  if (!accel) return;
  try {
    if (globalShortcut.register(accel, () => clipPressed('hotkey'))) { hotkeyReg = accel; hotkeyError = null; }
    else hotkeyError = 'in_use';
  } catch { hotkeyError = 'invalid'; }
}
function testHotkey(accel) {
  if (typeof accel !== 'string' || !accel || accel.length > 40) return 'invalid';
  if (accel === hotkeyReg) return null;
  try { const ok = globalShortcut.register(accel, () => {}); if (ok) globalShortcut.unregister(accel); return ok ? null : 'in_use'; } catch { return 'invalid'; }
}

function soundSrc(s = settings.get()) {
  if (s.sound === 'off') return null;
  if (s.sound === 'custom' && s.customSound) return `glint-media://sound/custom?v=${encodeURIComponent(s.customSound)}-${fileStamp(path.join(SOUNDS_DIR, s.customSound))}`;
  return `sounds/${s.sound}.wav`;
}
const fileStamp = f => { try { return Math.round(fs.statSync(f).mtimeMs); } catch { return 0; } };
function syncSound() { const s = settings.get(); const src = soundSrc(s); overlay.setSound({ src, volume: s.soundVolume / 100, nope: s.sound === 'off' ? null : 'sounds/nope.wav' }); }

function toast(t) {
  const s = settings.get();
  overlay.toast({ show: s.overlay, corner: s.overlayCorner, rect: monitor, accent: velora.me?.color || null, ...t });
}
const fmtLen = sec => { const s = Math.round(sec); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`; };
const saveQueue = [];
let saving = false;
let pressSeq = 0;
function clipPressed(source) {
  const s = settings.get();
  if (!recorder.recording) { notRecordingPressed(source); return { error: 'not_recording' }; }
  const g = games.current || lastGame || { key: 'desktop', name: 'Desktop', image: '' };
  const press = { at: Date.now(), id: `c${++pressSeq}`, game: { key: g.key, name: g.name, image: g.image || '' }, length: s.clipLength, source };
  const queued = saveQueue.length + (saving ? 1 : 0);
  toast({ id: press.id, kind: 'captured', title: queued ? `Clip captured (${queued + 1} saving)` : 'Clip captured', game: g.name, icon: g.image || '', length: fmtLen(s.clipLength), sound: s.sound !== 'off' });
  saveQueue.push(press);
  runQueue();
  return { ok: true, queued: true };
}
async function notRecordingPressed(source) {
  const s = settings.get();
  let fg = null;
  if (source === 'hotkey') { try { fg = await ff.helper('fg', null, 3000); } catch { fg = null; } }
  const now = Date.now();
  const d = hotkeyflow.decide({ recording: recorder.recording, wanted: recordingWanted(), startedWantingAt: wantedSince }, idleOffer, fg, now, idleToastAt, process.pid);
  if (d.action === 'clip') { clipPressed(source); return; }
  if (d.action === 'add') {
    idleOffer = null;
    const r = await addCustomGame(d.app.path, d.app.name);
    if (r.error) { toast({ id: 'idle', kind: 'error', title: "Couldn't add it", detail: r.error, rect: fg?.mon || monitor }); return; }
    forcePopupKey = `c:${r.game.id}`;
    toast({ id: 'idle', kind: 'game', title: 'Starting to record', game: r.game.name, icon: r.game.icon || '', detail: `${r.game.name} is on your games list now`, rect: fg?.mon || monitor });
    return;
  }
  if (!d.toast) return;
  idleToastAt = now;
  idleOffer = d.offer ? { path: d.offer.path, exe: d.offer.exe, at: now } : null;
  toast({ id: 'idle', kind: 'idle', title: 'Not recording', detail: d.reason, hint: d.offer ? `Press ${s.hotkey} again within 5 s to start recording ${d.offer.exe}` : '', rect: fg?.mon || monitor, sound: s.sound !== 'off' ? 'nope' : false });
}
async function addCustomGame(p, name) {
  if (typeof p !== 'string' || !/\.exe$/i.test(p)) return { error: 'Pick a program (.exe).' };
  const list = settings.get().customGames;
  const have = list.find(g => g.path && g.path.toLowerCase() === p.toLowerCase());
  if (have) { games.scan().catch(() => {}); return { game: have, existed: true }; }
  let icon = '';
  try { icon = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch {  }
  const g = { id: Math.random().toString(36).slice(2, 10), name: String(name || path.basename(p, '.exe')).slice(0, 80), path: p, exe: path.basename(p), icon };
  applySettings({ customGames: [...list, g] });
  return { game: g };
}
async function runQueue() {
  if (saving) return;
  saving = true;
  try {
    while (saveQueue.length) {
      const p = saveQueue.shift();
      const r = await saveClip(p);
      if (r.ok) toast({ id: p.id, kind: 'saved', title: 'Clip saved', game: p.game.name, icon: p.game.image, length: fmtLen(r.length) });
      else toast({ id: p.id, kind: 'error', title: "Couldn't save the clip", detail: r.error === 'buffer_empty' ? 'The buffer is still filling up - try again in a second' : r.error === 'not_recording' ? 'Recording stopped before it could be saved' : 'Something went wrong while saving' });
    }
  } finally { saving = false; }
}
async function saveClip(p) {
  const s = settings.get();
  if (!recorder.recording) return { error: 'not_recording' };
  try {
    const out = clipPath(clipsDir(), p.game.name);
    const r = await recorder.saveClip(p.length, out, s.audioOffsetMs, p.at);
    const windowRect = recorder.session?.cap?.mode === 'monitor' && games.current ? capture.windowRectInClip(monitor, r.width, r.height) : null;
    const clip = library.add({ file: r.file, duration: r.duration, width: r.width, height: r.height, trim: r.trim, audioTracks: r.audioTracks, windowRect, game: { key: p.game.key, name: p.game.name, icon: p.game.image } });
    const len = r.trim ? r.trim.out - r.trim.in : r.duration;
    log(`[clip] saved ${r.file} (${r.duration.toFixed(2)} s, ${r.audioTracks.length} audio tracks, shift ${r.audioShift}s, ${r.encoder}) via ${p.source}`);
    const sess = sessions.clipSaved(clip.id);
    if (sess.late && pendingHighlight) { pendingHighlight.ids.push(clip.id); send('glint:highlight', pendingHighlight); }
    makeThumb(clip).finally(() => {
      send('glint:library', { added: clip.id });
      if (uploadOnSave(s, { signedIn: !!velora.token, late: sess.late })) queueAutoUpload([clip.id]);
    });
    return { ok: true, id: clip.id, length: len };
  } catch (e) {
    log('[clip] failed', e.message);
    return { error: e.message };
  }
}
async function makeThumb(clip) {
  const at = (clip.trim?.in || 0) + Math.min(1.5, ((clip.trim ? clip.trim.out - clip.trim.in : clip.duration) || 2) / 3);
  try { await ff.run(ffargs.thumbArgs(clip.file, at, library.thumbPath(clip.id), 480, 4)); } catch (e) { log('[thumb]', e.message); }
}

async function onGameChange(g) {
  log('[games]', g ? `${g.name} (${g.source || 'ember'})` : 'none');
  if (g) lastGame = { key: g.key, name: g.name, image: g.image || '' };
  const ended = sessions.gameChanged(g);
  const r = await doRefresh().catch(e => { log('[recording]', e.message); return {}; });
  const forced = g && forcePopupKey === g.key;
  if (forced) forcePopupKey = null;
  if (g && (settings.get().detectPopup || forced)) toast({ kind: 'game', title: 'Glint is recording', game: g.name, icon: g.image || '', detail: `${g.name} - press ${settings.get().hotkey} to clip${voiceNote()}` });
  if (ended) {
    const what = onSessionEnd(settings.get(), ended, { signedIn: !!velora.token, otherGame: !!g });
    if (what.upload.length) queueAutoUpload(what.upload);
    if (ended.clips.length) {
      pendingHighlight = { ids: ended.clips.slice(), game: ended.name };
      if (what.open) { createWindow(true); send('glint:highlight', pendingHighlight); }
    }
  }
  void r;
}

function mediaFile(kind, id, sub) {
  if (kind === 'appicon') return /^[\w-]{1,40}$/.test(id) ? path.join(APPICONS, `${id}.png`) : null;
  if (kind === 'sound') { const s = settings.get(); return id === 'custom' && s.customSound ? path.join(SOUNDS_DIR, s.customSound) : null; }
  const c = library.get(id);
  if (!c) return null;
  if (kind === 'clip') return c.file;
  if (kind === 'thumb') return library.thumbPath(id);
  if (kind === 'strip') return library.stripPath(id);
  if (kind === 'track' && /^\d$/.test(sub || '')) return trackFile(id, Number(sub));
  return null;
}
const TYPES = { appicon: 'image/png', clip: 'video/mp4', track: 'audio/mp4', thumb: 'image/jpeg', strip: 'image/jpeg' };
const SOUND_TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
async function serveMedia(req) {
  const u = new URL(req.url);
  const parts = u.pathname.replace(/^\//, '').split('/').map(decodeURIComponent);
  const file = mediaFile(u.hostname, parts[0], parts[1]);
  if (!file) return new Response('not found', { status: 404 });
  let st;
  try { st = await fsp.stat(file); } catch { return new Response('not found', { status: 404 }); }
  const type = u.hostname === 'sound' ? SOUND_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' : TYPES[u.hostname] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(st.size - 1, Number(range[2])) : st.size - 1;
    if (start >= st.size) return new Response('', { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206, headers: { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' } });
}
const trackFile = (id, k) => path.join(library.thumbs, `${id}-a${k}.m4a`);
async function ensureTracks(id) {
  const c = library.get(id);
  if (!c || !fs.existsSync(c.file)) return null;
  const list = tracks.normalizeTracks(c.audioTracks);
  const outs = list.map(t => trackFile(id, t.index));
  if (!outs.every(f => fs.existsSync(f))) {
    try { await ff.run(ffargs.demuxTracksArgs(c.file, outs)); } catch (e) { log('[tracks]', e.message); return null; }
  }
  return list.map(t => t.index);
}

function sourceKbps(clip) { const d = clip.duration || 1; return Math.round((ff.fileSize(clip.file) * 8) / d / 1000); }
function exportEncoder() { const s = settings.get().encoder; return s !== 'auto' && encoders.includes(s) ? s : encoders[0] || 'libx264'; }
async function exportMp4(clip, out, onProgress, signal, edits) {
  const trim = edits?.trim !== undefined ? edits.trim : clip.trim;
  const at = edits?.audioTracks || (clip.audioTracks ? tracks.normalizeTracks(clip.audioTracks) : null);
  const r = ffargs.trimRange(trim, clip.duration);
  const crop = edits?.crop !== undefined ? edits.crop : clip.crop || null;
  await ff.run(ffargs.exportMp4Args({ src: clip.file, out, trim, crop, duration: clip.duration, encoder: exportEncoder(), kbps: sourceKbps(clip), audioTracks: at }),
    { onProgress: onProgress ? sec => onProgress(Math.min(1, sec / Math.max(0.1, r.length))) : null, signal });
}
const uploadError = e => {
  const c = e?.code || e?.message || '';
  if (c === 'pro_only' || c === 'insufficient_scope' || c === 'forbidden') return "Uploading isn't available on your account yet.";
  if (c === 'storage_limit_exceeded') return "You're out of Nookara storage. Delete some uploads on Nookara and try again.";
  if (c === 'file_too_large') return 'That clip is too big to upload (1 GB max). Trim it shorter first.';
  if (c === 'cancelled') return 'Upload cancelled.';
  if (c === 'tos_required') return "Accept Nookara's terms on nookara.cc first, then try again.";
  if (c === 'banned') return 'This Nookara account is banned.';
  if (c === 'media_delete_failed') return "Nookara wouldn't delete the video - try again in a bit.";
  if (c === 'render_failed') return "The server couldn't render the draft - try publishing again.";
  if (e?.status === 401) return 'Your Nookara sign-in expired - sign in again.';
  if (e?.status === 429 || c === 'rate_limited') return 'Slow down a little - try again in a minute.';
  return `Upload failed (${c || 'network error'}).`;
};
async function makeUploadThumb(clip, trim, crop = null) {
  const t = trim !== undefined ? trim : clip.trim;
  const tmp = path.join(os.tmpdir(), `glint-thumb-${clip.id}.jpg`);
  const at = (t?.in || 0) + Math.min(1.5, ((t ? t.out - t.in : clip.duration) || 2) / 3);
  for (const [w, q] of [[640, 4], [640, 8], [480, 10]]) {
    await ff.run(ffargs.thumbArgs(clip.file, at, tmp, w, q, crop));
    const b = await fsp.readFile(tmp);
    if (b.length * 1.37 < 300 * 1024) { fsp.rm(tmp, { force: true }).catch(() => {}); return `data:image/jpeg;base64,${b.toString('base64')}`; }
  }
  fsp.rm(tmp, { force: true }).catch(() => {});
  return null;
}
const cancelled = () => Object.assign(new Error('cancelled'), { code: 'cancelled' });
function newJob(id, extra) {
  const job = { controller: new AbortController(), progress: 0, stage: 'preparing', chunks: 1, sent: 0, size: 0, ...extra };
  uploads.set(id, job);
  job.tell = () => send('glint:upload', { id, stage: job.stage, progress: job.progress, chunks: job.chunks, sent: job.sent, size: job.size, auto: !!job.auto, kind: job.kind || 'upload', visibility: job.visibility, title: job.title, presetLabel: compress.PRESETS[job.preset]?.label || '' });
  job.tell();
  return job;
}
const sourceCache = new Map();
async function clipSource(clip) {
  const k = `${clip.id}:${ff.fileSize(clip.file)}`;
  if (sourceCache.has(k)) return sourceCache.get(k);
  const p = await ff.probe(clip.file);
  const s = { width: p.width || clip.width, height: p.height || clip.height, fps: p.fps || 60, kbps: Math.round((ff.fileSize(clip.file) * 8) / Math.max(0.1, p.duration || clip.duration) / 1000), audioStreams: p.audioStreams };
  sourceCache.set(k, s);
  return s;
}
async function compressTo(clip, out, { preset, custom, draft, edits }, onProgress, signal) {
  const source = await clipSource(clip);
  const base = { src: clip.file, out, preset, custom, source, duration: clip.duration, trim: edits?.trim !== undefined ? edits.trim : clip.trim, crop: edits?.crop !== undefined ? edits.crop : clip.crop || null, audioTracks: edits?.audioTracks || tracks.normalizeTracks(clip.audioTracks), encoder: exportEncoder(), draft };
  for (const gpu of [true, false]) {
    const c = compress.compressArgs({ ...base, gpu });
    try { await ff.run(c.args, { onProgress: onProgress ? sec => onProgress(Math.min(1, sec / Math.max(0.1, c.length))) : null, signal }); return c.plan; }
    catch (e) { if (isCancel(e) || signal?.aborted || !gpu) throw e; log('[compress] GPU path failed, retrying on the CPU:', e.message); }
  }
  return null;
}
async function renderAndSend(clip, job, { draft, edits, tmp }) {
  const signal = job.controller.signal;
  let file = clip.file;
  const preset = compress.PRESET_IDS.includes(job.preset) ? job.preset : 'balanced';
  if (preset !== 'original' || !draft) {
    job.stage = 'rendering'; job.progress = 0; job.tell();
    if (preset === 'original') await exportMp4(clip, tmp, p => { job.progress = p; job.tell(); }, signal, edits);
    else await compressTo(clip, tmp, { preset, custom: job.custom, draft, edits }, p => { job.progress = p; job.tell(); }, signal);
    file = tmp;
  }
  if (signal.aborted) throw cancelled();
  const info = await ff.probe(file);
  job.size = ff.fileSize(file); job.sent = 0;
  job.stage = 'uploading'; job.progress = 0; job.tell();
  const name = `${String(job.title || 'clip').replace(/[^\w .-]+/g, '').slice(0, 60) || 'clip'}.mp4`;
  const up = await velora.uploadVideo(file, name, (p, total, sent) => { job.progress = p; job.chunks = total; job.sent = sent; job.tell(); }, signal);
  return { url: up.url, info };
}
const cleanupApi = () => ({ myClips: () => velora.myClips(), deleteClip: (id, m) => velora.deleteClip(id, m), mediaList: () => velora.mediaList(), deleteMedia: id => velora.deleteMedia(id) });
function appIconData(appId) {
  try { const b = fs.readFileSync(path.join(APPICONS, `${appId}.png`)); return b.length * 1.37 <= 16 * 1024 ? `data:image/png;base64,${b.toString('base64')}` : null; } catch { return null; }
}
const contractTracks = list => tracks.normalizeTracks(list).map(t => {
  const o = { index: t.index, kind: t.kind, label: t.label, enabled: t.enabled, volume: t.volume };
  if (t.kind === 'app' && t.app) { o.app = { exe: t.app.exe, name: t.app.name }; const icon = t.appId && appIconData(t.appId); if (icon) o.icon = icon; }
  return o;
});

/**
 * opts = { title, visibility: 'public'|'unlisted'|'draft', auto }
 * public / unlisted: render the final MP4 on this PC (trim + enabled tracks mixed into one AAC track) and upload that.
 * draft: upload the ORIGINAL multi-track file untouched + trim + audioTracks, so the web editor can change them.
 * Cancel: stops the chunks; anything that already exists (Nookara media after finalize, the Glint record) is deleted.
 */
async function upload(id, opts = {}) {
  const clip = library.get(id);
  if (!clip) return { error: 'Clip not found.' };
  if (!velora.token) return { error: 'Sign in with Nookara first.' };
  if (uploads.has(id)) return { error: 'Already uploading.' };
  if (!fs.existsSync(clip.file)) return { error: 'The clip file is missing.' };
  const visibility = ['unlisted', 'draft'].includes(opts.visibility) ? opts.visibility : 'public';
  const draft = visibility === 'draft';
  const title = String(opts.title || clip.title || `${clip.game.name} clip`).trim().slice(0, 100);
  const s0 = settings.get();
  const preset = compress.PRESET_IDS.includes(opts.preset) ? opts.preset : opts.auto ? s0.autoUploadPreset : s0.uploadPreset;
  const job = newJob(id, { auto: !!opts.auto, visibility, title, kind: 'upload', preset, custom: opts.custom || s0.uploadCustom });
  const tmp = path.join(os.tmpdir(), `glint-upload-${id}-${Date.now()}.mp4`);
  const state = { mediaUrl: null, clipId: null };
  const plan = tracks.uploadPlan(clip.audioTracks, { states: opts.trackStates || null, stripVoice: !!(opts.auto || opts.voiceOff) });
  if (opts.trackStates && Array.isArray(clip.audioTracks)) library.update(id, { audioTracks: plan.tracks.map(t => (plan.removed.includes(t.index) ? tracks.normalizeTracks(clip.audioTracks).find(x => x.index === t.index) : t)) });
  const keptFile = `${tmp}.kept.mp4`;
  try {
    let source = clip;
    if (draft && plan.removed.length) {
      job.stage = 'rendering'; job.progress = 0; job.tell();
      await ff.run(ffargs.keepTracksArgs(clip.file, keptFile, plan.kept), { signal: job.controller.signal });
      source = { ...clip, file: keptFile, audioTracks: plan.keptTracks };
    }
    const { url, info } = await renderAndSend(source, job, { draft, tmp, edits: draft ? undefined : { audioTracks: plan.tracks } });
    state.mediaUrl = url;
    if (job.controller.signal.aborted) throw cancelled();
    job.stage = 'publishing'; job.tell();
    const thumbnail = await makeUploadThumb(clip);
    const gi = clip.game.icon || '';
    const icon = /^https:\/\//.test(gi) || (/^data:image\/(png|jpeg|webp);base64,/.test(gi) && gi.length < 170000) ? gi : undefined;
    const trim = draft ? contractTrim(clip.trim, clip.duration) : null;
    const at = plan.removed.length ? (plan.keptTracks.length ? contractTracks(plan.keptTracks) : []) : contractTracks(clip.audioTracks);
    const r = await velora.createClip({
      videoUrl: url, title, game: String(clip.game.name || '').slice(0, 64), ...(icon ? { gameIcon: icon } : {}),
      durationSec: Math.round((info.duration || clip.duration) * 100) / 100, width: info.width || clip.width, height: info.height || clip.height,
      visibility, ...(thumbnail ? { thumbnail } : {}), ...(draft ? { ...(trim ? { trim } : {}), ...(clip.crop ? { crop: clip.crop } : {}), ...(at.length ? { audioTracks: at } : {}) } : {}),
    }, job.controller.signal);
    state.clipId = r.id;
    if (job.controller.signal.aborted) throw cancelled();
    const link = r.url || `https://clips.nookara.cc/c/${r.id}`;
    library.update(id, { title, upload: { id: r.id, url: link, videoUrl: url, visibility, title, status: null, uploadedAt: Date.now(), ...(draft ? { sentTrim: trim, sentTracks: at, sentCrop: clip.crop || null, ...(plan.removed.length ? { keptTracks: plan.kept } : {}) } : {}) }, uploadGone: false });
    send('glint:library', { changed: id });
    return { ok: true, url: link, draft };
  } catch (e) {
    const wasCancel = isCancel(e) || job.controller.signal.aborted;
    if (wasCancel && (state.mediaUrl || state.clipId)) {
      const r = await cleanupAfterCancel(cleanupApi(), state);
      log('[upload] cancelled after finalize, cleaned up:', r.deleted || 'nothing found');
    }
    if (!wasCancel) log('[upload]', id, e.code || e.message, e.status || '');
    return { error: wasCancel ? 'Upload cancelled.' : uploadError(e), cancelled: wasCancel };
  } finally {
    uploads.delete(id);
    fsp.rm(tmp, { force: true }).catch(() => {});
    fsp.rm(keptFile, { force: true }).catch(() => {});
  }
}
const autoQueue = [];
let autoBusy = false;
function queueAutoUpload(ids) {
  for (const id of ids) if (!autoQueue.includes(id) && !library.get(id)?.upload) autoQueue.push(id);
  runAuto();
}
async function runAuto() {
  if (autoBusy) return;
  autoBusy = true;
  try {
    while (autoQueue.length) {
      const id = autoQueue.shift();
      const vis = settings.get().autoUploadVisibility;
      const r = await upload(id, { visibility: vis, auto: true });
      send('glint:upload', { id, stage: r.ok ? 'done' : 'failed', error: r.error || null, url: r.url || null, auto: true });
      if (!r.ok) log('[auto-upload]', id, r.error);
    }
  } finally { autoBusy = false; }
}

const draftSyncTimers = new Map();
function scheduleDraftSync(id) {
  clearTimeout(draftSyncTimers.get(id));
  draftSyncTimers.set(id, setTimeout(() => { draftSyncTimers.delete(id); syncDraft(id).catch(e => log('[draft-sync]', id, e.message)); }, 900));
}
async function syncDraft(id) {
  const c = library.get(id);
  if (!c || !velora.token || uploads.has(id)) return;
  const p = draftSyncPayload(c, { contractTrim, contractTracks });
  if (!p) return;
  try { await velora.patchClip(c.upload.id, p.body); }
  catch (e) {
    if (e.status === 404) { library.update(id, { upload: null, uploadGone: true }); send('glint:library', { changed: id }); return; }
    log('[draft-sync]', id, e.code || e.message, e.status || '');
    send('glint:notice', { kind: 'draftsync', error: true });
    return;
  }
  const now = library.get(id);
  if (!now?.upload || now.upload.id !== c.upload.id) return;
  library.update(id, { upload: { ...now.upload, sentTrim: p.sentTrim, sentTracks: p.sentTracks, sentCrop: p.sentCrop } });
  if (draftSyncPayload(library.get(id), { contractTrim, contractTracks })) scheduleDraftSync(id);
}

/**
 * Publish a draft. Always rendered on THIS PC (never the server): trim + enabled tracks mixed -> chunked Nookara upload ->
 * POST /clips/:id/replace (CONTRACT v1.1.1). Edits made on the web (server trim/tracks that differ from what this PC
 * uploaded) win, so phone edits aren't lost. Only if the original file is gone does it fall back to the server render.
 */
async function publishDraft(id, opts = {}) {
  const c = library.get(id);
  if (!c?.upload?.id) return { error: 'Not uploaded.' };
  if (uploads.has(id)) return { error: 'Already working on it.' };
  const visibility = opts.visibility === 'unlisted' ? 'unlisted' : 'public';
  const title = String(opts.title || c.upload.title || c.title).slice(0, 100);
  if (!fs.existsSync(c.file)) return publishOnServer(id, visibility, title);
  const s0 = settings.get();
  const preset = compress.PRESET_IDS.includes(opts.preset) ? opts.preset : s0.uploadPreset;
  const job = newJob(id, { visibility, title, kind: 'publish', preset, custom: opts.custom || s0.uploadCustom });
  const tmp = path.join(os.tmpdir(), `glint-publish-${id}-${Date.now()}.mp4`);
  const state = { mediaUrl: null, clipId: null };
  try {
    let remote = null;
    try { remote = (await velora.myClips()).find(x => x && String(x.id) === String(c.upload.id)) || null; } catch { remote = null; }
    const edits = draftEdits(c, remote);
    if (edits.fromWeb) log(`[publish] ${id}: using the edits made on the web`);
    const { url, info } = await renderAndSend(c, job, { draft: false, edits, tmp });
    state.mediaUrl = url;
    if (job.controller.signal.aborted) throw cancelled();
    job.stage = 'publishing'; job.tell();
    const thumbnail = await makeUploadThumb(c, edits.trim, edits.crop ?? null);
    const r = await velora.replaceClip(c.upload.id, {
      videoUrl: url, visibility, title, durationSec: Math.round((info.duration || 0) * 100) / 100, width: info.width || c.width, height: info.height || c.height, ...(thumbnail ? { thumbnail } : {}),
    }, job.controller.signal);
    const cl = r?.clip || {};
    library.update(id, { upload: { ...c.upload, visibility: cl.visibility || visibility, title: cl.title || title, status: null, videoUrl: cl.videoUrl || url, url: cl.url || c.upload.url, sentTrim: undefined, sentTracks: undefined, sentCrop: undefined } });
    send('glint:library', { changed: id });
    return { ok: true, url: cl.url || c.upload.url, fromWeb: edits.fromWeb };
  } catch (e) {
    const wasCancel = isCancel(e) || job.controller.signal.aborted;
    if (wasCancel && state.mediaUrl) {
      try { const m = (await velora.mediaList()).find(u => u && u.url === state.mediaUrl); if (m) await velora.deleteMedia(m.id); } catch {  }
    }
    if (!wasCancel) log('[publish]', id, e.code || e.message, e.status || '');
    return { error: wasCancel ? 'Publish cancelled - it is still a draft.' : uploadError(e), cancelled: wasCancel };
  } finally {
    uploads.delete(id);
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
}
async function publishOnServer(id, visibility, title) {
  const c = library.get(id);
  const job = newJob(id, { visibility, title, kind: 'publish', stage: 'server' });
  job.stage = 'server'; job.tell();
  try {
    await velora.publishClip(c.upload.id, { visibility, title });
    library.update(id, { upload: { ...c.upload, status: 'rendering' } });
    send('glint:library', { changed: id });
    const until = Date.now() + 20 * 60 * 1000;
    while (Date.now() < until) {
      if (job.controller.signal.aborted) return { error: 'Stopped watching - the server keeps rendering it.', cancelled: true };
      await new Promise(r => setTimeout(r, 3000));
      let j;
      try { j = await velora.getClip(c.upload.id); } catch (e) { if (e.status === 404) { library.update(id, { upload: null, uploadGone: true }); send('glint:library', { changed: id }); return { error: 'That upload is gone from Nookara.' }; } continue; }
      const cl = j?.clip || j || {};
      const st = cl.status;
      if (st === 'failed') { library.update(id, { upload: { ...library.get(id).upload, status: 'failed' } }); send('glint:library', { changed: id }); return { error: uploadError({ code: cl.error || 'render_failed' }) }; }
      if (st === 'ready' || (cl.visibility && cl.visibility !== 'draft' && st !== 'rendering')) {
        library.update(id, { upload: { ...library.get(id).upload, visibility: cl.visibility || visibility, status: null, videoUrl: cl.videoUrl || c.upload.videoUrl, url: cl.url || c.upload.url } });
        send('glint:library', { changed: id });
        return { ok: true, url: cl.url || c.upload.url, server: true };
      }
    }
    return { error: 'Still rendering - check back in a bit.' };
  } catch (e) {
    return { error: uploadError(e) };
  } finally { uploads.delete(id); }
}
async function reconcile() {
  if (!velora.token) return;
  try { if (library.reconcile(await velora.myClips())) send('glint:library', { changed: '*' }); } catch (e) { log('[reconcile]', e.status ? `${e.code} (${e.status})` : gnet.describe(e)); }
}

function createWindow(show = true) {
  if (win && !win.isDestroyed()) {
    if (show) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
    return;
  }
  win = new BrowserWindow({
    width: 1240, height: 800, minWidth: 940, minHeight: 620, frame: false, backgroundColor: '#0e0e10', show: false, title: 'Glint',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false },
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.on('close', e => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.on('maximize', () => send('glint:win', { maximized: true }));
  win.on('unmaximize', () => send('glint:win', { maximized: false }));
  win.once('ready-to-show', () => { if (show) win.show(); });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
function openExternal(url) {
  try { const u = new URL(url); if (u.protocol === 'https:' && /(^|\.)ikelene\.(net|dev)$/.test(u.hostname)) shell.openExternal(u.href); } catch {  }
}
function trayIcon() { return nativeImage.createFromPath(path.join(__dirname, 'assets', recorder?.recording ? 'tray-rec.png' : 'tray.png')); }
function updateTray() {
  if (!tray) return;
  const st = status();
  tray.setImage(trayIcon());
  tray.setToolTip(st.recording ? `Glint - recording ${st.game ? st.game.name : 'the desktop'}` : 'Glint - waiting for a game');
  const s = settings.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Glint', click: () => createWindow(true) },
    { type: 'separator' },
    { label: st.recording ? `Recording: ${st.game ? st.game.name : 'Desktop'}` : 'Not recording (no game running)', enabled: false },
    { label: `Save clip now (${s.hotkey})`, enabled: !!st.recording, click: () => clipPressed('tray') },
    { label: 'Stop recording voices', enabled: !!(s.mic || s.audioDesktop || Object.values(s.audioApps || {}).some(Boolean)), click: () => { applySettings({ mic: false, audioDesktop: false, audioApps: { discord: false, fluxer: false, ember: false } }); send('glint:settings', settings.get()); } },
    { label: 'Always record (even without a game)', type: 'checkbox', checked: s.alwaysRecord, click: i => { applySettings({ alwaysRecord: i.checked }); } },
    { type: 'separator' },
    { label: 'Open clips folder', click: () => { fs.mkdirSync(clipsDir(), { recursive: true }); shell.openPath(clipsDir()); } },
    ...(updater?.state?.state === 'ready' ? [{ label: `Restart to update (${updater.state.version})`, click: () => installUpdate() }] : []),
    { label: 'Quit Glint', click: () => { quitting = true; app.quit(); } },
  ]));
}
let installWhenIdle = null;
const busyReason = () => (velora?.flow ? 'sign-in' : uploads.size ? 'upload' : saving || saveQueue.length ? 'clip' : null);
function installUpdate() {
  const why = busyReason();
  if (why) {
    send('glint:notice', { kind: 'update-wait', why });
    if (!installWhenIdle) installWhenIdle = setInterval(() => { if (!busyReason()) { clearInterval(installWhenIdle); installWhenIdle = null; installUpdate(); } }, 3000);
    return false;
  }
  if (updater.run(true)) { quitting = true; app.quit(); }
  return true;
}
function applyLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.get().startWithWindows, path: process.execPath, args: ['--hidden'] });
}
function applySettings(patch) {
  const before = settings.get();
  if (patch && patch.hotkey && patch.hotkey !== before.hotkey) {
    const err = testHotkey(patch.hotkey);
    if (err) return { error: err, settings: before };
  }
  const s = settings.set(patch);
  if (s.hotkey !== before.hotkey) { setHotkey(null); setHotkey(s.hotkey); }
  if (s.startWithWindows !== before.startWithWindows) applyLoginItem();
  if (s.sound !== before.sound || s.customSound !== before.customSound || s.soundVolume !== before.soundVolume) syncSound();
  if (JSON.stringify(s.customGames) !== JSON.stringify(before.customGames)) games.scan().catch(() => {});
  refreshRecording();
  updateTray();
  return { settings: s };
}

function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    if (!win || e.sender !== win.webContents) return null;
    try { return await fn(...args); } catch (x) { log(`[ipc ${ch}]`, gnet.describe(x)); return { error: x.message, reason: gnet.reasonOf(x) }; }
  });
}
function account() { const m = velora.me; return velora.token ? (m ? { signedIn: true, username: m.username, color: m.color, pfp: m.pfp } : { signedIn: true }) : { signedIn: false }; }
const iconCache = new Map();
async function exeIcon(p) {
  if (iconCache.has(p)) return iconCache.get(p);
  let icon = '';
  try { icon = (await app.getFileIcon(p, { size: 'normal' })).toDataURL(); } catch {  }
  iconCache.set(p, icon);
  return icon;
}
function registerIpc() {
  handle('state', () => {
    const hl = pendingHighlight;
    return { settings: settings.get(), status: status(), account: account(), update: updater.state, encoders, version: app.getVersion(), clipsDir: clipsDir(), highlight: hl, uploads: [...uploads.entries()].map(([id, j]) => ({ id, stage: j.stage, progress: j.progress, chunks: j.chunks, sent: j.sent, size: j.size, auto: !!j.auto, kind: j.kind, visibility: j.visibility, title: j.title })) };
  });
  handle('highlight:seen', () => { pendingHighlight = null; return true; });
  handle('settings:set', patch => applySettings(patch));
  handle('mics', async () => { try { return await ff.helper('devices'); } catch { return []; } });
  handle('pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Where should clips go?', defaultPath: clipsDir(), properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('sound:pickCustom', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick a clip sound', properties: ['openFile'], filters: [{ name: 'Sounds', extensions: ['mp3', 'wav', 'ogg'] }] });
    if (r.canceled || !r.filePaths[0]) return { cancelled: true };
    const src = r.filePaths[0], ext = path.extname(src).toLowerCase();
    if (!SOUND_TYPES[ext]) return { error: 'Pick an MP3, WAV or OGG file.' };
    if (fs.statSync(src).size > 5 * 1024 * 1024) return { error: 'That sound is too big (5 MB max) - a short clip works best.' };
    await fsp.mkdir(SOUNDS_DIR, { recursive: true });
    for (const f of await fsp.readdir(SOUNDS_DIR)) if (/^custom\./i.test(f)) await fsp.rm(path.join(SOUNDS_DIR, f), { force: true });
    await fsp.copyFile(src, path.join(SOUNDS_DIR, `custom${ext}`));
    const res = applySettings({ sound: 'custom', customSound: `custom${ext}` });
    syncSound();
    return { ok: true, name: path.basename(src), settings: res.settings };
  });
  handle('openClipsDir', () => { fs.mkdirSync(clipsDir(), { recursive: true }); shell.openPath(clipsDir()); return true; });
  handle('openExternal', url => { openExternal(url); return true; });
  handle('clipNow', () => clipPressed('app'));

  handle('library:list', () => { reconcileSoon(); return library.list(); });
  handle('library:update', (id, patch) => {
    const r = library.update(id, patch || {});
    if (patch && ('trim' in patch || 'audioTracks' in patch || 'crop' in patch)) scheduleDraftSync(id);
    return r;
  });
  handle('library:delete', async (id, deleteFile) => {
    for (const f of await fsp.readdir(library.thumbs).catch(() => [])) if (f.startsWith(`${id}-a`)) await fsp.rm(path.join(library.thumbs, f), { force: true }).catch(() => {});
    const ok = await library.remove(id, !!deleteFile); send('glint:library', { removed: id }); return ok;
  });
  handle('library:reveal', id => { const c = library.get(id); if (c && fs.existsSync(c.file)) shell.showItemInFolder(c.file); return true; });
  handle('library:strip', async id => {
    const c = library.get(id);
    if (!c) return null;
    const f = library.stripPath(id);
    if (!fs.existsSync(f)) { try { await ff.run(ffargs.filmstripArgs(c.file, c.duration, f, 14, 72)); } catch (e) { log('[strip]', e.message); return null; } }
    return true;
  });
  handle('library:tracks', id => ensureTracks(id));
  handle('library:thumb', async id => { const c = library.get(id); if (c) await makeThumb(c); return true; });

  handle('export', async (id, kind) => {
    const c = library.get(id);
    if (!c || !fs.existsSync(c.file)) return { error: 'The clip file is missing.' };
    const mp3 = kind === 'mp3';
    const base = path.basename(c.file, '.mp4') + (c.trim ? ' (trimmed)' : '');
    const r = await dialog.showSaveDialog(win, {
      title: mp3 ? 'Export MP3' : 'Export MP4', defaultPath: path.join(app.getPath('downloads'), `${base}.${mp3 ? 'mp3' : 'mp4'}`),
      filters: [mp3 ? { name: 'MP3 audio', extensions: ['mp3'] } : { name: 'MP4 video', extensions: ['mp4'] }],
    });
    if (r.canceled || !r.filePath) return { cancelled: true };
    if (path.resolve(r.filePath).toLowerCase() === path.resolve(c.file).toLowerCase()) return { error: "Pick a different file - that's the original clip." };
    const at = tracks.normalizeTracks(c.audioTracks);
    if (mp3 && !at.some(t => t.enabled && t.volume > 0)) return { error: 'Every audio track is muted - turn one on to export MP3.' };
    if (mp3) await ff.run(ffargs.exportMp3Args({ src: c.file, out: r.filePath, trim: c.trim, duration: c.duration, audioTracks: at }));
    else await exportMp4(c, r.filePath);
    shell.showItemInFolder(r.filePath);
    return { ok: true, file: r.filePath };
  });

  handle('upload:start', (id, opts) => upload(id, opts));
  handle('upload:cancel', id => { uploads.get(id)?.controller.abort(); return true; });
  handle('upload:publish', (id, opts) => publishDraft(id, opts));
  handle('upload:estimate', async (id, o = {}) => {
    const c = library.get(id);
    if (!c || !fs.existsSync(c.file)) return null;
    const source = await clipSource(c);
    const e = compress.estimate({ preset: o.preset, custom: o.custom, source, duration: c.duration, trim: c.trim, fileSize: ff.fileSize(c.file), audioTrackCount: source.audioStreams, draft: !!o.draft });
    return { bytes: e.bytes, originalBytes: e.originalBytes, saves: e.saves, plan: e.plan, source };
  });
  handle('storage:usage', () => velora.storageUsage().catch(() => null));
  handle('upload:patch', async (id, patch) => {
    const c = library.get(id);
    if (!c?.upload) return { error: 'Not uploaded.' };
    const body = {};
    if (typeof patch.title === 'string' && patch.title.trim()) body.title = patch.title.trim().slice(0, 100);
    if (patch.visibility === 'public' || patch.visibility === 'unlisted') body.visibility = patch.visibility;
    try { await velora.patchClip(c.upload.id, body); }
    catch (e) { if (e.status === 404) { library.update(id, { upload: null, uploadGone: true }); send('glint:library', { changed: id }); return { error: 'That upload is gone from Nookara.' }; } return { error: uploadError(e) }; }
    library.update(id, { upload: { ...c.upload, ...body } });
    return { ok: true, clip: library.get(id) };
  });
  handle('upload:delete', async id => {
    const c = library.get(id);
    if (!c?.upload) return { ok: true };
    try { await velora.deleteClip(c.upload.id, true); }
    catch (e) { if (e.status !== 404) return { error: e.code === 'forbidden' ? "Nookara wouldn't delete that upload." : uploadError(e) }; }
    library.update(id, { upload: null, uploadGone: false });
    send('glint:library', { changed: id });
    return { ok: true };
  });

  handle('account:signIn', async () => {
    const r = await velora.signIn(st => send('glint:account', { ...account(), signingIn: st.state }));
    if (!r.ok && r.error !== 'cancelled') log('[sign-in]', r.error, r.reason || '');
    send('glint:account', account());
    if (r.ok) { reconcile(); win?.show(); win?.focus(); }
    return r;
  });
  handle('account:cancel', () => { velora.cancelSignIn(); return true; });
  handle('account:signOut', () => { velora.signOut(); send('glint:account', account()); return true; });
  handle('account:refresh', async () => { await velora.account(true).catch(() => {}); return account(); });

  handle('games:list', () => ({
    current: games.current ? { key: games.current.key, name: games.current.name, image: games.current.image, source: games.current.source } : null,
    running: (games.running || []).map(g => ({ key: g.key, name: g.name, image: g.image, source: g.source })),
    custom: settings.get().customGames,
  }));
  handle('audioApps:add', async ({ path: p, name }) => {
    if (typeof p !== 'string' || !/\.exe$/i.test(p)) return { error: 'Pick a program (.exe).' };
    const s = settings.get();
    const exe = path.basename(p);
    if (/[@,]/.test(exe)) return { error: "That program's name can't be used for a track." };
    if (s.audioCustomApps.some(a => a.exe.toLowerCase() === exe.toLowerCase())) return { error: `${exe} is already on the list.` };
    if (tracks.planTracks({ ...s, audioCustomApps: [] }, 1).length + s.audioCustomApps.filter(a => a.enabled).length >= tracks.MAX_TRACKS) return { error: 'That would be more than 8 audio tracks - turn another source off first.' };
    const id = Math.random().toString(36).slice(2, 10);
    try {
      await fsp.mkdir(APPICONS, { recursive: true });
      let img = await app.getFileIcon(p, { size: 'normal' });
      if (img.isEmpty()) img = await app.getFileIcon(p, { size: 'large' });
      if (!img.isEmpty()) { let png = img.toPNG(); if (png.length > 11000) png = img.resize({ width: 32, height: 32 }).toPNG(); await fsp.writeFile(path.join(APPICONS, `${id}.png`), png); }
    } catch (e) { log('[appicon]', e.message); }
    const entry = { id, name: String(name || path.basename(p, '.exe')).slice(0, 40), exe, path: p, enabled: true, volume: 100 };
    const r = applySettings({ audioCustomApps: [...s.audioCustomApps, entry] });
    return { ok: true, app: entry, settings: r.settings };
  });
  handle('audioApps:remove', id => applySettings({ audioCustomApps: settings.get().audioCustomApps.filter(a => a.id !== id) }));
  handle('games:running', async (refresh, mode) => {
    if (refresh) await games.scan().catch(() => {});
    const list = games.windowed({ apps: mode === 'apps' }).slice(0, 40);
    for (const p of list) p.icon = await exeIcon(p.path);
    return list;
  });
  handle('games:add', async ({ path: p, name }) => {
    if (typeof p !== 'string' || !/\.exe$/i.test(p)) return { error: 'Pick a program (.exe).' };
    if (settings.get().customGames.some(g => g.path && g.path.toLowerCase() === p.toLowerCase())) return { error: "That one's already on your list." };
    const r = await addCustomGame(p, name);
    return r.error ? r : { ok: true, game: r.game };
  });
  handle('games:pickExe', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Pick the game program', properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('games:update', (id, patch) => {
    const list = settings.get().customGames.map(g => (g.id === id ? { ...g, name: typeof patch?.name === 'string' && patch.name.trim() ? patch.name.trim().slice(0, 80) : g.name } : g));
    return applySettings({ customGames: list });
  });
  handle('games:remove', id => applySettings({ customGames: settings.get().customGames.filter(g => g.id !== id) }));

  handle('update:check', () => updater.check(true));
  handle('update:install', () => { installUpdate(); return true; });
  handle('win', cmd => {
    if (cmd === 'min') win.minimize();
    else if (cmd === 'max') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
    else if (cmd === 'close') win.hide();
    return win.isMaximized();
  });
  ipcMain.on('overlay:hidden', e => { if (overlay.isOverlay(e.sender)) overlay.hidden(); });
}
let reconcileAt = 0;
function reconcileSoon() { if (Date.now() - reconcileAt > 60000) { reconcileAt = Date.now(); reconcile(); } }

app.on('second-instance', () => createWindow(true));
app.whenReady().then(async () => {
  settings = new Settings(DATA);
  library = new Library(DATA);
  velora = new Velora(DATA, app.getVersion());
  updater = new Updater(st => { send('glint:update', st); updateTray(); });
  recorder = new Recorder();
  games = new GameDetect(() => settings.get().customGames);
  protocol.handle('glint-media', serveMedia);
  registerIpc();
  syncSound();
  setHotkey(settings.get().hotkey);
  overlay.warm(null, settings.get().overlayCorner);

  const hidden = process.argv.includes('--hidden') && settings.get().startMinimized;
  createWindow(!hidden);
  tray = new Tray(trayIcon());
  tray.on('click', () => createWindow(true));
  updateTray();
  applyLoginItem();

  recorder.on('status', pushStatus);
  recorder.on('stalled', ({ hwnd }) => { log('[capture] window capture gave no frames - switching to the window\'s screen area'); gfxStalled.add(hwnd); refreshRecording(); });
  gfxCheck = ff.run(['-hide_banner', '-h', 'filter=gfxcapture'], { allowFail: true, stdout: true }).then(r => { hasGfx = /gfxcapture AVOptions/.test(`${r.stdout}${r.stderr}`); if (!hasGfx) log('[capture] this ffmpeg has no gfxcapture - windowed games use the screen-area fallback'); }).catch(() => { hasGfx = false; });
  recorder.on('log', m => log(m));
  recorder.on('error', e => log('[recorder]', e.message));
  recorder.on('encoder-failed', ({ encoder, why }) => { log(`[recorder] ${encoder} failed, falling back`, why); send('glint:notice', { kind: 'encoder', encoder }); });
  games.on('log', m => log(m));
  games.on('change', g => { onGameChange(g).catch(e => log('[games]', e.message)); });
  games.on('pids', () => { refreshRecording(); pushStatus(); });

  if (!ff.ready()) log('[start] ffmpeg or glint-helper missing!');
  await Recorder.cleanStale();
  ff.detectCaptureEncoders(path.join(DATA, 'encoder-probe.json')).then(r => {
    encoders = r.list.map(x => x.encoder);
    recorder.setEncoders(encoders, Object.fromEntries(r.list.map(x => [x.encoder, x.chain])));
    log('[start] encoders', r.list.map(x => `${x.encoder}/${x.chain}`).join(', '));
    for (const l of r.log || []) log('[encoders]', l);
    refreshRecording();
  }).catch(e => log('[encoders]', e.message));
  velora.account().then(() => send('glint:account', account())).catch(() => {});
  games.start().catch(e => log('[games]', e.message));
  if (settings.get().autoUpdate) updater.start();
  reconcileTimer = setInterval(reconcile, 10 * 60 * 1000);
  setTimeout(reconcile, 5000);
});
app.on('window-all-closed', e => e.preventDefault?.());
app.on('before-quit', () => {
  quitting = true;
  try { globalShortcut.unregisterAll(); } catch {  }
  recorder?.stop();
  games?.stop();
  overlay.stopAll();
  library?.flush();
  clearInterval(reconcileTimer);
  if (updater?.ready) updater.run(false);
});
