const { mixPlan, normalizeTracks } = require('./tracks');
const { cropFilter } = require('./crop');

const PRESETS = {
  original: { label: 'Original', maxH: 0, fps: 0, kbps: 0, audioK: 160, note: 'No re-encode unless the trim or the track mix needs one' },
  high: { label: 'High', maxH: 1440, fps: 0, kbps: 12000, audioK: 160, note: 'Up to 1440p, ~12 Mbps' },
  balanced: { label: 'Balanced', maxH: 1080, fps: 0, kbps: 6000, audioK: 128, note: '1080p, ~6 Mbps' },
  small: { label: 'Small', maxH: 720, fps: 0, kbps: 3000, audioK: 128, note: '720p, ~3 Mbps' },
  tiny: { label: 'Tiny', maxH: 720, fps: 30, kbps: 1200, audioK: 96, note: '720p 30 fps, ~1.2 Mbps' },
  custom: { label: 'Custom', note: 'Your own resolution, frame rate and quality' },
};
const PRESET_IDS = Object.keys(PRESETS);
const AUDIO_K = [96, 128, 160, 192];
const DEFAULT_CUSTOM = { maxH: 1080, fps: 60, quality: 60, audioK: 128 };
const even = n => Math.max(2, Math.round(n / 2) * 2);

function cleanCustom(c) {
  const r = c && typeof c === 'object' ? c : {};
  return {
    maxH: [0, 480, 720, 1080, 1440].includes(Number(r.maxH)) ? Number(r.maxH) : DEFAULT_CUSTOM.maxH,
    fps: Number(r.fps) === 30 ? 30 : 60,
    quality: Math.max(0, Math.min(100, Math.round(Number.isFinite(Number(r.quality)) ? Number(r.quality) : DEFAULT_CUSTOM.quality))),
    audioK: AUDIO_K.includes(Number(r.audioK)) ? Number(r.audioK) : DEFAULT_CUSTOM.audioK,
  };
}
function baseKbps(height) { return height >= 1440 ? 14000 : height >= 1080 ? 8000 : height >= 720 ? 4000 : 2000; }

function plan(presetId, src, custom) {
  const id = PRESET_IDS.includes(presetId) ? presetId : 'balanced';
  const p = id === 'custom' ? { ...PRESETS.custom, ...cleanCustom(custom) } : PRESETS[id];
  const sw = Number(src?.width) || 1920, sh = Number(src?.height) || 1080, sfps = Number(src?.fps) || 60;
  const h = p.maxH && p.maxH < sh ? p.maxH : sh;
  const w = h === sh ? even(sw) : even((sw * h) / sh);
  const fps = p.fps && p.fps < sfps - 1 ? p.fps : Math.round(sfps) >= 50 ? 60 : Math.round(sfps) || 60;
  const fpsK = fps >= 50 ? 1 : 0.65;
  if (id === 'original') {
    const srcK = Math.max(1500, Number(src?.kbps) || 12000);
    return { id, label: p.label, width: even(sw), height: even(sh), fps, scaled: false, videoKbps: Math.max(1000, srcK - 160), maxKbps: Math.round(srcK * 1.5), audioK: 160, original: true };
  }
  let videoKbps, maxKbps, quality = null;
  if (id === 'custom') {
    quality = p.quality;
    videoKbps = Math.round(baseKbps(h) * fpsK * (0.3 + (quality / 100) * 1.2));
    maxKbps = Math.round(videoKbps * 1.6);
  } else {
    const full = (p.maxH * 16) / 9 * p.maxH;
    const ratio = Math.max(0.45, Math.min(1, (w * h) / full));
    videoKbps = Math.round(p.kbps * fpsK * ratio);
    const srcVideoK = Number(src?.kbps) ? Number(src.kbps) - 160 : Infinity;
    videoKbps = Math.max(400, Math.min(videoKbps, srcVideoK));
    maxKbps = Math.round(videoKbps * 1.25);
  }
  return { id, label: p.label, width: w, height: h, fps, scaled: h !== sh, videoKbps, maxKbps, audioK: p.audioK, quality, original: false };
}

const cqOf = q => Math.round(34 - (q / 100) * 16);
const crfOf = q => Math.round(32 - (q / 100) * 14);

function videoEncoderArgs(encoder, pl) {
  const b = `${pl.videoKbps}k`, max = `${pl.maxKbps}k`, buf = `${pl.maxKbps * 2}k`, gop = String(pl.fps * 2);
  const custom = pl.quality != null;
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', ...(custom ? ['-cq', String(cqOf(pl.quality)), '-b:v', '0'] : ['-b:v', b]), '-maxrate', max, '-bufsize', buf, '-spatial-aq', '1', '-bf', '2', '-g', gop, '-profile:v', 'high'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', ...(custom ? ['-rc', 'cqp', '-qp_i', String(cqOf(pl.quality)), '-qp_p', String(cqOf(pl.quality) + 2)] : ['-rc', 'vbr_peak', '-b:v', b]), '-maxrate', max, '-bufsize', buf, '-g', gop, '-profile:v', 'high'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', ...(custom ? ['-global_quality', String(cqOf(pl.quality))] : ['-b:v', b]), '-maxrate', max, '-bufsize', buf, '-g', gop, '-profile:v', 'high'];
    default:
      return ['-c:v', 'libx264', '-preset', 'medium', ...(custom ? ['-crf', String(crfOf(pl.quality))] : ['-b:v', b]), '-maxrate', max, '-bufsize', buf, '-g', gop, '-pix_fmt', 'yuv420p'];
  }
}

