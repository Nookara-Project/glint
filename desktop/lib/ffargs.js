
const ENCODERS = ['h264_nvenc', 'h264_amf', 'h264_qsv', 'libx264'];
const HEIGHTS = { 720: 720, 1080: 1080, 1440: 1440 };
const BITRATES = {
  720: { low: 4, medium: 6, high: 9, ultra: 14 },
  1080: { low: 8, medium: 12, high: 18, ultra: 28 },
  1440: { low: 14, medium: 20, high: 30, ultra: 45 },
  2160: { low: 25, medium: 35, high: 50, ultra: 80 },
};
const SEGMENT_SEC = 1;
const { splitFilter, mixPlan } = require('./tracks');
const { sourceFilter } = require('./capture');
const { cropFilter } = require('./crop');

const even = n => Math.max(2, Math.round(n / 2) * 2);

function targetSize(monW, monH, resolution) {
  const w = Math.max(2, Number(monW) || 1920), h = Math.max(2, Number(monH) || 1080);
  const want = HEIGHTS[String(resolution)] || 0;
  if (!want || want >= h) return { width: even(w), height: even(h), scaled: false };
  return { width: even((w * want) / h), height: want, scaled: true };
}

function bitrateKbps(height, fps, preset) {
  if (Number.isFinite(Number(preset)) && Number(preset) > 0) return Math.round(Number(preset) * 1000);
  const rows = Object.keys(BITRATES).map(Number).sort((a, b) => a - b);
  const row = rows.find(r => height <= r) || rows[rows.length - 1];
  const mbps = BITRATES[row][preset] || BITRATES[row].medium;
  return Math.round(mbps * 1000 * (Number(fps) >= 50 ? 1 : 0.65));
}

function encoderArgs(encoder, kbps, gop) {
  const b = `${kbps}k`, max = `${Math.round(kbps * 1.5)}k`, buf = `${kbps * 2}k`;
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', String(gop), '-bf', '0', '-forced-idr', '1', '-no-scenecut', '1', '-profile:v', 'high'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'balanced', '-rc', 'vbr_peak', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', String(gop), '-bf', '0', '-profile:v', 'high'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', String(gop), '-bf', '0', '-profile:v', 'high'];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-b:v', b, '-maxrate', max, '-bufsize', buf, '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-bf', '0', '-pix_fmt', 'yuv420p'];
  }
}

const CHAINS = { h264_nvenc: ['direct', 'download'], h264_amf: ['direct', 'hwmap', 'download'], h264_qsv: ['hwmap', 'download'], libx264: ['download'] };
function captureFilter(encoder, size, chain) {
  const pix = encoder === 'libx264' ? 'yuv420p' : 'nv12';
  const c = (CHAINS[encoder] || CHAINS.libx264).includes(chain) ? chain : (CHAINS[encoder] || CHAINS.libx264)[0];
  if (size.scaled) return `hwdownload,format=bgra,scale=${size.width}:${size.height}:flags=fast_bilinear,format=${pix}`;
  if (c === 'direct') return null;
  if (c === 'hwmap') return encoder === 'h264_qsv' ? 'hwmap=derive_device=qsv,format=qsv' : 'hwmap=derive_device=amf,format=amf';
  return `hwdownload,format=bgra,format=${pix}`;
}
function probeCaptureArgs(encoder, chain, outputIdx = 0) {
  const vf = captureFilter(encoder, { scaled: false }, chain);
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', `ddagrab=output_idx=${Math.max(0, outputIdx | 0)}:framerate=30:dup_frames=1`,
    '-t', '1.2', ...(vf ? ['-vf', vf] : []), '-r', '30', '-fps_mode', 'cfr', ...encoderArgs(encoder, 4000, 30), '-an', '-f', 'null', '-'];
}

