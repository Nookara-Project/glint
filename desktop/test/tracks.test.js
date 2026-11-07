const test = require('node:test');
const assert = require('node:assert/strict');
const t = require('../lib/tracks');

const S = { audioGame: true, mic: true, micDevice: 'default', micVolume: 80, sysVolume: 120, audioApps: { discord: true, fluxer: false, ember: true }, audioDesktop: false };

test('planTracks: contract order, game process loopback with system fallback, voice apps, gains', () => {
  const p = t.planTracks(S, 4242);
  assert.deepEqual(p.map(x => x.kind), ['game', 'mic', 'discord', 'ember']);
  assert.equal(p[0].arg, 'game:proc=4242:fallback@1.20');
  assert.equal(p[1].arg, 'mic:dev=default@0.80');
  assert.match(p[2].arg, /^discord:app=discord\.exe,discordcanary\.exe,discordptb\.exe/);
  assert.equal(p[3].arg, 'ember:app=ember.exe,bonfire.exe@1.00');
  assert.deepEqual(t.planTracks({ ...S, audioDesktop: true }, 1).map(x => x.kind).pop(), 'desktop');
});

test('planTracks: no game (always record) -> the desktop mix; nothing on -> still one track', () => {
  assert.deepEqual(t.planTracks({ ...S, mic: false, audioApps: { discord: false, fluxer: false, ember: false } }, 0).map(x => x.arg), ['desktop:sys@1.20']);
  assert.deepEqual(t.planTracks({ audioGame: false, mic: false, audioApps: { discord: false, fluxer: false, ember: false } }, 99).map(x => x.kind), ['desktop']);
});

test('applyStatus: a game track that fell back to the system mix is relabelled and the desktop track becomes a duplicate', () => {
  const plan = t.planTracks({ ...S, audioDesktop: true }, 7);
  const st = { tracks: [{ state: 'system' }, { state: 'device' }, { state: 'waiting' }, { state: 'app' }, { state: 'system' }] };
  const tr = t.applyStatus(plan, st);
  assert.equal(tr[0].label, 'System audio');
  assert.equal(tr[4].dup, true);
});

test('clipTracks: app tracks only when the app ran during the clip window; dead devices dropped', () => {
  const tracks = [{ kind: 'game', state: 'process' }, { kind: 'mic', state: 'none' }, { kind: 'discord', state: 'waiting' }, { kind: 'ember', state: 'app' }, { kind: 'fluxer', state: 'waiting' }, { kind: 'desktop', state: 'system', dup: true }];
  const ev = [
    { index: 2, on: true, t: 1500 },
    { index: 3, on: false, t: 500 },
    { index: 4, on: true, t: 100 }, { index: 4, on: false, t: 200 },
  ];
  assert.deepEqual(t.clipTracks(tracks, ev, 1000, 2000), [0, 2]);
  assert.deepEqual(t.clipTracks(tracks, [], 1000, 2000), [0, 3]);
  assert.deepEqual(t.clipTracks(tracks, [{ index: 3, on: false, t: 1700 }], 1000, 2000), [0, 3]);
});

test('clipAudioTracks + normalizeTracks', () => {
  const tracks = [{ kind: 'game', label: 'Game' }, { kind: 'mic', label: 'Microphone' }, { kind: 'ember', label: 'Ember' }];
  assert.deepEqual(t.clipAudioTracks(tracks, [0, 2]), [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'ember', label: 'Ember', enabled: true, volume: 1 }]);
  assert.deepEqual(t.normalizeTracks(undefined), [{ index: 0, kind: 'desktop', label: 'Audio', enabled: true, volume: 1 }]);
  assert.deepEqual(t.normalizeTracks([{ index: 1, kind: 'weird', volume: 9, enabled: false }]), [{ index: 1, kind: 'desktop', label: 'Audio', enabled: false, volume: 2 }]);
});

