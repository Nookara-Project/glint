const MIN = 64;
const evenDown = n => Math.max(0, Math.floor(n / 2) * 2);

const ASPECTS = { free: null, '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3 };

function cleanCrop(c, W, H) {
  if (!c || typeof c !== 'object') return null;
  W = evenDown(Number(W) || 0); H = evenDown(Number(H) || 0);
  if (W < MIN || H < MIN) return null;
  let x = evenDown(Math.max(0, Math.round(Number(c.x) || 0))), y = evenDown(Math.max(0, Math.round(Number(c.y) || 0)));
  x = Math.min(x, W - MIN); y = Math.min(y, H - MIN);
  let w = evenDown(Math.round(Number(c.w) || 0)), h = evenDown(Math.round(Number(c.h) || 0));
  w = Math.max(MIN, Math.min(w, W - x)); h = Math.max(MIN, Math.min(h, H - y));
  if (x === 0 && y === 0 && w >= W && h >= H) return null;
  return { x, y, w, h };
}
function presetRect(aspect, W, H) {
  if (!aspect) return { x: 0, y: 0, w: evenDown(W), h: evenDown(H) };
  let w = W, h = W / aspect;
  if (h > H) { h = H; w = H * aspect; }
  w = evenDown(w); h = evenDown(h);
  return { x: evenDown((W - w) / 2), y: evenDown((H - h) / 2), w, h };
}
function fitAspect(rect, aspect, W, H) {
  if (!aspect) return cleanCrop(rect, W, H) || { x: 0, y: 0, w: evenDown(W), h: evenDown(H) };
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  let w = rect.w, h = w / aspect;
  if (h > rect.h) { h = rect.h; w = h * aspect; }
  if (w > W) { w = W; h = w / aspect; }
  if (h > H) { h = H; w = h * aspect; }
  if (w < MIN || h < MIN) { const k = Math.max(MIN / w, MIN / h); w *= k; h *= k; }
  w = evenDown(w); h = evenDown(h);
  const x = evenDown(Math.min(Math.max(0, cx - w / 2), W - w)), y = evenDown(Math.min(Math.max(0, cy - h / 2), H - h));
  return { x, y, w, h };
}
const cropFilter = c => (c ? `crop=${c.w}:${c.h}:${c.x}:${c.y}` : null);
const croppedSize = (c, W, H) => (c ? { width: c.w, height: c.h } : { width: W, height: H });

module.exports = { MIN, ASPECTS, cleanCrop, presetRect, fitAspect, cropFilter, croppedSize };