function captureArgs(o) {
  const fps = Number(o.fps) >= 50 ? 60 : 30;
  const cap = o.cap || { mode: 'monitor', outputIdx: o.outputIdx, width: o.monW, height: o.monH };
  const size = targetSize(cap.width || o.monW, cap.height || o.monH, o.resolution);
  const kbps = bitrateKbps(size.height, fps, o.bitrate);
  const gop = fps * SEGMENT_SEC;
  const n = Math.max(0, Math.min(8, Number(o.audioTracks ?? (o.audio ? 1 : 0)) | 0));
  const a = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-stats_period', '1', '-progress', 'pipe:2',
    '-f', 'lavfi', '-i', sourceFilter({ ...cap, outputIdx: cap.outputIdx ?? o.outputIdx }, fps, o.cursor)];
  if (n) {
    const off = Number(o.audioOffsetMs) || 0;
    if (off) a.push('-itsoffset', (off / 1000).toFixed(3));
    a.push('-thread_queue_size', '1024', '-f', 'f32le', '-ar', '48000', '-ac', String(2 * n), '-i', 'pipe:0');
  }
  const vf = captureFilter(o.encoder, size, o.chain);
  const graph = [];
  if (vf) graph.push(`[0:v]${vf}[v]`);
  if (n > 1) graph.push(splitFilter(n));
  if (graph.length) a.push('-filter_complex', graph.join(';'));
  a.push('-map', vf ? '[v]' : '0:v', '-r', String(fps), '-fps_mode', 'cfr', ...encoderArgs(o.encoder, kbps, gop),
    '-force_key_frames', `expr:gte(t,n_forced*${SEGMENT_SEC})`);
  if (n === 1) a.push('-map', '1:a');
  for (let i = 0; n > 1 && i < n; i++) a.push('-map', `[t${i}]`);
  if (n) a.push('-c:a', 'aac', '-b:a', '160k', '-ar', '48000');
  a.push('-f', 'segment', '-segment_time', String(SEGMENT_SEC), '-segment_time_delta', '0.05', '-segment_format', 'mpegts',
    '-segment_list', 'list.csv', '-segment_list_type', 'csv', '-segment_list_size', String(Math.max(10, o.listSize | 0 || 200)),
    'seg_%06d.ts');
  return { args: a, size, kbps, fps };
}

function concatArgs(listFile, out, opts = {}) {
  if (typeof opts === 'number') opts = { audioShift: opts };
  const shift = Number(opts.audioShift) || 0;
  const a = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile];
  if (shift) a.push('-itsoffset', shift.toFixed(3), '-f', 'concat', '-safe', '0', '-i', listFile);
  const src = shift ? 1 : 0;
  a.push('-map', '0:v');
  if (Array.isArray(opts.audio)) {
    opts.audio.forEach(t => a.push('-map', `${src}:a:${t.stream}`));
    opts.audio.forEach((t, j) => { if (t.title) a.push(`-metadata:s:a:${j}`, `title=${t.title}`, `-metadata:s:a:${j}`, `handler_name=${t.title}`); });
  } else a.push('-map', `${src}:a?`);
  a.push('-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', out);
  return a;
}
const concatList = files => files.map(f => "file '" + String(f).replace(/\\/g, '/').split("'").join("'\\''") + "'").join('\n') + '\n';

function isFullTrim(trim, duration) {
  if (!trim) return true;
  const d = Number(duration) || 0;
  return (Number(trim.in) || 0) <= 0.05 && (trim.out == null || Number(trim.out) >= d - 0.05);
}
function trimRange(trim, duration) {
  const d = Math.max(0, Number(duration) || 0);
  let a = Math.max(0, Number(trim?.in) || 0), b = trim?.out == null ? d : Math.min(d || Infinity, Number(trim.out));
  if (!(b > a)) { a = 0; b = d; }
  return { start: a, end: b, length: Math.max(0, b - a) };
}
const sec = n => Number(n).toFixed(3);
function audioOut(audioTracks, copyOk) {
  const aac = ['-c:a', 'aac', '-b:a', '160k'];
  if (!audioTracks) return { maps: ['-map', '0:a?'], filter: null, codec: copyOk ? ['-c:a', 'copy'] : aac };
  const m = mixPlan(audioTracks);
  if (m.none) return { maps: [], filter: null, codec: ['-an'] };
  if (m.map) return { maps: ['-map', m.map], filter: null, codec: copyOk ? ['-c:a', 'copy'] : aac };
  return { maps: ['-map', m.label], filter: m.filter, codec: aac };
}

