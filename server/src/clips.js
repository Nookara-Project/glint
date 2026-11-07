const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function newId(len = 10) {
  let out = '';
  while (out.length < len) {
    for (const b of crypto.randomBytes(len * 2)) {
      if (b < 248) out += B62[b % 62];
      if (out.length === len) break;
    }
  }
  return out;
}
const ID_RE = /^[0-9A-Za-z]{10}$/;
const KINDS = ['game', 'mic', 'discord', 'fluxer', 'ember', 'desktop', 'app', 'other'];

class BadInput extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const CTRL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;
function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(CTRL, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanMultiline(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(CTRL, ' ').replace(/\s+/g, ' ').trim()).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
}

function decodeDataUrl(v, mimes, maxBytes) {
  if (typeof v !== 'string') return null;
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(v);
  if (!m || !mimes.includes(m[1])) return null;
  if (m[2].length > Math.ceil(maxBytes / 3) * 4 + 8) return { tooBig: true };
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) return { tooBig: true };
  return { mime: m[1], buf };
}

const MAGIC = {
  'image/jpeg': b => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': b => b.length > 8 && b.readUInt32BE(0) === 0x89504e47,
  'image/webp': b => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
};
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function validateCrop(c, width, height) {
  if (c === undefined || c === null) return null;
  if (typeof c !== 'object') throw new BadInput('invalid_crop');
  const v = ['x', 'y', 'w', 'h'].map(k => c[k]);
  if (!v.every(n => Number.isInteger(n) && n % 2 === 0)) throw new BadInput('invalid_crop');
  const [x, y, w, h] = v;
  if (x < 0 || y < 0 || w < 64 || h < 64 || x + w > width || y + h > height) throw new BadInput('invalid_crop');
  if (x === 0 && y === 0 && w === width && h === height) return null;
  return { x, y, w, h };
}

function validateTrim(t, duration) {
  if (t === undefined || t === null) return null;
  if (typeof t !== 'object') throw new BadInput('invalid_trim');
  const start = Number(t.start), end = Number(t.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + 0.5 || end - start < 0.25) throw new BadInput('invalid_trim');
  return { start: Math.round(start * 1000) / 1000, end: Math.round(Math.min(end, duration) * 1000) / 1000 };
}

