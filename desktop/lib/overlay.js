const { BrowserWindow, screen } = require('electron');
const path = require('path');

const W = 400, H = 118, MARGIN = 24;
let win = null, ready = false, queue = [], idleTimer = null, warmWanted = false;
let lastRect = null, lastCorner = 'top-left', soundCfg = null;

function ensure() {
  if (win && !win.isDestroyed()) return;
  ready = false;
  win = new BrowserWindow({
    width: W, height: H, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, focusable: false, hasShadow: false,
    show: false, alwaysOnTop: true, type: 'toolbar', title: 'Glint overlay',
    webPreferences: { preload: path.join(__dirname, '..', 'overlay-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.setContentProtection(true);
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.webContents.on('did-finish-load', () => {
    ready = true;
    if (soundCfg) win.webContents.send('overlay:sound', soundCfg);
    place(lastRect, lastCorner);
    const q = queue; queue = []; q.forEach(send);
  });
  win.on('closed', () => { win = null; ready = false; });
  win.loadFile(path.join(__dirname, '..', 'assets', 'overlay.html'));
}
function send(msg) {
  if (!win || win.isDestroyed()) return;
  if (!ready) { queue.push(msg); return; }
  if (msg.show) {
    if (msg.rect !== undefined || msg.corner) place(msg.rect ?? lastRect, msg.corner || lastCorner);
    win.showInactive(); win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop();
  }
  win.webContents.send('overlay:toast', msg);
}
function place(rect, corner) {
  if (!win || win.isDestroyed()) return;
  lastRect = rect || lastRect; lastCorner = corner || lastCorner;
  let d = null;
  try { if (lastRect && lastRect.w > 0) d = screen.getDisplayMatching(screen.screenToDipRect(null, { x: lastRect.x, y: lastRect.y, width: lastRect.w, height: lastRect.h })); } catch { d = null; }
  const b = (d || screen.getPrimaryDisplay()).bounds;
  const c = String(lastCorner || 'top-left');
  const x = c.endsWith('left') ? b.x + MARGIN : b.x + b.width - W - MARGIN;
  const y = c.startsWith('bottom') ? b.y + b.height - H - MARGIN - 40 : b.y + MARGIN;
  const nb = { x: Math.round(x), y: Math.round(y), width: W, height: H };
  const cur = win.getBounds();
  if (cur.x !== nb.x || cur.y !== nb.y) win.setBounds(nb);
}

function warm(rect, corner) {
  warmWanted = true;
  clearTimeout(idleTimer);
  lastRect = rect || lastRect; lastCorner = corner || lastCorner;
  ensure();
  if (ready) place(lastRect, lastCorner);
}
function cool() {
  warmWanted = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!warmWanted && win && !win.isDestroyed()) win.destroy(); }, 60000);
}
function setSound(cfg) {
  soundCfg = cfg;
  if (win && !win.isDestroyed() && ready) win.webContents.send('overlay:sound', cfg);
}

function toast(t) {
  if (!t.show && !t.sound) return;
  ensure();
  send(t);
  if (!warmWanted) cool();
}
function hidden() { if (win && !win.isDestroyed() && win.isVisible()) win.hide(); }
function stopAll() { clearTimeout(idleTimer); if (win && !win.isDestroyed()) win.destroy(); win = null; }

module.exports = { toast, warm, cool, setSound, hidden, stopAll, isOverlay: wc => !!(win && !win.isDestroyed() && wc === win.webContents) };
