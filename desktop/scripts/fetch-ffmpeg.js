const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = '9.0.2';
const URL = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/ffmpeg-${VERSION}-essentials_build.zip`;
const SHA256 = '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba';
const root = path.join(__dirname, '..');
const dir = path.join(root, 'vendor', 'ffmpeg');
const exe = path.join(dir, 'ffmpeg.exe');
const zip = path.join(root, 'vendor', `ffmpeg-${VERSION}-essentials_build.zip`);
const stampFile = path.join(dir, 'VERSION');

(async () => {
  if (fs.existsSync(exe) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8').trim() === VERSION) { console.log(`[ffmpeg] ${VERSION} present`); return; }
  fs.mkdirSync(dir, { recursive: true });
  const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  if (!fs.existsSync(zip) || sha(zip) !== SHA256) {
    console.log(`[ffmpeg] downloading ${URL}`);
    const r = await fetch(URL);
    if (!r.ok) throw new Error(`download failed: ${r.status}`);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  }
  if (sha(zip) !== SHA256) { fs.rmSync(zip, { force: true }); throw new Error('ffmpeg zip sha256 mismatch'); }
  const tmp = path.join(root, 'vendor', 'ffmpeg-extract');
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp, `ffmpeg-${VERSION}-essentials_build/bin/ffmpeg.exe`, `ffmpeg-${VERSION}-essentials_build/LICENSE`], { stdio: 'inherit' });
  fs.copyFileSync(path.join(tmp, `ffmpeg-${VERSION}-essentials_build`, 'bin', 'ffmpeg.exe'), exe);
  fs.copyFileSync(path.join(tmp, `ffmpeg-${VERSION}-essentials_build`, 'LICENSE'), path.join(dir, 'LICENSE.txt'));
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(stampFile, VERSION);
  console.log(`[ffmpeg] ${VERSION} ready at vendor/ffmpeg/ffmpeg.exe`);
})().catch(e => { console.error(`[ffmpeg] ${e.message}`); process.exit(1); });
