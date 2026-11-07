const fs = require('fs');
const path = require('path');
const net = require('net');
const express = require('express');
const { createClips, BadInput } = require('./clips');
const { createJobs } = require('./jobs');
const { createSigner } = require('./sign');
const { createLimiter, createSeen } = require('./ratelimit');
const { VeloraError } = require('./velora');
const render = require('./render');

function clientIp(req) {
  const cf = String(req.headers['cf-connecting-ip'] || '').trim();
  if (cf && net.isIP(cf)) return cf;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xff && net.isIP(xff)) return xff;
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function bearer(req) {
  const h = String(req.headers.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

function createApp({ cfg, db, velora, log = console }) {
  const signer = createSigner(cfg.dataDir);
  const clips = createClips({ db, cfg, velora, signer, log });
  const jobs = createJobs({ cfg, db, velora, clips, signer, log });
  const limits = {
    api: createLimiter({ windowMs: 60_000, max: cfg.apiRateMax || 300 }),
    viewIp: createLimiter({ windowMs: 10 * 60_000, max: 120 }),
    createIp: createLimiter({ windowMs: 60 * 60_000, max: 30 }),
    createUser: createLimiter({ windowMs: 60 * 60_000, max: 20 }),
    write: createLimiter({ windowMs: 10 * 60_000, max: 60 }),
    lookupIp: createLimiter({ windowMs: 60_000, max: 40 }),
    like: createLimiter({ windowMs: 60_000, max: 30 }),
    comment: createLimiter({ windowMs: 10 * 60_000, max: 10 }),
    publish: createLimiter({ windowMs: 60 * 60_000, max: 20 }),
  };
  const seenViews = createSeen(6 * 3600 * 1000);
  const html = render.create(cfg);

  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use((req, res, next) => {
    if (req.url === cfg.basePath) return res.redirect(301, cfg.basePath + '/');
    if (req.url.startsWith(cfg.basePath + '/')) req.url = req.url.slice(cfg.basePath.length) || '/';
    req.ip_ = clientIp(req);
    next();
  });

  function limited(res, r) {
    res.setHeader('Retry-After', String(r.retryAfter));
    return res.status(429).json({ error: 'rate_limited', retryAfter: r.retryAfter });
  }

  function fail(res, e) {
    if (e instanceof BadInput) return res.status(e.status).json({ error: e.code });
    if (e instanceof VeloraError) {
      const status = [401, 403].includes(e.status) ? e.status : 502;
      if (status === 502) log.warn?.(`[glint] velora error: ${e.code} ${e.detail ?? ''}`);
      return res.status(status).json({ error: e.code });
    }
    log.error?.('[glint] error', e);
    return res.status(500).json({ error: 'server_error' });
  }

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const r = limits.api.hit(req.ip_);
    if (!r.ok) return limited(res, r);
    next();
  });
  api.use(express.json({ limit: '1mb' }));
  api.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'body_too_large' });
    if (err) return res.status(400).json({ error: 'bad_json' });
    next();
  });

  const auth = (optional = false) => async (req, res, next) => {
    const token = bearer(req);
    if (!token) return optional ? next() : res.status(401).json({ error: 'unauthorized' });
    try {
      const user = await velora.validate(token, req.ip_);
      if (!user) return optional ? next() : res.status(401).json({ error: 'unauthorized' });
      req.user = user; req.token = token;
      clips.rememberUser(user);
      next();
    } catch (e) {
      if (optional) return next();
      fail(res, e);
    }
  };
  const wrap = fn => async (req, res) => { try { await fn(req, res); } catch (e) { fail(res, e); } };
  const userLimit = (lim, req, res) => { const r = lim.hit('u' + req.user.id); if (!r.ok) { limited(res, r); return false; } return true; };

  async function visible(req) {
    const row = await clips.getVisible(req.params.id, req.user);
    if (!row) throw new BadInput('not_found', 404);
    return row;
  }
  function clipJson(row, user, { expand = false } = {}) {
    const out = clips.serialize(row, { owner: !!(user && user.id === row.user_id), liked: user ? clips.isLiked(row.id, user) : undefined });
    if (expand) { out.uploaderStats = clips.userStats(row.user_id); out.gameStats = clips.gameStats(row.game_key); }
    return out;
  }

  api.get('/me', auth(), (req, res) => {
    const u = req.user;
    res.json({ user: { id: u.id, username: u.username, avatar: clips.absUrl(u.pfp_url), color: u.color, rank: u.rank,
      profileUrl: `${cfg.publicBase}/u/${encodeURIComponent(u.username)}` } });
  });

  api.post('/clips', auth(), wrap(async (req, res) => {
    let r = limits.createIp.hit(req.ip_); if (!r.ok) return limited(res, r);
    if (!userLimit(limits.createUser, req, res)) return;
    const out = await clips.create(req.user, req.token, req.ip_, req.body);
    res.status(out.existing ? 200 : 201).json(out);
  }));

  api.get('/me/likes', auth(), (req, res) => {
    res.json(clips.likedBy(req.user, typeof req.query.cursor === 'string' ? req.query.cursor : ''));
  });

  api.get('/me/clips', auth(), wrap(async (req, res) => {
    res.json({ clips: await clips.mine(req.user, req.token, req.ip_) });
  }));

  api.get('/clips', auth(true), (req, res) => {
    const sort = req.query.sort === 'top' ? 'top' : 'new';
    const str = v => (typeof v === 'string' ? v : '');
    res.json(clips.list({ sort, game: str(req.query.game), user: str(req.query.user), q: str(req.query.q), cursor: str(req.query.cursor) }, req.user));
  });

  api.get('/clips/:id', auth(true), wrap(async (req, res) => {
    const row = await visible(req);
    res.json(clipJson(row, req.user, { expand: req.query.expand === '1' }));
  }));

  api.get('/clips/:id/edit', auth(), wrap(async (req, res) => {
    const row = clips.ownRow(req.user, req.params.id);
    if (!(await clips.fresh(row))) throw new BadInput('not_found', 404);
    res.json(jobs.editPayload(clips.getRow(row.id), { retry: req.query.retry === '1' }));
  }));

  api.post('/clips/:id/publish', auth(), wrap(async (req, res) => {
    if (!userLimit(limits.publish, req, res)) return;
    const row = clips.ownRow(req.user, req.params.id);
    if (!(await clips.fresh(row))) throw new BadInput('not_found', 404);
    if (req.user.scopes && !(req.user.scopes & 4096)) throw new BadInput('reauth_upload', 403);
    res.status(202).json(jobs.publish(req.user, req.token, req.ip_, clips.getRow(row.id), req.body));
  }));

  api.post('/clips/:id/replace', auth(), wrap(async (req, res) => {
    if (!userLimit(limits.publish, req, res)) return;
    const row = clips.ownRow(req.user, req.params.id);
    res.json(await jobs.replace(req.user, req.token, req.ip_, row, req.body));
  }));

  api.patch('/clips/:id', auth(), wrap(async (req, res) => {
    if (!userLimit(limits.write, req, res)) return;
    res.json(clips.update(req.user, req.params.id, req.body));
  }));

  api.delete('/clips/:id', auth(), wrap(async (req, res) => {
    if (!userLimit(limits.write, req, res)) return;
    const media = ['1', 'true', 'yes'].includes(String(req.query.media || ''));
    res.json(await clips.remove(req.user, req.token, req.ip_, req.params.id, { media }));
  }));

  api.post('/clips/:id/view', wrap(async (req, res) => {
    const r = limits.viewIp.hit(req.ip_); if (!r.ok) return limited(res, r);
    const row = await clips.getVisible(req.params.id, null);
    if (!row) return res.status(404).json({ error: 'not_found' });
    if (!seenViews.first(`${req.ip_}|${row.id}`)) return res.json({ views: row.views, counted: false });
    res.json({ views: clips.view(row.id) ?? row.views, counted: true });
  }));

  for (const [method, on] of [['put', true], ['delete', false]]) {
    api[method]('/clips/:id/like', auth(), wrap(async (req, res) => {
      if (!userLimit(limits.like, req, res)) return;
      const row = await visible(req);
      res.json(clips.setLike(req.user, row, on));
    }));
  }

  api.get('/clips/:id/comments', auth(true), wrap(async (req, res) => {
    const row = await visible(req);
    res.json(clips.listComments(row, typeof req.query.cursor === 'string' ? req.query.cursor : ''));
  }));
  api.post('/clips/:id/comments', auth(), wrap(async (req, res) => {
    const row = await visible(req);
    if (!userLimit(limits.comment, req, res)) return;
    res.status(201).json(clips.addComment(req.user, row, req.body && req.body.body));
  }));
  api.delete('/comments/:id', auth(), wrap(async (req, res) => {
    if (!userLimit(limits.write, req, res)) return;
    res.json(clips.deleteComment(req.user, req.params.id));
  }));

  async function profile(username, ip, viewer) {
    if (typeof username !== 'string' || !/^[A-Za-z0-9_.-]{1,40}$/.test(username)) return null;
    const p = await velora.lookup(username, ip);
    if (!p) return null;
    const id = Number(p.id) || (clips.userByName(String(p.username).toLowerCase()) || {}).id;
    const priv = !!p.private;
    const user = {
      id: id || null,
      username: p.username,
      avatar: clips.absUrl(p.pfp_url),
      color: p.color || null,
      private: priv,
      veloraUrl: `${cfg.veloraPublic}/u/${encodeURIComponent(p.username)}`,
    };
    if (!priv) {
      user.bio = typeof p.bio === 'string' ? p.bio.replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').slice(0, 600) : '';
      user.banner = clips.absUrl(p.banner_url);
      user.pronouns = p.pronouns || null;
      user.joined = p.created_at || null;
    }
    if (id) clips.rememberUser({ id, username: p.username, pfp_url: p.pfp_url, color: p.color });
    const stats = id ? clips.publicForUser(id, viewer) : { clips: [], clipCount: 0, totalViews: 0, totalLikes: 0 };
    return { user, ...stats };
  }

  api.get('/users/:username', auth(true), wrap(async (req, res) => {
    const r = limits.lookupIp.hit(req.ip_); if (!r.ok) return limited(res, r);
    const p = await profile(req.params.username, req.ip_, req.user);
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.json(p);
  }));

  api.get('/games', (req, res) => res.json({ games: clips.games() }));

  api.get('/thumb/:file', (req, res) => {
    const m = /^([0-9A-Za-z]{10})\.jpg$/.exec(req.params.file);
    if (!m) return res.status(404).json({ error: 'not_found' });
    const row = clips.getRow(m[1]);
    if (!row || row.status !== 'ok' || !row.has_thumb) return res.status(404).json({ error: 'not_found' });
    if (row.visibility === 'draft' && !signer.verify(`thumb/${row.id}`, req.query.exp, req.query.sig)) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Cache-Control', row.visibility === 'draft' ? 'private, max-age=3600' : 'public, max-age=3600');
    res.sendFile(path.join(clips.thumbDir, `${m[1]}.jpg`), err => { if (err && !res.headersSent) res.status(404).json({ error: 'not_found' }); });
  });

  api.get('/proxy/:id/:file', (req, res) => {
    const p = jobs.proxyFile(req.params.id, req.params.file, req.query.exp, req.query.sig);
    if (!p) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(p, err => { if (err && !res.headersSent) res.status(404).json({ error: 'not_found' }); });
  });

  api.get('/icon/:file', (req, res) => {
    if (!/^[0-9a-f]{24}\.(png|jpg|webp)$/.test(req.params.file)) return res.status(404).json({ error: 'not_found' });
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.sendFile(path.join(clips.iconDir, req.params.file), err => { if (err && !res.headersSent) res.status(404).json({ error: 'not_found' }); });
  });

  api.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use('/api', api);

  app.use('/static', express.static(cfg.webDir, {
    index: false, fallthrough: true,
    setHeaders: res => {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  }));
  app.use('/assets', express.static(path.join(cfg.webDir, 'static'), { index: false, fallthrough: true, setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=86400') }));
  app.use('/download', express.static(cfg.downloadDir, { index: false, redirect: false, fallthrough: true, setHeaders: res => res.setHeader('Cache-Control', 'no-cache') }));

  const iconFile = f => { const p = path.join(cfg.webDir, 'static', f); return fs.existsSync(p) ? p : null; };
  const sendIcon = (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    const p = iconFile('glint-icon.svg');
    if (p) return res.type('image/svg+xml').sendFile(p);
    res.type('image/svg+xml').send(render.FAVICON);
  };
  app.get('/favicon.svg', sendIcon);
  app.get('/icon.svg', sendIcon);
  app.get('/icon-512.png', (req, res) => {
    const p = iconFile('glint-icon-512.png') || iconFile('glint-512.png');
    if (!p) return html.notFound(res);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('image/png').sendFile(p);
  });

  const latestRelease = () => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(cfg.downloadDir, 'latest.json'), 'utf8'));
      if (!j || typeof j.version !== 'string' || typeof j.url !== 'string') return null;
      return { version: j.version.slice(0, 40), url: /^https:\/\//.test(j.url) ? j.url : null, sha256: typeof j.sha256 === 'string' ? j.sha256.slice(0, 64) : null,
        size: Number(j.size) || null, notes: typeof j.notes === 'string' ? j.notes.slice(0, 4000) : '' };
    } catch { return null; }
  };

  app.get('/', (req, res) => {
    const plain = !req.query.q && !req.query.game && !req.query.user && req.query.sort !== 'top';
    html.send(res, 200, { page: 'browse', title: 'Glint', description: 'Game clips from the Nookara community.',
      boot: { page: 'browse', initial: plain ? clips.list({ sort: 'new' }) : null, games: clips.games() } });
  });

  app.get('/c/:id', async (req, res) => {
    try {
      const row = await clips.getVisible(req.params.id, null);
      if (!row) return html.notFound(res, 'clip', { draftCandidate: /^[0-9A-Za-z]{10}$/.test(req.params.id) ? req.params.id : null });
      const clip = clipJson(row, null, { expand: true });
      html.send(res, 200, { page: 'clip', clip, title: `${clip.title} - Glint`, boot: { page: 'clip', clip }, noindex: clip.visibility !== 'public' });
    } catch (e) { log.error?.(e); html.notFound(res); }
  });

  app.get('/embed/:id', async (req, res) => {
    const row = await clips.getVisible(req.params.id, null).catch(() => null);
    if (!row) return html.notFound(res, 'clip');
    html.embed(res, clips.serialize(row));
  });

  app.get('/u/:username', async (req, res) => {
    const r = limits.lookupIp.hit(req.ip_);
    if (!r.ok) { res.setHeader('Retry-After', String(r.retryAfter)); return html.error(res, 429, 'Slow down', 'Too many profile lookups from your connection. Try again in a minute.'); }
    try {
      const p = await profile(req.params.username, req.ip_, null);
      if (!p) return html.notFound(res, 'user');
      html.send(res, 200, { page: 'user', profile: p, title: `${p.user.username} - Glint`, boot: { page: 'user', profile: p } });
    } catch (e) {
      log.warn?.(`[glint] profile page: ${e.code || e.message}`);
      html.error(res, 502, 'Nookara is not answering', 'Profiles come from Nookara, which did not respond. Try again in a moment.');
    }
  });

  app.get('/liked', (req, res) => {
    html.send(res, 200, { page: 'liked', title: 'Liked clips - Glint', description: 'Clips you liked on Glint.', boot: { page: 'liked' }, noindex: true });
  });

  app.get('/download', (req, res) => {
    html.send(res, 200, { page: 'download', title: 'Download Glint', description: 'Glint for Windows: clip your games and share them on Nookara.', boot: { page: 'download', release: latestRelease() } });
  });

  app.use((req, res) => html.notFound(res));
  return { app, clips, jobs, limits };
}

module.exports = { createApp, clientIp };
