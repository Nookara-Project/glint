const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../lib/ffargs');

test('targetSize never upscales and keeps even widths', () => {
  assert.deepEqual(f.targetSize(2560, 1440, '1080'), { width: 1920, height: 1080, scaled: true });
  assert.deepEqual(f.targetSize(1920, 1080, '1440'), { width: 1920, height: 1080, scaled: false });
  assert.deepEqual(f.targetSize(3440, 1440, '720'), { width: 1720, height: 720, scaled: true });
  assert.deepEqual(f.targetSize(2560, 1080, 'native'), { width: 2560, height: 1080, scaled: false });
  assert.equal(f.targetSize(1366, 768, '720').width % 2, 0);
});

test('bitrate presets scale with height and fps', () => {
  assert.equal(f.bitrateKbps(1080, 60, 'medium'), 12000);
  assert.equal(f.bitrateKbps(1080, 30, 'medium'), 7800);
  assert.equal(f.bitrateKbps(1440, 60, 'ultra'), 45000);
  assert.equal(f.bitrateKbps(2160, 60, 'high'), 50000);
  assert.equal(f.bitrateKbps(720, 60, 'nonsense'), 6000);
});

const fc = args => args[args.indexOf('-filter_complex') + 1] || '';
test('native capture with NVENC is zero-copy (no video filter), scaled goes through the CPU', () => {
  const nat = f.captureArgs({ encoder: 'h264_nvenc', outputIdx: 1, monW: 2560, monH: 1440, resolution: 'native', fps: 60, bitrate: 'medium', audioTracks: 1 });
  assert.ok(!nat.args.includes('-filter_complex'));
  assert.ok(nat.args.join(' ').includes('ddagrab=output_idx=1:framerate=60'));
  assert.deepEqual(nat.args.slice(nat.args.indexOf('-map'), nat.args.indexOf('-map') + 2), ['-map', '0:v']);
  assert.ok(nat.args.includes('1:a'));
  const sc = f.captureArgs({ encoder: 'h264_nvenc', monW: 2560, monH: 1440, resolution: '1080', fps: 30, bitrate: 'low', audioTracks: 0 });
  assert.match(fc(sc.args), /^\[0:v\]hwdownload,format=bgra,scale=1920:1080/);
  assert.ok(sc.args.includes('[v]') && !sc.args.includes('pipe:0'));
  assert.equal(sc.args[sc.args.indexOf('-g') + 1], '30');
  const qsv = f.captureArgs({ encoder: 'h264_qsv', monW: 1920, monH: 1080, resolution: 'native', fps: 60, audioTracks: 1 });
  assert.match(fc(qsv.args), /hwmap=derive_device=qsv/);
  const x = f.captureArgs({ encoder: 'libx264', monW: 1920, monH: 1080, resolution: 'native', fps: 60, audioTracks: 1 });
  assert.match(fc(x.args), /format=yuv420p\[v\]$/);
});

test('multi-track capture: 2 channels per track on the pipe, split into one AAC stream each', () => {
  const c = f.captureArgs({ encoder: 'h264_nvenc', monW: 1920, monH: 1080, resolution: 'native', fps: 60, audioTracks: 3 });
  const a = c.args;
  assert.equal(a[a.indexOf('-ac') + 1], '6');
  assert.equal(fc(a), '[1:a]asplit=3[s0][s1][s2];[s0]pan=stereo|c0=c0|c1=c1[t0];[s1]pan=stereo|c0=c2|c1=c3[t1];[s2]pan=stereo|c0=c4|c1=c5[t2]');
  assert.deepEqual(['[t0]', '[t1]', '[t2]'].map(t => a.includes(t)), [true, true, true]);
  const sc = f.captureArgs({ encoder: 'libx264', monW: 2560, monH: 1440, resolution: '720', fps: 60, audioTracks: 2 });
  assert.match(fc(sc.args), /\[v\];\[1:a\]asplit=2/);
});

test('capture writes 1 s segments with a csv list and an audio offset when asked', () => {
  const c = f.captureArgs({ encoder: 'h264_amf', monW: 1920, monH: 1080, fps: 60, audioTracks: 1, audioOffsetMs: -120, listSize: 150 });
  const a = c.args;
  assert.equal(a[a.indexOf('-segment_time') + 1], '1');
  assert.equal(a[a.indexOf('-segment_list_type') + 1], 'csv');
  assert.equal(a[a.indexOf('-segment_list_size') + 1], '150');
  assert.equal(a[a.indexOf('-itsoffset') + 1], '-0.120');
  assert.ok(a.indexOf('-itsoffset') < a.indexOf('pipe:0'));
  assert.equal(a[a.length - 1], 'seg_%06d.ts');
});

