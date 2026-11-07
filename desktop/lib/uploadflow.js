const tracks = require('./tracks');
const isCancel = e => !!e && (e.code === 'cancelled' || e.name === 'AbortError');

async function cleanupAfterCancel(api, state = {}) {
  const { mediaUrl, clipId } = state;
  if (clipId) {
    try { await api.deleteClip(clipId, true); return { deleted: 'clip' }; } catch {  }
  }
  if (!mediaUrl) return { deleted: null };
  try {
    const mine = await api.myClips();
    const c = (mine || []).find(x => x && x.videoUrl === mediaUrl);
    if (c) { await api.deleteClip(c.id, true); return { deleted: 'clip' }; }
  } catch {  }
  try {
    const list = await api.mediaList();
    const m = (list || []).find(u => u && u.url === mediaUrl);
    if (m) { await api.deleteMedia(m.id); return { deleted: 'media' }; }
  } catch {  }
  return { deleted: null };
}

function rate(samples, total) {
  const s = (samples || []).filter(x => Number.isFinite(x.t) && Number.isFinite(x.sent));
  if (s.length < 2) return { bps: 0, eta: null };
  const last = s[s.length - 1];
  const first = s.find(x => last.t - x.t <= 8000) || s[0];
  const dt = (last.t - first.t) / 1000;
  const bps = dt > 0 ? Math.max(0, (last.sent - first.sent) / dt) : 0;
  const left = Math.max(0, (Number(total) || 0) - last.sent);
  return { bps, eta: bps > 0 ? left / bps : null };
}

const plainTracks = list => tracks.normalizeTracks(list).map(t => ({ index: t.index, kind: t.kind, label: t.label, enabled: t.enabled, volume: t.volume }));
function draftEdits(c, remote) {
  const contractTracks = plainTracks;
  const kept = Array.isArray(c.upload?.keptTracks) ? c.upload.keptTracks : null;
  const local = { trim: c.trim, crop: c.crop || null, audioTracks: tracks.normalizeTracks(c.audioTracks).map(t => (kept && !kept.includes(t.index) ? { ...t, enabled: false } : t)), fromWeb: false };
  if (!remote) return local;
  const rTrim = remote.trim && Number.isFinite(Number(remote.trim.start)) ? { in: Number(remote.trim.start), out: Number(remote.trim.end) } : null;
  const rTracks = Array.isArray(remote.audioTracks) && remote.audioTracks.length ? contractTracks(remote.audioTracks) : null;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const sentTrim = c.upload?.sentTrim ?? null, sentTracks = Array.isArray(c.upload?.sentTracks) ? plainTracks(c.upload.sentTracks) : null;
  const trimEdited = remote.trim !== undefined && !same(remote.trim ?? null, sentTrim);
  const tracksEdited = rTracks && !same(rTracks, sentTracks);
  const cropEdited = remote.crop !== undefined && !same(remote.crop ?? null, c.upload?.sentCrop ?? null);
  return {
    trim: trimEdited ? rTrim : local.trim,
    crop: cropEdited ? remote.crop || null : local.crop,
    audioTracks: tracksEdited ? tracks.normalizeTracks(local.audioTracks.map(t => { const r = rTracks.find(x => (kept ? kept[x.index] : x.index) === t.index); return r ? { ...t, enabled: r.enabled, volume: r.volume } : t; })) : local.audioTracks,
    fromWeb: !!(trimEdited || tracksEdited || cropEdited),
  };
}

function draftSyncPayload(c, fns) {
  const u = c?.upload;
  if (!u?.id || u.visibility !== 'draft' || u.status === 'rendering') return null;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  let trim = fns.contractTrim(c.trim, c.duration);
  const kept = Array.isArray(u.keptTracks) ? u.keptTracks : null;
  const at = kept ? (kept.length ? fns.contractTracks(tracks.keptView(c.audioTracks, kept)) : []) : fns.contractTracks(c.audioTracks);
  const prevTrim = u.sentTrim ?? null;
  if (!trim && prevTrim && Number(c.duration) > 0) trim = { start: 0, end: Math.round(Number(c.duration) * 100) / 100 };
  const body = {};
  if (trim && !same(trim, prevTrim)) body.trim = trim;
  if (at.length && !same(plainTracks(at), u.sentTracks == null ? null : plainTracks(u.sentTracks))) body.audioTracks = at;
  const crop = c.crop || null, prevCrop = u.sentCrop ?? null;
  if (!same(crop, prevCrop)) body.crop = crop;
  if (!Object.keys(body).length) return null;
  return { body, sentTrim: body.trim ?? prevTrim, sentTracks: body.audioTracks ?? u.sentTracks ?? null, sentCrop: 'crop' in body ? body.crop : prevCrop };
}

module.exports = { cleanupAfterCancel, rate, isCancel, draftEdits, draftSyncPayload, plainTracks };
