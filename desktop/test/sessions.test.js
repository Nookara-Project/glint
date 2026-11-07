const test = require('node:test');
const assert = require('node:assert/strict');
const { Sessions, uploadOnSave, onSessionEnd } = require('../lib/sessions');
const { migrate, clean } = require('../lib/settings');

test('sessions collect clips per game; a clip in the grace window after close is "late"', () => {
  const s = new Sessions();
  assert.equal(s.gameChanged({ key: 'hf:fnaj', name: 'FNAJ' }, 0), null);
  s.clipSaved('a', 100); s.clipSaved('b', 200);
  const ended = s.gameChanged(null, 1000);
  assert.deepEqual(ended.clips, ['a', 'b']);
  assert.equal(ended.name, 'FNAJ');
  assert.deepEqual(s.clipSaved('c', 5000), { session: s.ended, late: true });
  assert.deepEqual(s.ended.clips, ['a', 'b', 'c']);
  assert.equal(s.clipSaved('d', 60000).session, null);
});

test('switching straight to another game ends the first session and starts a new one', () => {
  const s = new Sessions();
  s.gameChanged({ key: 'a', name: 'A' }, 0);
  s.clipSaved('x', 1);
  const ended = s.gameChanged({ key: 'b', name: 'B' }, 10);
  assert.deepEqual(ended.clips, ['x']);
  assert.equal(s.cur.key, 'b');
  assert.equal(s.gameChanged({ key: 'b', name: 'B' }, 20), null);
});

test('auto-upload triggers', () => {
  const base = { autoUpload: 'off', openOnGameClose: true };
  assert.equal(uploadOnSave({ ...base, autoUpload: 'on_clip' }, { signedIn: true, late: false }), true);
  assert.equal(uploadOnSave({ ...base, autoUpload: 'on_clip' }, { signedIn: false }), false);
  assert.equal(uploadOnSave({ ...base, autoUpload: 'on_game_close' }, { signedIn: true, late: false }), false);
  assert.equal(uploadOnSave({ ...base, autoUpload: 'on_game_close' }, { signedIn: true, late: true }), true);
  assert.equal(uploadOnSave(base, { signedIn: true, late: true }), false);
  const sess = { clips: ['a', 'b'] };
  assert.deepEqual(onSessionEnd({ ...base, autoUpload: 'on_game_close' }, sess, { signedIn: true, otherGame: false }), { upload: ['a', 'b'], open: true });
  assert.deepEqual(onSessionEnd({ ...base, autoUpload: 'on_clip' }, sess, { signedIn: true, otherGame: true }), { upload: [], open: false });
  assert.deepEqual(onSessionEnd({ ...base, openOnGameClose: false }, sess, { signedIn: false, otherGame: false }), { upload: [], open: false });
  assert.deepEqual(onSessionEnd(base, { clips: [] }, { signedIn: true, otherGame: false }), { upload: [], open: false });
});

test('settings migration 1.0 -> 1.1: old defaults move, choices stay', () => {
  const m = clean(migrate({ hotkey: 'Alt+F10', sound: 'sparkle', overlayCorner: 'top-right', mic: false, clipLength: 60 }));
  assert.equal(m.hotkey, 'Alt+C');
  assert.equal(m.sound, 'shutter');
  assert.equal(m.overlayCorner, 'top-left');
  assert.equal(m.mic, false, 'the mic stays off until the popup gets a yes');
  assert.equal(m.micAsked, false);
  assert.equal(m.clipLength, 60);
  assert.equal(m.settingsVersion, 4);
  assert.deepEqual(m.audioApps, { discord: false, fluxer: false, ember: false }, 'voice apps are off until the popup gets a yes');
  assert.equal(m.voiceAsked, false);
  const kept = clean(migrate({ hotkey: 'Ctrl+Shift+K', sound: 'coin', overlayCorner: 'bottom-right' }));
  assert.deepEqual([kept.hotkey, kept.sound, kept.overlayCorner], ['Ctrl+Shift+K', 'coin', 'bottom-right']);
  assert.equal(clean(migrate({ settingsVersion: 2, hotkey: 'Alt+F10' })).hotkey, 'Alt+F10');
  const fresh = clean(migrate({}));
  assert.deepEqual([fresh.hotkey, fresh.sound, fresh.overlayCorner, fresh.autoUpload, fresh.autoUploadVisibility, fresh.openOnGameClose], ['Alt+C', 'shutter', 'top-left', 'off', 'draft', true]);
  assert.equal(clean({ sound: 'custom' }).sound, 'shutter');
  assert.equal(clean({ sound: 'custom', customSound: 'custom.ogg' }).sound, 'custom');
  assert.equal(clean({ autoUpload: 'sometimes' }).autoUpload, 'off');
});
