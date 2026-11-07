const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const src = path.join(root, 'helper', 'GlintHelper.cs');
const out = path.join(root, 'bin', 'glint-helper.exe');
const force = process.argv.includes('--force');

if (process.platform !== 'win32') { console.log('[helper] not Windows - skipped'); process.exit(0); }
if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) { console.log('[helper] up to date'); process.exit(0); }
const win = process.env.WINDIR || 'C:\Windows';
const csc = [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')].find(p => fs.existsSync(p));
if (!csc) { console.error('[helper] csc.exe (.NET Framework 4) not found'); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(csc, ['/nologo', '/optimize+', '/target:exe', '/platform:x64', `/out:${out}`, src], { stdio: 'inherit' });
console.log(`[helper] built ${path.relative(root, out)}`);
