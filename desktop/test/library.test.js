require('./_electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Library, clipPath, cleanTrim, safeName } = require('../lib/library');
const { clean } = require('../lib/settings');

test('cleanTrim: whole clip = null, tiny = null, clamps to the clip', () => {
  assert.equal(cleanTrim({ in: 0, out: 30 }, 30), null);
  assert.equal(cleanTrim({ in: 3, out: 3.2 }, 30), null);
  assert.deepEqual(cleanTrim({ in: 2.12345, out: 50 }, 30), { in: 2.123, out: 30 });
  assert.deepEqual(cleanTrim({ in: -4, out: 10 }, 30), { in: 0, out: 10 });
  assert.equal(cleanTrim(null, 30), null);
});

test('clip paths: per-game folder, safe names, never overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-t-'));
  const d = new Date(2026, 9, 28, 17, 4, 5);
  const a = clipPath(dir, 'Raldi\'s Crackhouse: "Deluxe"?', d);
  assert.equal(path.basename(path.dirname(a)), "Raldi's Crackhouse Deluxe");
  assert.match(path.basename(a), /2026-10-28 17-04-05\.mp4$/);
  fs.mkdirSync(path.dirname(a), { recursive: true });
  fs.writeFileSync(a, '');
  assert.match(clipPath(dir, 'Raldi\'s Crackhouse: "Deluxe"?', d), /\(2\)\.mp4$/);
  assert.equal(safeName('   '), 'Desktop');
  assert.equal(safeName('CON. '), 'CON');
});

test('library add / trim / untrim / reconcile with /me/clips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glint-l-'));
  const lib = new Library(dir);
  const c = lib.add({ file: path.join(dir, 'a.mp4'), duration: 31.5, trim: { in: 1.5, out: 31.5 }, game: { key: 'hf:fnaj', name: 'FNAJ' } });
  assert.deepEqual(c.trim, { in: 1.5, out: 31.5 });
  lib.update(c.id, { trim: { in: 0, out: 31.5 } });
  assert.equal(lib.get(c.id).trim, null);
  lib.update(c.id, { upload: { id: 'abc', url: 'u', visibility: 'public', title: 't' } });
  const d = lib.add({ file: path.join(dir, 'b.mp4'), duration: 10, game: {} });
  lib.update(d.id, { upload: { id: 'gone1', url: 'u2', visibility: 'public', title: 't2' } });
  assert.equal(lib.reconcile([{ id: 'abc', visibility: 'unlisted', title: 'new' }]), 2);
  assert.equal(lib.get(c.id).upload.visibility, 'unlisted');
  assert.equal(lib.get(c.id).upload.title, 'new');
  assert.equal(lib.get(d.id).upload, null);
  assert.equal(lib.get(d.id).uploadGone, true);
  lib.flush();
  assert.equal(new Library(dir).list().length, 2);
});

test('settings.clean keeps only valid values', () => {
  const s = clean({ clipLength: 9999, resolution: '4k', fps: 144, hotkey: 'Alt+F10', sound: 'boom', customGames: [{ id: 'x', name: 'X', path: 'C:\\x.exe' }, { bad: 1 }], extra: 1 });
  assert.equal(s.clipLength, 600);
  assert.equal(s.resolution, 'native');
  assert.equal(s.fps, 60);
  assert.equal(s.sound, 'shutter');
  assert.equal(s.customGames.length, 1);
  assert.equal(s.extra, undefined);
  assert.equal(clean({ sound: 'off' }).sound, 'off');
});