function exportMp4Args(o) {
  const r = trimRange(o.trim, o.duration);
  const head = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y'];
  if (isFullTrim(o.trim, o.duration) && !o.crop) {
    const au = audioOut(o.audioTracks, true);
    return [...head, '-i', o.src, ...(au.filter ? ['-filter_complex', au.filter] : []), '-map', '0:v:0', ...au.maps, '-c:v', 'copy', ...au.codec, '-movflags', '+faststart', o.out];
  }
  const kbps = Math.max(1500, Math.min(60000, Number(o.kbps) || 12000));
  const enc = ENCODERS.includes(o.encoder) ? o.encoder : 'libx264';
  const v = encoderArgs(enc, kbps, 120).filter((x, i, arr) => !(arr[i - 1] === '-forced-idr' || x === '-forced-idr'));
  const au = audioOut(o.audioTracks, false);
  const graph = [...(o.crop ? [`[0:v:0]${cropFilter(o.crop)}[vout]`] : []), ...(au.filter ? [au.filter] : [])];
  const trimmed = !isFullTrim(o.trim, o.duration);
  return [...head, ...(trimmed ? ['-ss', sec(r.start)] : []), '-i', o.src, ...(trimmed ? ['-t', sec(r.length)] : []), ...(graph.length ? ['-filter_complex', graph.join(';')] : []),
    '-map', o.crop ? '[vout]' : '0:v:0', ...au.maps, ...(enc === 'libx264' ? [] : ['-pix_fmt', enc === 'h264_qsv' ? 'nv12' : 'yuv420p']), ...v,
    ...au.codec, '-movflags', '+faststart', o.out];
}
function exportMp3Args(o) {
  const r = trimRange(o.trim, o.duration);
  const au = audioOut(o.audioTracks || null, false);
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', ...(r.start > 0 ? ['-ss', sec(r.start)] : []), '-i', o.src,
    '-t', sec(r.length), ...(au.filter ? ['-filter_complex', au.filter] : []), ...au.maps, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', o.out];
}
function demuxTracksArgs(src, outs) {
  const a = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', src];
  outs.forEach((out, k) => a.push('-map', `0:a:${k}`, '-vn', '-c', 'copy', '-movflags', '+faststart', out));
  return a;
}
function keepTracksArgs(src, out, kept) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', src, '-map', '0:v:0', ...kept.flatMap(k => ['-map', `0:a:${k}`]), '-c', 'copy', '-movflags', '+faststart', out];
}
function thumbArgs(src, atSec, out, width = 480, quality = 4, crop = null) {
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-ss', sec(Math.max(0, atSec)), '-i', src, '-frames:v', '1',
    '-vf', `${crop ? `${cropFilter(crop)},` : ''}scale=${width}:-2`, '-q:v', String(quality), out];
}
function filmstripArgs(src, duration, out, count = 12, height = 72) {
  const d = Math.max(0.5, Number(duration) || 1);
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-i', src, '-frames:v', '1',
    '-vf', `fps=${(count / d).toFixed(5)},scale=-2:${height},tile=${count}x1`, '-q:v', '5', out];
}
function probeEncoderArgs(encoder) {
  const pre = encoder === 'h264_qsv' ? ['-vf', 'format=nv12'] : ['-pix_fmt', 'yuv420p'];
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30:d=0.5', ...pre, '-c:v', encoder, '-frames:v', '10', '-f', 'null', '-'];
}

function parseProbe(text) {
  const s = String(text || '');
  const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  const v = /Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d{2,5})x(\d{2,5})/.exec(s);
  return {
    duration: d ? (+d[1]) * 3600 + (+d[2]) * 60 + parseFloat(d[3]) : 0,
    width: v ? +v[1] : 0,
    height: v ? +v[2] : 0,
    hasAudio: /Stream #\d+:\d+[^\n]*Audio:/.test(s),
    fps: (() => { const m = /Stream #\d+:\d+[^\n]*Video:[^\n]*?(\d+(?:\.\d+)?) fps/.exec(s); return m ? Number(m[1]) : 0; })(),
    audioStreams: (s.match(/Stream #\d+:\d+[^\n]*Audio:/g) || []).length,
  };
}

module.exports = { keepTracksArgs, CHAINS, probeCaptureArgs, ENCODERS, SEGMENT_SEC, BITRATES, targetSize, bitrateKbps, encoderArgs, captureFilter, captureArgs, concatArgs, concatList, isFullTrim, trimRange, exportMp4Args, exportMp3Args, demuxTracksArgs, thumbArgs, filmstripArgs, probeEncoderArgs, parseProbe };
