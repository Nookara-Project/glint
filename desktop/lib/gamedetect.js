const EventEmitter = require('events');
const path = require('path');
const { app } = require('electron');
const ember = require('./vendor/games');
const hyperfocus = require('./hyperfocus');
const ff = require('./ff');

const norm = p => String(p || '').replace(/\\/g, '/').toLowerCase();
const base = p => norm(p).split('/').pop();
const SELF = new Set(['glint.exe', 'electron.exe']);

function matchCustom(proc, list) {
  const p = norm(proc.p), b = base(p);
  for (const g of list || []) {
    if (!g) continue;
    if (g.path ? norm(g.path) === p : g.exe && base(g.exe) === b) return { key: `c:${g.id}`, name: g.name, image: g.icon || null, source: 'custom' };
  }
  return null;
}
function matchAll(proc, ctx) {
  const b = base(proc.p);
  if (!b || SELF.has(b) || Number(proc.i) === process.pid) return null;
  return matchCustom(proc, ctx.custom) || hyperfocus.match(proc, ctx.hf, ctx.byPid) || (ctx.ember ? ctx.ember(proc) : null);
}

class GameDetect extends EventEmitter {
  constructor(getCustom) {
    super();
    this.getCustom = getCustom || (() => []);
    this.hf = null;
    this.current = null;
    this.procs = [];
    this.timer = null;
    this.emberReady = false;
  }
  async start() {
    await this.reloadLists();
    await this.scan();
    this.timer = setInterval(() => this.scan().catch(() => {}), 8000);
    setInterval(() => this.reloadLists().catch(() => {}), 30 * 60 * 1000);
  }
  async reloadLists() {
    try { await ember._load(); this.emberReady = true; } catch (e) { this.emit('log', `[games] Ember lists: ${e.message}`); }
    try { this.hf = await hyperfocus.loadIndex(path.join(app.getPath('userData'), 'hyperfocus-apps.json')); } catch (e) { this.emit('log', `[games] Hyperfocus: ${e.message}`); }
  }
  async scan() {
    let list;
    try { list = await ff.helper('procs'); } catch (e) { this.emit('log', `[games] process list: ${e.message}`); return; }
    if (!Array.isArray(list)) return;
    this.procs = list;
    const byPid = new Map(list.map(p => [Number(p.i), p]));
    const ctx = { custom: this.getCustom(), hf: this.hf, byPid, ember: this.emberReady ? ember._match : null };
    const found = new Map();
    for (const pr of list) {
      let m = null;
      try { m = matchAll(pr, ctx); } catch { m = null; }
      if (!m) continue;
      const since = Date.parse(pr.t) || Date.now();
      const g = found.get(m.key) || { ...m, pids: [], since };
      g.pids.push(Number(pr.i));
      g.since = Math.min(g.since, since);
      found.set(m.key, g);
    }
    for (const g of found.values()) {
      const set = new Set(g.pids), t = pid => Date.parse(byPid.get(pid)?.t) || 0;
      g.root = g.pids.filter(pid => !set.has(Number(byPid.get(pid)?.pp))).sort((x, y) => t(x) - t(y))[0] || g.pids[0];
    }
    let best = null;
    for (const g of found.values()) if (!best || g.since > best.since) best = g;
    const prevKey = this.current?.key || null;
    const pidsChanged = best && this.current && best.key === prevKey && best.pids.join() !== this.current.pids.join();
    this.current = best;
    this.running = [...found.values()];
    if ((best?.key || null) !== prevKey) this.emit('change', best);
    else if (pidsChanged) this.emit('pids', best);
  }
  windowed(opts) { return pickable(this.procs, opts); }
  stop() { clearInterval(this.timer); }
}

const JUNK = new Set(['explorer.exe', 'textinputhost.exe', 'applicationframehost.exe', 'systemsettings.exe', 'shellexperiencehost.exe',
  'searchhost.exe', 'startmenuexperiencehost.exe', 'lockapp.exe', 'taskmgr.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'conhost.exe',
  'windowsterminal.exe', 'openconsole.exe', 'mmc.exe', 'notepad.exe', 'ember.exe', 'bonfire.exe', 'discord.exe', 'discordcanary.exe',
  'discordptb.exe', 'fluxer.exe', 'hyperfocus.exe', 'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'chrome.exe', 'msedge.exe',
  'firefox.exe', 'samsunginternet.exe', 'brave.exe', 'opera.exe', 'zen.exe', 'spotify.exe', 'obs64.exe', 'code.exe', 'claude.exe',
  'whatsapp.root.exe', 'whatsapp.exe', 'nvidia app.exe', 'nvcontainer.exe', 'rtss.exe', 'msiafterburner.exe']);
const VOICE = new Set(['ember.exe', 'bonfire.exe', 'discord.exe', 'discordcanary.exe', 'discordptb.exe', 'fluxer.exe']);
function pickable(procs, opts = {}) {
  const seen = new Set();
  return (procs || [])
    .filter(p => p.w && /\.exe$/i.test(String(p.p)) && /[\\/]/.test(String(p.p)))
    .filter(p => !SELF.has(base(p.p)) && (opts.apps ? !VOICE.has(base(p.p)) && !/^(explorer|textinputhost|applicationframehost|systemsettings|shellexperiencehost|searchhost|startmenuexperiencehost|lockapp|cmd|conhost|openconsole)\.exe$/i.test(base(p.p)) : !JUNK.has(base(p.p))) && !/[\\/]windows[\\/]|[\\/]windowsapps[\\/]microsoft\./i.test(String(p.p)))
    .sort((a, b) => (Date.parse(b.t) || 0) - (Date.parse(a.t) || 0))
    .filter(p => { const k = norm(p.p); if (seen.has(k)) return false; seen.add(k); return true; })
    .map(p => ({ pid: p.i, path: p.p, title: String(p.title || '').slice(0, 120), name: hyperfocus.prettify(base(p.p)) }));
}

module.exports = { GameDetect, matchCustom, matchAll, pickable };
