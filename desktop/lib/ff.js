const { spawn, execFile } = require('child_process');
const fs = require('fs');
const paths = require('./paths');
const { parseProbe, probeEncoderArgs, probeCaptureArgs, ENCODERS } = require('./ffargs');
const encprobe = require('./encprobe');

function run(args, opts = {}) {
  return new Promise((resolve, reject) => {
    const a = opts.onProgress ? [args[0], '-progress', 'pipe:2', '-nostats', ...args.slice(1)] : args;
    const p = spawn(paths.ffmpeg, a, { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', opts.stdout ? 'pipe' : 'ignore', 'pipe'] });
    let err = '', out = '';
    if (opts.stdout) p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => {
      const t = String(d);
      if (opts.onProgress) { const m = t.match(/out_time_us=(\d+)/g); if (m) opts.onProgress(Number(m[m.length - 1].split('=')[1]) / 1e6); }
      err += t; if (err.length > 64 * 1024) err = err.slice(-32 * 1024);
    });
    p.on('error', reject);
    if (opts.signal) opts.signal.addEventListener('abort', () => { try { p.kill(); } catch {  } }, { once: true });
    p.on('exit', code => {
      if (opts.signal?.aborted) return reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      return code === 0 || opts.allowFail ? resolve({ code, stderr: err, stdout: out }) : reject(Object.assign(new Error(lastLines(err) || `ffmpeg exited with ${code}`), { stderr: err, exitCode: code }));
    });
  });
}
const lastLines = s => String(s || '').trim().split(/\r?\n/).filter(l => l.trim()).slice(-3).join(' | ');
const GENERIC = /Task finished with error|Terminating thread|Nothing was written|Conversion failed|Could not open encoder before EOF|Error while filtering|Error reinitializing filters/i;
function reasonOf(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map(l => l.replace(/^\[[^\]]+@ [0-9a-fx]+\]\s*/i, '').trim()).filter(Boolean);
  const good = lines.filter(l => !GENERIC.test(l));
  return (good.length ? good.slice(-2) : lines.slice(-1)).join(' | ').slice(0, 300) || 'failed';
}

async function probe(file) {
  const r = await run(['-hide_banner', '-nostdin', '-i', file], { allowFail: true });
  return parseProbe(r.stderr);
}

async function detectEncoders(why = {}) {
  const ok = [];
  for (const e of ENCODERS) {
    if (e === 'libx264') { ok.push(e); continue; }
    try { await run(probeEncoderArgs(e)); ok.push(e); } catch (x) { why[e] = reasonOf(x.stderr || x.message);  }
  }
  return ok;
}

async function detectCaptureEncoders(cacheFile, outputIdx = 0) {
  let gpu = null;
  try { gpu = await helper('gpu'); } catch { gpu = null; }
  let ffStamp = '';
  try { const st = fs.statSync(paths.ffmpeg); ffStamp = `${st.size}-${Math.round(st.mtimeMs)}`; } catch {  }
  const key = encprobe.cacheKey(gpu, ffStamp);
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.key === key && Array.isArray(c.result?.list)) return { ...c.result, cached: true, gpu, log: [`cached probe for ${gpu?.name || 'this GPU'} (driver ${gpu?.driver || '?'})`, ...(c.log || [])] };
  } catch {  }
  const why = {};
  const available = await detectEncoders(why);
  const tryChain = async (enc, chain) => {
    try { await run(probeCaptureArgs(enc, chain, outputIdx), { signal: AbortSignal.timeout(20000) }); return null; }
    catch (e) { return e.code === 'cancelled' ? 'timed out' : reasonOf(e.stderr || e.message); }
  };
  const result = await encprobe.probeAll(available, tryChain);
  const log = [`GPU ${gpu?.name || '?'} (vendor ${gpu?.vendor || '?'}, driver ${gpu?.driver || '?'})`,
    ...Object.entries(why).map(([e, w]) => `${e}: synthetic test failed - ${String(w).slice(0, 300)}`), ...encprobe.describe(result, available)];
  if (result.captureOk) { try { fs.writeFileSync(cacheFile, JSON.stringify({ key, result, log, at: new Date().toISOString() }, null, 1)); } catch {  } }
  return { ...result, cached: false, gpu, log };
}

function helper(mode, arg, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (!paths.have(paths.helper)) return reject(new Error('glint-helper.exe is missing'));
    execFile(paths.helper, arg != null ? [mode, String(arg)] : [mode], { windowsHide: true, timeout, maxBuffer: 32 << 20 }, (e, out) => {
      if (e) return reject(e);
      try { resolve(JSON.parse(String(out).replace(/[\u0000-\u001f]/g, ' '))); } catch (x) { reject(x); }
    });
  });
}

const ready = () => paths.have(paths.ffmpeg) && paths.have(paths.helper);
const fileSize = f => { try { return fs.statSync(f).size; } catch { return 0; } };

module.exports = { reasonOf, run, probe, detectEncoders, detectCaptureEncoders, helper, ready, fileSize, lastLines };
