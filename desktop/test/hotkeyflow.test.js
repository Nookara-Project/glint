const test = require('node:test');
const assert = require('node:assert/strict');
const { decide, eligibleApp, ADD_WINDOW_MS, TOAST_GAP_MS } = require('../lib/hotkeyflow');

const GAME = { pid: 500, path: 'D:\\Games\\Indie\\Thing.exe', fullscreen: true };
const idle = { recording: false, wanted: false, startedWantingAt: 0 };

test('recording -> the press saves a clip', () => {
  assert.deepEqual(decide({ recording: true }, null, GAME, 1000), { action: 'clip' });
  assert.deepEqual(decide({ recording: true }, { path: GAME.path, at: 900 }, GAME, 1000), { action: 'clip' });
});

test('not recording: reason + the offer to record the app in front', () => {
  const d = decide(idle, null, GAME, 10000, 0);
  assert.equal(d.action, 'idle');
  assert.equal(d.reason, 'No game detected');
  assert.deepEqual([d.offer.exe, d.offer.name, d.offer.fullscreen], ['Thing.exe', 'Thing', true]);
  assert.equal(d.toast, true);
});

test('starting / paused: no offer (a game is already detected)', () => {
  const s = decide({ recording: false, wanted: true, startedWantingAt: 9000 }, null, GAME, 10000);
  assert.deepEqual([s.reason, s.offer], ['Recording is starting...', null]);
  const p = decide({ recording: false, wanted: true, startedWantingAt: 1000 }, null, GAME, 60000);
  assert.equal(p.reason, 'Recording paused');
});

test('second press within 5 s with the same app in front adds it; later / another app does not', () => {
  const pending = { path: GAME.path, exe: 'Thing.exe', at: 10000 };
  const add = decide(idle, pending, GAME, 10000 + ADD_WINDOW_MS - 1);
  assert.equal(add.action, 'add');
  assert.equal(add.app.path, GAME.path);
  assert.equal(decide(idle, pending, { ...GAME, path: GAME.path.toUpperCase() }, 12000).action, 'add');
  assert.equal(decide(idle, pending, GAME, 10000 + ADD_WINDOW_MS + 1).action, 'idle');
  assert.equal(decide(idle, pending, { pid: 9, path: 'C:\\Other\\app.exe' }, 11000).action, 'idle');
  assert.equal(decide(idle, pending, null, 11000).action, 'idle');
});

test('mashing the key: no stacked toasts (but the add still works)', () => {
  assert.equal(decide(idle, null, GAME, 10000, 10000 - TOAST_GAP_MS + 50).toast, false);
  assert.equal(decide(idle, null, GAME, 10000, 10000 - TOAST_GAP_MS).toast, true);
  assert.equal(decide(idle, { path: GAME.path, at: 9900 }, GAME, 10000, 9990).action, 'add');
});

test('never offered: Glint itself, the desktop, system processes, shells', () => {
  assert.equal(eligibleApp({ pid: 42, path: 'C:\\Program Files\\Glint\\Glint.exe' }, 42), null);
  assert.equal(eligibleApp({ pid: 7, path: 'C:\\Users\\me\\AppData\\Local\\Programs\\glint\\Glint.exe' }, 1), null);
  assert.equal(eligibleApp({ pid: 1, path: 'C:\\Windows\\explorer.exe' }), null);
  assert.equal(eligibleApp({ pid: 1, path: 'C:\\Windows\\System32\\taskmgr.exe' }), null);
  assert.equal(eligibleApp({ pid: 1, path: 'C:\\Windows\\SystemApps\\Microsoft.Windows.StartMenuExperienceHost_cw5n1h2txyewy\\StartMenuExperienceHost.exe' }), null);
  assert.equal(eligibleApp({ pid: 1, path: 'C:\\Program Files\\WindowsApps\\Microsoft.WindowsTerminal\\WindowsTerminal.exe' }), null);
  assert.equal(eligibleApp({ pid: 1, path: '' }), null);
  assert.equal(eligibleApp(null), null);
  assert.equal(decide(idle, null, { pid: 1, path: 'C:\\Windows\\explorer.exe' }, 5000).offer, null);
  assert.ok(eligibleApp({ pid: 3, path: 'C:\\Users\\me\\AppData\\Local\\Hyperfocus\\Apps\\fnaj\\fnaj.exe' }));
});
