require('./_electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupAfterCancel, rate, isCancel, draftEdits } = require('../lib/uploadflow');
const { Velora, ApiError } = require('../lib/velora');

function fakeApi({ mine = [], media = [], failDelete = false, failMine = false } = {}) {
  const calls = [];
  return {
    calls,
    myClips: async () => { if (failMine) throw new Error('down'); return mine; },
    deleteClip: async (id, m) => { calls.push(['clip', id, m]); if (failDelete) throw new Error('nope'); },
    mediaList: async () => media,
    deleteMedia: async id => { calls.push(['media', id]); },
  };
}

test('cancel before finalize: nothing to clean up', async () => {
  const api = fakeApi();
  assert.deepEqual(await cleanupAfterCancel(api, {}), { deleted: null });
  assert.deepEqual(api.calls, []);
});

test('cancel after finalize, before the Glint POST: the Nookara media is deleted', async () => {
  const api = fakeApi({ media: [{ id: 41, url: 'https://v/a.mp4' }, { id: 42, url: 'https://v/b.mp4' }] });
  assert.deepEqual(await cleanupAfterCancel(api, { mediaUrl: 'https://v/b.mp4' }), { deleted: 'media' });
  assert.deepEqual(api.calls, [['media', 42]]);
});

test('cancel while the Glint POST was in flight: the record (found by videoUrl) goes with its media', async () => {
  const api = fakeApi({ mine: [{ id: 'abc', videoUrl: 'https://v/b.mp4' }], media: [{ id: 42, url: 'https://v/b.mp4' }] });
  assert.deepEqual(await cleanupAfterCancel(api, { mediaUrl: 'https://v/b.mp4' }), { deleted: 'clip' });
  assert.deepEqual(api.calls, [['clip', 'abc', true]]);
});

test('cancel after the Glint POST returned: delete by id; falls back to the media when that fails', async () => {
  const ok = fakeApi();
  assert.deepEqual(await cleanupAfterCancel(ok, { mediaUrl: 'u', clipId: 'xyz' }), { deleted: 'clip' });
  assert.deepEqual(ok.calls, [['clip', 'xyz', true]]);
  const broken = fakeApi({ failDelete: true, failMine: true, media: [{ id: 7, url: 'u' }] });
  assert.deepEqual(await cleanupAfterCancel(broken, { mediaUrl: 'u', clipId: 'xyz' }), { deleted: 'media' });
});

test('the chunked upload stops between chunks when cancelled and never finalizes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-up-'));
  const file = path.join(dir, 'clip.mp4');
  fs.writeFileSync(file, Buffer.alloc(25 * 1024 * 1024));
  const v = new Velora(dir, '0');
  const calls = [];
  const ctl = new AbortController();
  v.req = async (base, p, o) => { calls.push(p); if (o.signal?.aborted) throw new ApiError('cancelled', 0); return { success: true, url: 'https://v/x.mp4' }; };
  const progress = [];
  const err = await v.uploadVideo(file, 'c.mp4', (pct, total, sent) => { progress.push([pct, total, sent]); if (progress.length === 1) ctl.abort(); }, ctl.signal).catch(e => e);
  assert.ok(isCancel(err));
  assert.deepEqual(calls, ['/media/video/chunk']);
  assert.deepEqual(progress[0], [1 / 3, 3, 10 * 1024 * 1024]);
  const all = new Velora(dir, '0');
  const seen = [];
  all.req = async (base, p) => { seen.push(p); return { success: true, url: 'https://v/x.mp4' }; };
  assert.equal((await all.uploadVideo(file, 'c.mp4', null)).url, 'https://v/x.mp4');
  assert.deepEqual(seen, ['/media/video/chunk', '/media/video/chunk', '/media/video/chunk', '/media/video/finalize']);
});

test('speed + ETA', () => {
  assert.deepEqual(rate([], 100), { bps: 0, eta: null });
  const r = rate([{ t: 0, sent: 0 }, { t: 2000, sent: 4e6 }], 10e6);
  assert.equal(r.bps, 2e6);
  assert.equal(r.eta, 3);
});

