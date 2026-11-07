/* Glint web client. Renders every page from the boot JSON the server inlines; talks to <base>/api.
   Icons are inline lucide SVG paths (no emoji, no unicode symbols). Player = web/player.js (window.GlintPlayer). */
(function () {
  'use strict';

  var BOOT = {};
  try { BOOT = JSON.parse(document.getElementById('boot').textContent || '{}'); } catch (e) { BOOT = {}; }
  var BASE = BOOT.base || '';
  var VELORA = BOOT.velora || 'https://nookara.cc';
  var TOKEN_KEY = 'glint_token';
  var ACCENT_KEY = 'glint_accent';
  var DEFAULT_ACCENT = '#9d8ad1';

  var ICONS = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
    film: '<rect width="18" height="18" x="3" y="3"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
    eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    logIn: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" x2="3" y1="12" y2="12"/>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" x2="9" y1="12" y2="12"/>',
    gamepad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4"/><path d="M3 10h18"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    monitor: '<rect width="20" height="14" x="2" y="3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/>',
    lock: '<rect width="18" height="11" x="3" y="11"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    sparkles: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    play: '<polygon points="6 3 20 12 6 21 6 3"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    searchX: '<path d="m13.5 8.5-5 5"/><path d="m8.5 8.5 5 5"/><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
    history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    keyboard: '<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    hardDrive: '<line x1="22" x2="2" y1="12" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" x2="6.01" y1="16" y2="16"/><line x1="10" x2="10.01" y1="16" y2="16"/>',
    wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    audioLines: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    volumeX: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    filePen: '<path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    toStart: '<path d="M3 19V5"/><path d="m13 6-6 6 6 6"/><path d="M7 12h14"/>',
    toEnd: '<path d="M17 12H3"/><path d="m11 18 6-6-6-6"/><path d="M21 5v14"/>',
    ratio: '<rect width="20" height="12" x="2" y="6"/><path d="M12 6v12"/>',
    copy: '<rect width="14" height="14" x="8" y="8"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    appWindow: '<rect x="2" y="4" width="20" height="16"/><path d="M10 4v4"/><path d="M2 8h20"/><path d="M6 4v4"/>'
  };
  function icon(name, cls) {
    var span = document.createElement('span');
    span.innerHTML = '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
    return span.firstChild;
  }

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') for (var s in v) el.style.setProperty(s, v[s]);
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDur(s) {
    s = Math.max(0, Math.round(Number(s) || 0));
    var m = Math.floor(s / 60), r = s % 60;
    if (m >= 60) return Math.floor(m / 60) + ':' + pad(m % 60) + ':' + pad(r);
    return m + ':' + pad(r);
  }
  function fmtPrecise(s) {
    s = Math.max(0, Number(s) || 0);
    var m = Math.floor(s / 60), r = s - m * 60;
    return m + ':' + (r < 10 ? '0' : '') + r.toFixed(1);
  }
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (n >= 1e4) return Math.round(n / 1e3) + 'K';
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  function plural(n, w) { return fmtNum(n) + ' ' + w + (Number(n) === 1 ? '' : 's'); }
  function views(n) { return plural(n, 'view'); }
  function ago(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (!isFinite(d)) return '';
    if (d < 60) return 'just now';
    var u = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
    for (var i = 0; i < u.length; i++) if (d >= u[i][0]) { var n = Math.floor(d / u[i][0]); return n + ' ' + u[i][1] + (n === 1 ? '' : 's') + ' ago'; }
    return '';
  }
  function fullDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return ''; }
  }
  function fmtBytes(b) {
    if (!b) return '';
    var u = ['B', 'KB', 'MB', 'GB'], i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(i ? 1 : 0) + ' ' + u[i];
  }
  function resLabel(w, hgt) {
    var p = Math.min(w, hgt);
    var name = p >= 2160 ? '4K' : p >= 1440 ? '1440p' : p >= 1080 ? '1080p' : p >= 720 ? '720p' : p + 'p';
    return name + ' (' + w + 'x' + hgt + ')';
  }

  function hexRgb(hex) {
    var m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
  }
  function validColor(c) { return !!hexRgb(c) && !/^#?(fff|ffffff)$/i.test(String(c).trim()); }
  function applyAccent(color, persist) {
    var hex = validColor(color) ? color : DEFAULT_ACCENT;
    var rgb = hexRgb(hex);
    document.documentElement.style.setProperty('--accent', hex);
    document.documentElement.style.setProperty('--accent-dim', 'rgba(' + rgb.join(', ') + ', .12)');
    if (persist) store(ACCENT_KEY, hex === DEFAULT_ACCENT ? null : hex);
  }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  applyAccent(load(ACCENT_KEY), false);

  var me = null;
  function token() { return load(TOKEN_KEY); }
  function api(method, path, body) {
    var headers = { Accept: 'application/json' };
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(BASE + '/api' + path, { method: method, headers: headers, body: body !== undefined ? JSON.stringify(body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (r.status === 401 && t) { signOutLocal(); }
          if (!r.ok) { var e = new Error(data.error || ('http_' + r.status)); e.status = r.status; e.data = data; throw e; }
          return data;
        });
      });
  }
  var ERRORS = {
    rate_limited: 'Slow down a little - try again in a moment.',
    unauthorized: 'Your session ended. Sign in again.',
    forbidden: 'You can\'t do that.',
    not_found: 'That clip no longer exists.',
    media_delete_failed: 'Nookara would not delete the video. The clip was kept - try again.',
    velora_unreachable: 'Nookara is not answering right now. Try again in a bit.',
    invalid_title: 'The title cannot be empty.',
    invalid_trim: 'The trim range is not valid.',
    tos_required: 'Accept the latest Nookara terms on nookara.cc first.',
    banned: 'This Nookara account is banned.',
    empty_comment: 'Write something first.',
    comment_too_long: 'Comments can be up to 500 characters.',
    rendering: 'This clip is being published right now.',
    storage_limit_exceeded: 'Your Nookara storage is full. Free up some space and try again.',
    token_rejected: 'Nookara rejected your sign-in during the upload. Sign in again and retry.',
    render_failed: 'Rendering the clip failed. Try again, or re-upload it from the app.',
    source_missing: 'The draft\'s video is gone from your Nookara uploads.',
    upload_failed: 'Uploading the finished clip to Nookara failed. Try again.',
    interrupted: 'The server restarted in the middle of publishing. Try again.',
    pro_only: 'Uploading isn\'t available on your account yet.',
    file_too_large: 'The finished clip is too big for Nookara.',
    proxy_failed: 'Preparing the editor failed.',
    reauth_upload: 'Publishing needs upload permission on your Nookara sign-in. Sign in again, then publish.',
    upload_forbidden: 'Nookara refused the upload for this sign-in. Sign in again, then publish.'
  };
  function reauthPrompt(code) {
    modal({
      title: 'Sign in again to publish', icon: 'logIn',
      body: [h('p', { text: ERRORS[code] || ERRORS.reauth_upload })],
      foot: function (close) {
        return [h('button', { class: 'btn btn-ghost', onclick: close }, 'Not now'),
          h('button', { class: 'btn btn-primary', onclick: function () { close(); signIn(); } }, icon('logIn'), 'Sign in again')];
      }
    });
  }
  function isReauth(e) { var c = typeof e === 'string' ? e : e && e.message; return c === 'reauth_upload' || c === 'upload_forbidden'; }
  function errText(e) { var c = typeof e === 'string' ? e : e && e.message; return ERRORS[c] || 'Something went wrong (' + (c || 'error') + ').'; }

  var toastBox = null;
  function toast(msg, err, action) {
    if (!toastBox) { toastBox = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(toastBox); }
    var t = h('div', { class: 'toast' + (err ? ' err' : '') + (action ? ' has-act' : '') }, icon(err ? 'alert' : 'check', 'i-sm'), h('span', { text: msg }));
    function gone() { t.classList.add('out'); setTimeout(function () { t.remove(); }, 240); }
    if (action) t.appendChild(h('button', { class: 'toast-act', onclick: function () { action.fn(); gone(); } }, action.icon ? icon(action.icon, 'i-sm') : null, action.label));
    toastBox.appendChild(t);
    setTimeout(gone, action ? 5200 : 3200);
  }
  function modal(opts) {
    var ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
    var prevFocus = document.activeElement;
    function close() { ov.remove(); document.removeEventListener('keydown', onKey); if (opts.onClose) opts.onClose(); try { prevFocus && prevFocus.focus(); } catch (e) {} }
    function onKey(e) { if (e.key === 'Escape') close(); }
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', onKey);
    var m = h('div', { class: 'modal' },
      h('div', { class: 'modal-head' }, opts.icon ? icon(opts.icon) : null, opts.title),
      h('div', { class: 'modal-body' }, opts.body),
      opts.foot ? h('div', { class: 'modal-foot' }, opts.foot(close)) : null);
    ov.appendChild(m);
    document.body.appendChild(ov);
    var f = m.querySelector('button.btn-danger-solid, button.btn-primary, button'); if (f) f.focus();
    return close;
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text;
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); }
      ta.remove();
    });
  }

  var signingIn = false;
  function signIn() {
    if (signingIn) return;
    signingIn = true;
    var popup = window.open('about:blank', 'glint-velora-signin', 'width=500,height=740');
    var cancelled = false, timer = null;
    var closeModal = modal({
      title: 'Sign in with Nookara', icon: 'logIn',
      body: [h('div', { style: { display: 'flex', 'align-items': 'center', gap: '12px' } }, h('div', { class: 'spinner' }), h('span', { text: 'Finish signing in in the Nookara window. This page updates by itself.' }))],
      foot: function (close) { return h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'); },
      onClose: function () { cancelled = true; signingIn = false; code = null; done(); if (timer) clearTimeout(timer); try { if (popup && !popup.closed) popup.close(); } catch (e) {} }
    });
    function done() { window.removeEventListener('message', onGrant); }
    var code = null;
    function onGrant(ev) {
      if (cancelled || ev.origin !== VELORA || !ev.data || ev.data.type !== 'nookara_app_grant' || ev.data.code !== code) return;
      done();
      if (timer) clearTimeout(timer);
      var finished = code; code = null;
      fetch(VELORA + '/auth/ext-code/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: finished, grant: ev.data.grant }) })
        .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.token) throw new Error('exchange'); return j; }); })
        .then(function (j) {
          store(TOKEN_KEY, j.token);
          try { if (popup && !popup.closed) popup.close(); } catch (e) {}
          closeModal();
          loadMe().then(function () { if (me) toast('Signed in as ' + me.username); route(); });
        })
        .catch(function () { if (!cancelled) { closeModal(); toast('Sign-in did not finish. Try again.', true); } });
    }
    window.addEventListener('message', onGrant);
    fetch(VELORA + '/auth/ext-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: BOOT.appId }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.code) throw new Error('no_code');
        code = d.code;
        var url = VELORA + '/login?code=' + encodeURIComponent(d.code);
        if (popup && !popup.closed) popup.location.href = url; else popup = window.open(url, 'glint-velora-signin', 'width=500,height=740');
        if (!popup) { closeModal(); toast('Allow pop-ups for this site to sign in.', true); return; }
        var started = Date.now();
        (function watch() {
          if (cancelled || !code) return;
          fetch(VELORA + '/auth/ext-code/status?code=' + encodeURIComponent(d.code))
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
            .then(function (res) {
              if (cancelled || !code) return;
              if (res.status === 404) throw new Error('expired');
              var closed = false; try { closed = !popup || popup.closed; } catch (e) {}
              if (closed && Date.now() - started > 3000 && res.j && res.j.alive === false && !res.j.approved) throw new Error('closed');
              timer = setTimeout(watch, 1500);
            })
            .catch(function (e) {
              if (cancelled || !code) return;
              closeModal();
              if (e.message !== 'closed') toast('Sign-in did not finish. Try again.', true);
            });
        })();
      })
      .catch(function () { if (!cancelled) { closeModal(); toast('Could not reach Nookara to sign in.', true); } });
  }
  function signOutLocal() { store(TOKEN_KEY, null); me = null; renderNav(); }
  function signOut() { signOutLocal(); store(ACCENT_KEY, null); applyAccent(null); toast('Signed out'); route(); }

  function loadMe() {
    if (!token()) { me = null; renderNav(); return Promise.resolve(null); }
    return api('GET', '/me').then(function (d) { me = d.user; applyAccent(me.color, true); renderNav(); return me; })
      .catch(function () { me = null; renderNav(); return null; });
  }

  function avatar(user, size) {
    var cls = 'avatar avatar-' + size;
    if (user && user.avatar) return h('img', { class: cls, src: user.avatar, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
    return h('span', { class: cls + ' avatar-ph' }, ((user && user.username) || '?').charAt(0));
  }
  function link(href, attrs) {
    attrs = attrs || {}; attrs.href = href;
    var a = h.apply(null, ['a', attrs].concat([].slice.call(arguments, 2)));
    a.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target) return;
      if (href.indexOf(BASE + '/') !== 0 || /^\/(download\/|api\/)/.test(href.slice(BASE.length))) return;
      e.preventDefault(); go(href);
    });
    return a;
  }
  function profileHref(name) { return BASE + '/u/' + encodeURIComponent(name); }
  function gameHref(game) { return BASE + '/?game=' + encodeURIComponent(game); }
  function thumb(c, opts) {
    opts = opts || {};
    var badge = null;
    if (opts.showVis) {
      if (c.status === 'rendering') badge = h('span', { class: 'badge vis draft' }, icon('history', 'i-sm'), 'Publishing');
      else if (c.visibility === 'draft' && c.status === 'failed') badge = h('span', { class: 'badge vis failed' }, icon('alert', 'i-sm'), 'Draft - failed');
      else if (c.visibility === 'draft') badge = h('span', { class: 'badge vis draft' }, icon('filePen', 'i-sm'), 'Draft');
      else if (c.visibility === 'unlisted') badge = h('span', { class: 'badge vis' }, icon('eyeOff', 'i-sm'), 'Unlisted');
    }
    return h('div', { class: 'thumb' },
      c.thumbnail ? h('img', { src: c.thumbnail, alt: '', loading: 'lazy' }) : h('div', { class: 'thumb-ph' }, icon('film', 'i-xl')),
      h('span', { class: 'play' }, icon(c.visibility === 'draft' ? 'pencil' : 'play')),
      h('span', { class: 'badge dur' }, fmtDur(c.durationSec)),
      badge);
  }
  function dot() { return h('span', { style: { width: '3px', height: '3px', background: 'var(--border-2)', 'flex-shrink': '0' } }); }
  function card(c, opts, i) {
    opts = opts || {};
    return link(BASE + '/c/' + c.id, { class: 'card', style: { '--i': String(i || 0) } },
      thumb(c, opts),
      h('div', { class: 'card-title', title: c.title }, c.title),
      opts.noUser ? null : h('div', { class: 'card-meta' }, h('span', { class: 'who' }, avatar(c.user, 20), c.user.username)),
      h('div', { class: 'card-sub' },
        c.gameIcon ? h('img', { src: c.gameIcon, alt: '', loading: 'lazy' }) : icon('gamepad', 'i-sm'),
        h('span', { text: c.game }), dot(),
        h('span', { text: views(c.views) }),
        c.likes ? [dot(), h('span', { class: 'lk', title: plural(c.likes, 'like') }, icon('heart', 'i-sm'), fmtNum(c.likes))] : null,
        dot(), h('span', { text: ago(c.createdAt) })));
  }
  function skeletonGrid(n) {
    var g = h('div', { class: 'grid' });
    for (var i = 0; i < n; i++) g.appendChild(h('div', { class: 'card' }, h('div', { class: 'thumb sk' }), h('div', { class: 'sk sk-line', style: { width: '80%' } }), h('div', { class: 'sk sk-line', style: { width: '45%' } })));
    return g;
  }
  function empty(iconName, title, text, action) {
    return h('div', { class: 'empty-state' }, icon(iconName, 'i-xl'), h('h3', { text: title }), text ? h('p', { text: text }) : null, action || null);
  }
  function footer() {
    return h('footer', { class: 'footer' },
      h('span', { text: 'Glint is an unofficial clip app for Nookara accounts.' }),
      h('a', { href: VELORA, target: '_blank', rel: 'noopener' }, 'nookara.cc'),
      link(BASE + '/download', {}, 'Get the app'));
  }
  function linkified(text) {
    var out = [], re = /https?:\/\/[^\s<>"']+/g, last = 0, m;
    while ((m = re.exec(text))) {
      var url = m[0].replace(/[.,!?;:)\]]+$/, '');
      if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
      out.push(h('a', { href: url, rel: 'nofollow ugc noopener noreferrer', target: '_blank', text: url }));
      last = m.index + url.length;
    }
    if (last < text.length) out.push(document.createTextNode(text.slice(last)));
    return out;
  }

  // ------------------------------------------------------------------ nav
  function renderNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;
    clear(nav);
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var onBrowse = path === BASE || path === BASE + '/';
    nav.appendChild(link(BASE + '/', { class: 'nav-logo', 'aria-label': 'Glint home' },
      BOOT.icon ? h('img', { src: BASE + '/icon.svg?v=2', alt: '' }) : h('span', { class: 'logo-mark' }),
      h('span', { text: 'Glint' }), h('span', { class: 'nav-tag', text: 'BETA' })));
    nav.appendChild(h('div', { class: 'nav-links' },
      link(BASE + '/', { class: 'nav-link' + (onBrowse ? ' active' : '') }, icon('film'), h('span', { class: 'lbl', text: 'Browse' })),
      link(BASE + '/download', { class: 'nav-link' + (path === BASE + '/download' ? ' active' : '') }, icon('download'), h('span', { class: 'lbl', text: 'Download' }))));
    nav.appendChild(h('div', { class: 'nav-spacer' }));
    if (!onBrowse) {
      var input = h('input', { type: 'search', placeholder: 'Search clips', 'aria-label': 'Search clips', maxlength: '64' });
      var form = h('form', { class: 'nav-search', role: 'search' }, icon('search', 'i-sm'), input);
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = input.value.trim();
        go(BASE + '/' + (q ? '?q=' + encodeURIComponent(q) : ''));
      });
      nav.appendChild(form);
    }
    if (me) {
      var wrap = h('div', { class: 'nav-user' });
      var menu = null;
      var btn = h('button', { class: 'nav-user-btn', 'aria-haspopup': 'menu', 'aria-label': 'Account menu', title: me.username }, avatar(me, 26), h('span', { class: 'nav-user-name', text: me.username }));
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (menu) { menu.remove(); menu = null; return; }
        menu = h('div', { class: 'menu', role: 'menu' },
          link(profileHref(me.username), {}, icon('film'), 'My clips'),
          link(profileHref(me.username) + '?tab=drafts', {}, icon('filePen'), 'My drafts'),
          link(BASE + '/liked', {}, icon('heart'), 'Liked clips'),
          h('a', { href: VELORA + '/u/' + encodeURIComponent(me.username), target: '_blank', rel: 'noopener' }, icon('user'), 'Nookara profile'),
          h('button', { class: 'danger', onclick: signOut }, icon('logOut'), 'Sign out'));
        wrap.appendChild(menu);
        var off = function () { if (menu) { menu.remove(); menu = null; } document.removeEventListener('click', off); };
        setTimeout(function () { document.addEventListener('click', off); });
      });
      wrap.appendChild(btn);
      nav.appendChild(wrap);
    } else {
      nav.appendChild(h('button', { class: 'btn btn-primary btn-sm', onclick: signIn }, icon('logIn', 'i-sm'), h('span', { class: 'lbl', text: 'Sign in' })));
    }
  }

  var app = document.getElementById('app');
  var pageToken = 0;
  var cleanups = [];
  function onLeave(fn) { cleanups.push(fn); }
  function leave() { var c = cleanups; cleanups = []; c.forEach(function (f) { try { f(); } catch (e) {} }); }
  function enter() { app.classList.remove('page-enter'); void app.offsetWidth; app.classList.add('page-enter'); }

  function setTitle(t) { document.title = t ? t + ' - Glint' : 'Glint'; }

  // ---- browse
  function pageBrowse(params, boot) {
    var my = ++pageToken;
    var state = { sort: params.get('sort') === 'top' ? 'top' : 'new', game: params.get('game') || '', user: params.get('user') || '', q: params.get('q') || '', cursor: null };
    setTitle(state.q ? 'Search' : '');
    clear(app); enter();

    var input = h('input', { type: 'search', placeholder: 'Search clips, games or people', 'aria-label': 'Search clips, games or people', maxlength: '64', enterkeyhint: 'search' });
    input.value = state.q;
    var clearBtn = h('button', { class: 'clear', type: 'button', 'aria-label': 'Clear search' }, icon('x', 'i-sm'));
    clearBtn.style.display = state.q ? '' : 'none';
    var seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Sort' });
    var head = h('div', { class: 'page-head' },
      h('div', {}, h('h1', { class: 'page-title', text: 'Clips' }), h('p', { class: 'page-sub', text: 'Fresh moments from the Nookara community.' })),
      seg);
    var searchBar = h('form', { class: 'search-bar', role: 'search' }, h('div', { class: 'search-box' }, icon('search', 'i-sm'), input, clearBtn));
    var filters = h('div', { class: 'filters' });
    var top = h('section', { class: 'topgames' });
    var grid = skeletonGrid(8);
    var more = h('div', { class: 'more-row' });
    add(app, [head, top, searchBar, filters, grid, more, footer()]);

    function drawSeg() {
      clear(seg);
      [['new', 'sparkles', 'New'], ['top', 'flame', 'Top']].forEach(function (s) {
        seg.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': String(state.sort === s[0]), class: state.sort === s[0] ? 'on' : '', onclick: function () { if (state.sort !== s[0]) { state.sort = s[0]; refresh(); } } }, icon(s[1], 'i-sm'), s[2]));
      });
    }
    function syncUrl() {
      var p = new URLSearchParams();
      if (state.q) p.set('q', state.q);
      if (state.game) p.set('game', state.game);
      if (state.user) p.set('user', state.user);
      if (state.sort === 'top') p.set('sort', 'top');
      var qs = p.toString();
      history.replaceState(null, '', BASE + '/' + (qs ? '?' + qs : ''));
      setTitle(state.q || state.game || state.user ? 'Search' : '');
    }
    function drawFilters() {
      clear(filters);
      var any = false;
      function chip(label, value, onRemove) {
        any = true;
        filters.appendChild(h('span', { class: 'fchip' }, h('span', { text: label + ':' }), h('b', { text: value }),
          h('button', { type: 'button', 'aria-label': 'Remove ' + label + ' filter', onclick: onRemove }, icon('x', 'i-sm'))));
      }
      if (state.q) chip('Search', state.q, function () { state.q = ''; input.value = ''; refresh(); });
      if (state.game) chip('Game', state.game, function () { state.game = ''; refresh(); });
      if (state.user) chip('User', state.user, function () { state.user = ''; refresh(); });
      filters.style.display = any ? '' : 'none';
    }
    function drawTop(games) {
      clear(top);
      if (!games || !games.length) { top.style.display = 'none'; return; }
      top.style.display = '';
      var row = h('div', { class: 'tg-row stagger' });
      games.slice(0, 12).forEach(function (g, i) {
        var on = state.game && state.game.toLowerCase() === g.key;
        row.appendChild(h('button', { type: 'button', class: 'tg' + (on ? ' on' : ''), style: { '--i': String(i) }, 'aria-pressed': String(!!on),
          onclick: function () { state.game = on ? '' : g.name; refresh(); } },
          g.icon ? h('img', { src: g.icon, alt: '' }) : h('span', { class: 'ph' }, icon('gamepad')),
          h('span', { class: 'tx' }, h('div', { class: 'nm', text: g.name }), h('div', { class: 'ct', text: plural(g.count, 'clip') })),
          h('span', { class: 'tg-rank', text: '#' + (i + 1) })));
      });
      top.appendChild(h('div', { class: 'topgames-title' }, icon('trophy', 'i-sm'), 'Top clipped games'));
      top.appendChild(row);
    }
    var games = boot && boot.games ? boot.games : null;

    function drawPage(data, append) {
      if (my !== pageToken) return;
      var start = append ? grid.children.length : 0;
      if (!append) { clear(grid); grid.className = 'grid stagger'; }
      if (!append && !data.clips.length) {
        grid.className = '';
        grid.appendChild(state.q || state.game || state.user
          ? empty('searchX', 'No clips found', 'Nothing matches that yet. Try another search, game or person.', h('button', { class: 'btn btn-surface btn-sm', onclick: function () { state.q = state.game = state.user = ''; input.value = ''; refresh(); } }, 'Clear search'))
          : empty('film', 'No clips yet', 'Clips people share from the Glint app show up here.', link(BASE + '/download', { class: 'btn btn-primary btn-sm' }, icon('download', 'i-sm'), 'Get Glint')));
      }
      data.clips.forEach(function (c, i) { grid.appendChild(card(c, {}, i + (append ? 0 : 0) + (start ? 0 : 0))); });
      state.cursor = data.nextCursor;
      clear(more);
      if (state.cursor) {
        var b = h('button', { class: 'btn btn-surface' }, 'Load more');
        b.addEventListener('click', function () {
          b.disabled = true;
          fetchPage().then(function (d) { drawPage(d, true); }).catch(function (e) { b.disabled = false; toast(errText(e), true); });
        });
        more.appendChild(b);
      }
    }
    function fetchPage() {
      var p = new URLSearchParams();
      if (state.sort === 'top') p.set('sort', 'top');
      if (state.game) p.set('game', state.game);
      if (state.user) p.set('user', state.user);
      if (state.q) p.set('q', state.q);
      if (state.cursor) p.set('cursor', state.cursor);
      return api('GET', '/clips?' + p.toString());
    }
    var seq = 0;
    function refresh(fromBoot) {
      state.cursor = null;
      drawSeg(); drawFilters(); drawTop(games);
      clearBtn.style.display = input.value ? '' : 'none';
      if (!fromBoot) syncUrl();
      var mine = ++seq;
      if (fromBoot && boot && boot.initial && !state.q && !state.game && !state.user && state.sort === 'new') return drawPage(boot.initial, false);
      grid.style.opacity = '.55';
      fetchPage().then(function (d) { if (mine === seq) { grid.style.opacity = ''; drawPage(d, false); } }).catch(function (e) {
        if (my !== pageToken || mine !== seq) return;
        grid.style.opacity = '';
        clear(grid).className = ''; grid.appendChild(empty('wifiOff', 'Could not load clips', errText(e)));
      });
    }
    var deb = 0;
    input.addEventListener('input', function () {
      clearBtn.style.display = input.value ? '' : 'none';
      clearTimeout(deb);
      deb = setTimeout(function () { var v = input.value.trim(); if (v !== state.q) { state.q = v; refresh(); } }, 300);
    });
    searchBar.addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(deb); state.q = input.value.trim(); refresh(); input.blur(); });
    clearBtn.addEventListener('click', function () { input.value = ''; state.q = ''; refresh(); input.focus(); });
    onLeave(function () { clearTimeout(deb); });

    if (!games) api('GET', '/games').then(function (d) { if (my === pageToken) { games = d.games; drawTop(games); } }).catch(function () {});
    refresh(true);
  }

  function pageClip(id, clip) {
    var my = ++pageToken;
    clear(app); enter();
    if (clip && clip.id === id) return show(clip);
    app.appendChild(h('div', { class: 'viewer' }, h('div', {}, h('div', { class: 'sk', style: { 'aspect-ratio': '16 / 9' } }), h('div', { class: 'sk sk-line', style: { width: '60%', height: '20px', 'margin-top': '16px' } })), h('div', { class: 'sk', style: { height: '220px' } })));
    api('GET', '/clips/' + encodeURIComponent(id) + '?expand=1').then(function (c) { if (my === pageToken) show(c); })
      .catch(function (e) { if (my === pageToken) { if (e.status === 404) page404('clip'); else { clear(app); app.appendChild(empty('wifiOff', 'Could not load this clip', errText(e))); } } });
    function show(c) {
      if (c.visibility === 'draft') {
        if (me && me.id === c.user.id) return pageEditor(c);
        return page404('clip');
      }
      clear(app); enter();
      drawViewer(c, my);
    }
  }

  function likeButton(c) {
    var n = h('span', { class: 'n', text: fmtNum(c.likes || 0) });
    var b = h('button', { class: 'btn btn-surface like-btn' + (c.liked ? ' on' : ''), 'aria-pressed': String(!!c.liked), 'aria-label': c.liked ? 'Unlike' : 'Like' }, icon('heart'), n);
    var busy = false;
    b.addEventListener('click', function () {
      if (!me) { signIn(); return; }
      if (busy) return;
      busy = true;
      var on = !c.liked;
      c.liked = on; c.likes = Math.max(0, (c.likes || 0) + (on ? 1 : -1));
      paint(on);
      api(on ? 'PUT' : 'DELETE', '/clips/' + c.id + '/like').then(function (d) { c.liked = d.liked; c.likes = d.likes; paint(false); })
        .catch(function (e) { c.liked = !on; c.likes = Math.max(0, c.likes + (on ? -1 : 1)); paint(false); toast(errText(e), true); })
        .then(function () { busy = false; });
    });
    function paint(pop) {
      b.classList.toggle('on', !!c.liked);
      b.setAttribute('aria-pressed', String(!!c.liked));
      b.setAttribute('aria-label', c.liked ? 'Unlike' : 'Like');
      n.textContent = fmtNum(c.likes || 0);
      if (pop) {
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
        var burst = h('span', { class: 'burst' }); b.appendChild(burst); setTimeout(function () { burst.remove(); }, 450);
      }
    }
    return b;
  }

  function drawViewer(c, my) {
    setTitle(c.title);
    var owner = !!(me && me.id === c.user.id);
    var stage = h('div', { class: 'player-wrap' });
    var player = window.GlintPlayer(stage, { src: c.videoUrl, poster: c.thumbnail, width: c.width, height: c.height, duration: c.durationSec,
      shareUrl: c.url, label: c.title, globalKeys: true });
    onLeave(function () { player.destroy(); });
    var counted = false;
    player.on('playing', function () {
      if (counted) return; counted = true;
      api('POST', '/clips/' + c.id + '/view').then(function (d) { if (d && typeof d.views === 'number') { c.views = d.views; viewsB.textContent = fmtNum(d.views); } }).catch(function () {});
    });
    player.on('error', function (err) { if (err && err.code === 4) toast('This video could not be played. It may have been deleted.', true); });

    var titleEl = h('h1', { class: 'clip-title', text: c.title });
    var actions = h('div', { class: 'actions' },
      likeButton(c),
      h('a', { class: 'btn btn-surface', title: 'Report this clip, no account needed', href: 'https://nookara.cc/report?' + new URLSearchParams({ user: (c.user && c.user.username) || '', category: 'voice_in_clip', clip: c.url }).toString(), target: '_blank', rel: 'noopener' }, icon('flag', 'i-sm'), 'My voice or image is in this'),
      h('button', { class: 'btn btn-surface', 'aria-label': 'Copy link', onclick: function () { copyText(c.url).then(function () { toast('Link copied'); }, function () { toast('Could not copy the link', true); }); } }, icon('link', 'i-sm'), 'Copy link'),
      h('button', { class: 'btn btn-primary', onclick: function () {
        if (navigator.share) navigator.share({ title: c.title, url: c.url }).catch(function () {});
        else copyText(c.url).then(function () { toast('Link copied - paste it anywhere'); });
      } }, icon('share', 'i-sm'), 'Share'));
    var mainCol = h('div', {},
      stage,
      h('div', { class: 'title-row' }, titleEl, actions),
      c.visibility === 'unlisted' ? h('div', { class: 'page-sub', style: { display: 'flex', 'align-items': 'center', gap: '6px', color: 'var(--yellow)' } }, icon('eyeOff', 'i-sm'), 'Unlisted - only people with the link can see it') : null,
      owner ? ownerPanel(c, titleEl) : null,
      commentsSection(c));

    var us = c.uploaderStats || {}, gs = c.gameStats || {};
    var viewsB = h('b', { text: fmtNum(c.views) });
    var uploader = h('section', { class: 'vcard', style: validColor(c.user.color) ? { '--uc': c.user.color } : null },
      h('div', { class: 'vcard-head' },
        link(profileHref(c.user.username), { 'aria-label': c.user.username + ' profile' }, avatar(c.user, 40)),
        h('div', { class: 'grow' }, link(profileHref(c.user.username), { class: 'vcard-name' }, c.user.username), h('div', { class: 'vcard-sub', text: 'Uploaded ' + ago(c.createdAt) }))),
      h('div', { class: 'vstats' },
        h('div', {}, h('b', { text: fmtNum(us.clips || 0) }), h('span', { text: 'Clips' })),
        h('div', {}, h('b', { text: fmtNum(us.views || 0) }), h('span', { text: 'Views' })),
        h('div', {}, h('b', { text: fmtNum(us.likes || 0) }), h('span', { text: 'Likes' }))),
      h('div', { class: 'vcard-foot' }, link(profileHref(c.user.username), {}, 'View profile', icon('arrowRight', 'i-sm'))));
    var gameCard = h('section', { class: 'vcard' },
      h('div', { class: 'vcard-head' },
        c.gameIcon ? h('img', { class: 'game-ic', src: c.gameIcon, alt: '' }) : h('span', { class: 'game-ic' }, icon('gamepad')),
        h('div', { class: 'grow' }, link(gameHref(c.game), { class: 'vcard-name' }, c.game), h('div', { class: 'vcard-sub', text: 'Game' }))),
      h('div', { class: 'vstats' },
        h('div', {}, h('b', { text: fmtNum(gs.clips || 0) }), h('span', { text: 'Clips' })),
        h('div', {}, h('b', { text: fmtNum(gs.views || 0) }), h('span', { text: 'Views' })),
        h('div', {}, h('b', { text: fmtNum(gs.likes || 0) }), h('span', { text: 'Likes' }))),
      h('div', { class: 'vcard-foot' }, link(gameHref(c.game), {}, 'More clips from ' + c.game, icon('arrowRight', 'i-sm'))));
    var likesB = h('b', { text: fmtNum(c.likes || 0) });
    var facts = h('section', { class: 'vcard' },
      h('div', { class: 'vcard-head', style: { 'padding-bottom': '10px' } }, h('div', { class: 'grow' }, h('div', { class: 'vcard-name', text: 'This clip' }))),
      h('div', { class: 'facts' },
        h('div', {}, icon('eye', 'i-sm'), viewsB, 'views'),
        h('div', {}, icon('heart', 'i-sm'), likesB, 'likes'),
        h('div', { title: new Date(c.createdAt).toLocaleString() }, icon('calendar', 'i-sm'), h('b', { text: fullDate(c.createdAt) })),
        h('div', {}, icon('clock', 'i-sm'), h('b', { text: fmtDur(c.durationSec) })),
        h('div', {}, icon('ratio', 'i-sm'), h('b', { text: resLabel(c.width, c.height) })),
        h('div', {}, icon(c.visibility === 'public' ? 'globe' : 'eyeOff', 'i-sm'), h('b', { text: c.visibility === 'public' ? 'Public' : 'Unlisted' }))));
    var moreTitle = h('div', { class: 'side-title' }, icon('gamepad', 'i-sm'), h('span', { text: 'More from ' + c.game }));
    var moreList = h('div', { class: 'side-list stagger' }, h('div', { class: 'sk', style: { height: '84px' } }));
    var moreBox = h('div', { style: { 'margin-top': '6px' } }, moreTitle, moreList);
    var side = h('aside', { class: 'vside stagger' }, uploader, gameCard, facts, moreBox);
    [uploader, gameCard, facts, moreBox].forEach(function (n, i) { n.style.setProperty('--i', String(i)); });
    app.appendChild(h('div', { class: 'viewer' }, mainCol, side));
    app.appendChild(footer());

    actions.firstChild.addEventListener('click', function () { setTimeout(function () { likesB.textContent = fmtNum(c.likes || 0); }, 0); });

    if (!c.uploaderStats) api('GET', '/clips/' + c.id + '?expand=1').then(function (x) {
      if (my !== pageToken) return;
      var a = uploader.querySelectorAll('.vstats b'), b = gameCard.querySelectorAll('.vstats b');
      a[0].textContent = fmtNum(x.uploaderStats.clips); a[1].textContent = fmtNum(x.uploaderStats.views); a[2].textContent = fmtNum(x.uploaderStats.likes);
      b[0].textContent = fmtNum(x.gameStats.clips); b[1].textContent = fmtNum(x.gameStats.views); b[2].textContent = fmtNum(x.gameStats.likes);
      if (x.liked && !c.liked) { c.liked = true; actions.firstChild.classList.add('on'); }
    }).catch(function () {});
    else if (me) api('GET', '/clips/' + c.id).then(function (x) { if (my === pageToken && x.liked !== c.liked) { c.liked = x.liked; actions.firstChild.classList.toggle('on', !!x.liked); actions.firstChild.setAttribute('aria-pressed', String(!!x.liked)); } }).catch(function () {});

    api('GET', '/clips?game=' + encodeURIComponent(c.game)).then(function (d) {
      if (my !== pageToken) return;
      clear(moreList);
      var items = d.clips.filter(function (x) { return x.id !== c.id; }).slice(0, 8);
      if (!items.length) {
        return api('GET', '/clips').then(function (d2) {
          if (my !== pageToken) return;
          moreTitle.lastChild.textContent = 'More clips';
          var it2 = d2.clips.filter(function (x) { return x.id !== c.id; }).slice(0, 8);
          if (!it2.length) { moreBox.style.display = 'none'; return; }
          it2.forEach(function (x, i) { moreList.appendChild(sideItem(x, i)); });
        });
      }
      items.forEach(function (x, i) { moreList.appendChild(sideItem(x, i)); });
    }).catch(function () { moreBox.style.display = 'none'; });
  }
  function sideItem(x, i) {
    return link(BASE + '/c/' + x.id, { class: 'side-item', style: { '--i': String(i || 0) } }, thumb(x),
      h('div', {}, h('div', { class: 't', text: x.title }), h('div', { class: 'm', text: x.user.username }), h('div', { class: 'm', text: views(x.views) + ' / ' + ago(x.createdAt) })));
  }

  // ---- comments
  function commentsSection(c) {
    var count = c.comments || 0;
    var countEl = h('span', { class: 'n', text: count ? fmtNum(count) : '' });
    var list = h('div', { class: 'clist' });
    var more = h('div', { class: 'more-row', style: { 'margin-top': '10px' } });
    var box = h('section', { class: 'comments', 'aria-label': 'Comments' }, h('div', { class: 'comments-head' }, icon('message'), 'Comments', countEl));
    function setCount(n) { count = Math.max(0, n); countEl.textContent = count ? fmtNum(count) : ''; }

    if (me) {
      var ta = h('textarea', { class: 'input', maxlength: '500', rows: '2', placeholder: 'Add a comment', 'aria-label': 'Add a comment' });
      var counter = h('span', { class: 'count', text: '0 / 500' });
      var post = h('button', { class: 'btn btn-primary btn-sm', disabled: true }, icon('send', 'i-sm'), 'Post');
      ta.addEventListener('input', function () {
        var n = ta.value.length;
        counter.textContent = n + ' / 500'; counter.classList.toggle('warn', n > 450);
        post.disabled = !ta.value.trim();
      });
      ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post.click(); } });
      post.addEventListener('click', function () {
        var body = ta.value.trim();
        if (!body) return;
        post.disabled = true;
        api('POST', '/clips/' + c.id + '/comments', { body: body }).then(function (cm) {
          ta.value = ''; counter.textContent = '0 / 500';
          list.insertBefore(commentEl(cm), list.firstChild);
          var e0 = list.querySelector('.empty-mini'); if (e0) e0.remove();
          setCount(count + 1);
        }).catch(function (e) { post.disabled = false; toast(errText(e), true); });
      });
      box.appendChild(h('div', { class: 'composer' }, avatar(me, 40), h('div', { class: 'grow' }, ta, h('div', { class: 'composer-foot' }, counter, post))));
    } else {
      box.appendChild(h('div', { class: 'composer' }, h('button', { class: 'btn btn-surface', onclick: signIn }, icon('logIn', 'i-sm'), 'Sign in to comment')));
    }
    box.appendChild(list); box.appendChild(more);

    function commentEl(cm) {
      var canDelete = me && (me.id === cm.user.id || me.id === c.user.id);
      var el = h('article', { class: 'cmt', style: validColor(cm.user.color) ? { '--uc': cm.user.color } : null },
        link(profileHref(cm.user.username), { 'aria-label': cm.user.username }, avatar(cm.user, 40)),
        h('div', { class: 'grow' },
          h('div', { class: 'cmt-meta' },
            link(profileHref(cm.user.username), { class: 'name' }, cm.user.username),
            h('span', { class: 'when', title: new Date(cm.createdAt).toLocaleString(), text: ago(cm.createdAt) }),
            canDelete ? h('button', { class: 'btn btn-ghost btn-sm btn-icon cmt-del', 'aria-label': 'Delete comment', title: 'Delete comment', onclick: function () {
              api('DELETE', '/comments/' + cm.id).then(function () {
                el.classList.add('leaving'); setTimeout(function () { el.remove(); }, 230); setCount(count - 1);
              }).catch(function (e) { toast(errText(e), true); });
            } }, icon('trash', 'i-sm')) : null),
          h('div', { class: 'cmt-body' }, linkified(cm.body))));
      return el;
    }
    var cursor = null;
    function loadPage() {
      return api('GET', '/clips/' + c.id + '/comments' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        if (!cursor && !d.comments.length) list.appendChild(h('p', { class: 'page-sub empty-mini', text: 'No comments yet.' }));
        d.comments.forEach(function (cm) { list.appendChild(commentEl(cm)); });
        cursor = d.nextCursor;
        clear(more);
        if (cursor) {
          var b = h('button', { class: 'btn btn-surface btn-sm' }, 'Load more comments');
          b.addEventListener('click', function () { b.disabled = true; loadPage().catch(function (e) { b.disabled = false; toast(errText(e), true); }); });
          more.appendChild(b);
        }
      });
    }
    loadPage().catch(function () { list.appendChild(h('p', { class: 'page-sub', text: 'Comments could not be loaded.' })); });
    return box;
  }

  function ownerPanel(c, titleEl) {
    var input = h('input', { class: 'input', maxlength: '100', 'aria-label': 'Clip title' }); input.value = c.title;
    var save = h('button', { class: 'btn btn-surface' }, icon('check', 'i-sm'), 'Save');
    function doRename() {
      var t = input.value.trim();
      if (!t || t === c.title) return;
      save.disabled = true;
      api('PATCH', '/clips/' + c.id, { title: t }).then(function (u) {
        c.title = u.title; titleEl.textContent = u.title; input.value = u.title; setTitle(u.title); toast('Renamed');
      }).catch(function (e) { toast(errText(e), true); }).then(function () { save.disabled = false; });
    }
    save.addEventListener('click', doRename);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doRename(); });

    var visSeg = h('div', { class: 'seg' });
    function drawVis() {
      clear(visSeg);
      [['public', 'globe', 'Public'], ['unlisted', 'eyeOff', 'Unlisted']].forEach(function (v) {
        visSeg.appendChild(h('button', { type: 'button', class: c.visibility === v[0] ? 'on' : '', 'aria-pressed': String(c.visibility === v[0]), onclick: function () {
          if (c.visibility === v[0]) return;
          api('PATCH', '/clips/' + c.id, { visibility: v[0] }).then(function (u) {
            c.visibility = u.visibility; drawVis(); toast(u.visibility === 'public' ? 'Clip is public' : 'Clip is unlisted - only people with the link can see it');
          }).catch(function (e) { toast(errText(e), true); });
        } }, icon(v[1], 'i-sm'), v[2]));
      });
    }
    drawVis();
    var del = h('button', { class: 'btn btn-danger' }, icon('trash', 'i-sm'), 'Delete clip');
    del.addEventListener('click', function () { confirmDelete(c, function () { go(profileHref(c.user.username)); }); });
    return h('div', { class: 'panel' },
      h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, icon('pencil', 'i-sm'), 'Manage clip'), h('span', { class: 'page-sub', text: 'Only you see this' })),
      h('div', { class: 'panel-body' },
        h('div', {}, h('label', { class: 'field-label', text: 'Title' }), h('div', { class: 'field-row' }, input, save)),
        h('div', {}, h('label', { class: 'field-label', text: 'Who can see it' }), visSeg),
        h('div', {}, del)));
  }

  function confirmDelete(c, done) {
    var cb = h('input', { type: 'checkbox' }); cb.checked = true;
    modal({
      title: c.visibility === 'draft' ? 'Delete this draft?' : 'Delete this clip?', icon: 'trash',
      body: [h('p', { text: '"' + c.title + '" will be removed from Glint.' + (c.visibility === 'draft' ? '' : ' Links to it will stop working.') }),
        h('label', { class: 'check' }, cb, h('span', { text: 'Also delete the video from my Nookara uploads (frees the storage)' }))],
      foot: function (close) {
        var go_ = h('button', { class: 'btn btn-danger-solid' }, icon('trash', 'i-sm'), 'Delete');
        go_.addEventListener('click', function () {
          go_.disabled = true;
          api('DELETE', '/clips/' + c.id + (cb.checked ? '?media=1' : '')).then(function () {
            close(); toast(c.visibility === 'draft' ? 'Draft deleted' : 'Clip deleted'); done();
          }).catch(function (e) { go_.disabled = false; toast(errText(e), true); });
        });
        return [h('button', { class: 'btn btn-ghost', onclick: close }, 'Cancel'), go_];
      }
    });
  }

  var KIND_ICON = { game: 'gamepad', mic: 'mic', discord: 'headphones', fluxer: 'headphones', ember: 'headphones', desktop: 'monitor', other: 'audioLines' };
  var APP_IMG = { discord: 'discord.svg', fluxer: 'fluxer.png', ember: 'ember.png' };
  function kindIcon(t) {
    if (t.kind === 'app') return t.icon && t.icon.indexOf('data:image/png;base64,') === 0 ? h('img', { src: t.icon, alt: '' }) : icon('appWindow');
    return APP_IMG[t.kind] ? h('img', { src: BASE + '/assets/apps/' + APP_IMG[t.kind], alt: '' }) : icon(KIND_ICON[t.kind] || 'audioLines');
  }
  var KIND_NAME = { app: 'App audio', game: 'Game audio', mic: 'Microphone', discord: 'Discord', fluxer: 'Fluxer', ember: 'Ember', desktop: 'Desktop audio', other: 'Audio' };
  var PHASES = ['queued', 'downloading', 'rendering', 'uploading', 'finishing'];
  var PHASE_TEXT = { queued: 'Waiting for a free slot', downloading: 'Fetching your draft', rendering: 'Rendering the clip', uploading: 'Uploading to Nookara', finishing: 'Finishing up' };

  var PV_STAGE = {
    queued: ['clock', 'Queued'], downloading: ['download', 'Downloading'], rendering: ['film', 'Rendering'],
    uploading: ['upload', 'Uploading'], finishing: ['sparkles', 'Publishing']
  };
  function fmtClock(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + pad(sec % 60); }
  function reducedMotion() { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function publishView(o) {
    var c = o.clip, open = true, finished = false, failed = false, started = Date.now();
    var prevFocus = document.activeElement;
    var root = h('div', { class: 'pv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Publishing ' + o.title });
    var inner = h('div', { class: 'pv-in enter' });
    var closeBtn = h('button', { class: 'btn btn-ghost btn-icon pv-x', 'aria-label': 'Close (publishing continues)', title: 'Close (Esc)' }, icon('x'));
    var media = h('div', { class: 'pv-media' });
    var vid = null;
    if (o.proxy && o.proxy.video) {
      vid = h('video', { src: o.proxy.video, muted: true, playsinline: true, autoplay: true, preload: 'auto', 'aria-hidden': 'true' });
      vid.muted = true; vid.playsInline = true;
      var t0 = o.trim ? o.trim.start : 0, t1 = o.trim ? o.trim.end : 0;
      vid.addEventListener('loadedmetadata', function () { try { vid.currentTime = t0; } catch (e) {} vid.play().catch(function () {}); });
      vid.addEventListener('timeupdate', function () { if (t1 && vid.currentTime >= t1) vid.currentTime = t0; });
      media.appendChild(vid);
    } else if (c.thumbnail) media.appendChild(h('img', { src: c.thumbnail, alt: '' }));
    else media.appendChild(h('span', { class: 'pv-none' }, icon('film', 'i-xl')));
    if (o.trim) media.appendChild(h('span', { class: 'badge dur' }, fmtDur(o.trim.end - o.trim.start)));

    function gameIcon() { return c.gameIcon ? h('img', { class: 'pv-gi', src: c.gameIcon, alt: '' }) : h('span', { class: 'pv-gi' }, icon('gamepad', 'i-sm')); }
    var visTag = h('span', { class: 'pv-tag' });
    function paintVis(v) { clear(visTag).appendChild(icon(v === 'public' ? 'globe' : 'eyeOff', 'i-sm')); visTag.appendChild(document.createTextNode(v === 'public' ? 'Public' : 'Unlisted')); }
    paintVis(o.vis);
    var trackIcons = h('span', { class: 'pv-tracks' }, o.tracks.map(function (t) { return h('span', { class: 'ti', title: t.label }, kindIcon(t)); }));
    var kick = h('div', { class: 'pv-kick', text: 'Publishing' });
    var head = h('div', { class: 'pv-head' }, kick, h('h2', { text: o.title }),
      h('div', { class: 'pv-meta' }, gameIcon(), h('span', { text: c.game }), visTag, o.tracks.length ? trackIcons : null));

    var lblSpan = h('span', {}), ico = h('span', { class: 'pv-ico' });
    var fill = h('i', {});
    var bar = h('div', { class: 'pv-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, fill);
    var elapsed = h('span', {}), eta = h('span', {}), pos = h('span', {});
    var prog = h('div', { class: 'pv-up ind', 'aria-live': 'polite' },
      h('div', { class: 'pv-top' }, h('div', { class: 'pv-lbl' }, lblSpan), ico), bar,
      h('div', { class: 'pv-stats' }, elapsed, eta, pos));
    var errBox = h('div', { class: 'pv-errbox' });
    var act = h('div', { class: 'pv-act' });
    var right = h('div', { class: 'pv-r' }, head, prog, errBox, act);
    inner.appendChild(closeBtn);
    inner.appendChild(h('div', { class: 'pv-l' }, media));
    inner.appendChild(right);
    root.appendChild(inner);
    document.body.appendChild(root);
    document.body.classList.add('pv-lock');
    function drawRunningActs() {
      clear(act);
      act.appendChild(h('button', { class: 'btn btn-surface', onclick: close }, icon('x', 'i-sm'), 'Close'));
      act.appendChild(h('p', { class: 'pv-note', text: 'Publishing keeps going on the server - come back to this page any time.' }));
    }
    drawRunningActs();
    closeBtn.addEventListener('click', close);
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    document.addEventListener('keydown', onKey);
    setTimeout(function () { closeBtn.focus(); }, 30);

    var lastStage = '', stageT0 = Date.now(), stageP0 = 0;
    var tick = setInterval(function () { if (!finished && !failed) elapsed.textContent = 'Elapsed ' + fmtClock((Date.now() - started) / 1000); }, 500);
    function setLabel(text, iconName) {
      if (lblSpan.textContent === text) return;
      lblSpan.textContent = text; lblSpan.classList.remove('swap'); void lblSpan.offsetWidth; lblSpan.classList.add('swap');
      clear(ico).appendChild(icon(iconName));
    }
    function progress(p) {
      if (!open || finished) return;
      p = p || { phase: 'queued', pct: 0 };
      failed = false; prog.classList.remove('failed'); clear(errBox);
      var stg = PV_STAGE[p.phase] || PV_STAGE.queued;
      var pct = Math.max(0, Math.min(100, Number(p.pct) || 0));
      var counted = p.phase === 'rendering' || p.phase === 'uploading';
      if (p.phase !== lastStage) { lastStage = p.phase; stageT0 = Date.now(); stageP0 = pct; }
      setLabel(stg[1] + (counted ? ' ' + pct + '%' : (p.phase === 'queued' && p.position > 1 ? ' - ' + (p.position - 1) + ' ahead of you' : '')), stg[0]);
      prog.classList.toggle('ind', !counted);
      prog.classList.toggle('rendering', p.phase === 'rendering');
      fill.style.width = (counted ? pct : 0) + '%';
      bar.setAttribute('aria-valuenow', String(counted ? pct : 0));
      bar.setAttribute('aria-valuetext', lblSpan.textContent);
      pos.textContent = p.phase === 'queued' && p.position ? 'Queue position ' + p.position : '';
      var dt = (Date.now() - stageT0) / 1000, dp = pct - stageP0;
      eta.textContent = counted && dp >= 3 && dt > 1.5 ? 'About ' + fmtClock(dt / dp * (100 - pct)) + ' left' : '';
    }
    function done(x) {
      if (!open) return;
      finished = true; clearInterval(tick);
      prog.classList.remove('ind', 'rendering'); fill.style.width = '100%';
      setLabel('Published', 'checkCircle');
      prog.classList.add('done');
      eta.textContent = ''; pos.textContent = ''; elapsed.textContent = 'Took ' + fmtClock((Date.now() - started) / 1000);
      kick.textContent = 'Live';
      clear(act);
      setTimeout(function () { if (open) share(x); }, reducedMotion() ? 0 : 700);
    }
    function copyBtn(label, iconName, text, cls) {
      var b = h('button', { class: 'btn ' + (cls || 'btn-surface') }, icon(iconName, 'i-sm'), h('span', { text: label }));
      var t = 0;
      b.addEventListener('click', function () {
        copyText(text()).then(function () {
          b.classList.add('copied'); b.lastChild.textContent = 'Copied';
          clearTimeout(t); t = setTimeout(function () { b.classList.remove('copied'); b.lastChild.textContent = label; }, 1600);
        }, function () { toast('Could not copy', true); });
      });
      return b;
    }
    function share(x) {
      c = x;
      clear(right);
      var title = x.title;
      var link = h('input', { class: 'input pv-field', readonly: true, 'aria-label': 'Clip link', value: x.url });
      link.addEventListener('focus', function () { link.select(); });
      var seg = h('div', { class: 'seg pv-vis', role: 'radiogroup', 'aria-label': 'Who can see it' });
      function drawSeg() {
        clear(seg);
        [['public', 'globe', 'Public'], ['unlisted', 'eyeOff', 'Unlisted']].forEach(function (v) {
          seg.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': String(c.visibility === v[0]), class: c.visibility === v[0] ? 'on' : '', onclick: function () {
            if (c.visibility === v[0]) return;
            api('PATCH', '/clips/' + c.id, { visibility: v[0] }).then(function (u) { c.visibility = u.visibility; drawSeg(); toast(u.visibility === 'public' ? 'Clip is public' : 'Clip is unlisted - only people with the link can see it'); })
              .catch(function (e) { toast(errText(e), true); });
          } }, icon(v[1], 'i-sm'), v[2]));
        });
      }
      drawSeg();
      var quick = h('div', { class: 'pv-quick slide' },
        h('a', { class: 'btn btn-surface', href: x.url, target: '_blank', rel: 'noopener' }, icon('external', 'i-sm'), 'Open'),
        navigator.share ? h('button', { class: 'btn btn-surface', onclick: function () { navigator.share({ title: title, url: x.url }).catch(function () {}); } }, icon('share', 'i-sm'), 'Share') : null,
        copyBtn('Copy for Discord / Ember', 'message', function () { return title + '\n' + x.url; }),
        copyBtn('Copy markdown', 'code', function () { return '[' + title.replace(/[\[\]]/g, '') + '](' + x.url + ')'; }));
      add(right, [
        h('div', { class: 'pv-done slide' }, icon('checkCircle'), h('span', { text: 'Your clip is live' })),
        h('div', { class: 'pv-head slide' }, h('h2', { text: title }), h('div', { class: 'pv-meta' }, gameIcon(), h('span', { text: c.game }))),
        h('div', { class: 'pv-link slide' }, link, copyBtn('Copy', 'copy', function () { return x.url; }, 'btn-primary pv-copy')),
        quick,
        h('div', { class: 'slide' }, h('label', { class: 'field-label', text: 'Who can see it' }), seg),
        h('div', { class: 'pv-act slide' }, h('button', { class: 'btn btn-primary btn-lg', onclick: function () { teardown(); o.onDone(c); } }, icon('check', 'i-sm'), 'Done'))]);
      setTimeout(function () { var cb = right.querySelector('.pv-copy'); if (cb) cb.focus(); }, 40);
    }
    function fail(code) {
      if (!open) return;
      failed = true;
      prog.classList.remove('ind', 'rendering', 'failed'); void prog.offsetWidth; prog.classList.add('failed');
      setLabel('Publishing failed', 'alert');
      eta.textContent = ''; pos.textContent = '';
      clear(errBox).appendChild(h('p', { class: 'pv-err', text: errText(code) }));
      clear(act);
      if (isReauth(code)) act.appendChild(h('button', { class: 'btn btn-primary', onclick: function () { teardown(); o.onClose(); signIn(); } }, icon('logIn', 'i-sm'), 'Sign in again'));
      else act.appendChild(h('button', { class: 'btn btn-primary', onclick: function () {
        started = Date.now(); lastStage = ''; finished = false; drawRunningActs(); progress({ phase: 'queued', pct: 0 }); o.onRetry();
      } }, icon('rotateCcw', 'i-sm'), 'Retry'));
      act.appendChild(h('button', { class: 'btn btn-surface', onclick: close }, 'Close'));
    }
    function teardown() {
      if (!open) return;
      open = false; clearInterval(tick);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('pv-lock');
      if (vid) try { vid.pause(); vid.removeAttribute('src'); vid.load(); } catch (e) {}
      root.classList.add('out');
      setTimeout(function () { root.remove(); }, reducedMotion() ? 0 : 210);
      try { prevFocus && prevFocus.focus(); } catch (e) {}
    }
    function close() {
      if (finished) { teardown(); o.onDone(c); return; }
      teardown(); o.onClose();
    }
    return { progress: progress, done: done, fail: fail, isOpen: function () { return open; }, destroy: teardown };
  }

  // Crop overlay on the (uncropped) proxy. The crop lives in SOURCE pixels (srcW x srcH); the overlay maps it onto the
  // letterboxed video rect. Editing = drag the box, drag corners (44 px touch targets), optional aspect lock.
  function cropTool(stage, video, srcW, srcH, initial, onChange) {
    var crop = initial ? { x: initial.x, y: initial.y, w: initial.w, h: initial.h } : null;
    var editing = false, aspect = null;
    var layer = h('div', { class: 'crop-layer' });
    var box = h('div', { class: 'crop-box', tabindex: '-1' });
    var shade = ['t', 'b', 'l', 'r'].map(function (k) { return h('div', { class: 'crop-shade ' + k }); });
    var grid = h('div', { class: 'crop-grid' }, h('i'), h('i'), h('i'), h('i'));
    var corners = ['nw', 'ne', 'sw', 'se'].map(function (k) { return h('div', { class: 'crop-h ' + k, 'data-c': k, role: 'slider', 'aria-label': 'Crop corner ' + k, tabindex: '0' }); });
    add(box, [grid].concat(corners));
    add(layer, shade.concat(box));
    stage.style.position = 'relative';
    stage.appendChild(layer);
    var rect = { x: 0, y: 0, w: 1, h: 1, s: 1 };
    function measure() {
      var sr = stage.getBoundingClientRect(), vr = video.getBoundingClientRect();
      if (!vr.width || !vr.height) return;
      var s = Math.min(vr.width / srcW, vr.height / srcH);
      var w = srcW * s, hh = srcH * s;
      rect = { x: vr.left - sr.left + (vr.width - w) / 2, y: vr.top - sr.top + (vr.height - hh) / 2, w: w, h: hh, s: s };
      paint();
    }
    function full() { return { x: 0, y: 0, w: srcW, h: srcH }; }
    function paint() {
      var c = crop || full();
      var L = rect.x + c.x * rect.s, T = rect.y + c.y * rect.s, W = c.w * rect.s, H = c.h * rect.s;
      layer.style.left = rect.x + 'px'; layer.style.top = rect.y + 'px'; layer.style.width = rect.w + 'px'; layer.style.height = rect.h + 'px';
      var lx = L - rect.x, ty = T - rect.y;
      box.style.left = lx + 'px'; box.style.top = ty + 'px'; box.style.width = W + 'px'; box.style.height = H + 'px';
      shade[0].style.cssText = 'left:0;top:0;width:100%;height:' + ty + 'px';
      shade[1].style.cssText = 'left:0;top:' + (ty + H) + 'px;width:100%;bottom:0';
      shade[2].style.cssText = 'left:0;top:' + ty + 'px;width:' + lx + 'px;height:' + H + 'px';
      shade[3].style.cssText = 'left:' + (lx + W) + 'px;top:' + ty + 'px;right:0;height:' + H + 'px';
      layer.classList.toggle('has-crop', !!crop);
    }
    function even(n) { return Math.round(n / 2) * 2; }
    function norm(c) {
      var w = Math.max(64, Math.min(srcW, even(c.w))), hh = Math.max(64, Math.min(srcH, even(c.h)));
      var x = Math.max(0, Math.min(srcW - w, even(c.x))), y = Math.max(0, Math.min(srcH - hh, even(c.y)));
      return { x: x, y: y, w: w, h: hh };
    }
    function commit(c, quiet) {
      c = c ? norm(c) : null;
      if (c && c.x === 0 && c.y === 0 && c.w === srcW && c.h === srcH) c = null;
      crop = c; paint();
      if (!quiet) onChange(crop);
    }
    function fitAspect(r) {
      var c = crop || full(), cx = c.x + c.w / 2, cy = c.y + c.h / 2;
      var w = srcW, hh = w / r;
      if (hh > srcH) { hh = srcH; w = hh * r; }
      return { x: Math.max(0, Math.min(srcW - w, cx - w / 2)), y: Math.max(0, Math.min(srcH - hh, cy - hh / 2)), w: w, h: hh };
    }
    var drag = null;
    function down(e) {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      var corner = e.target.getAttribute && e.target.getAttribute('data-c');
      drag = { corner: corner, sx: e.clientX, sy: e.clientY, c: Object.assign({}, crop || full()), id: e.pointerId, el: e.target };
      try { e.target.setPointerCapture(e.pointerId); } catch (x) {}
      (corner ? e.target : box).classList.add('drag');
      layer.classList.add('dragging');
    }
    function move(e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = (e.clientX - drag.sx) / rect.s, dy = (e.clientY - drag.sy) / rect.s, c0 = drag.c, n;
      if (!drag.corner) n = { x: Math.max(0, Math.min(srcW - c0.w, c0.x + dx)), y: Math.max(0, Math.min(srcH - c0.h, c0.y + dy)), w: c0.w, h: c0.h };
      else {
        var west = drag.corner.indexOf('w') >= 0, north = drag.corner.indexOf('n') >= 0;
        var ax = west ? c0.x + c0.w : c0.x, ay = north ? c0.y + c0.h : c0.y;
        var px = Math.max(0, Math.min(srcW, (west ? c0.x : c0.x + c0.w) + dx)), py = Math.max(0, Math.min(srcH, (north ? c0.y : c0.y + c0.h) + dy));
        var w = Math.max(64, Math.abs(px - ax)), hh = Math.max(64, Math.abs(py - ay));
        if (aspect) {
          if (w / hh > aspect) w = hh * aspect; else hh = w / aspect;
          var maxW = west ? ax : srcW - ax, maxH = north ? ay : srcH - ay;
          if (w > maxW) { w = maxW; hh = w / aspect; }
          if (hh > maxH) { hh = maxH; w = hh * aspect; }
        }
        n = { x: west ? ax - w : ax, y: north ? ay - hh : ay, w: w, h: hh };
      }
      commit(n, true);
    }
    function up(e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.el.classList && drag.el.classList.remove('drag'); box.classList.remove('drag'); layer.classList.remove('dragging');
      drag = null;
      onChange(crop);
    }
    box.addEventListener('pointerdown', down);
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
    corners.forEach(function (k) {
      k.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 20 : 2, c = Object.assign({}, crop || full()), d = k.getAttribute('data-c');
        var mx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, my = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!mx && !my) return;
        e.preventDefault();
        if (d.indexOf('w') >= 0) { c.x += mx; c.w -= mx; } else c.w += mx;
        if (d.indexOf('n') >= 0) { c.y += my; c.h -= my; } else c.h += my;
        commit(c);
      });
    });
    var ro = window.ResizeObserver ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(stage); else window.addEventListener('resize', measure);
    video.addEventListener('loadedmetadata', measure);
    setTimeout(measure, 0);
    return {
      editing: function () { return editing; },
      setEditing: function (on) { editing = on; layer.classList.toggle('editing', on); stage.classList.toggle('cropping', on); if (on) measure(); },
      setAspect: function (a) {
        aspect = a === 'free' ? null : (function (p) { return p[0] / p[1]; })(a.split(':').map(Number));
        if (aspect) commit(fitAspect(aspect));
      },
      set: function (c) { commit(c); },
      destroy: function () { if (ro) ro.disconnect(); else window.removeEventListener('resize', measure); layer.remove(); }
    };
  }

  function pageEditor(c0) {
    var my = pageToken;
    setTitle('Edit ' + c0.title);
    clear(app); enter();
    var c = c0;
    var st = { trim: null, tracks: [], crop: c.crop || null, title: c.title, vis: 'public', dirty: false, duration: c.durationSec };
    var cropper = null;
    var player = null;

    var titleIn = h('input', { class: 'input ed-title', maxlength: '100', 'aria-label': 'Clip title' }); titleIn.value = c.title;
    var head = h('div', { class: 'ed-head' }, h('span', { class: 'ed-badge' }, icon('filePen', 'i-sm'), 'Draft'), titleIn);
    var stage = h('div', { class: 'ed-stage' });
    var tl = h('div', { class: 'tl' });
    var leftCol = h('div', {}, head, stage, tl);
    var tracksPanel = h('section', { class: 'ed-panel' }, h('div', { class: 'ed-panel-head' }, icon('audioLines', 'i-sm'), 'Audio sources'));
    var actPanel = h('section', { class: 'ed-panel ed-sticky' });
    var rightCol = h('div', {}, tracksPanel, actPanel);
    app.appendChild(h('div', { class: 'editor' }, leftCol, rightCol));

    function markDirty() { st.dirty = true; drawActions(); }
    titleIn.addEventListener('input', function () { st.title = titleIn.value; markDirty(); });
    function beforeUnload(e) { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } }
    window.addEventListener('beforeunload', beforeUnload);
    onLeave(function () { window.removeEventListener('beforeunload', beforeUnload); if (cropper) cropper.destroy(); if (player) player.destroy(); clearTimeout(pollT); });

    var pollT = 0;
    function building(p) {
      clear(stage);
      var bar = h('div', { class: 'pbar' + (p.status === 'queued' || !p.progress ? ' indet' : '') }, h('div', { style: { width: (p.progress || 0) + '%' } }));
      var msg = p.status === 'failed' ? errText(p.error || 'proxy_failed')
        : p.status === 'queued' ? 'Waiting to prepare your draft' + (p.position > 1 ? ' (' + (p.position - 1) + ' ahead)' : '') + '...'
        : 'Preparing a quick-seek preview of your draft... ' + (p.progress ? p.progress + '%' : '');
      stage.appendChild(h('div', { class: 'ed-building' },
        p.status === 'failed' ? icon('alert', 'i-xl') : h('div', { class: 'spinner' }),
        h('div', { text: msg }),
        p.status === 'failed' ? h('button', { class: 'btn btn-surface btn-sm', onclick: function () { load(true); } }, icon('rotateCcw', 'i-sm'), 'Try again') : bar));
    }

    function load(retry) {
      api('GET', '/clips/' + c.id + '/edit' + (retry ? '?retry=1' : '')).then(function (e) {
        if (my !== pageToken) return;
        c = e.clip;
        if (c.status === 'rendering' && !rendering) { rendering = true; openView().progress(c.progress || { phase: 'queued', pct: 0 }); drawActions(); pollRender(); }
        if (!st.trim) { st.crop = e.crop || null; st.trim = { start: e.trim.start, end: e.trim.end }; st.tracks = e.audioTracks.map(function (t) { return { index: t.index, kind: t.kind, label: t.label, enabled: t.enabled, volume: t.volume, icon: t.icon, app: t.app }; }); drawTracks(); drawActions(); }
        if (e.proxy.status !== 'ready') { building(e.proxy); drawTimeline(null); if (e.proxy.status !== 'failed') pollT = setTimeout(load, 1500); return; }
        if (e.proxy.duration) st.duration = e.proxy.duration;
        if (!st.trim || st.trim.end > st.duration) st.trim = { start: 0, end: st.duration };
        if (e.audioTracks.length && st.tracks.length !== e.audioTracks.length) { st.tracks = e.audioTracks.map(function (t) { return { index: t.index, kind: t.kind, label: t.label, enabled: t.enabled, volume: t.volume, icon: t.icon, app: t.app }; }); drawTracks(); }
        mountPlayer(e.proxy);
        drawTimeline(e.proxy.filmstrip);
      }).catch(function (err) {
        if (my !== pageToken) return;
        if (err.status === 404) return page404('clip');
        building({ status: 'failed', error: err.message });
      });
    }

    var lastProxy = null;
    function mountPlayer(proxy) {
      lastProxy = proxy;
      clear(stage);
      if (player) player.destroy();
      player = window.GlintPlayer(stage, {
        src: proxy.video, muted: true, width: c.width, height: c.height, duration: st.duration, filmstrip: proxy.filmstrip, scrub: false, hideVolume: true, noPip: true, label: 'Draft preview', compact: true,
        tracks: proxy.tracks.map(function (t) { var s = trackState(t.index) || { enabled: true, volume: 1 }; return { index: t.index, url: t.url, gain: s.volume, muted: !s.enabled }; })
      });
      player.setRange(st.trim);
      player.on('time', paintHead);
      if (cropper) cropper.destroy();
      cropper = cropTool(stage, player.video, c.width, c.height, st.crop, function (cr) { st.crop = cr; markDirty(); drawCropBar(); });
      drawCropBar();
      player.on('meta', function (d) { if (d && Math.abs(d - st.duration) > 0.3) { st.duration = d; paintTimeline(); } });
    }
    function trackState(i) { for (var k = 0; k < st.tracks.length; k++) if (st.tracks[k].index === i) return st.tracks[k]; return null; }

    var track, dimL, dimR, sel, hIn, hOut, headEl, tIn, tOut, tLen;
    function drawTimeline(strip) {
      clear(tl);
      tIn = h('span', {}); tOut = h('span', {}); tLen = h('b', {});
      track = h('div', { class: 'tl-track', role: 'group', 'aria-label': 'Trim timeline' });
      if (strip) track.style.backgroundImage = 'url("' + strip + '")';
      dimL = h('div', { class: 'tl-dim', style: { left: '0' } }); dimR = h('div', { class: 'tl-dim', style: { right: '0' } });
      sel = h('div', { class: 'tl-sel' });
      hIn = h('div', { class: 'tl-handle in', role: 'slider', tabindex: '0', 'aria-label': 'Trim start' });
      hOut = h('div', { class: 'tl-handle out', role: 'slider', tabindex: '0', 'aria-label': 'Trim end' });
      headEl = h('div', { class: 'tl-head' });
      add(track, [dimL, dimR, sel, headEl, hIn, hOut]);
      tl.appendChild(h('div', { class: 'tl-times' }, h('span', {}, 'In ', tIn), h('span', {}, 'Length ', tLen), h('span', {}, 'Out ', tOut)));
      tl.appendChild(track);
      tl.appendChild(h('div', { class: 'tl-tools' },
        h('button', { class: 'btn btn-surface btn-sm', onclick: function () { if (player) setTrim(player.video.currentTime, null); } }, icon('toStart', 'i-sm'), 'Set in here'),
        h('button', { class: 'btn btn-surface btn-sm', onclick: function () { if (player) setTrim(null, player.video.currentTime); } }, icon('toEnd', 'i-sm'), 'Set out here'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: function () { setTrim(0, st.duration); toast('Trim reset'); } }, icon('rotateCcw', 'i-sm'), 'Reset trim'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: function () { if (player) { player.seek(st.trim.start); player.play(); } } }, icon('play', 'i-sm'), 'Play selection')));
      tl.appendChild(cropBar);
      drawCropBar();
      bindTimeline();
      paintTimeline();
    }
    var cropBar = h('div', { class: 'crop-bar' });
    var cropAspect = 'free';
    function drawCropBar() {
      clear(cropBar);
      var editing = cropper && cropper.editing();
      var label = st.crop ? st.crop.w + 'x' + st.crop.h : 'Full frame ' + c.width + 'x' + c.height;
      cropBar.appendChild(h('div', { class: 'crop-row' },
        h('button', { class: 'btn btn-sm ' + (editing ? 'btn-primary' : 'btn-surface'), 'aria-pressed': String(!!editing), disabled: !cropper, onclick: function () { cropper.setEditing(!cropper.editing()); drawCropBar(); } },
          icon('crop', 'i-sm'), editing ? 'Done cropping' : 'Crop'),
        h('span', { class: 'crop-dims' + (st.crop ? ' on' : ''), text: label }),
        st.crop ? h('button', { class: 'btn btn-ghost btn-sm', onclick: function () { cropper.set(null); toast('Crop reset'); } }, icon('rotateCcw', 'i-sm'), 'Reset crop') : null));
      if (editing) {
        var seg = h('div', { class: 'seg crop-aspects', role: 'radiogroup', 'aria-label': 'Crop shape' });
        [['free', 'Free'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:3', '4:3']].forEach(function (a) {
          seg.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': String(cropAspect === a[0]), class: cropAspect === a[0] ? 'on' : '', onclick: function () { cropAspect = a[0]; cropper.setAspect(a[0]); drawCropBar(); } }, a[1]));
        });
        cropBar.appendChild(seg);
      }
    }
    function pct(t) { return st.duration ? (t / st.duration) * 100 : 0; }
    function paintTimeline() {
      if (!track || !st.trim) return;
      var a = pct(st.trim.start), b = pct(st.trim.end);
      dimL.style.width = a + '%'; dimR.style.width = (100 - b) + '%';
      sel.style.left = a + '%'; sel.style.right = (100 - b) + '%';
      hIn.style.left = a + '%'; hOut.style.left = b + '%';
      tIn.textContent = fmtPrecise(st.trim.start); tOut.textContent = fmtPrecise(st.trim.end); tLen.textContent = fmtPrecise(st.trim.end - st.trim.start);
      hIn.setAttribute('aria-valuenow', st.trim.start.toFixed(1)); hIn.setAttribute('aria-valuetext', fmtPrecise(st.trim.start));
      hOut.setAttribute('aria-valuenow', st.trim.end.toFixed(1)); hOut.setAttribute('aria-valuetext', fmtPrecise(st.trim.end));
      hIn.setAttribute('aria-valuemax', st.duration.toFixed(1)); hOut.setAttribute('aria-valuemax', st.duration.toFixed(1));
    }
    function paintHead(t) { if (headEl) headEl.style.left = pct(t) + '%'; }
    var MIN = 0.5;
    function setTrim(a, b, quiet) {
      var s = a === null || a === undefined ? st.trim.start : a, e = b === null || b === undefined ? st.trim.end : b;
      s = Math.max(0, Math.min(s, st.duration - MIN)); e = Math.min(st.duration, Math.max(e, MIN));
      if (e - s < MIN) { if (a !== null && a !== undefined) s = e - MIN; else e = s + MIN; }
      st.trim = { start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100 };
      if (player) player.setRange(st.trim);
      paintTimeline();
      if (!quiet) markDirty();
    }
    function bindTimeline() {
      function timeAt(x) { var r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * st.duration; }
      track.addEventListener('pointerdown', function (e) {
        if (e.target === hIn || e.target === hOut) return;
        if (player) player.seek(Math.max(st.trim.start, Math.min(st.trim.end, timeAt(e.clientX))));
      });
      [[hIn, 'start'], [hOut, 'end']].forEach(function (pair) {
        var hd = pair[0], which = pair[1];
        hd.addEventListener('pointerdown', function (e) {
          e.preventDefault(); e.stopPropagation();
          try { hd.setPointerCapture(e.pointerId); } catch (x) {}
          hd.classList.add('drag');
          var wasPlaying = player && !player.video.paused;
          if (player) player.pause();
          var mv = function (ev) {
            var t = timeAt(ev.clientX);
            if (which === 'start') setTrim(t, null); else setTrim(null, t);
            if (player) { player.video.currentTime = which === 'start' ? st.trim.start : st.trim.end; paintHead(player.video.currentTime); }
          };
          var up = function () {
            hd.classList.remove('drag');
            hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
            if (player) { player.seek(st.trim.start); if (wasPlaying) player.play(); }
          };
          hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
        });
        hd.addEventListener('keydown', function (e) {
          var step = e.shiftKey ? 1 : 0.1, d = 0;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') d = -step;
          else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') d = step;
          else return;
          e.preventDefault();
          if (which === 'start') setTrim(st.trim.start + d, null); else setTrim(null, st.trim.end + d);
          if (player) player.seek(which === 'start' ? st.trim.start : Math.max(st.trim.start, st.trim.end - 0.05));
        });
      });
    }

    function drawTracks() {
      while (tracksPanel.children.length > 1) tracksPanel.removeChild(tracksPanel.lastChild);
      if (!st.tracks.length) { tracksPanel.appendChild(h('p', { class: 'page-sub', style: { padding: '14px' }, text: 'This clip has no audio.' })); return; }
      st.tracks.forEach(function (t, i) {
        var pctLabel = h('span', { text: Math.round(t.volume * 100) + '%' });
        var slider = h('input', { class: 'slider', type: 'range', min: '0', max: '200', step: '5', 'aria-label': t.label + ' volume' });
        slider.value = String(Math.round(t.volume * 100));
        slider.style.setProperty('--v', (t.volume * 50) + '%');
        var mute = h('button', { class: 'mute-btn' + (t.enabled ? '' : ' off'), 'aria-pressed': String(!t.enabled), 'aria-label': (t.enabled ? 'Mute ' : 'Unmute ') + t.label, title: t.enabled ? 'Mute' : 'Unmute' }, icon(t.enabled ? 'volume' : 'volumeX'));
        var row = h('div', { class: 'trk' + (t.enabled ? '' : ' off'), style: { 'animation-delay': (i * 40) + 'ms' } },
          h('span', { class: 'trk-ic', title: KIND_NAME[t.kind] || 'Audio' }, kindIcon(t)),
          h('div', { style: { 'min-width': '0' } }, h('div', { class: 'trk-name', text: t.label }), h('div', { class: 'trk-vol' }, slider, pctLabel)),
          mute);
        slider.addEventListener('input', function () {
          t.volume = Number(slider.value) / 100;
          pctLabel.textContent = slider.value + '%';
          slider.style.setProperty('--v', (t.volume * 50) + '%');
          if (player) player.setTrack(t.index, { gain: t.volume });
          markDirty();
        });
        mute.addEventListener('click', function () {
          t.enabled = !t.enabled;
          row.classList.toggle('off', !t.enabled); mute.classList.toggle('off', !t.enabled);
          mute.setAttribute('aria-pressed', String(!t.enabled)); mute.setAttribute('aria-label', (t.enabled ? 'Mute ' : 'Unmute ') + t.label);
          clear(mute).appendChild(icon(t.enabled ? 'volume' : 'volumeX'));
          if (player) player.setTrack(t.index, { muted: !t.enabled });
          markDirty();
        });
        tracksPanel.appendChild(row);
      });
    }

    var failedError = c.status === 'failed' ? c.error : null;
    function payload() {
      return { title: (st.title || '').trim() || c.title, trim: st.trim, crop: st.crop, audioTracks: st.tracks.map(function (t) { return { index: t.index, enabled: t.enabled, volume: t.volume }; }) };
    }
    function saveDraft() {
      if (!st.trim) return Promise.resolve();
      return api('PATCH', '/clips/' + c.id, payload()).then(function (u) { c = u; st.dirty = false; drawActions(); return u; });
    }
    function drawActions() {
      clear(actPanel);
      if (rendering) {
        add(actPanel, [h('div', { class: 'ed-render' },
          h('div', { class: 'phase' }, h('div', { class: 'spinner' }), h('span', { text: 'Publishing on the server...' })),
          h('button', { class: 'btn btn-primary', onclick: function () { openView(); } }, icon('upload', 'i-sm'), 'Show progress'))]);
        return;
      }
      var dirty = h('span', { class: 'ed-dirty' + (st.dirty ? ' show' : '') }, icon('alert', 'i-sm'), 'Unsaved changes');
      var saveBtn = h('button', { class: 'btn btn-surface', disabled: !st.dirty || !st.trim }, icon('save', 'i-sm'), 'Save draft');
      saveBtn.addEventListener('click', function () {
        saveBtn.disabled = true;
        saveDraft().then(function () { toast('Draft saved'); }).catch(function (e) { saveBtn.disabled = false; toast(errText(e), true); });
      });
      var seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Publish as' });
      [['public', 'globe', 'Public'], ['unlisted', 'eyeOff', 'Unlisted']].forEach(function (v) {
        seg.appendChild(h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.vis === v[0]), class: st.vis === v[0] ? 'on' : '', onclick: function () { st.vis = v[0]; drawActions(); } }, icon(v[1], 'i-sm'), v[2]));
      });
      var pub = h('button', { class: 'btn btn-primary btn-lg', disabled: !st.trim }, icon('upload'), failedError ? 'Try publishing again' : 'Publish ' + (st.vis === 'public' ? 'publicly' : 'as unlisted'));
      pub.addEventListener('click', publish);
      add(actPanel, [h('div', { class: 'ed-actions' },
        failedError ? h('div', { class: 'ed-err' }, icon('alert', 'i-sm'), h('span', { text: 'Last publish failed: ' + errText(failedError) })) : null,
        h('div', { class: 'row', style: { 'justify-content': 'space-between' } }, dirty, h('button', { class: 'btn btn-ghost btn-sm', onclick: function () { confirmDelete(c, function () { st.dirty = false; go(profileHref(c.user.username) + '?tab=drafts'); }); } }, icon('trash', 'i-sm'), 'Delete draft')),
        h('div', { class: 'row' }, saveBtn, h('span', { class: 'page-sub', text: st.trim ? 'Keeps ' + fmtPrecise(st.trim.end - st.trim.start) + ' of ' + fmtPrecise(st.duration) : '' })),
        seg, pub)]);
    }
    var rendering = false;
    var view = null;
    function openView() {
      if (view && view.isOpen()) return view;
      view = publishView({
        clip: c, title: payload().title, vis: st.vis, trim: st.trim, proxy: lastProxy,
        tracks: st.tracks.filter(function (t) { return t.enabled && t.volume > 0; }),
        onRetry: function () { publish(); },
        onClose: function () { drawActions(); },
        onDone: function (x) { st.dirty = false; leave(); pageClip(x.id, null); }
      });
      return view;
    }
    function publish() {
      var btns = actPanel.querySelectorAll('button'); [].forEach.call(btns, function (b) { b.disabled = true; });
      saveDraft().then(function () {
        return api('POST', '/clips/' + c.id + '/publish', { visibility: st.vis, title: payload().title });
      }).then(function () {
        failedError = null;
        if (player) player.pause();
        rendering = true;
        openView().progress({ phase: 'queued', pct: 0 });
        drawActions();
        pollRender();
      }).catch(function (e) {
        rendering = false;
        drawActions();
        if (view && view.isOpen()) view.fail(e.message);
        else if (isReauth(e)) reauthPrompt(e.message); else toast(errText(e), true);
      });
    }
    function pollRender() {
      clearTimeout(pollT);
      pollT = setTimeout(function () {
        api('GET', '/clips/' + c.id).then(function (x) {
          if (my !== pageToken) return;
          if (x.status === 'rendering') { if (view && view.isOpen()) view.progress(x.progress); pollRender(); return; }
          rendering = false;
          if (x.status === 'failed' || x.visibility === 'draft') {
            c = x; failedError = x.error || 'failed'; drawActions();
            if (view && view.isOpen()) view.fail(failedError);
            else if (isReauth(failedError)) reauthPrompt(failedError); else toast(errText(failedError), true);
            return;
          }
          st.dirty = false;
          if (view && view.isOpen()) { view.done(x); return; }
          toast(x.visibility === 'public' ? 'Published! Your clip is live.' : 'Published as unlisted.');
          leave(); pageClip(x.id, null);
        }).catch(function () { if (my === pageToken) pollRender(); });
      }, 1200);
    }
    onLeave(function () { if (view) view.destroy(); });

    drawActions();
    drawTimeline(null);
    building({ status: 'queued' });
    if (c.status === 'rendering') { rendering = true; openView().progress(c.progress || { phase: 'queued', pct: 0 }); drawActions(); pollRender(); }
    load(false);
  }

  // ---- profile
  function pageUser(username, boot, params) {
    var my = ++pageToken;
    clear(app); enter();
    if (boot && boot.profile && boot.profile.user.username.toLowerCase() === username.toLowerCase()) { draw(boot.profile); return; }
    app.appendChild(h('div', { class: 'profile' }, h('div', { class: 'profile-banner none sk' }), h('div', { style: { height: '90px' } })));
    app.appendChild(skeletonGrid(4));
    api('GET', '/users/' + encodeURIComponent(username)).then(function (p) { if (my === pageToken) { clear(app); draw(p); } })
      .catch(function (e) { if (my === pageToken) { if (e.status === 404) page404('user'); else { clear(app); app.appendChild(empty('wifiOff', 'Could not load this profile', errText(e))); } } });

    function draw(p) {
      var u = p.user;
      setTitle(u.username);
      var self = !!(me && me.id === u.id);
      var pc = validColor(u.color) ? { '--pc': u.color } : null;
      var banner = u.banner ? h('div', { class: 'profile-banner' }, h('img', { src: u.banner, alt: '' })) : h('div', { class: 'profile-banner none' });
      var box = h('section', { class: 'profile', style: pc },
        banner,
        h('div', { class: 'profile-row' },
          avatar(u, 96),
          h('div', { class: 'profile-id' }, h('div', { class: 'profile-name', text: u.username }), u.pronouns ? h('div', { class: 'profile-pron', text: u.pronouns }) : null),
          h('a', { class: 'btn btn-ghost btn-sm', href: u.veloraUrl, target: '_blank', rel: 'noopener' }, icon('external', 'i-sm'), 'Nookara profile')),
        u.private ? h('div', { class: 'notice' }, icon('lock', 'i-sm'), h('span', { text: 'This Nookara profile is friends-only, so only the name and picture are shown here.' })) : null,
        u.bio ? h('div', { class: 'profile-bio', text: u.bio }) : null,
        h('div', { class: 'profile-stats' },
          h('div', {}, h('b', { text: fmtNum(p.clipCount) }), h('span', { text: p.clipCount === 1 ? 'Clip' : 'Clips' })),
          h('div', {}, h('b', { text: fmtNum(p.totalViews) }), h('span', { text: 'Views' })),
          h('div', {}, h('b', { text: fmtNum(p.totalLikes || 0) }), h('span', { text: 'Likes' })),
          u.joined ? h('div', {}, h('b', { text: new Date(u.joined).getFullYear() }), h('span', { text: 'Joined' })) : null));
      app.appendChild(box);

      var grid = h('div', { class: 'grid stagger' });
      var tabsEl = null, tab = params && (params.get('tab') === 'drafts' || params.get('tab') === 'liked') && self ? params.get('tab') : 'published';
      var likedMore = h('div', {});
      var mine = null;
      function fill() {
        clear(grid); grid.className = 'grid stagger'; clear(likedMore);
        if (self && tab === 'liked') { likedMore.appendChild(likedGrid(grid, my)); return; }
        var list = !self ? p.clips : (mine || p.clips).filter(function (c) { return tab === 'drafts' ? c.visibility === 'draft' : c.visibility !== 'draft'; });
        if (!list.length) {
          grid.className = '';
          grid.appendChild(self
            ? (tab === 'drafts'
              ? empty('filePen', 'No drafts', 'Upload a clip as a draft from the Glint app to trim it and pick its audio here.')
              : empty('scissors', 'No clips yet', 'Clip something with the Glint app and upload it - it shows up here.', link(BASE + '/download', { class: 'btn btn-primary btn-sm' }, icon('download', 'i-sm'), 'Get Glint')))
            : empty('film', 'No public clips', u.username + ' has not shared any clips yet.'));
          return;
        }
        list.forEach(function (c, i) { grid.appendChild(card(c, { noUser: true, showVis: self }, i)); });
      }
      function drawTabs() {
        if (!tabsEl) return;
        clear(tabsEl);
        var pub = mine ? mine.filter(function (c) { return c.visibility !== 'draft'; }).length : p.clips.length;
        var dr = mine ? mine.filter(function (c) { return c.visibility === 'draft'; }).length : 0;
        [['published', 'film', 'Clips', pub], ['drafts', 'filePen', 'Drafts', dr], ['liked', 'heart', 'Liked', null]].forEach(function (t) {
          tabsEl.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === t[0]), class: 'tab' + (tab === t[0] ? ' on' : ''), onclick: function () {
            tab = t[0]; history.replaceState(null, '', profileHref(u.username) + (tab !== 'published' ? '?tab=' + tab : '')); drawTabs(); fill();
          } }, icon(t[1], 'i-sm'), t[2], h('span', { class: 'n', text: mine && t[3] !== null ? String(t[3]) : '' })));
        });
      }
      if (self) {
        tabsEl = h('div', { class: 'tabs', role: 'tablist' });
        app.appendChild(tabsEl);
        drawTabs();
        api('GET', '/me/clips').then(function (d) { if (my === pageToken) { mine = d.clips; drawTabs(); fill(); } }).catch(function () {});
      } else {
        app.appendChild(h('div', { class: 'page-head' }, h('h2', { class: 'page-title', style: { 'font-size': '17px' } }, icon('film'), 'Clips')));
      }
      app.appendChild(grid);
      app.appendChild(likedMore);
      fill();
      app.appendChild(footer());
    }
  }

  // ---- liked clips (GET /me/likes): cards with a filled heart; unliking animates the card out with an undo toast
  function likedGrid(grid, my) {
    var cursor = null, count = 0;
    var more = h('div', { class: 'more-row' });
    grid.className = 'grid stagger';
    function emptyState() {
      grid.className = '';
      clear(grid).appendChild(empty('heart', 'Clips you like show up here', 'Tap the heart on any clip to save it to this list.', link(BASE + '/', { class: 'btn btn-primary btn-sm' }, icon('film', 'i-sm'), 'Browse clips')));
    }
    function likedCard(c, i) {
      var el = card(c, { showVis: false }, i);
      var heart = h('button', { class: 'card-heart on', 'aria-label': 'Unlike ' + c.title, title: 'Unlike' }, icon('heart'));
      heart.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var next = el.nextSibling;
        heart.disabled = true;
        api('DELETE', '/clips/' + c.id + '/like').then(function () {
          el.classList.add('leaving');
          setTimeout(function () {
            el.remove(); count--;
            if (!grid.querySelector('.card')) emptyState();
          }, 260);
          toast('Removed from liked clips', false, { label: 'Undo', icon: 'undo', fn: function () {
            api('PUT', '/clips/' + c.id + '/like').then(function () {
              if (!grid.querySelector('.card')) { clear(grid); grid.className = 'grid stagger'; }
              var back = likedCard(c, 0);
              if (next && next.parentNode === grid) grid.insertBefore(back, next); else grid.appendChild(back);
              count++;
            }).catch(function (er) { toast(errText(er), true); });
          } });
        }).catch(function (er) { heart.disabled = false; toast(errText(er), true); });
      });
      var th = el.querySelector('.thumb'); if (th) th.appendChild(heart);
      return el;
    }
    function page() {
      return api('GET', '/me/likes' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')).then(function (d) {
        if (my !== pageToken) return;
        if (!cursor) clear(grid);
        if (!cursor && !d.clips.length) { emptyState(); return; }
        d.clips.forEach(function (c, i) { grid.appendChild(likedCard(c, i)); count++; });
        cursor = d.nextCursor;
        clear(more);
        if (cursor) {
          var b = h('button', { class: 'btn btn-surface' }, 'Load more');
          b.addEventListener('click', function () { b.disabled = true; page().catch(function (e) { b.disabled = false; toast(errText(e), true); }); });
          more.appendChild(b);
        }
      });
    }
    clear(grid);
    for (var k = 0; k < 4; k++) grid.appendChild(h('div', { class: 'card' }, h('div', { class: 'thumb sk' }), h('div', { class: 'sk sk-line', style: { width: '70%' } })));
    page().catch(function (e) { grid.className = ''; clear(grid).appendChild(empty('wifiOff', 'Could not load your liked clips', errText(e))); });
    return more;
  }

  function pageLiked() {
    var my = ++pageToken;
    setTitle('Liked clips');
    clear(app); enter();
    app.appendChild(h('div', { class: 'page-head' }, h('div', {}, h('h1', { class: 'page-title' }, icon('heart'), 'Liked clips'), h('p', { class: 'page-sub', text: 'Only you can see this list.' }))));
    if (!me) {
      app.appendChild(empty('lock', 'Sign in to see your liked clips', 'Your likes are tied to your Nookara account.', h('button', { class: 'btn btn-primary btn-sm', onclick: signIn }, icon('logIn', 'i-sm'), 'Sign in with Nookara')));
      app.appendChild(footer());
      return;
    }
    var grid = h('div', { class: 'grid stagger' });
    app.appendChild(grid);
    app.appendChild(likedGrid(grid, my));
    app.appendChild(footer());
  }

  function pageDownload(boot) {
    setTitle('Download');
    ++pageToken;
    clear(app); enter();
    var rel = boot ? boot.release : null;
    var copy = h('div', { class: 'dl-copy' },
      rel ? h('span', { class: 'badge', style: { 'align-self': 'flex-start', background: 'var(--accent-dim)', color: 'var(--accent)', padding: '3px 9px' } }, 'Version ' + rel.version)
        : h('span', { class: 'soon' }, icon('clock', 'i-sm'), 'Coming soon'),
      h('h1', { text: 'Clip the moment. Share it in seconds.' }),
      h('p', { text: 'Glint runs quietly while you play, keeps the last moments ready, and turns them into a link with one key press. Clips upload to your Nookara account, so they live next to everything else you have there.' }),
      rel && rel.url
        ? h('div', { style: { display: 'flex', gap: '10px', 'flex-wrap': 'wrap' } }, h('a', { class: 'btn btn-primary btn-lg', href: rel.url }, icon('download'), 'Download for Windows'))
        : h('div', { style: { display: 'flex', gap: '10px', 'flex-wrap': 'wrap' } }, h('button', { class: 'btn btn-primary btn-lg', disabled: true }, icon('download'), 'Download for Windows'),
            link(BASE + '/', { class: 'btn btn-surface btn-lg' }, icon('film'), 'Browse clips')),
      h('div', { class: 'dl-meta' },
        h('span', {}, icon('monitor', 'i-sm'), 'Windows 10 / 11, 64-bit'),
        rel && rel.size ? h('span', {}, icon('hardDrive', 'i-sm'), fmtBytes(rel.size)) : null),
      rel && rel.sha256 ? h('div', { class: 'hash' }, 'SHA-256 ' + rel.sha256) : null,
      !rel ? h('p', { style: { 'font-size': '13px', color: 'var(--muted)' }, text: 'The Windows app is still being built. Check back soon.' }) : null);
    var steps = [['Install and sign in', 'Sign in with your Nookara account.'], ['Play like normal', 'Glint keeps a rolling replay of your game.'], ['Press the clip key', 'Trim it, name it, and upload.'], ['Share the link', 'It plays right inside Discord and Ember.']];
    var side = h('div', { class: 'dl-side stagger' }, steps.map(function (s, i) {
      return h('div', { class: 'dl-step', style: { '--i': String(i) } }, h('span', { class: 'n', text: String(i + 1) }), h('div', {}, h('b', { text: s[0] }), h('span', { text: s[1] })));
    }));
    app.appendChild(h('section', { class: 'dl-hero' }, copy, side));
    var feats = [['history', 'Instant replay', 'Save what already happened, without recording everything.'], ['scissors', 'Trim before you share', 'Cut it down to the good part right in the app.'], ['audioLines', 'Every voice on its own track', 'Game, mic and voice chat are separate, so you pick what goes in.'], ['link', 'Links that embed', 'Clip pages play inline in Discord and Ember.']];
    app.appendChild(h('div', { class: 'features stagger' }, feats.map(function (f, i) {
      return h('div', { class: 'feature', style: { '--i': String(i) } }, h('div', { class: 'ic' }, icon(f[0])), h('b', { text: f[1] }), h('span', { text: f[2] }));
    })));
    if (rel && rel.notes) app.appendChild(h('div', { class: 'panel notes' }, h('div', { class: 'panel-head' }, h('div', { class: 'panel-title' }, icon('sparkles', 'i-sm'), 'What is new in ' + rel.version)), h('div', { class: 'panel-body' }, h('pre', { text: rel.notes }))));
    app.appendChild(footer());
  }

  function page404(kind) {
    ++pageToken;
    setTitle('Not found');
    clear(app); enter();
    var msg = kind === 'clip' ? ['This clip is gone', 'It was deleted, or the video was removed from its owner\'s Nookara uploads.']
      : kind === 'user' ? ['No one by that name', 'There is no Nookara account with that username.']
      : ['Page not found', 'The page you are looking for does not exist.'];
    app.appendChild(h('div', { class: 'nf' }, h('div', { class: 'nf-box' },
      h('div', { class: 'nf-code', text: '404' }), h('h1', { text: msg[0] }), h('p', { text: msg[1] }),
      h('div', { class: 'row' }, link(BASE + '/', { class: 'btn btn-primary' }, icon('film', 'i-sm'), 'Browse clips'),
        h('button', { class: 'btn btn-ghost', onclick: function () { history.length > 1 ? history.back() : go(BASE + '/'); } }, icon('arrowLeft', 'i-sm'), 'Go back')))));
  }
  function pageError(b) {
    ++pageToken;
    setTitle(b.title);
    clear(app); enter();
    app.appendChild(h('div', { class: 'nf' }, h('div', { class: 'nf-box' },
      h('div', { class: 'nf-code', text: String(b.status || 'Error') }), h('h1', { text: b.title || 'Something went wrong' }), h('p', { text: b.message || '' }),
      h('div', { class: 'row' }, h('button', { class: 'btn btn-primary', onclick: function () { location.reload(); } }, 'Try again'), link(BASE + '/', { class: 'btn btn-ghost' }, 'Browse clips')))));
  }

  var bootUsed = false;
  function go(href, replace) {
    if (replace) history.replaceState(null, '', href); else history.pushState(null, '', href);
    window.scrollTo(0, 0);
    route();
  }
  function route() {
    leave();
    var boot = bootUsed ? null : BOOT;
    bootUsed = true;
    var path = location.pathname;
    if (path.indexOf(BASE) === 0) path = path.slice(BASE.length);
    path = path.replace(/\/+$/, '') || '/';
    var params = new URLSearchParams(location.search);
    renderNav();
    var m;
    if (boot && boot.page === '404') {
      if (boot.draftCandidate && token()) return pageClip(boot.draftCandidate, null);
      return page404(boot.kind);
    }
    if (boot && boot.page === 'error') return pageError(boot);
    if (path === '/') return pageBrowse(params, boot && boot.page === 'browse' ? boot : null);
    if ((m = /^\/c\/([0-9A-Za-z]{10})$/.exec(path))) return pageClip(m[1], boot && boot.page === 'clip' ? boot.clip : null);
    if ((m = /^\/u\/([^/]+)$/.exec(path))) return pageUser(decodeURIComponent(m[1]), boot && boot.page === 'user' ? boot : null, params);
    if (path === '/liked') return pageLiked();
    if (path === '/download') {
      if (boot && boot.page === 'download') return pageDownload(boot);
      return fetch(BASE + '/download/latest.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
        .then(function (rel) { pageDownload({ release: rel && rel.version ? rel : null }); });
    }
    page404('page');
  }
  window.addEventListener('popstate', route);

  var firstBoot = BOOT;
  var needsMe = !!token() && (firstBoot.page === '404' && firstBoot.draftCandidate || /\/(c|u)\/|\/liked$/.test(location.pathname));
  if (needsMe) {
    loadMe().then(function () { route(); });
  } else {
    route();
    loadMe();
  }
})();
