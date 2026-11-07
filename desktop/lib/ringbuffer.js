
function parseList(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([^,]+\.ts),(-?[\d.]+),(-?[\d.]+)\s*$/.exec(line.trim());
    if (!m) continue;
    const idx = /(\d+)\.ts$/.exec(m[1]);
    out.push({ file: m[1], index: idx ? Number(idx[1]) : out.length, start: Number(m[2]), end: Number(m[3]) });
  }
  return out.sort((a, b) => a.index - b.index);
}

function pickClip(segments, pressMs, lengthSec) {
  const segs = (segments || []).filter(s => s && s.end > s.start && Number.isFinite(s.wallEnd));
  if (!segs.length) return null;
  const want = Math.max(1, Number(lengthSec) || 30);
  let lastIdx = segs.findIndex(s => s.wallEnd >= pressMs);
  if (lastIdx < 0) lastIdx = segs.length - 1;
  const last = segs[lastIdx];
  const lastDur = last.end - last.start;
  const excessEnd = Math.min(lastDur, Math.max(0, (last.wallEnd - pressMs) / 1000));
  const picked = [];
  let total = 0;
  for (let i = lastIdx; i >= 0; i--) {
    const s = segs[i];
    if (picked.length && Math.abs(s.end - picked[0].start) > 0.5) break;
    picked.unshift(s);
    total += s.end - s.start;
    if (total - excessEnd >= want) break;
  }
  const trimOut = Math.max(0, total - excessEnd);
  const trimIn = Math.max(0, trimOut - want);
  return { segments: picked, total: round3(total), trimIn: round3(trimIn), trimOut: round3(trimOut) };
}

function filesToPrune(files, segments, keepSec) {
  const segs = (segments || []).slice().sort((a, b) => a.index - b.index);
  if (!segs.length) return [];
  let acc = 0, oldestKept = segs[segs.length - 1].index;
  for (let i = segs.length - 1; i >= 0; i--) {
    acc += segs[i].end - segs[i].start;
    oldestKept = segs[i].index;
    if (acc >= keepSec) break;
  }
  return (files || []).filter(f => {
    const m = /^seg_(\d+)\.ts$/.exec(f);
    return m && Number(m[1]) < oldestKept;
  });
}

function videoT0(segments, encoderDelayMs = 0) {
  let best = Infinity;
  for (const s of segments || []) if (Number.isFinite(s.wallEnd)) best = Math.min(best, s.wallEnd - s.end * 1000);
  return Number.isFinite(best) ? best - encoderDelayMs : null;
}
function encoderDelayMs(encoder, fps) {
  const frames = { h264_nvenc: 2, h264_amf: 2, h264_qsv: 3, libx264: 1 }[encoder] ?? 2;
  return (frames * 1000) / (Number(fps) || 60);
}
function audioShift(vT0, aT0, userOffsetMs = 0) {
  if (!Number.isFinite(vT0) || !Number.isFinite(aT0)) return round3((Number(userOffsetMs) || 0) / 1000);
  const skew = vT0 - aT0;
  if (Math.abs(skew) > 3000) return round3((Number(userOffsetMs) || 0) / 1000);
  return round3((-skew + (Number(userOffsetMs) || 0)) / 1000);
}
const round3 = n => Math.round(n * 1000) / 1000;

module.exports = { parseList, pickClip, filesToPrune, videoT0, encoderDelayMs, audioShift };