test('draft publish uses the web edits only when they changed on the web', () => {
  const clip = { trim: { in: 1, out: 9 }, audioTracks: [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Microphone', enabled: true, volume: 1 }],
    upload: { sentTrim: { start: 1, end: 9 }, sentTracks: [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Microphone', enabled: true, volume: 1 }] } };
  const same = draftEdits({ ...clip, trim: { in: 2, out: 9 } }, { trim: { start: 1, end: 9 }, audioTracks: clip.upload.sentTracks });
  assert.equal(same.fromWeb, false);
  assert.deepEqual(same.trim, { in: 2, out: 9 });
  const web = draftEdits(clip, { trim: { start: 3, end: 7 }, audioTracks: [{ index: 0, kind: 'game', enabled: true, volume: 0.5 }, { index: 1, kind: 'mic', enabled: false, volume: 1 }] });
  assert.equal(web.fromWeb, true);
  assert.deepEqual(web.trim, { in: 3, out: 7 });
  assert.deepEqual(web.audioTracks.map(t => [t.enabled, t.volume]), [[true, 0.5], [false, 1]]);
  assert.equal(draftEdits(clip, null).fromWeb, false);
});

test('editing a draft in the app syncs trim + tracks and becomes the new baseline', () => {
  const { draftSyncPayload } = require('../lib/uploadflow');
  const tr = require('../lib/tracks');
  const fns = { contractTrim: (t, d) => (t ? { start: t.in, end: t.out } : null), contractTracks: l => tr.normalizeTracks(l).map(t => ({ index: t.index, kind: t.kind, label: t.label, enabled: t.enabled, volume: t.volume })) };
  const tracks = [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Microphone', enabled: true, volume: 1 }];
  const base = { duration: 30, trim: null, audioTracks: tracks, upload: { id: 'x', visibility: 'draft', sentTrim: null, sentTracks: fns.contractTracks(tracks) } };
  assert.equal(draftSyncPayload(base, fns), null);
  assert.equal(draftSyncPayload({ ...base, upload: { ...base.upload, visibility: 'public' } }, fns), null);
  assert.equal(draftSyncPayload({ ...base, trim: { in: 1, out: 9 }, upload: { ...base.upload, status: 'rendering' } }, fns), null);
  const edited = { ...base, trim: { in: 1, out: 9 }, audioTracks: [tracks[0], { ...tracks[1], enabled: false }] };
  const p = draftSyncPayload(edited, fns);
  assert.deepEqual(p.body.trim, { start: 1, end: 9 });
  assert.equal(p.body.audioTracks[1].enabled, false);
  const synced = { ...edited, upload: { ...edited.upload, sentTrim: p.sentTrim, sentTracks: p.sentTracks } };
  assert.equal(draftSyncPayload(synced, fns), null);
  const d = draftEdits(synced, { trim: { start: 1, end: 9 }, audioTracks: p.body.audioTracks });
  assert.equal(d.fromWeb, false);
  assert.deepEqual(d.trim, { in: 1, out: 9 });
  assert.equal(draftEdits(synced, { trim: { start: 2, end: 5 }, audioTracks: p.body.audioTracks }).fromWeb, true);
  const reset = draftSyncPayload({ ...synced, trim: null }, fns);
  assert.deepEqual(reset.body, { trim: { start: 0, end: 30 } });
});

test('a draft with voice tracks left out: publishing keeps them out, web edits map back, syncing only sends what is there', () => {
  const { draftSyncPayload } = require('../lib/uploadflow');
  const list = [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Microphone', enabled: true, volume: 1 }, { index: 2, kind: 'discord', label: 'Discord', enabled: true, volume: 1 }];
  const sent = [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'discord', label: 'Discord', enabled: true, volume: 1 }];
  const c = { id: 'x', duration: 10, audioTracks: list, upload: { id: 'u', visibility: 'draft', sentTracks: sent, keptTracks: [0, 2] } };
  const local = draftEdits(c, null);
  assert.deepEqual(local.audioTracks.map(t => t.enabled), [true, false, true], 'the removed mic stays off');
  const web = draftEdits(c, { audioTracks: [{ ...sent[0] }, { ...sent[1], enabled: false }] });
  assert.deepEqual(web.audioTracks.map(t => t.enabled), [true, false, false], "the web's track 1 is this clip's track 2");
  const fns = { contractTrim: () => null, contractTracks: l => l };
  assert.equal(draftSyncPayload(c, fns), null, 'turning the mic on locally changes nothing on the draft');
  const edited = { ...c, audioTracks: list.map(t => (t.index === 2 ? { ...t, enabled: false } : t)) };
  assert.deepEqual(draftSyncPayload(edited, fns).body.audioTracks.map(t => [t.index, t.enabled]), [[0, true], [1, false]]);
  assert.equal(draftSyncPayload({ ...c, upload: { id: 'u', visibility: 'draft', keptTracks: [] } }, fns), null, 'a draft with no audio sends none');
});