test('concat: picked tracks with titles, A/V correction via -itsoffset on a second copy of the list', () => {
  const plain = f.concatArgs('l.txt', 'o.mp4');
  assert.deepEqual(plain.slice(plain.indexOf('-map')), ['-map', '0:v', '-map', '0:a?', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart', 'o.mp4']);
  const s = f.concatArgs('l.txt', 'o.mp4', { audioShift: -0.113, audio: [{ stream: 0, title: 'Game' }, { stream: 3, title: 'Discord' }] });
  assert.equal(s[s.indexOf('-itsoffset') + 1], '-0.113');
  assert.ok(s.includes('1:a:0') && s.includes('1:a:3') && !s.includes('1:a:1'));
  assert.equal(s[s.indexOf('-metadata:s:a:1') + 1], 'title=Discord');
  assert.ok(s.includes('handler_name=Game'));
  assert.equal(f.concatList(['C:\\a\\seg_000001.ts', "it's.ts"]), "file 'C:/a/seg_000001.ts'\nfile 'it'\\''s.ts'\n");
});

test('mixed exports: only enabled tracks, at their volumes; video copy when untrimmed', () => {
  const tracks = [{ index: 0, kind: 'game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', enabled: false, volume: 1 }, { index: 2, kind: 'discord', enabled: true, volume: 0.5 }];
  const full = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: null, duration: 30, audioTracks: tracks });
  assert.equal(fc(full), '[0:a:0]volume=1.00[m0];[0:a:2]volume=0.50[m1];[m0][m1]amix=inputs=2:duration=longest:normalize=0[aout]');
  assert.equal(full[full.indexOf('-c:v') + 1], 'copy');
  assert.equal(full[full.indexOf('-c:a') + 1], 'aac');
  const one = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: null, duration: 30, audioTracks: [{ index: 0, enabled: false, volume: 1 }, { index: 1, enabled: true, volume: 1 }] });
  assert.ok(one.includes('0:a:1') && !one.includes('-filter_complex'));
  assert.equal(one[one.indexOf('-c:a') + 1], 'copy');
  const none = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: { in: 1, out: 4 }, duration: 30, encoder: 'h264_nvenc', audioTracks: [{ index: 0, enabled: false, volume: 1 }] });
  assert.ok(none.includes('-an'));
  const mp3 = f.exportMp3Args({ src: 'a.mp4', out: 'b.mp3', trim: { in: 1, out: 4 }, duration: 30, audioTracks: tracks });
  assert.ok(fc(mp3).includes('amix=inputs=2') && mp3.includes('[aout]') && mp3.includes('libmp3lame'));
  assert.deepEqual(f.demuxTracksArgs('a.mp4', ['x0.m4a', 'x1.m4a']).filter(x => /^0:a:/.test(x)), ['0:a:0', '0:a:1']);
});

test('trim -> export args', () => {
  assert.equal(f.isFullTrim(null, 30), true);
  assert.equal(f.isFullTrim({ in: 0, out: 30 }, 30), true);
  assert.equal(f.isFullTrim({ in: 2, out: 30 }, 30), false);
  const copy = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: null, duration: 30 });
  assert.ok(copy.includes('copy') && !copy.includes('-ss'));
  const cut = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: { in: 2.5, out: 12.25 }, duration: 30, encoder: 'h264_nvenc', kbps: 9000 });
  assert.equal(cut[cut.indexOf('-ss') + 1], '2.500');
  assert.ok(cut.indexOf('-ss') < cut.indexOf('-i'));
  assert.equal(cut[cut.indexOf('-t') + 1], '9.750');
  assert.equal(cut[cut.indexOf('-c:v') + 1], 'h264_nvenc');
  assert.equal(cut[cut.indexOf('-b:v') + 1], '9000k');
  assert.ok(!cut.includes('-forced-idr'));
  assert.ok(cut.includes('+faststart'));
  const bad = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: { in: 1, out: 5 }, duration: 30, encoder: 'evil' });
  assert.equal(bad[bad.indexOf('-c:v') + 1], 'libx264');
  const mp3 = f.exportMp3Args({ src: 'a.mp4', out: 'b.mp3', trim: { in: 1, out: 4 }, duration: 30 });
  assert.equal(mp3[mp3.indexOf('-t') + 1], '3.000');
  assert.ok(mp3.includes('-vn') && mp3.includes('libmp3lame'));
  const full = f.exportMp3Args({ src: 'a.mp4', out: 'b.mp3', trim: null, duration: 30 });
  assert.ok(!full.includes('-ss'));
  assert.deepEqual(f.trimRange({ in: 5, out: 3 }, 10), { start: 0, end: 10, length: 10 });
});

test('parseProbe reads duration, size and audio', () => {
  const txt = [
    'Input #0, mov,mp4',
    '  Duration: 00:01:05.91, start: 0.000000, bitrate: 7371 kb/s',
    '  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709, progressive), 2560x1440 [SAR 1:1 DAR 16:9], 60 fps',
    '  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 159 kb/s',
  ].join('\n');
  assert.deepEqual(f.parseProbe(txt), { duration: 65.91, width: 2560, height: 1440, hasAudio: true, fps: 60, audioStreams: 1 });
  assert.deepEqual(f.parseProbe(''), { duration: 0, width: 0, height: 0, hasAudio: false, fps: 0, audioStreams: 0 });
});
