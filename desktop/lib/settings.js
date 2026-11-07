const fs = require('fs');
const path = require('path');
const { PRESET_IDS, cleanCustom } = require('./compress');

const VERSION = 4;
const LENGTHS = [15, 30, 60, 120];
const SOUNDS = ['sparkle', 'shutter', 'coin', 'whoosh', 'glint'];
const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const DEFAULTS = {
  settingsVersion: VERSION,
  hotkey: 'Alt+C',
  clipLength: 30,
  resolution: 'native',
  fps: 60,
  bitrate: 'medium',
  encoder: 'auto',
  alwaysRecord: false,
  captureMode: 'window',
  cursor: true,
  audioGame: true,
  sysVolume: 100,
  mic: false,
  micAsked: false,
  micDevice: 'default',
  micVolume: 100,
  audioApps: { discord: false, fluxer: false, ember: false },
  voiceAsked: false,
  audioDesktop: false,
  audioCustomApps: [],
  audioOffsetMs: 0,
  clipsDir: '',
  sound: 'shutter',
  customSound: '',
  soundVolume: 70,
  overlay: true,
  overlayCorner: 'top-left',
  detectPopup: true,
  openOnGameClose: true,
  autoUpload: 'off',
  autoUploadVisibility: 'draft',
  uploadPreset: 'balanced',
  autoUploadPreset: 'balanced',
  uploadCustom: { maxH: 1080, fps: 60, quality: 60, audioK: 128 },
  startWithWindows: true,
  startMinimized: true,
  customGames: [],
  autoUpdate: true,
};
const int = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Math.round(Number(v)))) : d);
const str = (v, max, d) => (typeof v === 'string' ? v.slice(0, max) : d);

function migrate(raw) {
  const r = raw && typeof raw === 'object' ? { ...raw } : {};
  const v = Number(r.settingsVersion) || 1;
  if (v < 2 && Object.keys(r).length) {
    if (r.hotkey === 'Alt+F10') r.hotkey = 'Alt+C';
    if (r.sound === 'sparkle' || r.sound == null) r.sound = 'shutter';
    if (r.overlayCorner === 'top-right' || r.overlayCorner == null) r.overlayCorner = 'top-left';
    if (r.systemAudio === false) r.audioGame = false;
  }
  if (v < 3 && Object.keys(r).length) { r.mic = false; r.micAsked = false; }
  if (v < 4 && Object.keys(r).length) { r.audioApps = { discord: false, fluxer: false, ember: false }; r.voiceAsked = false; }
  r.settingsVersion = VERSION;
  return r;
}

function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const o = { ...DEFAULTS, audioApps: { ...DEFAULTS.audioApps }, uploadCustom: { ...DEFAULTS.uploadCustom } };
  if (typeof r.hotkey === 'string' && r.hotkey.trim() && r.hotkey.length <= 40) o.hotkey = r.hotkey.trim();
  o.clipLength = int(r.clipLength, 5, 600, DEFAULTS.clipLength);
  if (['720', '1080', '1440', 'native'].includes(String(r.resolution))) o.resolution = String(r.resolution);
  if (['window', 'monitor'].includes(r.captureMode)) o.captureMode = r.captureMode;
  o.fps = Number(r.fps) === 30 ? 30 : 60;
  if (['low', 'medium', 'high', 'ultra'].includes(r.bitrate)) o.bitrate = r.bitrate;
  if (['auto', 'h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'].includes(r.encoder)) o.encoder = r.encoder;
  for (const k of ['alwaysRecord', 'cursor', 'audioGame', 'mic', 'micAsked', 'voiceAsked', 'audioDesktop', 'overlay', 'detectPopup', 'openOnGameClose', 'startWithWindows', 'startMinimized', 'autoUpdate']) if (typeof r[k] === 'boolean') o[k] = r[k];
  if (r.audioApps && typeof r.audioApps === 'object') for (const k of Object.keys(o.audioApps)) if (typeof r.audioApps[k] === 'boolean') o.audioApps[k] = r.audioApps[k];
  o.sysVolume = int(r.sysVolume, 0, 200, 100);
  o.micVolume = int(r.micVolume, 0, 200, 100);
  o.micDevice = str(r.micDevice, 300, 'default') || 'default';
  o.audioOffsetMs = int(r.audioOffsetMs, -1000, 1000, 0);
  o.clipsDir = str(r.clipsDir, 500, '');
  o.customSound = /^custom\.(mp3|wav|ogg)$/i.test(String(r.customSound || '')) ? r.customSound : '';
  o.sound = r.sound === 'off' || SOUNDS.includes(r.sound) || (r.sound === 'custom' && o.customSound) ? r.sound : DEFAULTS.sound;
  o.soundVolume = int(r.soundVolume, 0, 100, 70);
  if (CORNERS.includes(r.overlayCorner)) o.overlayCorner = r.overlayCorner;
  if (['off', 'on_clip', 'on_game_close'].includes(r.autoUpload)) o.autoUpload = r.autoUpload;
  if (['draft', 'unlisted', 'public'].includes(r.autoUploadVisibility)) o.autoUploadVisibility = r.autoUploadVisibility;
  if (PRESET_IDS.includes(r.uploadPreset)) o.uploadPreset = r.uploadPreset;
  if (PRESET_IDS.includes(r.autoUploadPreset)) o.autoUploadPreset = r.autoUploadPreset;
  o.uploadCustom = cleanCustom(r.uploadCustom);
  o.audioCustomApps = (Array.isArray(r.audioCustomApps) ? r.audioCustomApps : [])
    .filter(a => a && typeof a.id === 'string' && typeof a.exe === 'string' && /\.exe$/i.test(a.exe) && !/[@,\\/:]/.test(a.exe))
    .slice(0, 8)
    .map(a => ({ id: a.id.slice(0, 40), name: str(a.name, 40, a.exe) || a.exe, exe: a.exe.slice(0, 120), path: str(a.path, 500, ''), enabled: a.enabled !== false, volume: int(a.volume, 0, 200, 100) }));
  o.customGames = (Array.isArray(r.customGames) ? r.customGames : [])
    .filter(g => g && typeof g.id === 'string' && typeof g.name === 'string' && (typeof g.path === 'string' || typeof g.exe === 'string'))
    .slice(0, 200)
    .map(g => ({ id: g.id.slice(0, 40), name: g.name.slice(0, 80), path: str(g.path, 500, ''), exe: str(g.exe, 200, ''), icon: str(g.icon, 200000, '') }));
  o.settingsVersion = VERSION;
  return o;
}

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    const raw = this.read();
    this.data = clean(migrate(raw));
    if (Object.keys(raw).length && (Number(raw.settingsVersion) || 1) < VERSION) this.set({});
  }
  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return {}; } }
  get() { return this.data; }
  set(patch) {
    const p = patch && typeof patch === 'object' ? patch : {};
    this.data = clean({ ...this.data, ...p, ...(p.audioApps ? { audioApps: { ...this.data.audioApps, ...p.audioApps } } : {}) });
    try { fs.writeFileSync(this.file + '.tmp', JSON.stringify(this.data, null, 2)); fs.renameSync(this.file + '.tmp', this.file); } catch {  }
    return this.data;
  }
}

module.exports = { Settings, clean, migrate, DEFAULTS, LENGTHS, SOUNDS, CORNERS, VERSION };
