const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ACCENT = '#9f8bd1', WHITE = '#ededf0', REC = '#e24848';
const corners = (o, t, arm, fill) => {
  const e = 100 - o;
  return [[o, o, arm, t], [o, o, t, arm], [e - arm, o, arm, t], [e - t, o, t, arm], [o, e - t, arm, t], [o, e - arm, t, arm], [e - arm, e - t, arm, t], [e - t, e - arm, t, arm]].map(rect => ({ rect, fill }));
};
const MARK = [...corners(12, 6, 26, ACCENT), { poly: [[41, 32], [71, 50], [41, 68]], fill: WHITE }];
const TRAY = [...corners(4, 12, 32, ACCENT), { poly: [[34, 24], [78, 50], [34, 76]], fill: ACCENT }];
const REC_DOT = { rect: [66, 66, 34, 34], fill: REC };

function svg(shapes) {
  const el = s => s.rect
    ? `<rect x="${s.rect[0]}" y="${s.rect[1]}" width="${s.rect[2]}" height="${s.rect[3]}" fill="${s.fill}"${s.opacity ? ` fill-opacity="${s.opacity}"` : ''}/>`
    : `<polygon points="${s.poly.map(p => p.join(',')).join(' ')}" fill="${s.fill}"${s.opacity ? ` fill-opacity="${s.opacity}"` : ''}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\n  <!-- Glint: viewfinder corners + a play mark. Square corners. -->\n  ${shapes.map(el).join('\n  ')}\n</svg>\n`;
}
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
function inside(s, x, y) {
  if (s.rect) { const [rx, ry, rw, rh] = s.rect; return x >= rx && x < rx + rw && y >= ry && y < ry + rh; }
  let c = false; const p = s.poly;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
function raster(shapes, size) {
  const px = Buffer.alloc(size * size * 4), SS = 5;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const ux = ((x + (sx + 0.5) / SS) / size) * 100, uy = ((y + (sy + 0.5) / SS) / size) * 100;
      for (let k = shapes.length - 1; k >= 0; k--) {
        const s = shapes[k];
        if (!inside(s, ux, uy)) continue;
        const [cr, cg, cb] = hex(s.fill), op = s.opacity ?? 1;
        r += cr * op; g += cg * op; b += cb * op; a += op;
        break;
      }
    }
    const n = SS * SS, o = (y * size + x) * 4;
    if (a > 0) { px[o] = Math.round(r / a); px[o + 1] = Math.round(g / a); px[o + 2] = Math.round(b / a); }
    px[o + 3] = Math.round((a / n) * 255);
  }
  return png(size, px);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function ico(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let off = 6 + images.length * 16;
  const dir = images.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(off, 12); off += data.length;
    return e;
  });
  return Buffer.concat([head, ...dir, ...images.map(i => i.data)]);
}

const root = path.join(__dirname, '..');
const web = path.join(root, '..', 'web', 'static');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256].map(size => ({ size, data: raster(size <= 32 ? TRAY : MARK, size) }))));
fs.writeFileSync(path.join(root, 'assets', 'icon.png'), raster(MARK, 256));
fs.writeFileSync(path.join(root, 'assets', 'icon.svg'), svg(MARK));
fs.writeFileSync(path.join(root, 'assets', 'tray.png'), raster(TRAY, 32));
fs.writeFileSync(path.join(root, 'assets', 'tray-rec.png'), raster([...TRAY, REC_DOT], 32));
if (fs.existsSync(path.join(root, '..', 'web'))) {
  fs.mkdirSync(web, { recursive: true });
  fs.writeFileSync(path.join(web, 'glint-512.png'), raster(MARK, 512));
  fs.writeFileSync(path.join(web, 'glint-icon.svg'), svg(MARK));
}
console.log('icons written');