/**
 * The compressed render.
 * o = { src, out, preset, custom, source: {width,height,fps,kbps}, duration, trim, crop, audioTracks, encoder, gpu, draft }
 * crop: applied first (public / unlisted only - drafts keep the original frame), the preset scales from the cropped size
 * draft: full length, every audio track kept (re-encoded at the preset's audio bitrate, titles carried over)
 */
function compressArgs(o) {
  const crop = !o.draft && o.crop ? o.crop : null;
  const pl = plan(o.preset, crop ? { ...o.source, width: crop.w, height: crop.h } : o.source, o.custom);
  const enc = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'].includes(o.encoder) ? o.encoder : 'libx264';
  const cuda = o.gpu !== false && enc === 'h264_nvenc';
  const cudaFrames = cuda && !crop;
  const d3d = o.gpu !== false && !cuda && enc !== 'libx264';
  const a = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  if (cudaFrames) a.push('-hwaccel', 'cuda', '-hwaccel_output_format', 'cuda');
  else if (cuda) a.push('-hwaccel', 'cuda');
  else if (d3d) a.push('-hwaccel', 'd3d11va');
  const d = Math.max(0, Number(o.duration) || 0);
  let start = 0, len = d;
  if (!o.draft && o.trim) {
    start = Math.max(0, Number(o.trim.in) || 0);
    len = Math.max(0.1, Math.min(d || Infinity, Number(o.trim.out) || d) - start);
  }
  if (start > 0) a.push('-ss', start.toFixed(3));
  a.push('-i', o.src);
  if (!o.draft && o.trim) a.push('-t', len.toFixed(3));
  const graph = [];
  let vmap = '0:v:0';
  const pre = crop ? `${cropFilter(crop)},` : '';
  if (pl.scaled) {
    graph.push(cudaFrames ? `[0:v:0]scale_cuda=${pl.width}:${pl.height}[vout]` : `[0:v:0]${pre}scale=${pl.width}:${pl.height}:flags=bicubic,format=${enc === 'h264_qsv' ? 'nv12' : 'yuv420p'}[vout]`);
    vmap = '[vout]';
  } else if (crop || (!cuda && enc !== 'libx264')) {
    graph.push(`[0:v:0]${pre}format=${enc === 'h264_qsv' ? 'nv12' : 'yuv420p'}[vout]`);
    vmap = '[vout]';
  }
  const aArgs = [];
  if (o.draft) {
    a.push(...(graph.length ? ['-filter_complex', graph.join(';')] : []), '-map', vmap, '-map', '0:a?');
    aArgs.push('-c:a', 'aac', '-b:a', `${pl.audioK}k`);
  } else {
    const m = mixPlan(o.audioTracks ? normalizeTracks(o.audioTracks) : [{ index: 0, enabled: true, volume: 1 }]);
    if (m.filter) graph.push(m.filter);
    if (graph.length) a.push('-filter_complex', graph.join(';'));
    a.push('-map', vmap);
    if (m.none) aArgs.push('-an');
    else { a.push('-map', m.label || m.map); aArgs.push('-c:a', 'aac', '-b:a', `${pl.audioK}k`); }
  }
  if (pl.fps && Number(o.source?.fps) && pl.fps < Number(o.source.fps) - 1) a.push('-r', String(pl.fps), '-fps_mode', 'cfr');
  a.push(...videoEncoderArgs(enc, pl), ...aArgs, '-movflags', '+faststart', o.out);
  return { args: a, plan: pl, length: len };
}

function estimate(o) {
  const pl = plan(o.preset, !o.draft && o.crop ? { ...o.source, width: o.crop.w, height: o.crop.h } : o.source, o.custom);
  const d = Math.max(0, Number(o.duration) || 0);
  const len = !o.draft && o.trim ? Math.max(0, Math.min(d, Number(o.trim.out) || d) - Math.max(0, Number(o.trim.in) || 0)) : d;
  const fileSize = Number(o.fileSize) || 0;
  const originalBytes = fileSize && d ? Math.round(fileSize * (len / d)) : Math.round(((Number(o.source?.kbps) || 12000) * 1000 * len) / 8);
  if (pl.original) return { bytes: originalBytes, originalBytes, saves: 0, plan: pl };
  const tracks = o.draft ? Math.max(1, Number(o.audioTrackCount) || 1) : 1;
  const bytes = Math.round((((pl.videoKbps + pl.audioK * tracks) * 1000) / 8) * len * 1.02);
  return { bytes, originalBytes, saves: Math.max(0, originalBytes - bytes), plan: pl };
}

module.exports = { PRESETS, PRESET_IDS, AUDIO_K, DEFAULT_CUSTOM, cleanCustom, plan, videoEncoderArgs, compressArgs, estimate, cqOf, crfOf };
