const test = require('node:test');
const { before, after } = test;
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PUB, startAll, makeSample, ffprobeJson, hasFfmpeg, JPEG, until } = require('./helpers');

const FF = hasFfmpeg();
let T, req, fake;
before(async () => { T = await startAll(); req = T.req; fake = T.fake; });
after(() => T.stop());

const body = (videoUrl, extra = {}) => ({ videoUrl, title: 'Draft play', game: 'Minecraft', durationSec: 4, width: 640, height: 360, thumbnail: JPEG, ...extra });
async function create(token, uid, extra = {}, file = '') {
  const name = `v_${Math.random().toString(36).slice(2)}.mp4`;
  const { id: mediaId, url } = fake.addMedia(uid, name, file);
  const r = await req('POST', '/api/clips', { token, body: body(url, extra) });
  assert.ok([200, 201].includes(r.status), r.text);
  return { id: r.json.id, mediaId, url, name };
}
const tracks2 = [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Mic', enabled: true, volume: 0.8 }];

// ------------------------------------------------------------------ drafts
test('drafts: validation, visibility rules, patch edit state', async () => {
  const { url } = fake.addMedia(7, 'bad.mp4');
  let r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', trim: { start: 3, end: 2 } }) });
  assert.strictEqual(r.json.error, 'invalid_trim');
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: [{ index: 0 }, { index: 0 }] }) });
  assert.strictEqual(r.json.error, 'invalid_audio_tracks');
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: [{ index: 0, volume: 3 }] }) });
  assert.strictEqual(r.json.error, 'invalid_audio_tracks');

  const d = await create('tokA', 7, { visibility: 'draft', trim: { start: 0.5, end: 3.5 }, audioTracks: tracks2, title: 'Secret draft' });
  assert.strictEqual((await req('GET', `/api/clips/${d.id}`)).status, 404);
  assert.strictEqual((await req('GET', `/api/clips/${d.id}`, { token: 'tokB' })).status, 404);
  assert.strictEqual((await req('PATCH', `/api/clips/${d.id}`, { token: 'tokB', body: { title: 'x' } })).status, 404);
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/view`)).status, 404);
  assert.ok(!(await req('GET', '/api/clips')).json.clips.some(c => c.id === d.id));
  assert.ok(!(await req('GET', '/api/clips?q=secret')).json.clips.length);
  assert.ok(!(await req('GET', '/api/games')).json.games.length);
  assert.strictEqual((await req('GET', '/api/users/alice')).json.clipCount, 0);
  const page = await req('GET', `/c/${d.id}`);
  assert.strictEqual(page.status, 404);
  assert.match(page.text, new RegExp(`"draftCandidate":"${d.id}"`));
  assert.ok(!page.text.includes('glint:id'));
  assert.strictEqual((await req('GET', `/api/thumb/${d.id}.jpg`)).status, 404, 'draft thumb needs a signature');
  r = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.json.trim, { start: 0.5, end: 3.5 });
  assert.strictEqual(r.json.audioTracks.length, 2);
  assert.strictEqual(r.json.status, 'ready');
  assert.strictEqual((await req('GET', r.json.thumbnail.replace('https://ikelene.net/glint', ''))).status, 200, 'signed draft thumb works');
  assert.ok((await req('GET', '/api/me/clips', { token: 'tokA' })).json.clips.some(c => c.id === d.id && c.visibility === 'draft'));
  r = await req('PATCH', `/api/clips/${d.id}`, { token: 'tokA', body: { trim: { start: 1, end: 2 }, audioTracks: [{ index: 1, enabled: false, volume: 0.5, label: 'renamed' }] } });
  assert.strictEqual(r.status, 200, r.text);
  assert.deepStrictEqual(r.json.trim, { start: 1, end: 2 });
  assert.deepStrictEqual(r.json.audioTracks[1], { index: 1, kind: 'mic', label: 'Mic', enabled: false, volume: 0.5 });
  r = await req('PATCH', `/api/clips/${d.id}`, { token: 'tokA', body: { trim: { start: 0, end: 99 } } });
  assert.strictEqual(r.json.error, 'invalid_trim');
  r = await req('PATCH', `/api/clips/${d.id}`, { token: 'tokA', body: { visibility: 'public' } });
  assert.strictEqual(r.json.error, 'use_publish');
  const p = await create('tokA', 7, { visibility: 'public' });
  r = await req('PATCH', `/api/clips/${p.id}`, { token: 'tokA', body: { trim: { start: 0, end: 1 } } });
  assert.strictEqual(r.json.error, 'not_a_draft');
  r = await req('GET', `/api/clips/${p.id}/edit`, { token: 'tokA' });
  assert.strictEqual(r.json.error, 'not_a_draft');
  await req('DELETE', `/api/clips/${p.id}`, { token: 'tokA' });
  await req('DELETE', `/api/clips/${d.id}`, { token: 'tokA' });
});

test('edit: proxies built with ffmpeg (muted video, one m4a per track, filmstrip)', { skip: !FF && 'no ffmpeg' }, async () => {
  const sample = makeSample(T.tmp, 'multi.mp4');
  const d = await create('tokA', 7, { visibility: 'draft' }, sample);
  let r = await req('GET', `/api/clips/${d.id}/edit`, { token: 'tokA' });
  assert.strictEqual(r.status, 200, r.text);
  assert.ok(['queued', 'building', 'ready'].includes(r.json.proxy.status));
  assert.strictEqual((await req('GET', `/api/clips/${d.id}/edit`, { token: 'tokB' })).status, 404);
  r = await until(async () => { const x = await req('GET', `/api/clips/${d.id}/edit`, { token: 'tokA' }); return x.json.proxy.status === 'ready' ? x : (x.json.proxy.status === 'failed' ? assert.fail(x.text) : null); });
  const e = r.json;
  assert.strictEqual(e.proxy.tracks.length, 2);
  assert.deepStrictEqual(e.audioTracks.map(t => [t.index, t.kind, t.label]), [[0, 'game', 'Game'], [1, 'mic', 'Mic']]);
  assert.deepStrictEqual(e.trim, { start: 0, end: 4 });
  const rel = u => u.replace('https://ikelene.net/glint', '');
  const v = await req('GET', rel(e.proxy.video));
  assert.strictEqual(v.status, 200);
  assert.strictEqual(v.headers.get('cache-control'), 'private, max-age=3600');
  const ranged = await req('GET', rel(e.proxy.video), { headers: { Range: 'bytes=0-99' } });
  assert.strictEqual(ranged.status, 206);
  assert.strictEqual((await req('GET', rel(e.proxy.video).replace(/sig=[^&]+/, 'sig=AAAA'))).status, 404);
  assert.strictEqual((await req('GET', rel(e.proxy.tracks[1].url))).status, 200);
  const dir = path.join(T.cfg.dataDir, 'drafts', d.id);
  const pv = ffprobeJson(path.join(dir, 'video.mp4'));
  assert.ok(!pv.streams.some(s => s.codec_type === 'audio'), 'proxy video is muted');
  assert.strictEqual(ffprobeJson(path.join(dir, 'a1.m4a')).streams[0].codec_type, 'audio');
  assert.ok(fs.existsSync(path.join(dir, 'strip.jpg')));
  await req('DELETE', `/api/clips/${d.id}`, { token: 'tokA' });
  assert.ok(!fs.existsSync(dir));
});

test('publish: trim + mix renders, uploads, swaps media, deletes the draft media', { skip: !FF && 'no ffmpeg' }, async () => {
  const sample = makeSample(T.tmp, 'pub.mp4');
  const d = await create('tokA', 7, { visibility: 'draft', title: 'To publish', trim: { start: 0.5, end: 3 },
    audioTracks: [{ index: 0, kind: 'game', label: 'Game', enabled: true, volume: 1 }, { index: 1, kind: 'mic', label: 'Mic', enabled: false, volume: 1 }] }, sample);
  const stale = T.made.clips.getRow(d.id);
  let r = await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'unlisted', title: 'Published!' } });
  assert.strictEqual(r.status, 202, r.text);
  assert.deepStrictEqual(r.json, { status: 'rendering' });
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: {} })).json.error, 'rendering');
  assert.strictEqual((await req('DELETE', `/api/clips/${d.id}`, { token: 'tokA' })).json.error, 'rendering');
  r = await until(async () => { const x = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' }); return x.json && x.json.status !== 'rendering' ? x : null; });
  assert.strictEqual(r.json.status, 'ready', r.text);
  assert.strictEqual(r.json.visibility, 'unlisted');
  assert.strictEqual(r.json.title, 'Published!');
  assert.notStrictEqual(r.json.videoUrl, d.url);
  assert.ok(Math.abs(r.json.durationSec - 2.5) < 0.2, `duration ${r.json.durationSec}`);
  assert.strictEqual(r.json.trim, undefined);
  assert.ok(fake.deletes.includes(d.mediaId), 'old draft media deleted');
  const up = fake.files.get(r.json.videoUrl.split('/').pop());
  const info = ffprobeJson(up);
  assert.strictEqual(info.streams.filter(s => s.codec_type === 'audio').length, 1, 'one mixed audio track');
  assert.ok(!fs.existsSync(path.join(T.cfg.dataDir, 'drafts', d.id)));
  assert.strictEqual((await req('GET', `/api/clips/${d.id}`)).status, 200);
  stale.last_checked = 0;
  const still = await T.made.clips.fresh(stale);
  assert.ok(still, 'fresh() re-reads the row after a swap');
  assert.strictEqual(T.made.clips.getRow(d.id).status, 'ok');
  await T.made.clips.sweep();
  assert.strictEqual(T.made.clips.getRow(d.id).status, 'ok');
});

test('publish: failures leave a draft with status failed (+ retry works)', { skip: !FF && 'no ffmpeg' }, async () => {
  const sample = makeSample(T.tmp, 'fail.mp4');
  const d = await create('tokA', 7, { visibility: 'draft', trim: { start: 0, end: 2 } }, sample);
  const waitDone = () => until(async () => { const x = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' }); return x.json.status !== 'rendering' ? x : null; });

  fake.chunkStatus = 413;
  await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
  let r = await waitDone();
  assert.deepStrictEqual([r.json.status, r.json.error, r.json.visibility], ['failed', 'storage_limit_exceeded', 'draft']);
  assert.strictEqual((await req('GET', `/api/clips/${d.id}`)).status, 404, 'still a hidden draft');

  fake.chunkStatus = 200;
  fake.revoked.add('tokA');
  await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
  r = await waitDone();
  assert.deepStrictEqual([r.json.status, r.json.error], ['failed', 'token_rejected']);
  fake.revoked.delete('tokA');

  const d2 = await create('tokA', 7, { visibility: 'draft', trim: { start: 0, end: 1 } }, sample);
  fake.files.delete(d2.name);
  T.made.clips.getRow(d2.id);
  T.db.prepare('UPDATE clips SET last_checked=? WHERE id=?').run(Date.now() + 1e9, d2.id);
  await req('POST', `/api/clips/${d2.id}/publish`, { token: 'tokA', body: {} });
  r = await until(async () => { const x = await req('GET', `/api/clips/${d2.id}`, { token: 'tokA' }); return x.json && x.json.status !== 'rendering' ? x : null; });
  assert.deepStrictEqual([r.json.status, r.json.error], ['failed', 'source_missing']);

  await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
  r = await waitDone();
  assert.deepStrictEqual([r.json.status, r.json.visibility], ['ready', 'public']);
  assert.ok((await req('GET', '/api/clips')).json.clips.some(c => c.id === d.id));
});

test('publish: single-track untrimmed draft goes live without a re-render', { skip: !FF && 'no ffmpeg' }, async () => {
  const sample = makeSample(T.tmp, 'one.mp4', { tracks: 1 });
  const d = await create('tokA', 7, { visibility: 'draft' }, sample);
  await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
  const r = await until(async () => { const x = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' }); return x.json.status !== 'rendering' ? x : null; });
  assert.strictEqual(r.json.status, 'ready');
  assert.strictEqual(r.json.videoUrl, d.url, 'same media');
  assert.strictEqual(r.json.mediaId, d.mediaId);
  assert.ok(!fake.deletes.includes(d.mediaId));
});

test('likes: idempotent, counted, per-user, drafts private', async () => {
  const c = await create('tokB', 8, { visibility: 'public', title: 'Likeable' });
  assert.strictEqual((await req('PUT', `/api/clips/${c.id}/like`)).status, 401);
  assert.deepStrictEqual((await req('PUT', `/api/clips/${c.id}/like`, { token: 'tokA' })).json, { liked: true, likes: 1 });
  assert.deepStrictEqual((await req('PUT', `/api/clips/${c.id}/like`, { token: 'tokA' })).json, { liked: true, likes: 1 });
  assert.deepStrictEqual((await req('PUT', `/api/clips/${c.id}/like`, { token: 'tokC' })).json, { liked: true, likes: 2 });
  assert.deepStrictEqual((await req('DELETE', `/api/clips/${c.id}/like`, { token: 'tokC' })).json, { liked: false, likes: 1 });
  let r = await req('GET', `/api/clips/${c.id}`, { token: 'tokA' });
  assert.deepStrictEqual([r.json.likes, r.json.liked], [1, true]);
  r = await req('GET', `/api/clips/${c.id}`);
  assert.strictEqual(r.json.liked, undefined);
  r = await req('GET', '/api/clips', { token: 'tokC' });
  const inList = r.json.clips.find(x => x.id === c.id);
  assert.deepStrictEqual([inList.likes, inList.liked], [1, false]);
  const d = await create('tokB', 8, { visibility: 'draft' });
  assert.strictEqual((await req('PUT', `/api/clips/${d.id}/like`, { token: 'tokA' })).status, 404);
  assert.strictEqual((await req('PUT', '/api/clips/AAAAAAAAAA/like', { token: 'tokA' })).status, 404);
  T.made.limits.like.reset();
  let last;
  for (let i = 0; i < 31; i++) last = await req(i % 2 ? 'DELETE' : 'PUT', `/api/clips/${c.id}/like`, { token: 'tokC' });
  assert.strictEqual(last.status, 429);
  T.made.limits.like.reset();
});

test('comments: validation, order, paging, delete rights, rate limit, purge with clip', async () => {
  const c = await create('tokB', 8, { visibility: 'public', title: 'Talk' });
  assert.strictEqual((await req('POST', `/api/clips/${c.id}/comments`, { body: { body: 'hi' } })).status, 401);
  assert.strictEqual((await req('POST', `/api/clips/${c.id}/comments`, { token: 'tokA', body: { body: '   \n ' } })).json.error, 'empty_comment');
  assert.strictEqual((await req('POST', `/api/clips/${c.id}/comments`, { token: 'tokA', body: { body: 'x'.repeat(501) } })).json.error, 'comment_too_long');
  const a = await req('POST', `/api/clips/${c.id}/comments`, { token: 'tokA', body: { body: '  first <b>bold</b>\n\n\n\nline  ' } });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(a.json.body, 'first <b>bold</b>\n\nline', 'stored as plain text, trimmed, breaks collapsed');
  assert.strictEqual(a.json.user.username, 'alice');
  const b = await req('POST', `/api/clips/${c.id}/comments`, { token: 'tokC', body: { body: 'second' } });
  let r = await req('GET', `/api/clips/${c.id}/comments`);
  assert.deepStrictEqual(r.json.comments.map(x => x.body), ['second', 'first <b>bold</b>\n\nline']);
  assert.strictEqual((await req('GET', `/api/clips/${c.id}`)).json.comments, 2);
  assert.strictEqual((await req('DELETE', `/api/comments/${a.json.id}`, { token: 'tokC' })).status, 403);
  assert.strictEqual((await req('DELETE', `/api/comments/${b.json.id}`, { token: 'tokB' })).status, 200, 'clip owner');
  assert.strictEqual((await req('DELETE', `/api/comments/${a.json.id}`, { token: 'tokA' })).status, 200, 'author');
  assert.strictEqual((await req('DELETE', `/api/comments/${a.json.id}`, { token: 'tokA' })).status, 404);
  assert.strictEqual((await req('GET', `/api/clips/${c.id}`)).json.comments, 0);
  for (let i = 0; i < 25; i++) {
    T.made.limits.comment.reset();
    await req('POST', `/api/clips/${c.id}/comments`, { token: 'tokA', body: { body: `c${i}` } });
  }
  r = await req('GET', `/api/clips/${c.id}/comments`);
  assert.strictEqual(r.json.comments.length, 20);
  assert.strictEqual(r.json.comments[0].body, 'c24');
  const r2 = await req('GET', `/api/clips/${c.id}/comments?cursor=${r.json.nextCursor}`);
  assert.deepStrictEqual(r2.json.comments.map(x => x.body), ['c4', 'c3', 'c2', 'c1', 'c0']);
  assert.strictEqual(r2.json.nextCursor, null);
  T.made.limits.comment.reset();
  let last;
  for (let i = 0; i < 11; i++) last = await req('POST', `/api/clips/${c.id}/comments`, { token: 'tokC', body: { body: `spam ${i}` } });
  assert.strictEqual(last.status, 429);
  const d = await create('tokB', 8, { visibility: 'draft' });
  assert.strictEqual((await req('GET', `/api/clips/${d.id}/comments`)).status, 404);
  assert.strictEqual((await req('GET', `/api/clips/${d.id}/comments`, { token: 'tokB' })).status, 200);
  await req('PUT', `/api/clips/${c.id}/like`, { token: 'tokA' });
  await req('DELETE', `/api/clips/${c.id}`, { token: 'tokB' });
  assert.strictEqual(T.db.prepare('SELECT COUNT(*) n FROM comments WHERE clip_id=?').get(c.id).n, 0);
  assert.strictEqual(T.db.prepare('SELECT COUNT(*) n FROM likes WHERE clip_id=?').get(c.id).n, 0);
});

test('search: title / game / uploader, exact matches ranked first, user + game filters', async () => {
  fake.profiles.carol = { id: 9, username: 'carol', bio: '' };
  const a = await create('tokC', 9, { visibility: 'public', title: 'carol the great', game: 'Terraria' });
  const b = await create('tokB', 8, { visibility: 'public', title: 'something else', game: 'Carol Quest' });
  const c = await create('tokB', 8, { visibility: 'public', title: 'big win', game: 'Terraria' });
  let r = await req('GET', '/api/clips?q=CAROL');
  const ids = r.json.clips.map(x => x.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id) && !ids.includes(c.id));
  assert.strictEqual(ids[0], a.id, 'exact uploader match first');
  r = await req('GET', '/api/clips?q=terraria');
  assert.deepStrictEqual(new Set(r.json.clips.map(x => x.id)), new Set([a.id, c.id]));
  r = await req('GET', '/api/clips?user=bob&game=terraria');
  assert.deepStrictEqual(r.json.clips.map(x => x.id), [c.id]);
  r = await req('GET', '/api/clips?q=nothing-like-this');
  assert.strictEqual(r.json.clips.length, 0);
  r = await req('GET', `/api/clips/${c.id}?expand=1`);
  assert.strictEqual(r.json.gameStats.clips, 2);
  assert.ok(r.json.uploaderStats.clips >= 2);
});

test('clip page: glint:* Ember meta + embed player', async () => {
  const c = await create('tokB', 8, { visibility: 'public', title: 'Meta <check>' });
  const p = await req('GET', `/c/${c.id}`);
  for (const n of ['id', 'title', 'user', 'user_avatar', 'game', 'game_icon', 'duration', 'video', 'thumb', 'likes', 'views']) {
    assert.match(p.text, new RegExp(`<meta name="glint:${n}" content="`), n);
  }
  assert.match(p.text, /<meta name="glint:title" content="Meta &lt;check&gt;">/);
  assert.match(p.text, new RegExp(`<meta name="glint:video" content="${PUB.replace(/\./g, '\\.')}/uploads/videos/`));
  assert.match(p.text, /og:video/);
  const e = await req('GET', `/embed/${c.id}`);
  assert.match(e.text, /player\.js/);
  assert.match(e.text, /"embed-boot"/);
});

