const test = require('node:test');
const assert = require('node:assert/strict');
const { probeAll, describe, cacheKey } = require('../lib/encprobe');
const f = require('../lib/ffargs');

const pc = ok => async (enc, chain) => (ok.includes(`${enc}/${chain}`) ? null : `${enc}/${chain}: Error encoding a frame`);

test('AMD whose direct D3D11 path fails on capture frames: falls back to the next chain that works', async () => {
  const r = await probeAll(['h264_amf', 'libx264'], pc(['libx264/download', 'h264_amf/download']));
  assert.deepEqual(r.list, [{ encoder: 'h264_amf', chain: 'download' }, { encoder: 'libx264', chain: 'download' }]);
  assert.deepEqual(Object.keys(r.failures.h264_amf), ['direct', 'hwmap']);
  assert.equal(r.captureOk, true);
  const lines = describe(r, ['h264_amf', 'libx264']);
  assert.match(lines.find(l => l.startsWith('h264_amf')), /^h264_amf: download \(failed first: direct: .*; hwmap: /);
});

test('an encoder that fails every chain is dropped (Steam Deck: only libx264), with the reasons', async () => {
  const r = await probeAll(['h264_amf', 'libx264'], pc(['libx264/download']));
  assert.deepEqual(r.list, [{ encoder: 'libx264', chain: 'download' }]);
  assert.match(describe(r, ['h264_amf', 'libx264']).find(l => l.startsWith('h264_amf')), /unusable - direct: .*hwmap: .*download: /);
});

test('NVIDIA: direct wins on the first try; QSV tries hwmap first', async () => {
  const tried = [];
  const r = await probeAll(['h264_nvenc', 'h264_qsv', 'libx264'], async (e, c) => { tried.push(`${e}/${c}`); return ['libx264/download', 'h264_nvenc/direct', 'h264_qsv/hwmap'].includes(`${e}/${c}`) ? null : 'no'; });
  assert.deepEqual(r.list.map(x => `${x.encoder}/${x.chain}`), ['h264_nvenc/direct', 'h264_qsv/hwmap', 'libx264/download']);
  assert.deepEqual(tried, ['libx264/download', 'h264_nvenc/direct', 'h264_qsv/hwmap']);
});

test('the screen can\'t be captured during the probe (locked PC): untested order, flagged not to cache', async () => {
  const r = await probeAll(['h264_nvenc', 'libx264'], async () => 'ddagrab: access lost');
  assert.equal(r.captureOk, false);
  assert.deepEqual(r.list.map(x => x.encoder), ['h264_nvenc', 'libx264']);
  assert.match(describe(r, ['h264_nvenc', 'libx264']).pop(), /not cached/);
});

test('cache key changes with the driver / GPU / ffmpeg build', () => {
  const g = { vendor: 4098, device: 5951, driver: '31.0.24027.1012', name: 'AMD Radeon' };
  assert.equal(cacheKey(g, 'a'), cacheKey({ ...g }, 'a'));
  assert.notEqual(cacheKey(g, 'a'), cacheKey({ ...g, driver: '31.0.24027.2000' }, 'a'));
  assert.notEqual(cacheKey(g, 'a'), cacheKey(g, 'b'));
});

test('chain -> capture filter + probe args', () => {
  const native = { scaled: false };
  assert.equal(f.captureFilter('h264_amf', native, 'direct'), null);
  assert.equal(f.captureFilter('h264_amf', native, 'hwmap'), 'hwmap=derive_device=amf,format=amf');
  assert.equal(f.captureFilter('h264_amf', native, 'download'), 'hwdownload,format=bgra,format=nv12');
  assert.equal(f.captureFilter('h264_qsv', native, 'download'), 'hwdownload,format=bgra,format=nv12');
  assert.equal(f.captureFilter('libx264', native, 'direct'), 'hwdownload,format=bgra,format=yuv420p');
  assert.match(f.captureFilter('h264_amf', { scaled: true, width: 1280, height: 720 }, 'direct'), /scale=1280:720.*format=nv12$/);
  const c = f.captureArgs({ encoder: 'h264_amf', chain: 'download', monW: 1920, monH: 1080, resolution: 'native', fps: 60, audioTracks: 1 });
  assert.match(c.args[c.args.indexOf('-filter_complex') + 1], /^\[0:v\]hwdownload,format=bgra,format=nv12\[v\]$/);
  const p = f.probeCaptureArgs('h264_amf', 'download', 1);
  assert.ok(p.join(' ').includes('ddagrab=output_idx=1'));
  assert.equal(p[p.indexOf('-vf') + 1], 'hwdownload,format=bgra,format=nv12');
  assert.equal(p[p.indexOf('-c:v') + 1], 'h264_amf');
  assert.deepEqual(p.slice(-3), ['-f', 'null', '-']);
  assert.ok(!f.probeCaptureArgs('h264_nvenc', 'direct').includes('-vf'));
});
