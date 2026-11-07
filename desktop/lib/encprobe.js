const { CHAINS } = require('./ffargs');

const PROBE_VERSION = 2;
const ORDER = ['h264_nvenc', 'h264_amf', 'h264_qsv'];

const cacheKey = (gpu, ffStamp) => JSON.stringify([PROBE_VERSION, gpu?.vendor || 0, gpu?.device || 0, gpu?.driver || '', gpu?.name || '', ffStamp || '']);

async function probeAll(available, tryChain) {
  const failures = {};
  const base = await tryChain('libx264', 'download');
  if (base) {
    return { list: [...ORDER.filter(e => available.includes(e)).map(e => ({ encoder: e, chain: CHAINS[e][0] })), { encoder: 'libx264', chain: 'download' }], failures: { libx264: { download: base } }, captureOk: false };
  }
  const list = [];
  for (const enc of ORDER) {
    if (!available.includes(enc)) continue;
    for (const chain of CHAINS[enc]) {
      const why = await tryChain(enc, chain);
      if (!why) { list.push({ encoder: enc, chain }); break; }
      (failures[enc] = failures[enc] || {})[chain] = why;
    }
  }
  list.push({ encoder: 'libx264', chain: 'download' });
  return { list, failures, captureOk: true };
}

function describe(result, available) {
  const lines = [];
  for (const enc of [...ORDER, 'libx264']) {
    const picked = result.list.find(x => x.encoder === enc);
    const f = result.failures[enc];
    if (picked && result.captureOk) lines.push(`${enc}: ${picked.chain}${f ? ` (failed first: ${Object.entries(f).map(([c, w]) => `${c}: ${w}`).join('; ')})` : ''}`);
    else if (f) lines.push(`${enc}: unusable - ${Object.entries(f).map(([c, w]) => `${c}: ${w}`).join('; ')}`);
    else if (!available.includes(enc)) lines.push(`${enc}: not available (no such GPU / driver, or the synthetic test failed)`);
  }
  if (!result.captureOk) lines.push('screen capture failed during the probe - using the untested order this time, not cached');
  return lines;
}

module.exports = { probeAll, describe, cacheKey, PROBE_VERSION, ORDER };