test('replace: swaps in a desktop render, deletes the old draft media, clears draft state', async () => {
  const d = await create('tokA', 7, { visibility: 'draft', trim: { start: 1, end: 3 }, audioTracks: tracks2 });
  const fresh = fake.addMedia(7, 'rendered_' + d.id + '.mp4');
  const other = fake.addMedia(8, 'bobs.mp4');
  const rb = (url, extra = {}) => ({ videoUrl: url, visibility: 'unlisted', durationSec: 2, width: 1920, height: 1080, title: 'Final cut', thumbnail: JPEG, ...extra });
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { body: rb(fresh.url) })).status, 401);
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokB', body: rb(fresh.url) })).status, 404);
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokA', body: rb(other.url) })).json.error, 'media_not_found');
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokA', body: rb(d.url) })).json.error, 'same_media');
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokA', body: rb(fresh.url, { visibility: 'draft' }) })).json.error, 'invalid_visibility');
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokA', body: rb(fresh.url, { width: 0 }) })).json.error, 'invalid_dimensions');
  T.db.prepare("UPDATE clips SET job_status='failed', job_error='interrupted' WHERE id=?").run(d.id);
  const r = await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokA', body: rb(fresh.url) });
  assert.strictEqual(r.status, 200, r.text);
  assert.strictEqual(r.json.oldMediaDeleted, true);
  const c = r.json.clip;
  assert.deepStrictEqual([c.visibility, c.status, c.title, c.videoUrl, c.mediaId, c.width, c.durationSec, c.trim, c.audioTracks, c.error],
    ['unlisted', 'ready', 'Final cut', fresh.url, fresh.id, 1920, 2, undefined, undefined, undefined]);
  assert.ok(fake.deletes.includes(d.mediaId));
  assert.strictEqual((await req('GET', `/api/clips/${d.id}`)).status, 200, 'anonymous can see it now');
  assert.strictEqual((await req('POST', `/api/clips/${d.id}/replace`, { token: 'tokA', body: rb(fresh.url) })).json.error, 'not_a_draft');
  const d2 = await create('tokA', 7, { visibility: 'draft' });
  const f2 = fake.addMedia(7, 'rendered2.mp4');
  fake.deleteFails = true;
  const r2 = await req('POST', `/api/clips/${d2.id}/replace`, { token: 'tokA', body: rb(f2.url, { visibility: 'public' }) });
  fake.deleteFails = false;
  assert.deepStrictEqual([r2.status, r2.json.oldMediaDeleted, r2.json.clip.visibility], [200, false, 'public']);
  const d3 = await create('tokA', 7, { visibility: 'draft' });
  assert.strictEqual((await req('POST', `/api/clips/${d3.id}/replace`, { token: 'tokA', body: rb(f2.url) })).json.error, 'media_in_use');
});

