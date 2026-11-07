const test = require('node:test');
const assert = require('node:assert/strict');
const hf = require('../lib/hyperfocus');

const idx = hf.buildIndex({
  localAppData: 'C:\\Users\\nat\\AppData\\Local',
  settings: { installRoot: 'D:\\Games\\HF' },
  remote: { apps: [{ id: 'fnaj', name: 'Five Nights at JARVIS', icon: 'assets/fnaj/icon.png' }, { id: 'toomuchtoast', name: 'Too Much Toast!', icon: 'https://ikelene.net/launcher/assets/tmt.png' }] },
  manifestCache: { apps: [{ id: 'c-gvnwmwdj', name: 'Stone People to Death Simulator', icon: 'https://ikelene.net/launcher/assets/sptds/icon.png', community: true }] },
  installed: {
    fnaj: { dir: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\fnaj', name: 'Five Nights at JARVIS' },
    custom: { dir: 'E:\\Stuff\\MyGame', name: 'My Custom Install' },
    setupapp: { dir: 'C:\\Program Files\\Setup App', name: 'Setup App' },
  },
  installedBetas: { toomuchtoast: { dir: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\toomuchtoast-beta', name: 'Too Much Toast!' } },
});

test('index: roots + recorded folders + icons resolved', () => {
  assert.deepEqual(idx.roots.sort(), ['c:/users/nat/appdata/local/hyperfocus/apps', 'd:/games/hf']);
  assert.equal(idx.apps.get('fnaj').icon, 'https://ikelene.net/launcher/assets/fnaj/icon.png');
});

test('a game in the default Apps folder gets its catalogue name + icon', () => {
  const m = hf.match({ i: 1, p: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\fnaj\\five-nights-at-jarvis.exe' }, idx);
  assert.deepEqual(m, { key: 'hf:fnaj', name: 'Five Nights at JARVIS', image: 'https://ikelene.net/launcher/assets/fnaj/icon.png', source: 'hyperfocus' });
});

test('betas map to the same game; community games use the manifest cache', () => {
  assert.equal(hf.match({ p: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\toomuchtoast-beta\\TooMuchToast.exe' }, idx).key, 'hf:toomuchtoast');
  const c = hf.match({ p: 'C:/Users/nat/AppData/Local/Hyperfocus/Apps/c-gvnwmwdj/sub/game.exe' }, idx);
  assert.equal(c.name, 'Stone People to Death Simulator');
});

test('custom install folders, installers and a changed installRoot', () => {
  assert.equal(hf.match({ p: 'E:\\Stuff\\MyGame\\bin\\Game.exe' }, idx).name, 'My Custom Install');
  assert.equal(hf.match({ p: 'C:\\Program Files\\Setup App\\app.exe' }, idx).key, 'hf:setupapp');
  const r = hf.match({ p: 'D:\\Games\\HF\\somnilink-beta\\SOMNILINK.exe' }, idx);
  assert.equal(r.key, 'hf:somnilink');
  assert.equal(r.name, 'Somnilink');
  assert.equal(r.image, hf.HF_ICON);
});

test('not games: crash handlers, the downloads folder, loose files, other programs', () => {
  assert.equal(hf.match({ p: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\fnaj\\UnityCrashHandler64.exe' }, idx), null);
  assert.equal(hf.match({ p: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\.downloads\\x.exe' }, idx), null);
  assert.equal(hf.match({ p: 'C:\\Users\\nat\\AppData\\Local\\Hyperfocus\\Apps\\loose.exe' }, idx), null);
  assert.equal(hf.match({ p: 'C:\\Windows\\notepad.exe' }, idx), null);
  assert.equal(hf.match({ p: 'C:\\Users\\nat\\AppData\\Local\\Programs\\Hyperfocus\\Hyperfocus.exe' }, idx), null);
});

test('launched by Hyperfocus (Hyperfocus.exe -> cmd.exe -> game) from anywhere', () => {
  const procs = [
    { i: 10, pp: 1, p: 'C:\\Users\\nat\\AppData\\Local\\Programs\\Hyperfocus\\Hyperfocus.exe' },
    { i: 11, pp: 10, p: 'C:\\Windows\\System32\\cmd.exe' },
    { i: 12, pp: 11, p: 'F:\\Elsewhere\\cool_game.exe' },
    { i: 13, pp: 10, p: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' },
    { i: 14, pp: 99, p: 'F:\\Elsewhere\\other.exe' },
  ];
  const by = new Map(procs.map(p => [p.i, p]));
  assert.deepEqual(hf.match(procs[2], idx, by), { key: 'hf:exe:cool_game.exe', name: 'Cool Game', image: hf.HF_ICON, source: 'hyperfocus' });
  assert.equal(hf.match(procs[1], idx, by), null);
  assert.equal(hf.match(procs[3], idx, by), null);
  assert.equal(hf.match(procs[4], idx, by), null);
});
