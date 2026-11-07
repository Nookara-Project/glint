require('./_electron-stub');
const test = require('node:test');
const assert = require('node:assert');
const { waitForGrant, APP_ID, APP_ORIGIN } = require('../lib/velora');

const post = (url, body, type = 'application/json') => fetch(`${url}grant`, { method: 'POST', headers: { 'Content-Type': type }, body });

test('the app id and address', () => {
  assert.match(APP_ID, /^app_[0-9a-f]{20}$/);
  assert.strictEqual(APP_ORIGIN, 'https://clips.nookara.cc');
});
test('a local page on 127.0.0.1 passes the grant for this code on, once it arrives', async () => {
  const back = await waitForGrant({ cancelled: false });
  try {
    assert.match(back.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetch(back.url);
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /nookara_grant/);
    const got = back.grant('code1', 3000);
    assert.strictEqual((await post(back.url, JSON.stringify({ code: 'other', grant: 'nope' }))).status, 204);
    assert.strictEqual((await post(back.url, JSON.stringify({ code: 'code1', grant: 'yes' }))).status, 204);
    assert.strictEqual(await got, 'yes');
  } finally { back.close(); }
});
test('only JSON posts count (a web page can not send those here without a preflight), bad bodies are refused', async () => {
  const back = await waitForGrant({ cancelled: false });
  try {
    assert.strictEqual((await post(back.url, 'code=a&grant=b', 'text/plain')).status, 404);
    assert.strictEqual((await post(back.url, 'not json')).status, 400);
    assert.strictEqual((await fetch(`${back.url}nope`)).status, 404);
    assert.strictEqual(await back.grant('a', 300), null);
  } finally { back.close(); }
});
test('cancelling ends the wait', async () => {
  const flow = { cancelled: false };
  const back = await waitForGrant(flow);
  try {
    const got = back.grant('a', 60000);
    flow.cancelled = true;
    assert.strictEqual(await got, null);
  } finally { back.close(); }
});