test('publish: ffmpeg killed mid-render (e.g. OOM) -> failed render_failed, service keeps running', { skip: (!FF || process.platform !== 'linux') && 'needs linux + ffmpeg' }, async () => {
  const sample = makeSample(T.tmp, 'killme.mp4');
  const d = await create('tokA', 7, { visibility: 'draft', trim: { start: 0, end: 2 } }, sample);
  const killer = path.join(T.tmp, 'ffmpeg-oom.sh');
  fs.writeFileSync(killer, '#!/bin/sh\nkill -9 $$\n', { mode: 0o755 });
  const real = T.cfg.ffmpeg;
  T.cfg.ffmpeg = killer;
  try {
    await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
    const r = await until(async () => { const x = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' }); return x.json.status !== 'rendering' ? x : null; });
    assert.deepStrictEqual([r.json.status, r.json.error, r.json.visibility], ['failed', 'render_failed', 'draft']);
  } finally { T.cfg.ffmpeg = real; }
  assert.strictEqual((await req('GET', '/api/games')).status, 200, 'still serving');
});

test('publish: 1080p60 60 s 3-track render stays within memory', { skip: (!FF || !process.env.GLINT_HEAVY) && 'set GLINT_HEAVY=1', timeout: 15 * 60_000 }, async () => {
  const { execFileSync } = require('child_process');
  const out = path.join(T.tmp, 'heavy.mp4');
  const t0 = Date.now();
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-nostdin',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=60:duration=60', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=60',
    '-f', 'lavfi', '-i', 'sine=frequency=600:duration=60', '-f', 'lavfi', '-i', 'anoisesrc=d=60:a=0.1',
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '20M', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '160k', out]);
  const genS = (Date.now() - t0) / 1000;
  const d = await create('tokA', 7, { visibility: 'draft', durationSec: 60, width: 1920, height: 1080, trim: { start: 5, end: 55 } }, out);
  let nodePeak = 0;
  const iv = setInterval(() => { nodePeak = Math.max(nodePeak, process.memoryUsage().rss); }, 200);
  const t1 = Date.now();
  await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
  const r = await until(async () => { const x = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' }); return x.json.status !== 'rendering' ? x : null; }, 14 * 60_000, 1000);
  clearInterval(iv);
  const peakMb = Math.round(T.made.jobs.lastRenderPeakKb() / 1024);
  console.log(`# heavy: sample gen ${genS.toFixed(0)}s, publish ${((Date.now() - t1) / 1000).toFixed(0)}s, ffmpeg peak ${peakMb} MB, node rss peak ${Math.round(nodePeak / 1048576)} MB (incl. test harness)`);
  assert.strictEqual(r.json.status, 'ready', r.text);
  assert.ok(peakMb > 0 && peakMb < 900, `ffmpeg peak ${peakMb} MB`);
  assert.ok(nodePeak < 400 * 1048576, `node rss ${nodePeak}`);
});

test('app audio tracks: kind app with {exe,name} + small png icon, validated and kept', async () => {
  for (const k of ['createIp', 'createUser']) T.made.limits[k].reset();
  const { url } = fake.addMedia(7, 'apptrk.mp4');
  const png = n => 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]).toString('base64');
  const tr = extra => [{ index: 0, kind: 'game', label: 'Game' }, { index: 1, kind: 'app', label: 'Spotify', app: { exe: 'Spotify.exe', name: 'Spotify' }, icon: png(200), ...extra }];
  let r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: tr({ icon: png(17 * 1024) }) }) });
  assert.strictEqual(r.status, 413); assert.strictEqual(r.json.error, 'track_icon_too_large');
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: tr({ icon: 'data:image/jpeg;base64,/9j/AAAA' }) }) });
  assert.strictEqual(r.json.error, 'invalid_track_icon');
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: tr({ icon: 'data:image/png;base64,AAAAAAAAAAAA' }) }) });
  assert.strictEqual(r.json.error, 'invalid_track_icon', 'png magic checked');
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: tr({ app: { exe: '../evil' } }) }) });
  assert.strictEqual(r.json.error, 'invalid_audio_tracks');
  r = await req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', audioTracks: tr() }) });
  assert.strictEqual(r.status, 201, r.text);
  const id = r.json.id;
  let c = (await req('GET', `/api/clips/${id}`, { token: 'tokA' })).json;
  assert.deepStrictEqual(c.audioTracks[1].app, { exe: 'Spotify.exe', name: 'Spotify' });
  assert.match(c.audioTracks[1].icon, /^data:image\/png;base64,/);
  assert.strictEqual(c.audioTracks[0].icon, undefined, 'icons only on app tracks');
  r = await req('PATCH', `/api/clips/${id}`, { token: 'tokA', body: { audioTracks: [{ index: 1, enabled: false, volume: 0.4 }] } });
  assert.deepStrictEqual([r.json.audioTracks[1].kind, r.json.audioTracks[1].app.name, !!r.json.audioTracks[1].icon, r.json.audioTracks[1].enabled], ['app', 'Spotify', true, false]);
  await req('DELETE', `/api/clips/${id}`, { token: 'tokA' });
});

