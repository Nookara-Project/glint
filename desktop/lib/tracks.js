
const KINDS = ['game', 'mic', 'discord', 'fluxer', 'ember', 'app', 'desktop'];
const MAX_TRACKS = 8;
const LABELS = { app: 'App', game: 'Game', mic: 'Microphone', discord: 'Discord', fluxer: 'Fluxer', ember: 'Ember', desktop: 'Desktop audio', system: 'System audio' };
const APP_EXES = {
  discord: ['discord.exe', 'discordcanary.exe', 'discordptb.exe', 'discorddevelopment.exe'],
  fluxer: ['fluxer.exe', 'fluxercanary.exe', 'fluxer canary.exe', 'fluxerptb.exe'],
  ember: ['ember.exe', 'bonfire.exe'],
};
const gain = v => (Math.max(0, Math.min(400, Number.isFinite(Number(v)) ? Number(v) : 100)) / 100).toFixed(2);

function planTracks(s, gamePid) {
  const out = [];
  const add = (kind, src, vol = 100) => out.push({ kind, label: LABELS[kind], arg: `${kind}:${src}@${gain(vol)}` });
  const apps = s.audioApps || {};
  if (gamePid && s.audioGame !== false) add('game', `proc=${gamePid}:fallback`, s.sysVolume);
  if (s.mic) add('mic', `dev=${s.micDevice || 'default'}`, s.micVolume);
  for (const k of ['discord', 'fluxer', 'ember']) if (apps[k] !== false) add(k, `app=${APP_EXES[k].join(',')}`);
  const wantDesktop = !!(s.audioDesktop || !gamePid);
  for (const a of Array.isArray(s.audioCustomApps) ? s.audioCustomApps : []) {
    if (!a || a.enabled === false || !a.exe || /[@,]/.test(a.exe)) continue;
    if (out.length >= MAX_TRACKS - (wantDesktop ? 1 : 0)) break;
    out.push({ kind: 'app', label: String(a.name || a.exe).slice(0, 40), arg: `app:app=${a.exe}@${gain(a.volume ?? 100)}`, app: { exe: a.exe, name: String(a.name || a.exe).slice(0, 40) }, appId: a.id });
  }
  if (wantDesktop || !out.length) add('desktop', 'sys', gamePid ? 100 : s.sysVolume);
  return out.slice(0, MAX_TRACKS);
}

function applyStatus(plan, status) {
  const st = Array.isArray(status?.tracks) ? status.tracks : [];
  const tracks = plan.map((t, i) => ({ ...t, state: st[i]?.state || 'none', name: st[i]?.name || null }));
  const fellBack = tracks.some(t => t.kind === 'game' && t.state === 'system');
  for (const t of tracks) {
    if (t.kind === 'game' && t.state === 'system') t.label = LABELS.system;
    if (t.kind === 'desktop' && fellBack) t.dup = true;
  }
  return tracks;
}

function clipTracks(tracks, events, startMs, endMs) {
  const keep = [];
  tracks.forEach((t, i) => {
    if (t.dup || t.state === 'none') return;
    if (t.state === 'waiting' || t.state === 'app') {
      let on = t.state === 'app';
      let any = false;
      const ev = (events || []).filter(e => e.index === i).sort((a, b) => a.t - b.t);
      for (const e of ev) {
        if (e.t <= startMs) { on = e.on; continue; }
        if (e.t > endMs) break;
        if (on || e.on) any = true;
        on = e.on;
      }
      if (on || any) keep.push(i);
      return;
    }
    keep.push(i);
  });
  return keep;
}

function splitFilter(n) {
  if (n <= 1) return null;
  const outs = Array.from({ length: n }, (_, i) => `[s${i}]`).join('');
  const parts = [`[1:a]asplit=${n}${outs}`];
  for (let i = 0; i < n; i++) parts.push(`[s${i}]pan=stereo|c0=c${i * 2}|c1=c${i * 2 + 1}[t${i}]`);
  return parts.join(';');
}

function clipAudioTracks(tracks, keep) {
  return keep.map((ti, j) => ({ index: j, kind: tracks[ti].kind, label: tracks[ti].label, enabled: true, volume: 1, ...(tracks[ti].app ? { app: tracks[ti].app, appId: tracks[ti].appId } : {}) }));
}
function normalizeTracks(list, fallbackCount = 1) {
  if (!Array.isArray(list) || !list.length) return Array.from({ length: fallbackCount }, (_, i) => ({ index: i, kind: 'desktop', label: 'Audio', enabled: true, volume: 1 }));
  return list.filter(t => t && Number.isInteger(t.index) && t.index >= 0).slice(0, 8).map(t => ({
    index: t.index, kind: KINDS.includes(t.kind) ? t.kind : 'desktop', label: String(t.label || LABELS[t.kind] || 'Audio').slice(0, 40),
    enabled: t.enabled !== false, volume: Math.max(0, Math.min(2, Number.isFinite(Number(t.volume)) ? Number(t.volume) : 1)),
    ...(t.kind === 'app' && t.app && typeof t.app.exe === 'string' ? { app: { exe: String(t.app.exe).slice(0, 120), name: String(t.app.name || t.app.exe).slice(0, 40) }, ...(typeof t.appId === 'string' ? { appId: t.appId.slice(0, 40) } : {}) } : {}),
  }));
}

function mixPlan(audioTracks) {
  const on = normalizeTracks(audioTracks).filter(t => t.enabled && t.volume > 0);
  if (!on.length) return { none: true };
  if (on.length === 1 && Math.abs(on[0].volume - 1) < 0.001) return { map: `0:a:${on[0].index}`, copyable: true };
  if (on.length === 1) return { filter: `[0:a:${on[0].index}]volume=${on[0].volume.toFixed(2)}[aout]`, label: '[aout]' };
  const legs = on.map((t, i) => `[0:a:${t.index}]volume=${t.volume.toFixed(2)}[m${i}]`);
  return { filter: `${legs.join(';')};${on.map((_, i) => `[m${i}]`).join('')}amix=inputs=${on.length}:duration=longest:normalize=0[aout]`, label: '[aout]' };
}

const isVoice = t => !!t && ((t.kind !== 'game') || t.label === LABELS.system);

function uploadPlan(list, { states = null, stripVoice = false } = {}) {
  const all = normalizeTracks(list).map(t => {
    let enabled = t.enabled;
    if (states && Object.prototype.hasOwnProperty.call(states, t.index)) enabled = !!states[t.index];
    if (stripVoice && isVoice(t)) enabled = false;
    return { ...t, enabled };
  });
  const removed = all.filter(t => isVoice(t) && !t.enabled).map(t => t.index);
  const keep = all.filter(t => !removed.includes(t.index));
  return { tracks: all, removed, kept: keep.map(t => t.index), keptTracks: keep.map((t, j) => ({ ...t, index: j })) };
}
function keptView(list, kept) {
  return normalizeTracks(list).filter(t => kept.includes(t.index)).sort((a, b) => kept.indexOf(a.index) - kept.indexOf(b.index)).map((t, j) => ({ ...t, index: j }));
}

module.exports = { isVoice, uploadPlan, keptView, MAX_TRACKS, KINDS, LABELS, APP_EXES, planTracks, applyStatus, clipTracks, splitFilter, clipAudioTracks, normalizeTracks, mixPlan };
