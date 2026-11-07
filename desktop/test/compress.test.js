const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../lib/compress');

const SRC = { width: 2560, height: 1440, fps: 59.99, kbps: 20700 };
const at = (args, flag) => args[args.indexOf(flag) + 1];

test('preset plans: resolution / fps caps, never upscale, never more bitrate than the source', () => {
  assert.deepEqual(['width', 'height', 'fps', 'videoKbps', 'audioK'].map(k => c.plan('balanced', SRC)[k]), [1920, 1080, 60, 6000, 128]);
  assert.deepEqual(['width', 'height', 'videoKbps'].map(k => c.plan('high', SRC)[k]), [2560, 1440, 12000]);
  const tiny = c.plan('tiny', SRC);
  assert.deepEqual([tiny.height, tiny.fps, tiny.videoKbps, tiny.audioK], [720, 30, 780, 96]);
  const small720 = c.plan('high', { width: 1280, height: 720, fps: 60, kbps: 5000 });
  assert.equal(small720.scaled, false);
  assert.ok(small720.videoKbps <= 4840 && small720.videoKbps >= 400);
  assert.equal(c.plan('nonsense', SRC).id, 'balanced');
  assert.equal(c.plan('original', SRC).original, true);
  const cu = c.plan('custom', SRC, { maxH: 720, fps: 30, quality: 100, audioK: 192 });
  assert.deepEqual([cu.height, cu.fps, cu.audioK, cu.quality], [720, 30, 192, 100]);
});

test('preset -> ffmpeg args per encoder (VBR + maxrate; custom = CQ / CRF)', () => {
  const pl = c.plan('balanced', SRC);
  const nv = c.videoEncoderArgs('h264_nvenc', pl);
  assert.deepEqual([at(nv, '-c:v'), at(nv, '-rc'), at(nv, '-b:v'), at(nv, '-maxrate')], ['h264_nvenc', 'vbr', '6000k', '7500k']);
  assert.equal(at(c.videoEncoderArgs('h264_amf', pl), '-rc'), 'vbr_peak');
  assert.equal(at(c.videoEncoderArgs('h264_qsv', pl), '-b:v'), '6000k');
  assert.equal(at(c.videoEncoderArgs('libx264', pl), '-preset'), 'medium');
  const cu = c.plan('custom', SRC, { quality: 50 });
  const nvq = c.videoEncoderArgs('h264_nvenc', cu);
  assert.equal(at(nvq, '-cq'), String(c.cqOf(50)));
  assert.equal(at(nvq, '-b:v'), '0');
  assert.ok(nvq.includes('-maxrate'));
  assert.equal(at(c.videoEncoderArgs('libx264', cu), '-crf'), String(c.crfOf(50)));
  assert.equal(at(c.videoEncoderArgs('h264_qsv', cu), '-global_quality'), String(c.cqOf(50)));
  assert.ok(c.cqOf(100) < c.cqOf(0));
});

test('compressArgs: NVENC decodes + scales on the GPU (CUDA), CPU fallback, trim + track mix for public', () => {
  const tracks = [{ index: 0, enabled: true, volume: 1 }, { index: 1, enabled: false, volume: 1 }, { index: 2, enabled: true, volume: 0.5 }];
  const g = c.compressArgs({ src: 'a.mp4', out: 'b.mp4', preset: 'balanced', source: SRC, duration: 61, trim: { in: 2, out: 12 }, audioTracks: tracks, encoder: 'h264_nvenc' });
  const a = g.args;
  assert.equal(at(a, '-hwaccel'), 'cuda');
  assert.equal(at(a, '-ss'), '2.000');
  assert.equal(at(a, '-t'), '10.000');
  assert.match(at(a, '-filter_complex'), /^\[0:v:0\]scale_cuda=1920:1080\[vout\];.*amix=inputs=2/);
  assert.ok(a.includes('[vout]') && a.includes('[aout]'));
  assert.equal(at(a, '-b:a'), '128k');
  assert.equal(g.length, 10);
  const cpu = c.compressArgs({ src: 'a.mp4', out: 'b.mp4', preset: 'balanced', source: SRC, duration: 61, trim: null, audioTracks: tracks, encoder: 'h264_nvenc', gpu: false });
  assert.ok(!cpu.args.includes('-hwaccel'));
  assert.match(at(cpu.args, '-filter_complex'), /scale=1920:1080:flags=bicubic,format=yuv420p/);
  const amf = c.compressArgs({ src: 'a.mp4', out: 'b.mp4', preset: 'tiny', source: SRC, duration: 61, audioTracks: tracks, encoder: 'h264_amf' });
  assert.equal(at(amf.args, '-hwaccel'), 'd3d11va');
  assert.equal(at(amf.args, '-r'), '30');
  const muted = c.compressArgs({ src: 'a.mp4', out: 'b.mp4', preset: 'small', source: SRC, duration: 61, audioTracks: [{ index: 0, enabled: false, volume: 1 }], encoder: 'libx264' });
  assert.ok(muted.args.includes('-an'));
});

test('drafts: full length, every audio track kept separately, video re-encoded', () => {
  const d = c.compressArgs({ src: 'a.mp4', out: 'b.mp4', preset: 'balanced', source: SRC, duration: 61, trim: { in: 2, out: 12 }, audioTracks: [{ index: 0, enabled: false, volume: 1 }], encoder: 'h264_nvenc', draft: true });
  const a = d.args;
  assert.ok(!a.includes('-ss') && !a.includes('-t'));
  assert.ok(a.includes('0:a?'));
  assert.ok(!/amix|volume=/.test(at(a, '-filter_complex')));
  assert.equal(at(a, '-c:a'), 'aac');
  assert.equal(d.length, 61);
});

test('size estimate (duration x bitrate) and the saving vs the original', () => {
  const e = c.estimate({ preset: 'balanced', source: SRC, duration: 61, trim: null, fileSize: 157830293 });
  assert.ok(Math.abs(e.bytes - 47.7e6) < 1e6, String(e.bytes));
  assert.ok(e.saves > 100e6);
  const t = c.estimate({ preset: 'balanced', source: SRC, duration: 61, trim: { in: 0, out: 30.5 }, fileSize: 157830293 });
  assert.ok(Math.abs(t.bytes - e.bytes / 2) < 1e5);
  assert.ok(Math.abs(t.originalBytes - 157830293 / 2) < 10);
  const d = c.estimate({ preset: 'balanced', source: SRC, duration: 61, trim: { in: 0, out: 10 }, fileSize: 157830293, audioTrackCount: 3, draft: true });
  assert.ok(d.bytes > e.bytes);
  const o = c.estimate({ preset: 'original', source: SRC, duration: 61, trim: null, fileSize: 1000 });
  assert.deepEqual([o.bytes, o.saves], [1000, 0]);
  assert.deepEqual(c.cleanCustom({ maxH: 999, fps: 144, quality: 500, audioK: 1 }), { maxH: 1080, fps: 60, quality: 100, audioK: 128 });
});