test('publish: queued jobs report their queue position', { skip: !FF && 'no ffmpeg' }, async () => {
  for (const k of ['publish', 'createIp', 'createUser']) T.made.limits[k].reset();
  const sample = makeSample(T.tmp, 'q.mp4', { seconds: 4 });
  const a = await create('tokA', 7, { visibility: 'draft', trim: { start: 0, end: 3 } }, sample);
  const b = await create('tokA', 7, { visibility: 'draft', trim: { start: 0, end: 3 } }, sample);
  await req('POST', `/api/clips/${a.id}/publish`, { token: 'tokA', body: {} });
  await req('POST', `/api/clips/${b.id}/publish`, { token: 'tokA', body: {} });
  const rb = await req('GET', `/api/clips/${b.id}`, { token: 'tokA' });
  assert.strictEqual(rb.json.status, 'rendering');
  assert.strictEqual(rb.json.progress.phase, 'queued');
  assert.ok(rb.json.progress.position >= 2, JSON.stringify(rb.json.progress));
  await until(async () => (await req('GET', `/api/clips/${b.id}`, { token: 'tokA' })).json.status !== 'rendering');
});

test('crop: validation on POST, PATCH round-trip (+ null clears), /edit + /me/clips carry it', async () => {
  for (const k of ['createIp', 'createUser', 'write']) T.made.limits[k].reset();
  const { url } = fake.addMedia(7, 'crop1.mp4');
  const post = crop => req('POST', '/api/clips', { token: 'tokA', body: body(url, { visibility: 'draft', width: 640, height: 360, crop }) });
  for (const bad of [{ x: 1, y: 0, w: 320, h: 180 }, { x: 0, y: 0, w: 62, h: 180 }, { x: 400, y: 0, w: 320, h: 180 }, { x: 0, y: 0, w: 320.5, h: 180 }, { x: -2, y: 0, w: 64, h: 64 }, 'nope', { x: 0, y: 0, w: 320 }]) {
    const r = await post(bad);
    assert.strictEqual(r.json.error, 'invalid_crop', JSON.stringify(bad));
  }
  let r = await post({ x: 100, y: 40, w: 320, h: 180 });
  assert.strictEqual(r.status, 201, r.text);
  const id = r.json.id;
  r = await req('GET', `/api/clips/${id}`, { token: 'tokA' });
  assert.deepStrictEqual(r.json.crop, { x: 100, y: 40, w: 320, h: 180 });
  r = await req('PATCH', `/api/clips/${id}`, { token: 'tokA', body: { crop: { x: 0, y: 0, w: 360, h: 360 } } });
  assert.deepStrictEqual(r.json.crop, { x: 0, y: 0, w: 360, h: 360 });
  assert.ok((await req('GET', '/api/me/clips', { token: 'tokA' })).json.clips.find(c => c.id === id).crop.w === 360);
  assert.strictEqual((await req('PATCH', `/api/clips/${id}`, { token: 'tokA', body: { crop: { x: 0, y: 0, w: 700, h: 360 } } })).json.error, 'invalid_crop');
  r = await req('PATCH', `/api/clips/${id}`, { token: 'tokA', body: { crop: { x: 0, y: 0, w: 640, h: 360 } } });
  assert.strictEqual(r.json.crop, null, 'full frame = no crop');
  await req('PATCH', `/api/clips/${id}`, { token: 'tokA', body: { crop: { x: 2, y: 2, w: 64, h: 64 } } });
  r = await req('PATCH', `/api/clips/${id}`, { token: 'tokA', body: { crop: null } });
  assert.strictEqual(r.json.crop, null, 'null clears');
  const p = await create('tokA', 7, { visibility: 'public' });
  assert.strictEqual((await req('PATCH', `/api/clips/${p.id}`, { token: 'tokA', body: { crop: { x: 0, y: 0, w: 64, h: 64 } } })).json.error, 'not_a_draft');
});

