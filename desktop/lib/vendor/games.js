// Game detection (for games that don't send Discord rich presence, like Roblox): every 20 s Bonfire looks at
// the programs running and matches them against
//   - Discord's own list of known games (the same one Discord uses: program names + official icons), and
//   - this PC's Steam library (any installed Steam game - Steam artwork; non-games like Wallpaper Engine skipped),
//   - Minecraft: Java edition (javaw running net.minecraft).
// The newest game started wins. Windows, and macOS (Discord's darwin program names, ps, Steam in ~/Library/Application Support).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { app } = require('electron');

const DETECTABLE = 'https://discord.com/api/v10/applications/detectable';
const NICE = { ROBLOX: 'Roblox', 'ARKNIGHTS: ENDFIELD': 'Arknights: Endfield' }; // display names Discord's list writes oddly
// Steam apps that run all day but aren't games (Steam's store still calls some of them "game")
const NOT_GAMES = new Set(['431960', '250820', '993090', '1905180', '365670', '228980', '1070560', '1391110', '1628350', '1493710', '2180100', '629520', '1118310', '1388770', '388080', '1422450', '2016440']);
const SKIP_EXE = /(crash|report|helper|launcher|updater|setup|install|unins|redist|vc_redist|dxsetup|easyanticheat|battleye|eac_|ue4prereq|webhelper|overlay)/i;
const MAC = process.platform === 'darwin';
const PS = `Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ i = $_.ProcessId; p = $(if ($_.ExecutablePath) { $_.ExecutablePath } else { $_.Name }); t = $(if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { '' }); c = $(if ($_.Name -like 'java*') { $_.CommandLine } else { $null }) } } | ConvertTo-Json -Compress`;

let onChange = () => {};
let enabled = true;
let timer = null;
let byExe = new Map();   // exe file name -> [{ suffix, args, id, name, icon }]
let byName = new Map();  // lowercased game name -> { id, icon } (icons for Steam games too)
let steam = [];          // [{ common: 'd:/steamlibrary/steamapps/common/', games: Map(installdir -> { appid, name }) }]
let steamTypes = {};     // appid -> 'game' | 'application' | ... (cached)
let current = null;      // { key, activity }
const file = n => path.join(app.getPath('userData'), n);
const norm = p => String(p || '').replace(/\\/g, '/').toLowerCase();

// ── Discord's list of known games (cached a day; ~25k games, only this OS's program names are kept) ──
async function loadKnown() {
  let list = null;
  try {
    const st = fs.statSync(file('games.json'));
    if (Date.now() - st.mtimeMs < 864e5) list = JSON.parse(fs.readFileSync(file('games.json'), 'utf8'));
  } catch { /* fetch it */ }
  if (!list) {
    try {
      const all = await fetch(DETECTABLE).then(r => (r.ok ? r.json() : null));
      if (Array.isArray(all)) {
        list = all.map(g => ({ id: g.id, name: g.name, icon: g.icon_hash || null,
          exes: (g.executables || []).filter(e => e.os === (MAC ? 'darwin' : 'win32') && !e.is_launcher).map(e => ({ name: e.name, args: e.arguments || null })) })).filter(g => g.exes.length);
        fs.writeFileSync(file('games.json'), JSON.stringify(list));
      }
    } catch { /* try the old copy */ }
    if (!list) { try { list = JSON.parse(fs.readFileSync(file('games.json'), 'utf8')); } catch { list = []; } }
  }
  const ex = new Map(), nm = new Map();
  for (const g of list) {
    const name = NICE[g.name] || g.name;
    nm.set(name.toLowerCase(), { id: g.id, icon: g.icon });
    for (const e of g.exes) {
      let n = norm(e.name);
      const viaArgs = n.startsWith('>');
      if (viaArgs) n = n.slice(1);
      const base = n.split('/').pop(); // macOS: 'roblox.app' (the bundle's folder name) or a plain program name like 'hl2_osx'
      if (!MAC && !base.endsWith('.exe')) continue;
      if (!ex.has(base)) ex.set(base, []);
      ex.get(base).push({ suffix: n.includes('/') ? n : null, args: viaArgs || e.args ? (e.args || '').toLowerCase() : null, id: g.id, name, icon: g.icon });
    }
  }
  byExe = ex; byName = nm;
}
const discordIcon = (id, icon) => (icon ? `https://cdn.discordapp.com/app-icons/${id}/${icon}.png?size=128` : null);

