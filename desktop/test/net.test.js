const test = require('node:test');
const assert = require('node:assert/strict');
const n = require('../lib/net');

test('the real cause is logged, not just "fetch failed"', () => {
  const e = new TypeError('fetch failed', { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }) });
  assert.equal(n.reasonOf(e), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  assert.equal(n.describe(e), 'fetch failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)');
  const noCode = new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND nookara.cc') });
  assert.equal(n.describe(noCode), 'fetch failed (getaddrinfo ENOTFOUND nookara.cc)');
  assert.equal(n.describe(new Error('plain')), 'plain');
  assert.equal(n.describe(Object.assign(new Error('net::ERR_CERT_AUTHORITY_INVALID'), { code: 'net::ERR_CERT_AUTHORITY_INVALID' })), 'net::ERR_CERT_AUTHORITY_INVALID');
  assert.equal(n.reasonOf(null), 'unknown');
});

test('transient = no HTTP answer / 5xx / 429; never a 4xx or a cancel', () => {
  assert.equal(n.isTransient(new TypeError('fetch failed')), true);
  assert.equal(n.isTransient({ status: 502 }), true);
  assert.equal(n.isTransient({ status: 429 }), true);
  assert.equal(n.isTransient({ status: 403 }), false);
  assert.equal(n.isTransient({ code: 'cancelled' }), false);
  const ac = new AbortController(); ac.abort();
  assert.equal(n.isTransient(new Error('x'), ac.signal), false);
});

test('retry: backs off on transient errors, stops on the first real answer / hard error', async () => {
  const waits = [];
  const sleep = ms => { waits.push(ms); return Promise.resolve(); };
  let calls = 0;
  const v = await n.retry(async () => { if (++calls < 3) throw new TypeError('fetch failed'); return 'ok'; }, { sleep });
  assert.deepEqual([v, calls, waits], ['ok', 3, [700, 1500]]);
  calls = 0;
  await assert.rejects(n.retry(async () => { calls++; throw Object.assign(new Error('forbidden'), { status: 403 }); }, { sleep }), /forbidden/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(n.retry(async () => { calls++; throw new TypeError('fetch failed'); }, { sleep, tries: 4 }), /fetch failed/);
  assert.equal(calls, 4);
});

test('makeFetch: net.fetch when ready, Node fetch before that or when net.fetch throws synchronously', async () => {
  const used = [];
  const nodeFetch = async u => { used.push(['node', u]); return 'node'; };
  let ready = false;
  const f = n.makeFetch({ getNetFetch: () => (ready ? async u => { used.push(['net', u]); return 'net'; } : null), nodeFetch });
  assert.equal(await f('a'), 'node');
  ready = true;
  assert.equal(await f('b'), 'net');
  const g = n.makeFetch({ getNetFetch: () => () => { throw new TypeError('unsupported'); }, nodeFetch });
  assert.equal(await g('c'), 'node');
  assert.deepEqual(used.map(x => x[0]), ['node', 'net', 'node']);
});

test('multipart buffer parses back into the same fields + file (what Nookara\'s multer gets)', async () => {
  const data = Buffer.from([0, 1, 2, 255, 13, 10, 45, 45]);
  const m = n.multipart({ sessionId: 'glint_abc', chunkIndex: '0', totalChunks: '3' }, { field: 'chunk', name: 'chunk_0', data });
  const fd = await new Response(m.body, { headers: { 'content-type': m.contentType } }).formData();
  assert.equal(fd.get('sessionId'), 'glint_abc');
  assert.equal(fd.get('totalChunks'), '3');
  const f = fd.get('chunk');
  assert.equal(f.name, 'chunk_0');
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), data);
});