test('crop: render args put crop before the 1440p cap, with trim + mix; crop alone forces a re-encode', () => {
  const media = require('../src/media');
  const cfg = { ffThreads: 2 };
  const tracks = [{ index: 0, enabled: true, volume: 1 }, { index: 1, enabled: true, volume: 0.5 }, { index: 2, enabled: false, volume: 1 }];
  let { args, duration } = media.renderArgs(cfg, 'in.mp4', 'out.mp4', { trim: { start: 1, end: 5 }, tracks, duration: 10, crop: { x: 100, y: 40, w: 320, h: 180 } });
  const vf = args[args.indexOf('-vf') + 1];
  assert.strictEqual(vf, "crop=320:180:100:40,scale=-2:'min(1440,ih)'");
  assert.deepStrictEqual(args.slice(args.indexOf('-ss'), args.indexOf('-ss') + 4), ['-ss', '1.000', '-t', '4.000']);
  assert.match(args[args.indexOf('-filter_complex') + 1], /\[0:a:0\]volume=1\.000.*\[0:a:1\]volume=0\.500.*amix=inputs=2/);
  assert.ok(!args.join(' ').includes('0:a:2'), 'disabled track left out');
  assert.strictEqual(duration, 4);
  ({ args } = media.renderArgs(cfg, 'in.mp4', 'out.mp4', { trim: null, tracks, duration: 10, crop: { x: 0, y: 0, w: 64, h: 64 } }));
  assert.ok(args.includes('libx264') && !args.includes('copy'), 'crop without trim re-encodes');
  ({ args } = media.renderArgs(cfg, 'in.mp4', 'out.mp4', { trim: null, tracks, duration: 10, crop: null }));
  assert.ok(args.includes('copy') && !args.includes('-vf'), 'nothing to do = stream copy');
});

