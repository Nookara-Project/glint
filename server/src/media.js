const { spawn } = require('child_process');

let lastPeakKb = 0;

function run(cfg, bin, args, { onLine, timeoutMs = 60 * 60_000 } = {}) {
  const fs = require('fs');
  return new Promise((resolve, reject) => {
    const cmd = cfg.nice ? 'nice' : bin;
    const argv = cfg.nice ? ['-n', String(cfg.nice), bin, ...args] : args;
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    try { fs.writeFileSync(`/proc/${p.pid}/oom_score_adj`, '1000'); } catch {}
    let peak = 0;
    const poll = process.platform === 'linux' ? setInterval(() => {
      try {
        const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p.pid}/status`, 'utf8'));
        if (m && Number(m[1]) > peak) peak = Number(m[1]);
      } catch {}
    }, 200) : null;
    let out = '', err = '', buf = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', d => {
      const s = d.toString();
      if (out.length < 2e6) out += s;
      if (onLine) { buf += s; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); } }
    });
    p.stderr.on('data', d => { err = (err + d.toString()).slice(-4000); });
    p.on('error', e => { clearTimeout(t); if (poll) clearInterval(poll); reject(e); });
    p.on('close', (code, signal) => {
      clearTimeout(t); if (poll) clearInterval(poll);
      lastPeakKb = peak;
      if (code === 0) resolve(out);
      else {
        const why = signal ? `killed by ${signal}${signal === 'SIGKILL' ? ' (out of memory or timeout)' : ''}` : `exited ${code}`;
        const e = new Error(`${bin} ${why}: ${err.trim().split('\n').slice(-3).join(' | ')}`);
        e.code = 'ffmpeg_failed'; e.signal = signal; e.peakKb = peak;
        reject(e);
      }
    });
  });
}

const DEC = ['-nostdin', '-threads', '2'];
const X264 = th => ['-threads', String(th), '-x264-params', 'rc-lookahead=10:sync-lookahead=0:lookahead-threads=1'];

async function probe(cfg, file) {
  const out = await run({ ...cfg, nice: 0 }, cfg.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { timeoutMs: 60_000 });
  const j = JSON.parse(out);
  const streams = j.streams || [];
  const v = streams.find(s => s.codec_type === 'video');
  const DEFAULT_HANDLERS = /^(sound ?handler|sound media handler|core media audio|isomedia file produced.*|)$/i;
  const audio = streams.filter(s => s.codec_type === 'audio').map((s, i) => {
    const t = s.tags || {};
    const h = t.handler_name && !DEFAULT_HANDLERS.test(t.handler_name.trim()) ? t.handler_name.trim() : null;
    return { index: i, title: t.title || t.TITLE || h || null };
  });
  let fps = 30;
  if (v && v.avg_frame_rate && v.avg_frame_rate.includes('/')) {
    const [a, b] = v.avg_frame_rate.split('/').map(Number);
    if (a > 0 && b > 0) fps = a / b;
  }
  return {
    duration: Number(j.format && j.format.duration) || Number(v && v.duration) || 0,
    width: v ? v.width : 0, height: v ? v.height : 0, fps, hasVideo: !!v, audio,
  };
}

async function buildProxies(cfg, src, dir, info, onProgress) {
  const path = require('path');
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...DEC, '-i', src,
    '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', "scale=-2:'min(720,ih)',format=yuv420p",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-maxrate', '2500k', '-bufsize', '5000k',
    '-force_key_frames', 'expr:gte(t,n_forced*1)', '-sc_threshold', '0', ...X264(cfg.ffThreads),
    '-movflags', '+faststart', path.join(dir, 'video.mp4')];
  for (const a of info.audio) {
    args.push('-map', `0:a:${a.index}`, '-vn', '-sn', '-dn', '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', path.join(dir, `a${a.index}.m4a`));
  }
  await run(cfg, cfg.ffmpeg, args, { onLine: progressParser(info.duration, onProgress) });
  const n = 10;
  const rate = `${n * 1000}/${Math.max(1000, Math.round(info.duration * 1000))}`;
  await run(cfg, cfg.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...DEC, '-i', path.join(dir, 'video.mp4'),
    '-vf', `fps=${rate},scale=192:-2,tile=${n}x1`, '-frames:v', '1', '-q:v', '5', path.join(dir, 'strip.jpg')]).catch(() => {});
}

function progressParser(duration, onProgress) {
  return line => {
    if (!onProgress || !duration) return;
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
    if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / duration));
  };
}

function renderArgs(cfg, src, out, { trim, tracks, duration, crop }) {
  const start = trim ? trim.start : 0;
  const end = trim ? trim.end : duration;
  const trimmed = !!(trim && (start > 0.05 || end < duration - 0.05));
  const reencode = trimmed || !!crop;
  const len = Math.max(0.1, end - start);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...DEC];
  if (trimmed) args.push('-ss', start.toFixed(3), '-t', len.toFixed(3));
  args.push('-i', src);
  const on = tracks.filter(t => t.enabled && t.volume > 0);
  args.push('-map', '0:v:0');
  if (on.length) {
    const parts = on.map((t, i) => `[0:a:${t.index}]volume=${t.volume.toFixed(3)},aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
    let fc = parts.join(';');
    if (on.length > 1) fc += ';' + on.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${on.length}:normalize=0:duration=longest[aout]`;
    else fc = fc.replace(/\[a0\]$/, '[aout]');
    args.push('-filter_complex', fc, '-map', '[aout]', '-c:a', 'aac', '-b:a', '160k');
  } else args.push('-an');
  if (reencode) {
    const vf = (crop ? [`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`] : []).concat("scale=-2:'min(1440,ih)'").join(',');
    args.push('-vf', vf, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', ...X264(cfg.ffThreads));
  } else args.push('-c:v', 'copy');
  args.push('-sn', '-dn', '-map_metadata', '-1', '-movflags', '+faststart', out);
  return { args, duration: trimmed ? len : duration };
}

async function render(cfg, src, out, opts, onProgress) {
  const { args, duration } = renderArgs(cfg, src, out, opts);
  await run(cfg, cfg.ffmpeg, args, { onLine: progressParser(duration, onProgress) });
  return { duration };
}

async function thumbnail(cfg, video, out, at) {
  await run(cfg, cfg.ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...DEC, '-ss', String(Math.max(0, at)), '-i', video,
    '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out], { timeoutMs: 60_000 });
}

module.exports = { run, probe, buildProxies, render, renderArgs, thumbnail, peakKb: () => lastPeakKb };
