const test = require('node:test');
const assert = require('node:assert/strict');
const rb = require('../lib/ringbuffer');

const LIST = 'seg_000000.ts,0.000000,1.021333\nseg_000001.ts,1.021333,2.021333\nseg_000002.ts,2.021333,3.021333\n\nseg_000003.ts,3.021333,4.021333\n';
const segs = n => Array.from({ length: n }, (_, i) => ({ file: `seg_${String(i).padStart(6, '0')}.ts`, index: i, start: i, end: i + 1, wallEnd: 10000 + (i + 1) * 1000 }));

test('parseList', () => {
  const l = rb.parseList(LIST);
  assert.equal(l.length, 4);
  assert.deepEqual(l[1], { file: 'seg_000001.ts', index: 1, start: 1.021333, end: 2.021333 });
});

test('pickClip covers exactly the wanted window with a soft trim', () => {
  const p = rb.pickClip(segs(60), 40500, 10);
  assert.equal(p.segments[p.segments.length - 1].index, 30);
  assert.equal(p.trimOut, p.total - 0.5);
  assert.equal(Math.round((p.trimOut - p.trimIn) * 1000) / 1000, 10);
  assert.ok(p.trimIn >= 0 && p.trimIn < 1);
  assert.equal(p.segments.length, 11);
});

test('pickClip with a short buffer returns what exists, untrimmed at the start', () => {
  const p = rb.pickClip(segs(5), 14800, 30);
  assert.equal(p.segments.length, 5);
  assert.equal(p.trimIn, 0);
  assert.equal(p.trimOut, 4.8);
});

test('pickClip: press after the newest segment uses the newest one', () => {
  const p = rb.pickClip(segs(10), 99999, 3);
  assert.equal(p.segments[p.segments.length - 1].index, 9);
  assert.equal(p.trimOut, p.total);
});

test('pickClip stops at a timeline gap (ffmpeg restarted)', () => {
  const s = segs(10);
  for (let i = 5; i < 10; i++) s[i] = { ...s[i], start: 95 + i, end: 96 + i };
  const p = rb.pickClip(s, 99999, 20);
  assert.equal(p.segments[0].index, 5);
  assert.equal(rb.pickClip([], 1, 10), null);
});

test('filesToPrune keeps the newest keepSec', () => {
  const s = segs(40).slice(10);
  const files = ['list.csv', ...Array.from({ length: 40 }, (_, i) => `seg_${String(i).padStart(6, '0')}.ts`), 'clip-1.txt'];
  const del = rb.filesToPrune(files, s, 12);
  assert.equal(del.length, 28);
  assert.ok(del.includes('seg_000000.ts') && del.includes('seg_000027.ts') && !del.includes('seg_000028.ts'));
  assert.ok(!del.includes('list.csv'));
});

test('A/V skew: video t0 from segment close times, shift pulls early audio back', () => {
  const s = segs(5).map((x, i) => ({ ...x, wallEnd: x.wallEnd + (i === 2 ? 0 : 40) }));
  assert.equal(rb.videoT0(s, 0), 10000);
  assert.equal(rb.videoT0(s, 33.3), 10000 - 33.3);
  assert.equal(rb.audioShift(10113, 10000, 0), -0.113);
  assert.equal(rb.audioShift(10113, 10000, 50), -0.063);
  assert.equal(rb.audioShift(null, 10000, 20), 0.02);
  assert.equal(rb.audioShift(20000, 10000, 0), 0);
  assert.ok(rb.encoderDelayMs('h264_nvenc', 60) > rb.encoderDelayMs('libx264', 60));
});