test('crop: publish renders the cropped frame', { skip: !FF && 'no ffmpeg' }, async () => {
  for (const k of ['publish', 'createIp', 'createUser']) T.made.limits[k].reset();
  const sample = makeSample(T.tmp, 'cropme.mp4', { tracks: 1 });
  const d = await create('tokA', 7, { visibility: 'draft', width: 640, height: 360, crop: { x: 160, y: 90, w: 320, h: 180 } }, sample);
  await req('POST', `/api/clips/${d.id}/publish`, { token: 'tokA', body: { visibility: 'public' } });
  const r = await until(async () => { const x = await req('GET', `/api/clips/${d.id}`, { token: 'tokA' }); return x.json.status !== 'rendering' ? x : null; });
  assert.strictEqual(r.json.status, 'ready', r.text);
  assert.notStrictEqual(r.json.mediaId, d.mediaId, 'crop forces a real render, not the visibility flip');
  assert.deepStrictEqual([r.json.width, r.json.height, r.json.crop], [320, 180, undefined]);
  const v = ffprobeJson(fake.files.get(r.json.videoUrl.split('/').pop())).streams.find(s => s.codec_type === 'video');
  assert.deepStrictEqual([v.width, v.height], [320, 180]);
});

test('me/likes: newest like first, public + unlisted only, drafts/deleted/gone dropped, paging', async () => {
  for (const k of ['createIp', 'createUser', 'like', 'write']) T.made.limits[k].reset();
  assert.strictEqual((await req('GET', '/api/me/likes')).status, 401);
  const a = await create('tokB', 8, { visibility: 'public', title: 'liked A' });
  const b = await create('tokB', 8, { visibility: 'unlisted', title: 'liked B' });
  const c = await create('tokB', 8, { visibility: 'public', title: 'liked C' });
  for (const x of [a, b, c]) { await req('PUT', `/api/clips/${x.id}/like`, { token: 'tokC' }); await new Promise(r => setTimeout(r, 5)); }
  let r = await req('GET', '/api/me/likes', { token: 'tokC' });
  assert.deepStrictEqual(r.json.clips.map(x => x.id), [c.id, b.id, a.id]);
  assert.ok(r.json.clips.every(x => x.liked === true && x.likedAt));
  await req('DELETE', `/api/clips/${c.id}/like`, { token: 'tokC' });
  await req('DELETE', `/api/clips/${a.id}`, { token: 'tokB' });
  fake.files.delete(b.name); await T.made.clips.fresh(T.made.clips.getRow(b.id));
  r = await req('GET', '/api/me/likes', { token: 'tokC' });
  assert.deepStrictEqual(r.json.clips, []);
  assert.strictEqual(r.json.nextCursor, null);
  for (let i = 0; i < 26; i++) {
    for (const k of ['createIp', 'createUser', 'like']) T.made.limits[k].reset();
    const x = await create('tokB', 8, { visibility: 'public', title: 'p' + i });
    await req('PUT', `/api/clips/${x.id}/like`, { token: 'tokC' });
  }
  r = await req('GET', '/api/me/likes', { token: 'tokC' });
  assert.strictEqual(r.json.clips.length, 24);
  const r2 = await req('GET', `/api/me/likes?cursor=${r.json.nextCursor}`, { token: 'tokC' });
  assert.strictEqual(r2.json.clips.length, 2);
  assert.strictEqual((await req('GET', '/liked')).status, 200);
});
