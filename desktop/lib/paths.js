const path = require('path');
const fs = require('fs');

let packaged = false;
try { packaged = require('electron').app?.isPackaged || false; } catch {  }
const root = path.join(__dirname, '..');
const res = packaged ? process.resourcesPath : null;

const ffmpeg = packaged ? path.join(res, 'ffmpeg', 'ffmpeg.exe') : path.join(root, 'vendor', 'ffmpeg', 'ffmpeg.exe');
const helper = packaged ? path.join(res, 'bin', 'glint-helper.exe') : path.join(root, 'bin', 'glint-helper.exe');
const assets = path.join(root, 'assets');

module.exports = { ffmpeg, helper, assets, root, have: p => { try { return fs.statSync(p).isFile(); } catch { return false; } } };