test('custom app sources: own "app" track per enabled exe, before the desktop mix, capped at 8 tracks', () => {
  const apps = [{ id: 'sp', name: 'Spotify', exe: 'Spotify.exe', enabled: true, volume: 80 }, { id: 'off', name: 'Off', exe: 'off.exe', enabled: false }, { id: 'ch', name: 'Chrome', exe: 'chrome.exe', enabled: true }];
  const p = t.planTracks({ ...S, audioDesktop: true, audioCustomApps: apps }, 9);
  assert.deepEqual(p.map(x => x.kind), ['game', 'mic', 'discord', 'ember', 'app', 'app', 'desktop']);
  assert.equal(p[4].arg, 'app:app=Spotify.exe@0.80');
  assert.deepEqual(p[4].app, { exe: 'Spotify.exe', name: 'Spotify' });
  assert.equal(p[4].appId, 'sp');
  assert.equal(p[4].label, 'Spotify');
  const many = Array.from({ length: 8 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, exe: `a${i}.exe`, enabled: true }));
  const capped = t.planTracks({ ...S, audioDesktop: true, audioCustomApps: many }, 9);
  assert.equal(capped.length, 8);
  assert.equal(capped[7].kind, 'desktop');
  assert.equal(t.planTracks({ ...S, audioCustomApps: [{ id: 'x', exe: 'bad@name.exe', enabled: true }] }, 9).some(x => x.kind === 'app'), false);
  const st = t.applyStatus(p, { tracks: p.map((x, i) => ({ state: i === 4 ? 'app' : i === 5 ? 'waiting' : 'device' })) });
  const keep = t.clipTracks(st, [], 1000, 2000);
  assert.ok(keep.includes(4) && !keep.includes(5));
  const lib = t.clipAudioTracks(st, keep);
  const sp = lib.find(x => x.kind === 'app');
  assert.deepEqual([sp.label, sp.app.exe, sp.appId], ['Spotify', 'Spotify.exe', 'sp']);
  assert.deepEqual(t.normalizeTracks([{ index: 0, kind: 'app', label: 'Spotify', app: { exe: 'Spotify.exe', name: 'Spotify' }, appId: 'sp' }])[0].app, { exe: 'Spotify.exe', name: 'Spotify' });
});

test('mixPlan', () => {
  assert.deepEqual(t.mixPlan([{ index: 0, enabled: false, volume: 1 }]), { none: true });
  assert.deepEqual(t.mixPlan([{ index: 0, enabled: true, volume: 0 }, { index: 1, enabled: true, volume: 1 }]), { map: '0:a:1', copyable: true });
  assert.equal(t.mixPlan([{ index: 2, enabled: true, volume: 0.4 }]).filter, '[0:a:2]volume=0.40[aout]');
  assert.match(t.mixPlan([{ index: 0, enabled: true, volume: 1 }, { index: 1, enabled: true, volume: 1.5 }]).filter, /amix=inputs=2:duration=longest:normalize=0\[aout\]$/);
  assert.equal(t.splitFilter(1), null);
});

test('voice tracks: anything but the game, or a game that fell back to the whole system mix', () => {
  assert.equal(t.isVoice({ kind: 'game', label: 'Game' }), false);
  assert.equal(t.isVoice({ kind: 'game', label: 'System audio' }), true);
  for (const kind of ['mic', 'discord', 'fluxer', 'ember', 'desktop', 'app']) assert.equal(t.isVoice({ kind, label: 'x' }), true, kind);
});
const CLIP = [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Microphone', enabled: true, volume: 1 }, { index: 2, kind: 'discord', label: 'Discord', enabled: true, volume: 0.5 }];
test('uploadPlan: the review decides, and a voice track left off is removed', () => {
  const p = t.uploadPlan(CLIP, { states: { 0: true, 1: false, 2: true } });
  assert.deepEqual(p.removed, [1]);
  assert.deepEqual(p.kept, [0, 2]);
  assert.deepEqual(p.keptTracks.map(x => [x.index, x.kind, x.volume]), [[0, 'game', 1], [1, 'discord', 0.5]], 'renumbered for a file with only those');
  assert.equal(p.tracks.find(x => x.index === 1).enabled, false);
});
test('uploadPlan: auto-upload keeps game audio only', () => {
  const p = t.uploadPlan(CLIP, { stripVoice: true });
  assert.deepEqual(p.kept, [0]);
  assert.deepEqual(p.removed, [1, 2]);
  assert.deepEqual(t.mixPlan(p.tracks), { map: '0:a:0', copyable: true });
});
test('uploadPlan: a clip of only voices can end up with no audio', () => {
  const p = t.uploadPlan([CLIP[1]], { stripVoice: true });
  assert.deepEqual(p.kept, []);
  assert.deepEqual(t.mixPlan(p.tracks), { none: true });
});
test('uploadPlan: a game track switched off stays in the file, only voices come out', () => {
  const p = t.uploadPlan(CLIP, { states: { 0: false, 1: false, 2: false } });
  assert.deepEqual(p.kept, [0]);
  assert.equal(p.keptTracks[0].enabled, false);
});
test('keptView renumbers', () => {
  assert.deepEqual(t.keptView(CLIP, [0, 2]).map(x => [x.index, x.kind]), [[0, 'game'], [1, 'discord']]);
});
