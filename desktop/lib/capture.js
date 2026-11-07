const even = n => Math.max(2, Math.floor(n / 2) * 2);

function decideCapture(o) {
  const m = o.mon || {};
  const monitor = reason => ({ mode: 'monitor', reason, outputIdx: m.idx | 0, width: even(m.w || 1920), height: even(m.h || 1080) });
  if (o.setting === 'monitor') return monitor('setting: whole monitor');
  const w = m.found !== false && m.hwnd && m.win;
  if (!w) return monitor('no game window (desktop recording)');
  if (w.covers) return monitor('the game covers its monitor (fullscreen / borderless)');
  if (!(w.cw >= 64 && w.ch >= 64)) return monitor('the game window is too small or minimised');
  if (o.hasGfx && !o.stalled) {
    const keep = o.sticky && o.sticky.hwnd === m.hwnd;
    return { mode: 'window', reason: 'windowed game: capturing just its window', outputIdx: m.idx | 0, hwnd: m.hwnd, width: keep ? o.sticky.width : even(w.cw), height: keep ? o.sticky.height : even(w.ch) };
  }
  const x = Math.max(0, w.cx - (m.x || 0)), y = Math.max(0, w.cy - (m.y || 0));
  const width = even(Math.min(w.cw, (m.w || w.cw) - x)), height = even(Math.min(w.ch, (m.h || w.ch) - y));
  if (width < 64 || height < 64) return monitor('the game window is mostly off-screen');
  return { mode: 'region', reason: o.hasGfx ? 'window capture gave no frames: recording the window\'s area of the screen' : 'no window capture in this ffmpeg: recording the window\'s area of the screen', outputIdx: m.idx | 0, x: even(x), y: even(y), width, height };
}

function sourceFilter(cap, fps, cursor) {
  const mouse = cursor === false ? 0 : 1;
  if (cap.mode === 'window') return `gfxcapture=hwnd=${cap.hwnd}:capture_cursor=${mouse}:display_border=0:capture_border=0:max_framerate=${fps}:resize_mode=scale_aspect:width=${cap.width}:height=${cap.height}`;
  const base = `ddagrab=output_idx=${Math.max(0, cap.outputIdx | 0)}:framerate=${fps}:draw_mouse=${mouse}:dup_frames=1`;
  if (cap.mode === 'region') return `${base}:offset_x=${cap.x}:offset_y=${cap.y}:video_size=${cap.width}x${cap.height}`;
  return base;
}
function sameCapture(a, b) {
  if (!a || !b || a.mode !== b.mode || (a.outputIdx | 0) !== (b.outputIdx | 0)) return false;
  if (a.mode === 'window') return a.hwnd === b.hwnd;
  if (a.mode === 'region') return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
  return a.width === b.width && a.height === b.height;
}
function windowRectInClip(mon, clipW, clipH) {
  const w = mon && mon.win;
  if (!w || w.covers || !mon.w || !mon.h) return null;
  const sx = clipW / mon.w, sy = clipH / mon.h;
  const x = even(Math.max(0, (w.cx - mon.x) * sx)), y = even(Math.max(0, (w.cy - mon.y) * sy));
  const ww = even(Math.min(clipW - x, w.cw * sx)), hh = even(Math.min(clipH - y, w.ch * sy));
  return ww >= 64 && hh >= 64 ? { x, y, w: ww, h: hh } : null;
}

module.exports = { decideCapture, sourceFilter, sameCapture, windowRectInClip };
