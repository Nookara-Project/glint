require('./_electron-stub');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { matchCustom, matchAll } = require('../lib/gamedetect');
const hf = require('../lib/hyperfocus');
const ember = require('../lib/vendor/games');

test("the vendored detector is byte-identical to Ember's games.js", () => {
  const src = path.join(__dirname, '..', '..', '..', 'bonfire-desktop', 'lib', 'games.js');
  if (!fs.existsSync(src)) return;
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  assert.equal(sha(path.join(__dirname, '..', 'lib', 'vendor', 'games.js')), sha(src));
});

test('custom games match by full path (case-insensitive) or program name', () => {
  const list = [{ id: 'a', name: 'Indie Thing', path: 'D:\\Games\\Indie\\Thing.exe', icon: 'data:image/png;base64,x' }, { id: 'b', name: 'By Name', exe: 'byname.exe' }];
  assert.deepEqual(matchCustom({ p: 'd:/games/indie/thing.exe' }, list), { key: 'c:a', name: 'Indie Thing', image: 'data:image/png;base64,x', source: 'custom' });
  assert.equal(matchCustom({ p: 'C:\\x\\ByName.exe' }, list).key, 'c:b');
  assert.equal(matchCustom({ p: 'D:\\Games\\Indie\\Other.exe' }, list), null);
});

test('priority: custom > Hyperfocus > Ember; Glint itself never counts', () => {
  const idx = hf.buildIndex({ localAppData: 'C:\\L' });
  const p = { i: 5, p: 'C:\\L\\Hyperfocus\\Apps\\fnaj\\fnaj.exe' };
  const em = () => ({ key: 'd:1' });
  assert.equal(matchAll(p, { custom: [{ id: 'z', name: 'Mine', path: p.p }], hf: idx, ember: em }).key, 'c:z');
  assert.equal(matchAll(p, { custom: [], hf: idx, ember: em }).key, 'hf:fnaj');
  assert.equal(matchAll({ p: 'C:\\x\\roblox.exe' }, { custom: [], hf: idx, ember: em }).key, 'd:1');
  assert.equal(matchAll({ p: 'C:\\Program Files\\Glint\\Glint.exe' }, { custom: [{ id: 'g', name: 'G', exe: 'glint.exe' }], hf: idx, ember: em }), null);
});

test("Ember's matcher (vendored) still finds Minecraft Java offline", () => {
  const m = ember._match({ p: 'C:\\Program Files\\Java\\bin\\javaw.exe', c: 'javaw -cp x net.minecraft.client.main.Main' });
  assert.equal(m.key, 'mc');
  assert.equal(ember._match({ p: 'C:\\Program Files\\Java\\bin\\javaw.exe', c: 'javaw -jar other.jar' }), null);
});