function validateTracks(a) {
  if (a === undefined || a === null) return null;
  if (!Array.isArray(a) || a.length > 8) throw new BadInput('invalid_audio_tracks');
  const seen = new Set();
  return a.map(t => {
    if (!t || typeof t !== 'object') throw new BadInput('invalid_audio_tracks');
    const index = Number(t.index);
    if (!Number.isInteger(index) || index < 0 || index > 7 || seen.has(index)) throw new BadInput('invalid_audio_tracks');
    seen.add(index);
    const volume = t.volume === undefined ? 1 : Number(t.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 2) throw new BadInput('invalid_audio_tracks');
    const kind = KINDS.includes(t.kind) ? t.kind : 'other';
    const out = {
      index,
      kind,
      label: cleanText(t.label, 40) || `Track ${index + 1}`,
      enabled: t.enabled === undefined ? true : !!t.enabled,
      volume: Math.round(volume * 100) / 100,
    };
    if (kind === 'app') {
      if (t.app !== undefined && t.app !== null) {
        if (typeof t.app !== 'object') throw new BadInput('invalid_audio_tracks');
        const exe = cleanText(t.app.exe, 128), name = cleanText(t.app.name, 64);
        if (exe && !/^[^\\/:*?"<>|]+$/.test(exe)) throw new BadInput('invalid_audio_tracks');
        if (exe || name) out.app = { exe: exe || null, name: name || null };
      }
      if (t.icon !== undefined && t.icon !== null && t.icon !== '') {
        const d = decodeDataUrl(t.icon, ['image/png'], 16 * 1024);
        if (!d) throw new BadInput('invalid_track_icon');
        if (d.tooBig) throw new BadInput('track_icon_too_large', 413);
        if (!MAGIC['image/png'](d.buf)) throw new BadInput('invalid_track_icon');
        out.icon = 'data:image/png;base64,' + d.buf.toString('base64');
      }
    }
    return out;
  }).sort((x, y) => x.index - y.index);
}

function createClips({ db, cfg, velora, signer, log = console }) {
  const thumbDir = path.join(cfg.dataDir, 'thumbs');
  const iconDir = path.join(cfg.dataDir, 'icons');
  const hooks = { progressOf: () => null, onRemoved: () => {} };

  const SEL = `SELECT c.*, u.username, u.pfp_url, u.color FROM clips c LEFT JOIN users u ON u.id = c.user_id`;
  const q = {
    upsertUser: db.prepare(`INSERT INTO users (id, username, username_lc, pfp_url, color, updated_at) VALUES (@id, @username, @lc, @pfp, @color, @now)
      ON CONFLICT(id) DO UPDATE SET username=@username, username_lc=@lc, pfp_url=COALESCE(@pfp, pfp_url), color=COALESCE(@color, color), updated_at=@now`),
    insert: db.prepare(`INSERT INTO clips (id, user_id, video_url, media_id, title, game, game_key, game_icon, duration, width, height, visibility, has_thumb, created_at, last_checked, trim_start, trim_end, audio_tracks, crop)
      VALUES (@id, @user_id, @video_url, @media_id, @title, @game, @game_key, @game_icon, @duration, @width, @height, @visibility, @has_thumb, @created_at, @created_at, @trim_start, @trim_end, @audio_tracks, @crop)`),
    byId: db.prepare(`${SEL} WHERE c.id = ?`),
    byMedia: db.prepare(`SELECT id, user_id FROM clips WHERE media_id = ?`),
    byUser: db.prepare(`${SEL} WHERE c.user_id = ? ORDER BY c.created_at DESC`),
    publicByUser: db.prepare(`${SEL} WHERE c.user_id = ? AND c.status = 'ok' AND c.visibility = 'public' ORDER BY c.created_at DESC LIMIT 200`),
    userViews: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(views),0) AS v, COALESCE(SUM(likes),0) AS l FROM clips WHERE user_id = ? AND status = 'ok' AND visibility = 'public'`),
    markGone: db.prepare(`UPDATE clips SET status='gone', gone_at=@now, last_checked=@now WHERE id=@id AND status='ok' AND video_url=@url AND job_status!='rendering'`),
    revive: db.prepare(`UPDATE clips SET status='ok', gone_at=NULL, last_checked=? WHERE id = ? AND status='gone'`),
    checked: db.prepare(`UPDATE clips SET last_checked=? WHERE id = ?`),
    del: db.prepare(`DELETE FROM clips WHERE id = ?`),
    delLikes: db.prepare(`DELETE FROM likes WHERE clip_id = ?`),
    delComments: db.prepare(`DELETE FROM comments WHERE clip_id = ?`),
    view: db.prepare(`UPDATE clips SET views = views + 1 WHERE id = ? AND status = 'ok' RETURNING views`),
    games: db.prepare(`SELECT game_key, COUNT(*) AS count, MAX(created_at) AS last FROM clips WHERE status='ok' AND visibility='public' GROUP BY game_key ORDER BY count DESC, last DESC LIMIT 200`),
    gameLatest: db.prepare(`SELECT game, game_icon FROM clips WHERE status='ok' AND visibility='public' AND game_key = ? ORDER BY (game_icon IS NULL), created_at DESC LIMIT 1`),
    sweepBatch: db.prepare(`SELECT id, video_url FROM clips WHERE status='ok' AND job_status!='rendering' AND last_checked <= ? ORDER BY last_checked ASC LIMIT 500`),
    oldGone: db.prepare(`SELECT id FROM clips WHERE status='gone' AND gone_at < ?`),
    userByName: db.prepare(`SELECT * FROM users WHERE username_lc = ?`),
    userById: db.prepare(`SELECT * FROM users WHERE id = ?`),
    likeIns: db.prepare(`INSERT OR IGNORE INTO likes (clip_id, user_id, created_at) VALUES (?, ?, ?)`),
    likeDel: db.prepare(`DELETE FROM likes WHERE clip_id = ? AND user_id = ?`),
    likeCount: db.prepare(`UPDATE clips SET likes = (SELECT COUNT(*) FROM likes WHERE clip_id = @id) WHERE id = @id RETURNING likes`),
    liked: db.prepare(`SELECT 1 FROM likes WHERE clip_id = ? AND user_id = ?`),
    commentIns: db.prepare(`INSERT INTO comments (clip_id, user_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id`),
    commentById: db.prepare(`SELECT * FROM comments WHERE id = ?`),
    commentDel: db.prepare(`DELETE FROM comments WHERE id = ?`),
    commentCount: db.prepare(`UPDATE clips SET comments = (SELECT COUNT(*) FROM comments WHERE clip_id = @id) WHERE id = @id`),
    commentsPage: db.prepare(`SELECT m.*, u.username, u.pfp_url, u.color FROM comments m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.clip_id = @clip AND m.id < @before ORDER BY m.id DESC LIMIT @limit`),
  };

  function rememberUser(u) {
    q.upsertUser.run({ id: u.id, username: u.username, lc: u.username.toLowerCase(), pfp: u.pfp_url || null, color: u.color || null, now: Date.now() });
  }

  function absUrl(u) {
    if (!u) return null;
    if (/^https:\/\//.test(u)) return u;
    if (u.startsWith('/')) return cfg.veloraPublic + u;
    return null;
  }

  function userObj(row) {
    return {
      id: row.user_id,
      username: row.username || 'unknown',
      avatar: absUrl(row.pfp_url),
      color: row.color || null,
      profileUrl: row.username ? `${cfg.publicBase}/u/${encodeURIComponent(row.username)}` : null,
    };
  }
  const cropOf = row => { try { return row.crop ? JSON.parse(row.crop) : null; } catch { return null; } };
  const tracksOf = row => { try { return row.audio_tracks ? JSON.parse(row.audio_tracks) : null; } catch { return null; } };

  function thumbUrl(row) {
    if (!row.has_thumb) return null;
    const v = row.job_updated || row.created_at;
    const base = `${cfg.publicBase}/api/thumb/${row.id}.jpg?v=${v}`;
    return row.visibility === 'draft' ? `${base}&${signer.query(`thumb/${row.id}`, cfg.signTtlSec)}` : base;
  }

  function serialize(row, { owner = false, liked } = {}) {
    const out = {
      id: row.id,
      url: `${cfg.publicBase}/c/${row.id}`,
      title: row.title,
      game: row.game,
      gameIcon: row.game_icon ? (row.game_icon.startsWith('icon:') ? `${cfg.publicBase}/api/icon/${row.game_icon.slice(5)}` : row.game_icon) : null,
      durationSec: row.duration,
      width: row.width,
      height: row.height,
      visibility: row.visibility,
      views: row.views,
      likes: row.likes || 0,
      comments: row.comments || 0,
      createdAt: new Date(row.created_at).toISOString(),
      videoUrl: row.video_url,
      thumbnail: thumbUrl(row),
      status: row.job_status || 'ready',
      user: userObj(row),
    };
    if (liked !== undefined) out.liked = !!liked;
    if (row.job_status === 'failed') out.error = row.job_error || 'failed';
    if (row.job_status === 'rendering') { const p = hooks.progressOf(row.id); if (p) out.progress = p; }
    if (owner) {
      out.mediaId = row.media_id;
      if (row.visibility === 'draft') {
        out.trim = row.trim_start !== null && row.trim_start !== undefined ? { start: row.trim_start, end: row.trim_end } : null;
        out.audioTracks = tracksOf(row);
        out.crop = cropOf(row);
      }
    }
    return out;
  }

  function serializeMany(rows, viewer, opts = {}) {
    let likedSet = null;
    if (viewer && rows.length) {
      const ids = rows.map(r => r.id);
      likedSet = new Set(db.prepare(`SELECT clip_id FROM likes WHERE user_id = ? AND clip_id IN (${ids.map(() => '?').join(',')})`).all(viewer.id, ...ids).map(r => r.clip_id));
    }
    return rows.map(r => serialize(r, { ...opts, liked: likedSet ? likedSet.has(r.id) : undefined }));
  }

  // ---- validation -------------------------------------------------------------------------------------------
  function validateCreate(b) {
    if (!b || typeof b !== 'object') throw new BadInput('bad_body');
    let videoUrl = typeof b.videoUrl === 'string' ? b.videoUrl.trim() : '';
    if (videoUrl.startsWith(cfg.legacyPublic + '/')) videoUrl = cfg.veloraPublic + videoUrl.slice(cfg.legacyPublic.length);
    if (videoUrl.length > 300 || !velora.parseMedia(videoUrl)) {
      throw new BadInput('invalid_video_url');
    }
    const title = cleanText(b.title, 100) || 'Untitled clip';
    const game = cleanText(b.game, 64) || 'Other';
    const durationSec = Number(b.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 3600) throw new BadInput('invalid_duration');
    const width = Number(b.width), height = Number(b.height);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16 || width > 8192 || height > 8192) throw new BadInput('invalid_dimensions');
    const visibility = b.visibility === undefined ? 'public' : b.visibility;
    if (!['public', 'unlisted', 'draft'].includes(visibility)) throw new BadInput('invalid_visibility');
    const trim = validateTrim(b.trim, durationSec);
    const crop = validateCrop(b.crop, width, height);
    const audioTracks = validateTracks(b.audioTracks);

    let thumb = null;
    if (b.thumbnail !== undefined && b.thumbnail !== null && b.thumbnail !== '') {
      const d = decodeDataUrl(b.thumbnail, ['image/jpeg'], 300 * 1024);
      if (!d) throw new BadInput('invalid_thumbnail');
      if (d.tooBig) throw new BadInput('thumbnail_too_large', 413);
      if (!MAGIC['image/jpeg'](d.buf)) throw new BadInput('invalid_thumbnail');
      thumb = d.buf;
    }

    let icon = null;
    if (b.gameIcon !== undefined && b.gameIcon !== null && b.gameIcon !== '') {
      if (typeof b.gameIcon === 'string' && b.gameIcon.startsWith('data:')) {
        const d = decodeDataUrl(b.gameIcon, ['image/png', 'image/jpeg', 'image/webp'], 128 * 1024);
        if (!d || d.tooBig || !MAGIC[d.mime](d.buf)) throw new BadInput('invalid_game_icon');
        icon = { buf: d.buf, ext: EXT[d.mime] };
      } else if (typeof b.gameIcon === 'string' && /^https:\/\/[^\s"'<>\\]{4,500}$/.test(b.gameIcon)) {
        icon = { url: b.gameIcon };
      } else throw new BadInput('invalid_game_icon');
    }
    return { videoUrl, title, game, durationSec: Math.round(durationSec * 100) / 100, width, height, visibility, thumb, icon, trim, audioTracks, crop };
  }

  function validateReplace(b) {
    if (!b || typeof b !== 'object') throw new BadInput('bad_body');
    const visibility = b.visibility === undefined ? 'public' : b.visibility;
    if (visibility !== 'public' && visibility !== 'unlisted') throw new BadInput('invalid_visibility');
    let title = null;
    if (b.title !== undefined && b.title !== null) { title = cleanText(b.title, 100); if (!title) throw new BadInput('invalid_title'); }
    const v = validateCreate({ videoUrl: b.videoUrl, title: title || 'x', game: 'x', durationSec: b.durationSec, width: b.width, height: b.height, thumbnail: b.thumbnail });
    return { videoUrl: v.videoUrl, visibility, title, durationSec: v.durationSec, width: v.width, height: v.height, thumb: v.thumb };
  }

  function storeIcon(icon) {
    if (!icon) return null;
    if (icon.url) return icon.url;
    const name = crypto.createHash('sha256').update(icon.buf).digest('hex').slice(0, 24) + '.' + icon.ext;
    const p = path.join(iconDir, name);
    if (!fs.existsSync(p)) fs.writeFileSync(p, icon.buf);
    return 'icon:' + name;
  }

  async function create(user, token, ip, body) {
    const v = validateCreate(body);
    const uploads = await velora.mediaList(token, ip, { fresh: true });
    const media = uploads.find(u => u && u.type === 'video' && velora.sameMedia(u.url, v.videoUrl));
    if (!media) throw new BadInput('media_not_found', 400);
    const mediaId = Number(media.id);

    const existing = q.byMedia.get(mediaId);
    if (existing) {
      if (existing.user_id !== user.id) throw new BadInput('media_not_found', 400);
      return { id: existing.id, url: `${cfg.publicBase}/c/${existing.id}`, existing: true };
    }

    rememberUser(user);
    let id;
    do { id = newId(); } while (q.byId.get(id));
    if (v.thumb) fs.writeFileSync(path.join(thumbDir, `${id}.jpg`), v.thumb);
    const draft = v.visibility === 'draft';
    q.insert.run({
      id, user_id: user.id, video_url: v.videoUrl, media_id: mediaId, title: v.title, game: v.game, game_key: v.game.toLowerCase(),
      game_icon: storeIcon(v.icon), duration: v.durationSec, width: v.width, height: v.height, visibility: v.visibility,
      has_thumb: v.thumb ? 1 : 0, created_at: Date.now(),
      trim_start: draft && v.trim ? v.trim.start : null, trim_end: draft && v.trim ? v.trim.end : null,
      audio_tracks: draft && v.audioTracks ? JSON.stringify(v.audioTracks) : null,
      crop: draft && v.crop ? JSON.stringify(v.crop) : null,
    });
    return { id, url: `${cfg.publicBase}/c/${id}` };
  }

  function getRow(id) {
    if (!ID_RE.test(String(id))) return null;
    return q.byId.get(id) || null;
  }

  const inflight = new Map();
  async function fresh(row) {
    if (!row || row.status !== 'ok') return null;
    if (row.job_status === 'rendering') return row;
    if (Date.now() - row.last_checked < cfg.headTtlMs) return row;
    const key = `${row.id}|${row.video_url}`;
    let p = inflight.get(key);
    if (!p) {
      p = velora.headMedia(row.video_url).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    const state = await p;
    const now = Date.now();
    if (state === 'gone') {
      const r = q.markGone.run({ now, id: row.id, url: row.video_url });
      if (r.changes) { log.info?.(`[glint] clip ${row.id} media gone (HEAD)`); return null; }
      return fresh(getRow(row.id));
    }
    if (state === 'ok') { q.checked.run(now, row.id); row.last_checked = now; }
    return row;
  }

  async function getVisible(id, viewer) {
    const row = getRow(id);
    if (!row) return null;
    if (row.visibility === 'draft' && !(viewer && viewer.id === row.user_id)) return null;
    return fresh(row);
  }

  function ownRow(user, id) {
    const row = getRow(id);
    if (!row || row.status !== 'ok') throw new BadInput('not_found', 404);
    if (row.user_id !== user.id) {
      if (row.visibility === 'draft') throw new BadInput('not_found', 404);
      throw new BadInput('forbidden', 403);
    }
    return row;
  }

  function update(user, id, body) {
    const row = ownRow(user, id);
    if (row.job_status === 'rendering') throw new BadInput('rendering', 409);
    if (!body || typeof body !== 'object') throw new BadInput('bad_body');
    const sets = [], args = {};
    if (body.title !== undefined) {
      const t = cleanText(body.title, 100);
      if (!t) throw new BadInput('invalid_title');
      sets.push('title=@title'); args.title = t;
    }
    if (body.visibility !== undefined && body.visibility !== row.visibility) {
      if (body.visibility === 'draft' || row.visibility === 'draft') throw new BadInput('use_publish');
      if (body.visibility !== 'public' && body.visibility !== 'unlisted') throw new BadInput('invalid_visibility');
      sets.push('visibility=@visibility'); args.visibility = body.visibility;
    } else if (body.visibility !== undefined && !['public', 'unlisted', 'draft'].includes(body.visibility)) throw new BadInput('invalid_visibility');
    if (body.crop !== undefined) {
      if (row.visibility !== 'draft') throw new BadInput('not_a_draft');
      const cr = validateCrop(body.crop, row.width, row.height);
      sets.push('crop=@crop'); args.crop = cr ? JSON.stringify(cr) : null;
    }
    if (body.trim !== undefined || body.audioTracks !== undefined) {
      if (row.visibility !== 'draft') throw new BadInput('not_a_draft');
      if (body.trim !== undefined) {
        const t = validateTrim(body.trim, row.duration);
        sets.push('trim_start=@ts', 'trim_end=@te'); args.ts = t ? t.start : null; args.te = t ? t.end : null;
      }
      if (body.audioTracks !== undefined) {
        const incoming = validateTracks(body.audioTracks) || [];
        const cur = tracksOf(row);
        let merged;
        if (cur && cur.length) {
          merged = cur.map(c => { const n = incoming.find(x => x.index === c.index); return n ? { ...c, enabled: n.enabled, volume: n.volume } : c; });
        } else merged = incoming;
        sets.push('audio_tracks=@at'); args.at = JSON.stringify(merged);
      }
    }
    if (!sets.length) throw new BadInput('nothing_to_update');
    db.prepare(`UPDATE clips SET ${sets.join(', ')} WHERE id=@id`).run({ ...args, id });
    rememberUser(user);
    return serialize(q.byId.get(id), { owner: true });
  }

  function removeFiles(id) {
    try { fs.unlinkSync(path.join(thumbDir, `${id}.jpg`)); } catch {}
  }

  function purge(id) {
    db.transaction(() => { q.del.run(id); q.delLikes.run(id); q.delComments.run(id); })();
    removeFiles(id);
    try { hooks.onRemoved(id); } catch {}
  }

  async function remove(user, token, ip, id, { media = false } = {}) {
    const row = getRow(id);
    if (!row) throw new BadInput('not_found', 404);
    if (row.user_id !== user.id) throw new BadInput(row.visibility === 'draft' ? 'not_found' : 'forbidden', row.visibility === 'draft' ? 404 : 403);
    if (row.job_status === 'rendering') throw new BadInput('rendering', 409);
    let mediaDeleted = false;
    if (media) {
      await velora.deleteMedia(token, ip, row.media_id);
      mediaDeleted = true;
    }
    purge(id);
    return { ok: true, mediaDeleted };
  }

  async function mine(user, token, ip) {
    rememberUser(user);
    let uploads = null;
    const fetchedAt = Date.now();
    try { uploads = await velora.mediaList(token, ip); }
    catch (e) { log.warn?.(`[glint] /me/clips reconcile skipped for ${user.id}: ${e.code || e.message}`); }
    const rows = q.byUser.all(user.id);
    if (uploads) {
      const have = new Set(uploads.filter(u => u && u.type === 'video').map(u => Number(u.id)));
      const now = Date.now();
      for (const r of rows) {
        if (r.job_status === 'rendering' || (r.job_updated && r.job_updated >= fetchedAt - 60_000)) continue;
        if (r.status === 'ok' && !have.has(r.media_id)) {
          if (await velora.headMedia(r.video_url) !== 'gone') continue;
          if (q.markGone.run({ now, id: r.id, url: r.video_url }).changes) { r.status = 'gone'; log.info?.(`[glint] clip ${r.id} media gone (reconcile)`); }
        } else if (r.status === 'gone' && have.has(r.media_id)) { q.revive.run(now, r.id); r.status = 'ok'; }
      }
    }
    return serializeMany(rows.filter(r => r.status === 'ok'), user, { owner: true });
  }

  function escLike(s) { return s.replace(/[\\%_]/g, c => '\\' + c); }

  function list({ sort = 'new', game = '', user = '', q: search = '', cursor = '' } = {}, viewer) {
    const where = [`c.status='ok'`, `c.visibility='public'`], args = {};
    const g = cleanText(game, 64).toLowerCase();
    if (g) { where.push('c.game_key = @game'); args.game = g; }
    const un = cleanText(user, 40).toLowerCase();
    if (un) { where.push('LOWER(u.username) = @user'); args.user = un; }
    const s = cleanText(search, 64);
    let rank = '';
    if (s) {
      where.push(`(c.title LIKE @s ESCAPE '\\' OR c.game LIKE @s ESCAPE '\\' OR u.username LIKE @s ESCAPE '\\')`);
      args.s = `%${escLike(s)}%`;
      args.exact = s.toLowerCase();
      args.prefix = `${escLike(s.toLowerCase())}%`;
      rank = `CASE WHEN c.game_key = @exact OR LOWER(u.username) = @exact THEN 0
        WHEN c.game_key LIKE @prefix ESCAPE '\\' OR LOWER(u.username) LIKE @prefix ESCAPE '\\' OR LOWER(c.title) LIKE @prefix ESCAPE '\\' THEN 1 ELSE 2 END, `;
    }
    const order = rank + (sort === 'top' ? '(c.views + c.likes * 5 + c.comments * 3) DESC, c.created_at DESC, c.id' : 'c.created_at DESC, c.id');
    let offset = parseInt(cursor, 10);
    if (!Number.isFinite(offset) || offset < 0 || offset > 100000) offset = 0;
    const limit = cfg.pageSize;
    const rows = db.prepare(`${SEL} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit + 1} OFFSET ${offset}`).all(args);
    const more = rows.length > limit;
    return { clips: serializeMany(rows.slice(0, limit), viewer), nextCursor: more ? String(offset + limit) : null };
  }

  function gameStats(gameKey) {
    const r = db.prepare(`SELECT COUNT(*) AS clips, COALESCE(SUM(views),0) AS views, COALESCE(SUM(likes),0) AS likes FROM clips
      WHERE status='ok' AND visibility='public' AND game_key = ?`).get(String(gameKey).toLowerCase());
    return { clips: r.clips, views: r.views, likes: r.likes };
  }
  function userStats(userId) {
    const st = q.userViews.get(userId);
    return { clips: st.n, views: st.v, likes: st.l };
  }

  function games() {
    return q.games.all().map(g => {
      const latest = q.gameLatest.get(g.game_key);
      const icon = latest && latest.game_icon;
      return {
        name: latest ? latest.game : g.game_key,
        key: g.game_key,
        icon: icon ? (icon.startsWith('icon:') ? `${cfg.publicBase}/api/icon/${icon.slice(5)}` : icon) : null,
        count: g.count,
      };
    });
  }

  function view(id) {
    const r = q.view.get(id);
    return r ? r.views : null;
  }

  function publicForUser(userId, viewer) {
    const rows = q.publicByUser.all(userId);
    const st = q.userViews.get(userId);
    return { clips: serializeMany(rows, viewer), clipCount: st.n, totalViews: st.v, totalLikes: st.l };
  }

  function isLiked(id, user) { return !!(user && q.liked.get(id, user.id)); }

  function setLike(user, row, on) {
    if (on) q.likeIns.run(row.id, user.id, Date.now()); else q.likeDel.run(row.id, user.id);
    const r = q.likeCount.get({ id: row.id });
    return { liked: on, likes: r ? r.likes : 0 };
  }

  function likedBy(user, cursor) {
    let offset = parseInt(cursor, 10);
    if (!Number.isFinite(offset) || offset < 0 || offset > 100000) offset = 0;
    const limit = cfg.pageSize;
    const rows = db.prepare(`SELECT c.*, u.username, u.pfp_url, u.color, l.created_at AS liked_at FROM likes l
      JOIN clips c ON c.id = l.clip_id LEFT JOIN users u ON u.id = c.user_id
      WHERE l.user_id = ? AND c.status = 'ok' AND c.visibility IN ('public', 'unlisted')
      ORDER BY l.created_at DESC, c.id LIMIT ${limit + 1} OFFSET ${offset}`).all(user.id);
    const more = rows.length > limit;
    return {
      clips: rows.slice(0, limit).map(r => ({ ...serialize(r, { liked: true }), likedAt: new Date(r.liked_at).toISOString() })),
      nextCursor: more ? String(offset + limit) : null,
    };
  }

  function commentObj(m) {
    return {
      id: m.id, body: m.body, createdAt: new Date(m.created_at).toISOString(),
      user: { id: m.user_id, username: m.username || 'unknown', avatar: absUrl(m.pfp_url), color: m.color || null,
        profileUrl: m.username ? `${cfg.publicBase}/u/${encodeURIComponent(m.username)}` : null },
    };
  }

  function listComments(row, cursor) {
    let before = parseInt(cursor, 10);
    if (!Number.isFinite(before) || before <= 0) before = Number.MAX_SAFE_INTEGER;
    const limit = 20;
    const rows = q.commentsPage.all({ clip: row.id, before, limit: limit + 1 });
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return { comments: page.map(commentObj), nextCursor: more ? String(page[page.length - 1].id) : null };
  }

  function addComment(user, row, body) {
    const text = cleanMultiline(body);
    if (!text) throw new BadInput('empty_comment');
    if ([...text].length > 500) throw new BadInput('comment_too_long');
    rememberUser(user);
    const { id } = q.commentIns.get(row.id, user.id, text, Date.now());
    q.commentCount.run({ id: row.id });
    const m = q.commentById.get(id);
    const u = q.userById.get(user.id) || {};
    return commentObj({ ...m, username: u.username, pfp_url: u.pfp_url, color: u.color });
  }

  function deleteComment(user, commentId) {
    const id = Number(commentId);
    const m = Number.isInteger(id) && id > 0 ? q.commentById.get(id) : null;
    if (!m) throw new BadInput('not_found', 404);
    const row = getRow(m.clip_id);
    const clipOwner = row && row.user_id === user.id;
    if (m.user_id !== user.id && !clipOwner) throw new BadInput('forbidden', 403);
    q.commentDel.run(id);
    if (row) q.commentCount.run({ id: row.id });
    return { ok: true };
  }

  async function sweep() {
    const cutoff = Date.now() - cfg.headTtlMs;
    const batch = q.sweepBatch.all(cutoff);
    let gone = 0, i = 0;
    const worker = async () => {
      while (i < batch.length) {
        const r = batch[i++];
        const state = await velora.headMedia(r.video_url);
        const now = Date.now();
        if (state === 'gone') { if (q.markGone.run({ now, id: r.id, url: r.video_url }).changes) gone++; }
        else if (state === 'ok') q.checked.run(now, r.id);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const old = q.oldGone.all(Date.now() - 30 * 24 * 3600 * 1000);
    for (const r of old) purge(r.id);
    if (gone || old.length) log.info?.(`[glint] sweep: checked ${batch.length}, newly gone ${gone}, purged ${old.length}`);
    return { checked: batch.length, gone, purged: old.length };
  }

  return {
    create, validateReplace, getRow, getVisible, gameStats, userStats, ownRow, fresh, update, remove, mine, list, games, view, publicForUser, sweep, serialize, serializeMany,
    rememberUser, cropOf, isLiked, likedBy, setLike, listComments, addComment, deleteComment, tracksOf,
    userByName: lc => q.userByName.get(lc), absUrl, thumbDir, iconDir, hooks,
  };
}

module.exports = { createClips, BadInput, newId, cleanText, cleanMultiline, validateTrim, validateCrop, validateTracks, ID_RE, KINDS };
