const test = require('node:test');
const assert = require('node:assert/strict');
const crop = require('../lib/crop');
const cap = require('../lib/capture');
const f = require('../lib/ffargs');
const c = require('../lib/compress');
const { draftSyncPayload, draftEdits } = require('../lib/uploadflow');

const at = (args, flag) => args[args.indexOf(flag) + 1];

test('cleanCrop: even, inside the frame, >= 64, whole frame = null', () => {
  assert.deepEqual(crop.cleanCrop({ x: 101, y: 51, w: 801, h: 451 }, 1920, 1080), { x: 100, y: 50, w: 800, h: 450 });
  assert.deepEqual(crop.cleanCrop({ x: 1900, y: 1070, w: 500, h: 500 }, 1920, 1080), { x: 1856, y: 1016, w: 64, h: 64 });
  assert.deepEqual(crop.cleanCrop({ x: -5, y: 0, w: 10, h: 9999 }, 1920, 1080), { x: 0, y: 0, w: 64, h: 1080 });
  assert.equal(crop.cleanCrop({ x: 0, y: 0, w: 1920, h: 1080 }, 1920, 1080), null);
  assert.equal(crop.cleanCrop(null, 1920, 1080), null);
});

test('aspect maths: presets centred, fitAspect keeps the centre and stays inside', () => {
  assert.deepEqual(crop.presetRect(9 / 16, 2560, 1440), { x: 874, y: 0, w: 810, h: 1440 });
  assert.deepEqual(crop.presetRect(1, 1920, 1080), { x: 420, y: 0, w: 1080, h: 1080 });
  assert.deepEqual(crop.presetRect(16 / 9, 1920, 1080), { x: 0, y: 0, w: 1920, h: 1080 });
  const r = crop.fitAspect({ x: 100, y: 100, w: 1000, h: 400 }, 1, 1920, 1080);
  assert.equal(r.w, r.h);
  assert.equal(r.w, 400);
  assert.equal(r.x + r.w / 2, 600);
  const edge = crop.fitAspect({ x: 1800, y: 0, w: 120, h: 1080 }, 16 / 9, 1920, 1080);
  assert.ok(edge.x + edge.w <= 1920 && edge.w >= 64 && Math.abs(edge.w / edge.h - 16 / 9) < 0.05);
  assert.equal(crop.cropFilter({ x: 2, y: 4, w: 640, h: 360 }), 'crop=640:360:2:4');
});

test('crop -> MP4 export: re-encode even without a trim, crop in the graph next to the audio mix', () => {
  const k = { x: 100, y: 50, w: 800, h: 450 };
  const a = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: null, crop: k, duration: 30, encoder: 'h264_nvenc', kbps: 9000, audioTracks: [{ index: 0, enabled: true, volume: 1 }, { index: 1, enabled: true, volume: 0.5 }] });
  assert.ok(!a.includes('-ss') && !a.includes('-t'));
  assert.match(at(a, '-filter_complex'), /^\[0:v:0\]crop=800:450:100:50\[vout\];.*amix/);
  assert.ok(a.includes('[vout]') && !a.includes('copy'));
  const t = f.exportMp4Args({ src: 'a.mp4', out: 'b.mp4', trim: { in: 2, out: 5 }, crop: k, duration: 30, encoder: 'libx264' });
  assert.equal(at(t, '-ss'), '2.000');
  assert.equal(at(t, '-t'), '3.000');
  const mp3 = f.exportMp3Args({ src: 'a.mp4', out: 'b.mp3', trim: null, crop: k, duration: 30 });
  assert.ok(!mp3.join(' ').includes('crop='));
  assert.match(at(f.thumbArgs('a.mp4', 1, 't.jpg', 640, 4, k), '-vf'), /^crop=800:450:100:50,scale=640:-2$/);
});

test('crop -> compressed renders: crop before scale, presets scale from the cropped size; drafts keep the frame', () => {
  const SRC = { width: 2560, height: 1440, fps: 60, kbps: 20000 };
  const k = { x: 0, y: 0, w: 1440, h: 1440 };
  const nv = c.compressArgs({ src: 'a', out: 'b', preset: 'balanced', source: SRC, duration: 10, crop: k, encoder: 'h264_nvenc' });
  assert.match(at(nv.args, '-filter_complex'), /^\[0:v:0\]crop=1440:1440:0:0,scale=1080:1080/);
  assert.equal(at(nv.args, '-hwaccel'), 'cuda');
  assert.ok(!nv.args.includes('-hwaccel_output_format'));
  assert.deepEqual([nv.plan.width, nv.plan.height], [1080, 1080]);
  const small = c.compressArgs({ src: 'a', out: 'b', preset: 'balanced', source: SRC, duration: 10, crop: { x: 0, y: 0, w: 800, h: 450 }, encoder: 'libx264' });
  assert.match(at(small.args, '-filter_complex'), /^\[0:v:0\]crop=800:450:0:0,format=yuv420p\[vout\]/);
  const draft = c.compressArgs({ src: 'a', out: 'b', preset: 'balanced', source: SRC, duration: 10, crop: k, encoder: 'h264_nvenc', draft: true });
  assert.ok(!draft.args.join(' ').includes('crop='));
  const est = c.estimate({ preset: 'balanced', source: SRC, duration: 10, crop: { x: 0, y: 0, w: 800, h: 450 }, fileSize: 25e6 });
  assert.equal(est.plan.height, 450);
});

