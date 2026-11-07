
function reasonOf(e) {
  if (!e) return 'unknown';
  const c = e.cause && (e.cause.code || e.cause.message);
  return String(c || e.code || e.message || e).slice(0, 160);
}
function describe(e) {
  const msg = String(e?.message || e || 'error');
  const r = reasonOf(e);
  return r && r !== msg && !msg.includes(r) ? `${msg} (${r})` : msg;
}
function isTransient(e, signal) {
  if (signal?.aborted || e?.code === 'cancelled') return false;
  const st = Number(e?.status) || 0;
  return !st || st >= 500 || st === 429;
}
async function retry(fn, { tries = 4, delays = [700, 1500, 3000, 5000], signal, sleep = ms => new Promise(r => setTimeout(r, ms)), transient = isTransient } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(i); } catch (e) {
      last = e;
      if (i === tries - 1 || !transient(e, signal)) throw e;
      await sleep(delays[Math.min(i, delays.length - 1)]);
    }
  }
  throw last;
}
function makeFetch({ getNetFetch, nodeFetch }) {
  return function glintFetch(input, init) {
    const nf = getNetFetch();
    if (nf) {
      try { return nf(input, init); } catch {  }
    }
    return nodeFetch(input, init);
  };
}
let original = null;
let electronRef = null;
function installGlobalFetch(electron) {
  const nodeFetch = globalThis.fetch.bind(globalThis);
  original = nodeFetch; electronRef = electron;
  globalThis.fetch = makeFetch({ getNetFetch: () => (electron.app.isReady() && electron.net?.fetch ? electron.net.fetch.bind(electron.net) : null), nodeFetch });
  return nodeFetch;
}

function sendBuffer(url, { method = 'POST', headers = {}, body, signal, timeout = 120000, node = false } = {}) {
  const el = electronRef;
  if (node || !el || !el.app.isReady() || !el.net?.request) return viaNode();
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener?.('abort', onAbort); fn(v); };
    let req;
    try { req = el.net.request({ method, url, redirect: 'follow' }); } catch (e) { done = true; return viaNode().then(resolve, reject); }
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v);
    const onAbort = () => { try { req.abort(); } catch {  } const e = new Error('cancelled'); e.code = 'cancelled'; finish(reject, e); };
    const timer = setTimeout(() => { try { req.abort(); } catch {  } finish(reject, Object.assign(new Error('fetch failed'), { cause: { code: 'ETIMEDOUT' } })); }, timeout);
    if (signal) { if (signal.aborted) return onAbort(); signal.addEventListener('abort', onAbort, { once: true }); }
    req.on('response', res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => finish(resolve, { status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', e => finish(reject, Object.assign(new Error('fetch failed'), { cause: e })));
    });
    req.on('error', e => finish(reject, Object.assign(new Error('fetch failed'), { cause: e })));
    if (body !== undefined && body !== null) req.write(body);
    req.end();
  });
  async function viaNode() {
    const r = await (original || globalThis.fetch)(url, { method, headers, body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
    return { status: r.status, text: await r.text() };
  }
}

function multipart(fields, file) {
  const boundary = `----GlintBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const parts = [];
  for (const [k, v] of Object.entries(fields || {})) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  if (file) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`));
    parts.push(file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

module.exports = { reasonOf, describe, isTransient, retry, makeFetch, installGlobalFetch, multipart, sendBuffer };
