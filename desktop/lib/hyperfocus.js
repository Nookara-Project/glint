const fs = require('fs');
const path = require('path');

const MANIFEST = 'https://ikelene.net/launcher/apps.json';
const BASE = 'https://ikelene.net/launcher/';
const HF_ICON = 'https://ikelene.net/launcher/assets/icon.png';
const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const base = p => norm(p).split('/').pop();
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const absUrl = u => (!u ? '' : /^https?:\/\//i.test(u) ? u : BASE + String(u).replace(/^\.?\//, ''));
const NOT_GAME = /(crash|report|unins|setup|install|redist|vc_redist|dxsetup|easyanticheat|battleye|prereq|updater)/i;
const SHELL = new Set(['cmd.exe', 'conhost.exe', 'powershell.exe', 'pwsh.exe', 'explorer.exe', 'hyperfocus.exe', 'openconsole.exe', 'windowsterminal.exe']);

const prettify = s => String(s || '').replace(/\.exe$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
const appIdOf = folder => String(folder || '').replace(/#beta$/i, '').replace(/-beta$/i, '');

function buildIndex(src = {}) {
  const apps = new Map();
  const addApps = list => {
    for (const a of Array.isArray(list) ? list : []) {
      if (!a || typeof a.id !== 'string') continue;
      const prev = apps.get(a.id) || {};
      apps.set(a.id, { name: a.name || prev.name || a.id, icon: absUrl(a.icon) || prev.icon || '' });
    }
  };
  addApps(src.remote?.apps);
  addApps(src.manifestCache?.apps);
  const roots = new Set();
  const defRoot = src.localAppData ? path.join(src.localAppData, 'Hyperfocus', 'Apps') : null;
  if (defRoot) roots.add(norm(defRoot));
  if (src.settings?.installRoot) roots.add(norm(src.settings.installRoot));
  const dirs = [];
  for (const recs of [src.installed, src.installedBetas]) {
    for (const [id, r] of Object.entries(recs && typeof recs === 'object' ? recs : {})) {
      if (!r || typeof r.dir !== 'string' || !r.dir) continue;
      const appId = appIdOf(id);
      const a = apps.get(appId) || {};
      dirs.push({ dir: norm(r.dir), appId, name: a.name || r.name || prettify(appId), icon: a.icon || '' });
    }
  }
  dirs.sort((x, y) => y.dir.length - x.dir.length);
  return { roots: [...roots], dirs, apps };
}

const game = (appId, idx, fallbackName) => {
  const a = idx.apps.get(appId) || {};
  return { key: `hf:${appId}`, name: a.name || fallbackName || prettify(appId), image: a.icon || HF_ICON, source: 'hyperfocus' };
};

function match(proc, idx, byPid) {
  if (!idx || !proc) return null;
  const p = norm(proc.p);
  const b = base(p);
  if (!b.endsWith('.exe') || NOT_GAME.test(b) || SHELL.has(b)) return null;
  for (const d of idx.dirs) {
    if (p.startsWith(`${d.dir}/`)) return game(d.appId, idx, d.name);
  }
  for (const r of idx.roots) {
    if (!p.startsWith(`${r}/`)) continue;
    const folder = p.slice(r.length + 1).split('/')[0];
    if (!folder || folder.startsWith('.') || p.slice(r.length + 1).indexOf('/') < 0) return null;
    return game(appIdOf(folder), idx);
  }
  if (byPid && proc.pp) {
    const parent = byPid.get(Number(proc.pp));
    const grand = parent && byPid.get(Number(parent.pp));
    if (parent && base(parent.p) === 'cmd.exe' && grand && base(grand.p) === 'hyperfocus.exe') {
      return { key: `hf:exe:${b}`, name: prettify(b), image: HF_ICON, source: 'hyperfocus' };
    }
  }
  return null;
}

async function loadIndex(cacheFile) {
  const appData = process.env.APPDATA || '';
  const local = process.env.LOCALAPPDATA || '';
  const hf = path.join(appData, 'Hyperfocus');
  let remote = null;
  try {
    const st = fs.statSync(cacheFile);
    if (Date.now() - st.mtimeMs < 6 * 3600e3) remote = readJson(cacheFile);
  } catch {  }
  if (!remote) {
    try {
      const r = await fetch(`${MANIFEST}?t=${Date.now()}`, { headers: { 'User-Agent': 'Glint (Windows)' }, signal: AbortSignal.timeout(10000) });
      if (r.ok) { const text = await r.text(); remote = JSON.parse(text.replace(/^﻿/, '')); fs.writeFileSync(cacheFile, JSON.stringify(remote)); }
    } catch { remote = readJson(cacheFile); }
  }
  return buildIndex({
    settings: readJson(path.join(hf, 'settings.json')),
    installed: readJson(path.join(hf, 'installed.json')),
    installedBetas: readJson(path.join(hf, 'installed-betas.json')),
    manifestCache: readJson(path.join(hf, 'manifest-cache.json')),
    remote, localAppData: local, appData,
  });
}

module.exports = { buildIndex, match, loadIndex, prettify, HF_ICON };