test('drafts: crop goes out with the PATCH sync (null clears it) and web crop edits win on publish', () => {
  const fns = { contractTrim: () => null, contractTracks: () => [] };
  const clip = { duration: 10, crop: { x: 2, y: 2, w: 640, h: 360 }, upload: { id: 'x', visibility: 'draft', sentCrop: null } };
  assert.deepEqual(draftSyncPayload(clip, fns).body, { crop: { x: 2, y: 2, w: 640, h: 360 } });
  assert.deepEqual(draftSyncPayload({ ...clip, crop: null, upload: { ...clip.upload, sentCrop: { x: 2, y: 2, w: 640, h: 360 } } }, fns).body, { crop: null });
  assert.equal(draftSyncPayload({ ...clip, upload: { ...clip.upload, sentCrop: clip.crop } }, fns), null);
  const e = draftEdits({ ...clip, upload: { ...clip.upload, sentCrop: clip.crop } }, { crop: { x: 0, y: 0, w: 360, h: 640 } });
  assert.deepEqual([e.fromWeb, e.crop], [true, { x: 0, y: 0, w: 360, h: 640 }]);
  assert.deepEqual(draftEdits({ ...clip, upload: { ...clip.upload, sentCrop: clip.crop } }, { crop: clip.crop }).crop, clip.crop);
});

const MON = { found: true, idx: 1, x: 2560, y: 0, w: 2560, h: 1440, hwnd: 777, win: { x: 2760, y: 200, w: 816, h: 489, cx: 2768, cy: 231, cw: 800, ch: 450, covers: false } };
test('capture decision: windowed -> gfxcapture of the window; fullscreen / setting / no game -> monitor; region fallback', () => {
  const w = cap.decideCapture({ setting: 'window', mon: MON, hasGfx: true });
  assert.deepEqual([w.mode, w.hwnd, w.width, w.height, w.outputIdx], ['window', 777, 800, 450, 1]);
  assert.equal(cap.decideCapture({ setting: 'window', mon: { ...MON, win: { ...MON.win, covers: true } }, hasGfx: true }).mode, 'monitor');
  assert.equal(cap.decideCapture({ setting: 'monitor', mon: MON, hasGfx: true }).mode, 'monitor');
  assert.equal(cap.decideCapture({ setting: 'window', mon: null, hasGfx: true }).mode, 'monitor');
  const r = cap.decideCapture({ setting: 'window', mon: MON, hasGfx: true, stalled: true });
  assert.deepEqual([r.mode, r.x, r.y, r.width, r.height], ['region', 208, 230, 800, 450]);
  assert.equal(cap.decideCapture({ setting: 'window', mon: MON, hasGfx: false }).mode, 'region');
  const resized = cap.decideCapture({ setting: 'window', mon: { ...MON, win: { ...MON.win, cw: 1200, ch: 700 } }, hasGfx: true, sticky: { hwnd: 777, width: 800, height: 450 } });
  assert.ok(cap.sameCapture(w, resized));
  assert.ok(!cap.sameCapture(r, cap.decideCapture({ setting: 'window', mon: { ...MON, win: { ...MON.win, cw: 1000 } }, hasGfx: false })));
});

test('capture source filters + the recorded window rect for the "Game window" crop', () => {
  const w = cap.decideCapture({ setting: 'window', mon: MON, hasGfx: true });
  assert.equal(cap.sourceFilter(w, 60, false), 'gfxcapture=hwnd=777:capture_cursor=0:display_border=0:capture_border=0:max_framerate=60:resize_mode=scale_aspect:width=800:height=450');
  const r = cap.decideCapture({ setting: 'window', mon: MON, hasGfx: false });
  assert.equal(cap.sourceFilter(r, 30, true), 'ddagrab=output_idx=1:framerate=30:draw_mouse=1:dup_frames=1:offset_x=208:offset_y=230:video_size=800x450');
  const args = f.captureArgs({ encoder: 'h264_nvenc', cap: w, resolution: 'native', fps: 60, audioTracks: 1 });
  assert.ok(args.args.includes(cap.sourceFilter(w, 60, true)));
  assert.equal(args.size.width, 800);
  assert.deepEqual(cap.windowRectInClip(MON, 1920, 1080), { x: 156, y: 172, w: 600, h: 336 });
  assert.equal(cap.windowRectInClip({ ...MON, win: { ...MON.win, covers: true } }, 1920, 1080), null);
});