// ── this PC's Steam library ──
function regSteamPath() {
  if (MAC) { const d = path.join(app.getPath('home'), 'Library', 'Application Support', 'Steam'); return Promise.resolve(fs.existsSync(path.join(d, 'steamapps')) ? d : null); }
  return new Promise(ok => execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (e, out) => ok(e ? null : (/SteamPath\s+REG_SZ\s+(.+)/.exec(String(out)) || [])[1]?.trim() || null)));
}
async function loadSteam() {
  const root = await regSteamPath();
  if (!root) { steam = []; return; }
  let libs = [path.join(root, 'steamapps')];
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
    libs = [...new Set([...libs, ...[...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map(m => path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps'))])];
  } catch { /* just the main one */ }
  try { steamTypes = JSON.parse(fs.readFileSync(file('steam-types.json'), 'utf8')); } catch { steamTypes = {}; }
  const out = [];
  for (const lib of libs) {
    const games = new Map();
    let names = [];
    try { names = fs.readdirSync(lib).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of names) {
      try {
        const acf = fs.readFileSync(path.join(lib, f), 'utf8');
        const appid = (/"appid"\s+"(\d+)"/.exec(acf) || [])[1];
        const name = (/"name"\s+"([^"]+)"/.exec(acf) || [])[1];
        const dir = (/"installdir"\s+"([^"]+)"/.exec(acf) || [])[1];
        if (appid && name && dir) games.set(norm(dir), { appid, name });
      } catch { /* skip */ }
    }
    out.push({ common: `${norm(path.join(lib, 'common'))}/`, games });
  }
  steam = out;
  // which of these are games (Steam's store says) - asked once per app, remembered
  const unknown = out.flatMap(l => [...l.games.values()]).filter(g => !steamTypes[g.appid]).slice(0, 60);
  for (const g of unknown) {
    try {
      const d = await fetch(`https://store.steampowered.com/api/appdetails?appids=${g.appid}&filters=basic`).then(r => r.json());
      steamTypes[g.appid] = d?.[g.appid]?.success ? d[g.appid].data?.type || 'unknown' : 'unknown';
    } catch { /* next time */ }
  }
  try { fs.writeFileSync(file('steam-types.json'), JSON.stringify(steamTypes)); } catch { /* fine */ }
}

// ── what's running ──
// macOS: ps gives pid + command line (its `comm` column is cut to 16 characters, so the program's path comes from the command line)
// + how long each has run. The path may have spaces ('/Applications/World of Warcraft/...'): the shortest start of the command line that is a real file wins.
const psOut = args => new Promise(ok => execFile('/bin/ps', args, { maxBuffer: 16 << 20, timeout: 15000 }, (e, out) => ok(e ? '' : String(out))));
const elapsed = s => { const m = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/.exec(s.trim()); return m ? (((+m[1] || 0) * 24 + (+m[2] || 0)) * 60 + +m[3]) * 60 + +m[4] : 0; };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
function macProgram(cmd) {
  const first = cmd.split(' ')[0];
  if (!cmd.startsWith('/') || first === cmd || isFile(first)) return first;
  for (let i = cmd.indexOf(' ', first.length + 1), n = 0; i > 0 && n < 8; i = cmd.indexOf(' ', i + 1), n++) if (isFile(cmd.slice(0, i))) return cmd.slice(0, i);
  return isFile(cmd) ? cmd : first;
}
async function macProcesses() {
  const [main, ages] = await Promise.all([psOut(['-axww', '-o', 'pid=,args=']), psOut(['-axww', '-o', 'pid=,etime='])]);
  const since = new Map();
  for (const l of ages.split('\n')) { const m = /^\s*(\d+)\s+(\S+)/.exec(l); if (m) since.set(+m[1], Date.now() - elapsed(m[2]) * 1000); }
  const list = [];
  for (const l of main.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(l);
    if (m) list.push({ i: +m[1], p: macProgram(m[2]), t: since.has(+m[1]) ? new Date(since.get(+m[1])).toISOString() : '', c: m[2] });
  }
  return list;
}
function processes() {
  if (MAC) return macProcesses();
  return new Promise(ok => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', PS],
    { windowsHide: true, maxBuffer: 16 << 20, timeout: 15000 }, (e, out) => {
      if (e) return ok([]);
      try { const j = JSON.parse(String(out) || '[]'); ok(Array.isArray(j) ? j : [j]); } catch { ok([]); }
    }));
}
function match(pr) {
  const p = norm(pr.p);
  const base = p.split('/').pop();
  if (MAC ? /\/(discord[^/]*|ember|bonfire)\.app\//.test(p) : base === 'bonfire.exe' || base === 'discord.exe') return null;
  // Discord's list (Roblox, Minecraft Bedrock, Fortnite, Valorant, League, osu!...)
  // macOS: the program's name, or any '<name>.app' folder it runs from (the list names the bundle: 'roblox.app', 'osx64/dota2.app')
  for (const key of MAC ? [base, ...p.split('/').filter(s => s.endsWith('.app'))] : [base]) {
    for (const c of byExe.get(key) || []) {
      if (c.suffix && !(MAC && key.endsWith('.app') ? p.includes(`/${c.suffix}/`) : p.endsWith(`/${c.suffix}`)) && p !== c.suffix) continue;
      if (c.args && !String(pr.c || '').toLowerCase().includes(c.args)) continue;
      return { key: `d:${c.id}`, name: c.name, image: discordIcon(c.id, c.icon) };
    }
  }
  // Minecraft: Java edition (javaw.exe running the game - any launcher)
  if ((MAC ? /^javaw?$/ : /^javaw?\.exe$/).test(base) && /net\.minecraft|\.minecraft[\\/]/i.test(String(pr.c || ''))) {
    const mc = byName.get('minecraft');
    return { key: 'mc', name: 'Minecraft', image: mc ? discordIcon(mc.id, mc.icon) : null };
  }
  // a Steam game (its program is somewhere inside steamapps/common/<game>/)
  if (SKIP_EXE.test(base)) return null;
  for (const lib of steam) {
    if (!p.startsWith(lib.common)) continue;
    const dir = p.slice(lib.common.length).split('/')[0];
    const g = lib.games.get(dir);
    if (!g) return null;
    if (NOT_GAMES.has(String(g.appid))) return null;
    const d = byName.get(g.name.toLowerCase());
    // only real games: Steam's store says so, or (store doesn't know it) Discord knows it as a game. Not Wallpaper Engine, tools...
    const type = steamTypes[g.appid];
    if (!(['game', 'demo', 'mod'].includes(type) || (!type || type === 'unknown') && d)) return null;
    return { key: `s:${g.appid}`, name: g.name, image: d ? discordIcon(d.id, d.icon) : `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg` };
  }
  return null;
}
let gamePids = new Set(); // every running process of any detected game (the in-game overlay checks the foreground window against it)
async function scan() {
  if (!enabled) return;
  const list = await processes();
  let best = null;
  const pids = new Set();
  for (const pr of list) {
    const m = match(pr);
    if (!m) continue;
    if (pr.i) pids.add(Number(pr.i));
    const since = Date.parse(pr.t) || Date.now();
    if (!best || since > best.since) best = { ...m, since };
  }
  gamePids = pids;
  const key = best ? best.key : null;
  if (key === (current?.key || null)) { onPids(); return; }
  current = best ? { key, activity: { type: 'playing', name: best.name, details: '', state: '', image: best.image, icon: null, since: best.since } } : null;
  onChange(current ? current.activity : null);
  onPids();
}
let onPids = () => {};

async function start(opts) {
  onChange = opts.onChange || onChange;
  onPids = opts.onPids || onPids;
  enabled = opts.enabled !== false;
  if (process.platform !== 'win32' && !MAC) return;
  await loadKnown().catch(() => {});
  await loadSteam().catch(() => {});
  scan();
  timer = setInterval(scan, 20000);
  setInterval(() => loadSteam().catch(() => {}), 30 * 60 * 1000); // new installs
  setInterval(() => loadKnown().catch(() => {}), 24 * 3600 * 1000);
}
function setEnabled(on) {
  enabled = !!on;
  if (!enabled) { gamePids = new Set(); if (current) { current = null; onChange(null); } onPids(); }
  if (enabled) scan();
}
// for the in-game overlay: is this program (full path) a game we know? which processes are games right now?
const isGamePath = p => !!(p && match({ p, c: '' }));
module.exports = { start, setEnabled, stopAll: () => clearInterval(timer), isGamePath, pids: () => gamePids, current: () => (current ? { key: current.key, name: current.activity.name } : null), _match: match, _load: async () => { await loadKnown(); await loadSteam(); }, _scan: processes };
