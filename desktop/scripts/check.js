const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..');
const skip = new Set(['node_modules', 'dist', 'vendor', '.git']);
const files = [];
(function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (skip.has(e.name)) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p); } })(root);
files.push(path.join(root, 'lib', 'vendor', 'games.js'));
let bad = 0;
for (const f of files) { try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(`FAIL ${path.relative(root, f)}\n${e.stderr}`); } }
console.log(`[check] ${files.length - bad}/${files.length} files OK`);
process.exit(bad ? 1 : 0);
