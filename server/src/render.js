const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const jsonForHtml = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#9d8ad1"/><path d="M11 8v16l13-8z" fill="#16141c"/><path d="M25 5v4M23 7h4" stroke="#16141c" stroke-width="2"/></svg>`;

const VIDEO_TYPES = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska' };
const videoType = url => VIDEO_TYPES[(String(url).split('.').pop() || '').toLowerCase()] || 'video/mp4';

function fmtViews(n) { return `${n} view${n === 1 ? '' : 's'}`; }

function create(cfg) {
  const ver = f => {
    try { return crypto.createHash('sha1').update(fs.readFileSync(path.join(cfg.webDir, f))).digest('hex').slice(0, 10); }
    catch { return '0'; }
  };
  const V = { css: ver('glint.css'), js: ver('app.js'), player: ver('player.js') };
  const hasPng = () => ['glint-icon-512.png', 'glint-512.png'].some(f => fs.existsSync(path.join(cfg.webDir, 'static', f)));
  const B = cfg.basePath;

  const csp = (frameAncestors = "'self'") => [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    `media-src 'self' ${cfg.veloraPublic} ${cfg.legacyPublic} ${cfg.cdnPublic}`,
    `connect-src 'self' ${cfg.veloraPublic} ${cfg.legacyPublic} ${cfg.cdnPublic}`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');

  function clipMeta(c) {
    const desc = `${c.game} clip by ${c.user.username} - ${fmtViews(c.views)}`;
    const vt = videoType(c.videoUrl);
    const m = [
      ['property', 'og:type', 'video.other'],
      ['property', 'og:title', c.title],
      ['property', 'og:description', desc],
      ['property', 'og:url', c.url],
      ['property', 'og:video', c.videoUrl],
      ['property', 'og:video:url', c.videoUrl],
      ['property', 'og:video:secure_url', c.videoUrl],
      ['property', 'og:video:type', vt],
      ['property', 'og:video:width', c.width],
      ['property', 'og:video:height', c.height],
      ['name', 'twitter:card', 'player'],
      ['name', 'twitter:title', c.title],
      ['name', 'twitter:description', desc],
      ['name', 'twitter:player', `${cfg.publicBase}/embed/${c.id}`],
      ['name', 'twitter:player:width', c.width],
      ['name', 'twitter:player:height', c.height],
      ['name', 'twitter:player:stream', c.videoUrl],
      ['name', 'twitter:player:stream:content_type', vt],
      ['name', 'description', desc],
    ];
    m.push(['name', 'glint:id', c.id], ['name', 'glint:title', c.title], ['name', 'glint:user', c.user.username],
      ['name', 'glint:user_avatar', c.user.avatar || ''], ['name', 'glint:game', c.game], ['name', 'glint:game_icon', c.gameIcon || ''],
      ['name', 'glint:duration', c.durationSec], ['name', 'glint:video', c.videoUrl], ['name', 'glint:thumb', c.thumbnail || ''],
      ['name', 'glint:likes', c.likes || 0], ['name', 'glint:views', c.views]);
    if (c.thumbnail) {
      m.push(['property', 'og:image', c.thumbnail], ['property', 'og:image:width', c.width], ['property', 'og:image:height', c.height], ['name', 'twitter:image', c.thumbnail]);
    }
    if (c.user.color && /^#[0-9a-f]{6}$/i.test(c.user.color)) m.push(['name', 'theme-color', c.user.color]);
    return m;
  }

  function page({ title, description, page: kind, clip, profile, boot, noindex }) {
    let meta = [];
    if (kind === 'clip' && clip) meta = clipMeta(clip);
    else {
      const d = description || (profile ? `${profile.user.username}'s game clips on Glint` : 'Game clips from the Nookara community.');
      meta = [['property', 'og:type', 'website'], ['property', 'og:title', title], ['property', 'og:description', d], ['name', 'description', d], ['name', 'twitter:card', 'summary']];
      if (profile && profile.user.avatar) meta.push(['property', 'og:image', profile.user.avatar]);
      else if (hasPng()) meta.push(['property', 'og:image', `${cfg.publicBase}/icon-512.png?v=2`]);
      if (profile && profile.user.color && /^#[0-9a-f]{6}$/i.test(profile.user.color)) meta.push(['name', 'theme-color', profile.user.color]);
    }
    meta.unshift(['property', 'og:site_name', 'Glint']);
    const metaHtml = meta.map(([k, n, v]) => `<meta ${k}="${esc(n)}" content="${esc(v)}">`).join('\n  ');
    const oembedLess = kind === 'clip' && clip ? `<link rel="canonical" href="${esc(clip.url)}">` : '';
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  ${metaHtml}
  ${noindex ? '<meta name="robots" content="noindex">' : ''}
  ${oembedLess}
  <link rel="icon" href="${B}/icon.svg?v=2" type="image/svg+xml">
  ${hasPng() ? `<link rel="apple-touch-icon" href="${B}/icon-512.png?v=2">` : ''}
  <meta name="theme-color" content="#151517">
  <link rel="stylesheet" href="${B}/static/glint.css?v=${V.css}">
</head>
<body>
  <div id="root">
    <header class="nav" id="nav">
      <a class="nav-logo" href="${B}/"><span class="logo-mark"></span><span>Glint</span></a>
    </header>
    <main id="app" class="main">
      <noscript><div class="empty-state"><p>Glint needs JavaScript to play clips.</p>${kind === 'clip' && clip ? `<p><a href="${esc(clip.videoUrl)}">${esc(clip.title)}</a></p>` : ''}</div></noscript>
    </main>
  </div>
  <script type="application/json" id="boot">${jsonForHtml({ ...boot, base: B, publicBase: cfg.publicBase, velora: cfg.veloraPublic, appId: cfg.veloraAppId, icon: hasPng() || fs.existsSync(path.join(cfg.webDir, 'static', 'glint-icon.svg')) })}</script>
  <script src="${B}/static/player.js?v=${V.player}"></script>
  <script src="${B}/static/app.js?v=${V.js}"></script>
</body>
</html>`;
  }

  function headers(res, frameAncestors) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Content-Security-Policy', csp(frameAncestors));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  return {
    send(res, status, opts) {
      headers(res);
      res.status(status).send(page(opts));
    },
    notFound(res, kind = 'page', extra = {}) {
      headers(res);
      res.status(404).send(page({ page: '404', title: 'Not found - Glint', description: 'This page does not exist.', boot: { page: '404', kind, ...extra }, noindex: true }));
    },
    error(res, status, title, message) {
      headers(res);
      res.status(status).send(page({ page: 'error', title: `${title} - Glint`, boot: { page: 'error', status, title, message }, noindex: true }));
    },
    embed(res, c) {
      headers(res, '*');
      res.status(200).send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.title)} - Glint</title><meta name="robots" content="noindex">
<link rel="stylesheet" href="${B}/static/glint.css?v=${V.css}">
</head><body class="embed-body"><div id="embed" class="embed-wrap"></div>
<script type="application/json" id="embed-boot">${jsonForHtml({ clip: c, base: B })}</script>
<script src="${B}/static/player.js?v=${V.player}"></script></body></html>`);
    },
  };
}

module.exports = { create, esc, jsonForHtml, FAVICON };
