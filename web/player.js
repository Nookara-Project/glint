/* Glint player: custom controls over a <video>, Nookara look (square, accent, lucide icons).
   window.GlintPlayer(container, opts) -> api. Also used by the draft editor (muted proxy video + synced per-track audio).
   On /embed/<id> it mounts itself from #embed-boot. */
(function () {
  'use strict';

  var P = {
    play: 'M7 4.5v15l12.5-7.5z',
    pause: 'M6.5 4.5h4v15h-4zM13.5 4.5h4v15h-4z'
  };
  var I = {
    volume: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/><path d="M19.364 18.364a9 9 0 0 0 0-12.728"/>',
    volumeLow: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><path d="M16 9a5 5 0 0 1 0 6"/>',
    volumeX: '<path d="M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
    pip: '<path d="M2 10V7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6"/><rect width="10" height="7" x="2" y="13"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    rotateCcw: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    rewind: '<polygon points="11 19 2 12 11 5 11 19"/><polygon points="22 19 13 12 22 5 22 19"/>',
    forward: '<polygon points="13 19 22 12 13 5 13 19"/><polygon points="2 19 11 12 2 5 2 19"/>',
    check: '<path d="M20 6 9 17l-5-5"/>'
  };
  function svg(inner, cls) {
    var s = document.createElement('span');
    s.innerHTML = '<svg class="i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>';
    return s.firstChild;
  }
  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    return e;
  }
  function fmt(t) {
    t = Math.max(0, Math.floor(Number(t) || 0));
    var m = Math.floor(t / 60), s = t % 60;
    if (m >= 60) return Math.floor(m / 60) + ':' + (m % 60 < 10 ? '0' : '') + (m % 60) + ':' + (s < 10 ? '0' : '') + s;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  var SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  function GlintPlayer(container, opts) {
    opts = opts || {};
    var listeners = {};
    function emit(n, a) { (listeners[n] || []).forEach(function (f) { try { f(a); } catch (e) {} }); }

    var root = el('div', 'gp' + (opts.compact ? ' gp-compact' : ''), { tabindex: '0', role: 'region', 'aria-label': opts.label || 'Video player' });
    if (opts.width && opts.height) root.style.setProperty('--ar', opts.width + ' / ' + opts.height);
    var video = el('video', 'gp-video', { playsinline: '', 'webkit-playsinline': '', preload: opts.preload || 'metadata' });
    video.playsInline = true;
    if (opts.poster) video.poster = opts.poster;
    if (opts.muted) { video.muted = true; video.defaultMuted = true; }
    video.src = opts.src;
    root.appendChild(video);

    var spinner = el('div', 'gp-spinner', { 'aria-hidden': 'true' });
    var big = el('button', 'gp-big', { type: 'button', 'aria-label': 'Play' });
    var bigSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    bigSvg.setAttribute('viewBox', '0 0 24 24'); bigSvg.setAttribute('aria-hidden', 'true');
    var bigPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    bigPath.setAttribute('d', P.play);
    bigSvg.appendChild(bigPath); big.appendChild(bigSvg);
    var flash = el('div', 'gp-flash', { 'aria-hidden': 'true' });
    var tapL = el('div', 'gp-tap gp-tap-l', { 'aria-hidden': 'true' }); tapL.appendChild(svg(I.rewind)); tapL.appendChild(el('span'));
    var tapR = el('div', 'gp-tap gp-tap-r', { 'aria-hidden': 'true' }); tapR.appendChild(svg(I.forward)); tapR.appendChild(el('span'));
    var end = el('div', 'gp-end');
    var replayBtn = el('button', 'gp-end-btn gp-end-main', { type: 'button' }); replayBtn.appendChild(svg(I.rotateCcw)); replayBtn.appendChild(document.createTextNode('Replay'));
    end.appendChild(replayBtn);
    var copyBtn = null;
    if (opts.shareUrl) {
      copyBtn = el('button', 'gp-end-btn', { type: 'button' }); copyBtn.appendChild(svg(I.link)); copyBtn.appendChild(document.createTextNode('Copy link'));
      end.appendChild(copyBtn);
    }
    var live = el('div', 'gp-sr', { 'aria-live': 'polite' });

    var bar = el('div', 'gp-bar');
    var scrub = null, prog, buf, knob, tip, tipImg, tipTime;
    if (opts.scrub !== false) {
      scrub = el('div', 'gp-scrub', { role: 'slider', tabindex: '0', 'aria-label': 'Seek', 'aria-valuemin': '0', 'aria-valuenow': '0' });
      var rail = el('div', 'gp-rail');
      buf = el('div', 'gp-buf'); prog = el('div', 'gp-prog'); knob = el('div', 'gp-knob');
      rail.appendChild(buf); rail.appendChild(prog); rail.appendChild(knob);
      tip = el('div', 'gp-tip');
      if (opts.filmstrip) { tipImg = el('div', 'gp-tip-img'); tipImg.style.backgroundImage = 'url("' + opts.filmstrip + '")'; tip.appendChild(tipImg); }
      tipTime = el('span', 'gp-tip-time'); tip.appendChild(tipTime);
      scrub.appendChild(rail); scrub.appendChild(tip);
      bar.appendChild(scrub);
    }
    var row = el('div', 'gp-row');
    function btn(icon, label, cls) {
      var b = el('button', 'gp-btn' + (cls ? ' ' + cls : ''), { type: 'button', 'aria-label': label, title: label });
      if (icon) b.appendChild(icon);
      row.appendChild(b);
      return b;
    }
    var playSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    playSvg.setAttribute('viewBox', '0 0 24 24'); playSvg.setAttribute('class', 'i gp-fill'); playSvg.setAttribute('aria-hidden', 'true');
    var playPath = document.createElementNS('http://www.w3.org/2000/svg', 'path'); playPath.setAttribute('d', P.play); playSvg.appendChild(playPath);
    var playBtn = btn(playSvg, 'Play (k)');
    var volWrap = el('div', 'gp-vol');
    var muteBtn = el('button', 'gp-btn', { type: 'button', 'aria-label': 'Mute (m)', title: 'Mute (m)' });
    var volRange = el('input', 'gp-range', { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Volume' });
    volWrap.appendChild(muteBtn); volWrap.appendChild(volRange);
    if (!opts.hideVolume) row.appendChild(volWrap);
    var time = el('span', 'gp-time'); time.textContent = '0:00 / 0:00';
    row.appendChild(time);
    row.appendChild(el('span', 'gp-spacer'));
    var loopBtn = btn(svg(I.repeat), 'Loop', 'gp-toggle');
    var speedWrap = el('div', 'gp-speed');
    var speedBtn = el('button', 'gp-btn gp-speed-btn', { type: 'button', 'aria-label': 'Playback speed', 'aria-haspopup': 'menu', title: 'Speed' });
    speedBtn.textContent = '1x';
    var speedMenu = el('div', 'gp-menu', { role: 'menu' });
    SPEEDS.forEach(function (s) {
      var o = el('button', 'gp-menu-item', { type: 'button', role: 'menuitemradio', 'data-s': String(s) });
      o.appendChild(svg(I.check, 'i-sm'));
      o.appendChild(document.createTextNode(s === 1 ? 'Normal' : s + 'x'));
      o.addEventListener('click', function (e) { e.stopPropagation(); setRate(s); closeMenu(); });
      speedMenu.appendChild(o);
    });
    speedWrap.appendChild(speedBtn); speedWrap.appendChild(speedMenu);
    row.appendChild(speedWrap);
    var pipBtn = null;
    if (document.pictureInPictureEnabled && !video.disablePictureInPicture && !opts.noPip) pipBtn = btn(svg(I.pip), 'Picture in picture');
    var fsBtn = btn(svg(I.maximize), 'Fullscreen (f)');
    bar.appendChild(row);

    [spinner, flash, tapL, tapR, big, end, bar, live].forEach(function (n) { root.appendChild(n); });
    container.appendChild(root);

    var tracks = [];
    var actx = null;
    function ensureCtx() {
      if (!tracks.length) return;
      try {
        if (!actx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          actx = new AC();
          tracks.forEach(function (t) {
            try { var src = actx.createMediaElementSource(t.audio); t.node = actx.createGain(); t.node.gain.value = t.gain; src.connect(t.node).connect(actx.destination); t.audio.volume = 1; } catch (e) { t.node = null; }
          });
        }
        if (actx.state === 'suspended') actx.resume();
      } catch (e) {}
    }
    function applyGain(t) {
      var g = t.muted ? 0 : t.gain;
      if (t.node) t.node.gain.setTargetAtTime(g, actx.currentTime, 0.015);
      else t.audio.volume = Math.max(0, Math.min(1, g));
    }
    (opts.tracks || []).forEach(function (tr) {
      var a = new Audio(); a.preload = 'auto'; a.src = tr.url;
      tracks.push({ index: tr.index, audio: a, gain: tr.gain === undefined ? 1 : tr.gain, muted: !!tr.muted, node: null });
    });
    tracks.forEach(applyGain);
    function syncAll(force) {
      var vt = video.currentTime;
      tracks.forEach(function (t) {
        var a = t.audio;
        if (a.readyState < 1) return;
        var d = a.currentTime - vt;
        if (force || Math.abs(d) > 0.25) { try { a.currentTime = vt; } catch (e) {} a.playbackRate = video.playbackRate; }
        else if (Math.abs(d) > 0.04) a.playbackRate = video.playbackRate * (d > 0 ? 0.97 : 1.03);
        else a.playbackRate = video.playbackRate;
        if (!video.paused && !waiting && a.paused) a.play().catch(function () {});
        if ((video.paused || waiting) && !a.paused) a.pause();
      });
    }
    var waiting = false;
    var syncTimer = tracks.length ? setInterval(function () { if (!video.paused) syncAll(false); }, 250) : null;

    var range = null;
    function rStart() { return range ? range.start : 0; }
    function rEnd() { return range ? range.end : (video.duration || 0); }
    function play() {
      ensureCtx();
      if (range && (video.currentTime >= range.end - 0.05 || video.currentTime < range.start)) video.currentTime = range.start;
      var p = video.play(); if (p && p.catch) p.catch(function () {});
    }
    function pause() { video.pause(); }
    function toggle() { if (video.paused || video.ended) play(); else pause(); }
    function seek(t) {
      var d = video.duration || 0;
      t = Math.max(range ? range.start : 0, Math.min(range ? range.end : d, t));
      video.currentTime = t;
      if (tracks.length) syncAll(true);
      updateTime();
    }
    function setRate(s) {
      video.playbackRate = s;
      tracks.forEach(function (t) { t.audio.playbackRate = s; });
      speedBtn.textContent = (s === 1 ? '1' : s) + 'x';
      [].forEach.call(speedMenu.children, function (o) { o.classList.toggle('on', Number(o.getAttribute('data-s')) === s); o.setAttribute('aria-checked', String(Number(o.getAttribute('data-s')) === s)); });
      showFlash(null, s + 'x');
    }
    function closeMenu() { speedWrap.classList.remove('open'); }

    function setPlayIcon() {
      var playing = !video.paused && !video.ended;
      playPath.setAttribute('d', playing ? P.pause : P.play);
      bigPath.setAttribute('d', playing ? P.pause : P.play);
      playBtn.setAttribute('aria-label', playing ? 'Pause (k)' : 'Play (k)');
      big.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      root.classList.toggle('gp-playing', playing);
      root.classList.toggle('gp-paused', !playing);
    }
    function setVolIcon() {
      muteBtn.innerHTML = '';
      var v = video.muted ? 0 : video.volume;
      muteBtn.appendChild(svg(v === 0 ? I.volumeX : v < 0.5 ? I.volumeLow : I.volume));
      muteBtn.setAttribute('aria-label', video.muted ? 'Unmute (m)' : 'Mute (m)');
      volRange.value = String(video.muted ? 0 : video.volume);
      volRange.style.setProperty('--v', (video.muted ? 0 : video.volume) * 100 + '%');
    }
    var lastPct = -1;
    function updateTime() {
      var d = video.duration || opts.duration || 0, c = video.currentTime || 0;
      time.textContent = fmt(c) + ' / ' + fmt(d);
      if (scrub && !dragging) {
        var pct = d ? (c / d) * 100 : 0;
        if (Math.abs(pct - lastPct) > 0.01) { prog.style.width = pct + '%'; knob.style.left = pct + '%'; lastPct = pct; }
        scrub.setAttribute('aria-valuemax', String(Math.round(d)));
        scrub.setAttribute('aria-valuenow', String(Math.round(c)));
        scrub.setAttribute('aria-valuetext', fmt(c) + ' of ' + fmt(d));
      }
      emit('time', c);
    }
    function updateBuf() {
      if (!scrub) return;
      var d = video.duration; if (!d) return;
      var b = video.buffered, endB = 0;
      for (var i = 0; i < b.length; i++) if (b.start(i) <= video.currentTime + 0.5) endB = Math.max(endB, b.end(i));
      buf.style.width = (endB / d) * 100 + '%';
    }
    var raf = 0;
    function tick() { updateTime(); if (!video.paused) raf = requestAnimationFrame(tick); }

    var flashT = 0;
    function showFlash(icon, text) {
      flash.innerHTML = '';
      if (icon) flash.appendChild(svg(icon));
      if (text) { var s = el('span'); s.textContent = text; flash.appendChild(s); }
      flash.classList.remove('show'); void flash.offsetWidth; flash.classList.add('show');
      clearTimeout(flashT); flashT = setTimeout(function () { flash.classList.remove('show'); }, 650);
      if (text) live.textContent = text;
    }

    var hideT = 0;
    function poke() {
      root.classList.add('gp-active');
      clearTimeout(hideT);
      hideT = setTimeout(function () {
        if (!video.paused && !speedWrap.classList.contains('open') && !dragging && !root.contains(document.activeElement && document.activeElement !== root ? document.activeElement : null)) root.classList.remove('gp-active');
        else if (!video.paused) poke();
      }, coarse ? 3000 : 2200);
    }
    function hideNow() { if (!video.paused) { clearTimeout(hideT); root.classList.remove('gp-active'); } }

    video.addEventListener('play', function () { end.classList.remove('show'); setPlayIcon(); poke(); cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); if (tracks.length) syncAll(true); emit('play'); });
    video.addEventListener('pause', function () { setPlayIcon(); root.classList.add('gp-active'); if (tracks.length) syncAll(false); emit('pause'); });
    video.addEventListener('playing', function () { waiting = false; root.classList.remove('gp-loading'); if (tracks.length) syncAll(true); emit('playing'); });
    video.addEventListener('waiting', function () { waiting = true; root.classList.add('gp-loading'); if (tracks.length) syncAll(false); });
    video.addEventListener('stalled', function () { if (!video.paused) root.classList.add('gp-loading'); });
    video.addEventListener('canplay', function () { root.classList.remove('gp-loading'); });
    video.addEventListener('seeking', function () { if (tracks.length) syncAll(true); });
    video.addEventListener('seeked', function () { root.classList.remove('gp-loading'); if (tracks.length) syncAll(true); updateTime(); });
    video.addEventListener('ratechange', function () { tracks.forEach(function (t) { t.audio.playbackRate = video.playbackRate; }); });
    video.addEventListener('timeupdate', function () {
      if (range && video.currentTime >= range.end) {
        if (loopOn) { video.currentTime = range.start; if (tracks.length) syncAll(true); }
        else { pause(); video.currentTime = range.end; }
      }
      updateTime();
    });
    video.addEventListener('progress', updateBuf);
    video.addEventListener('loadedmetadata', function () { updateTime(); updateBuf(); emit('meta', video.duration); });
    video.addEventListener('volumechange', setVolIcon);
    video.addEventListener('ended', function () {
      setPlayIcon();
      if (!loopOn && !range) { end.classList.add('show'); root.classList.add('gp-active'); }
      emit('ended');
    });
    video.addEventListener('error', function () { root.classList.remove('gp-loading'); emit('error', video.error); });

    var loopOn = false;
    function setLoop(on) {
      loopOn = on;
      if (!range) video.loop = on;
      loopBtn.classList.toggle('on', on);
      loopBtn.setAttribute('aria-pressed', String(on));
      if (on) end.classList.remove('show');
    }
    loopBtn.addEventListener('click', function () { setLoop(!loopOn); showFlash(I.repeat, loopOn ? 'Loop on' : 'Loop off'); });

    playBtn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    big.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    replayBtn.addEventListener('click', function (e) { e.stopPropagation(); end.classList.remove('show'); seek(rStart()); play(); });
    if (copyBtn) copyBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var done = function () { copyBtn.lastChild.textContent = 'Copied'; setTimeout(function () { copyBtn.lastChild.textContent = 'Copy link'; }, 1500); };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(opts.shareUrl).then(done, function () {});
      if (opts.onCopy) opts.onCopy();
    });

    var savedVol = parseFloat(load('glint_volume'));
    if (!opts.muted && isFinite(savedVol)) video.volume = Math.max(0, Math.min(1, savedVol));
    if (!opts.muted && load('glint_muted') === '1') video.muted = true;
    muteBtn.addEventListener('click', function (e) { e.stopPropagation(); setMuted(!video.muted); });
    function setMuted(m) { video.muted = m; if (!m && video.volume === 0) video.volume = 0.5; store('glint_muted', m ? '1' : '0'); showFlash(m ? I.volumeX : I.volume, m ? 'Muted' : Math.round(video.volume * 100) + '%'); }
    function setVolume(v) { v = Math.max(0, Math.min(1, v)); video.volume = v; video.muted = v === 0; store('glint_volume', String(v)); store('glint_muted', v === 0 ? '1' : '0'); }
    volRange.addEventListener('input', function () { setVolume(parseFloat(volRange.value)); });
    volRange.addEventListener('click', function (e) { e.stopPropagation(); });
    setVolIcon();

    speedBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      speedWrap.classList.toggle('open');
      if (speedWrap.classList.contains('open')) {
        var off = function (ev) { if (!speedWrap.contains(ev.target)) { closeMenu(); document.removeEventListener('pointerdown', off, true); } };
        document.addEventListener('pointerdown', off, true);
      }
    });
    setRate(1); flash.classList.remove('show'); live.textContent = '';

    if (pipBtn) pipBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
      else video.requestPictureInPicture().catch(function () {});
    });
    function isFs() { return (document.fullscreenElement || document.webkitFullscreenElement) === root; }
    function toggleFs() {
      if (isFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      var req = root.requestFullscreen || root.webkitRequestFullscreen;
      if (req) { var p = req.call(root); if (p && p.catch) p.catch(function () { if (video.webkitEnterFullscreen) video.webkitEnterFullscreen(); }); }
      else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();
    }
    fsBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleFs(); });
    function onFs() {
      fsBtn.innerHTML = ''; fsBtn.appendChild(svg(isFs() ? I.minimize : I.maximize));
      fsBtn.setAttribute('aria-label', isFs() ? 'Exit fullscreen (f)' : 'Fullscreen (f)');
      root.classList.toggle('gp-fs', isFs());
    }
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    var dragging = false;
    function pctAt(clientX) { var r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (clientX - r.left) / r.width)); }
    function showTip(p) {
      var d = video.duration || opts.duration || 0;
      tipTime.textContent = fmt(p * d);
      tip.style.left = (p * 100) + '%';
      if (tipImg) { var n = 10, f = Math.min(n - 1, Math.floor(p * n)); tipImg.style.backgroundPosition = (f / (n - 1)) * 100 + '% 0'; }
    }
    if (scrub) {
      scrub.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') { scrub.classList.add('hover'); showTip(pctAt(e.clientX)); } });
      scrub.addEventListener('pointerleave', function () { if (!dragging) scrub.classList.remove('hover'); });
      scrub.addEventListener('pointerdown', function (e) {
        e.preventDefault(); e.stopPropagation();
        dragging = true; scrub.classList.add('drag', 'hover');
        try { scrub.setPointerCapture(e.pointerId); } catch (x) {}
        var wasPlaying = !video.paused;
        var move = function (ev) {
          var p = pctAt(ev.clientX), d = video.duration || 0;
          prog.style.width = p * 100 + '%'; knob.style.left = p * 100 + '%'; showTip(p);
          video.currentTime = p * d; time.textContent = fmt(p * d) + ' / ' + fmt(d);
        };
        move(e);
        if (wasPlaying) video.pause();
        var up = function (ev) {
          dragging = false; scrub.classList.remove('drag');
          if (ev.pointerType !== 'mouse') scrub.classList.remove('hover');
          scrub.removeEventListener('pointermove', move); scrub.removeEventListener('pointerup', up); scrub.removeEventListener('pointercancel', up);
          if (tracks.length) syncAll(true);
          if (wasPlaying) play();
          poke();
        };
        scrub.addEventListener('pointermove', move); scrub.addEventListener('pointerup', up); scrub.addEventListener('pointercancel', up);
      });
      scrub.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(video.currentTime + (e.key === 'ArrowLeft' ? -5 : 5)); }
      });
    }

    var lastTap = 0, tapTimer = 0, tapCount = 0, tapSide = 0;
    root.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') poke(); });
    root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hideNow(); });
    function surface(e) { return e.target === video || e.target === root || e.target === end || e.target.classList.contains('gp-tap'); }
    root.addEventListener('pointerup', function (e) {
      if (!surface(e)) return;
      if (e.pointerType === 'mouse') { if (e.button === 0) { toggle(); showFlash(video.paused ? I.volumeX && null : null, null); } return; }
      var now = Date.now();
      var r = root.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width;
      var side = x < 0.35 ? -1 : x > 0.65 ? 1 : 0;
      if (now - lastTap < 300 && side !== 0 && side === tapSide) {
        clearTimeout(tapTimer);
        tapCount++;
        seek(video.currentTime + side * 5);
        var t = side < 0 ? tapL : tapR;
        t.lastChild.textContent = (side < 0 ? '-' : '+') + (5 * tapCount) + 's';
        t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
        lastTap = now;
        return;
      }
      tapCount = 1; tapSide = side; lastTap = now;
      clearTimeout(tapTimer);
      tapTimer = setTimeout(function () {
        if (root.classList.contains('gp-active') && !video.paused) hideNow(); else poke();
      }, 260);
    });
    root.addEventListener('dblclick', function (e) { if (e.target === video) { e.preventDefault(); toggleFs(); } });

    function onKey(e) {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t !== volRange) return;
      if (t && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      var k = e.key, d = video.duration || 0;
      if (k === ' ' || k === 'k' || k === 'K') { e.preventDefault(); toggle(); showFlash(null, video.paused ? 'Paused' : 'Playing'); }
      else if (k === 'j' || k === 'J') { e.preventDefault(); seek(video.currentTime - 10); showFlash(I.rewind, '-10s'); }
      else if (k === 'l' || k === 'L') { e.preventDefault(); seek(video.currentTime + 10); showFlash(I.forward, '+10s'); }
      else if (k === 'ArrowLeft') { e.preventDefault(); seek(video.currentTime - 5); showFlash(I.rewind, '-5s'); }
      else if (k === 'ArrowRight') { e.preventDefault(); seek(video.currentTime + 5); showFlash(I.forward, '+5s'); }
      else if (k === 'ArrowUp' && !opts.hideVolume) { e.preventDefault(); setVolume(video.volume + 0.1); showFlash(I.volume, Math.round(video.volume * 100) + '%'); }
      else if (k === 'ArrowDown' && !opts.hideVolume) { e.preventDefault(); setVolume(video.volume - 0.1); showFlash(video.volume ? I.volumeLow : I.volumeX, Math.round(video.volume * 100) + '%'); }
      else if ((k === 'm' || k === 'M') && !opts.hideVolume) { e.preventDefault(); setMuted(!video.muted); }
      else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFs(); }
      else if (/^[0-9]$/.test(k) && d) { e.preventDefault(); seek(rStart() + (rEnd() - rStart()) * Number(k) / 10); showFlash(null, Number(k) * 10 + '%'); }
      else return;
      poke();
    }
    root.addEventListener('keydown', onKey);
    var globalKey = null;
    if (opts.globalKeys) {
      globalKey = function (e) { if (!root.contains(e.target) && (e.target === document.body || e.target === document.documentElement)) onKey(e); };
      document.addEventListener('keydown', globalKey);
    }
    root.addEventListener('focus', poke);

    setPlayIcon(); setLoop(!!opts.loop);
    root.classList.add('gp-active');
    if (opts.autoplay) play();

    return {
      el: root, video: video, play: play, pause: pause, toggle: toggle, seek: seek,
      on: function (n, f) { (listeners[n] = listeners[n] || []).push(f); },
      setRange: function (r) { range = r ? { start: r.start, end: r.end } : null; video.loop = !range && loopOn; },
      setTrack: function (index, o) {
        tracks.forEach(function (t) { if (t.index === index) { if (o.gain !== undefined) t.gain = o.gain; if (o.muted !== undefined) t.muted = o.muted; applyGain(t); } });
      },
      destroy: function () {
        clearInterval(syncTimer); cancelAnimationFrame(raf); clearTimeout(hideT);
        try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
        tracks.forEach(function (t) { try { t.audio.pause(); t.audio.removeAttribute('src'); t.audio.load(); } catch (e) {} });
        if (actx) try { actx.close(); } catch (e) {}
        if (globalKey) document.removeEventListener('keydown', globalKey);
        document.removeEventListener('fullscreenchange', onFs);
        document.removeEventListener('webkitfullscreenchange', onFs);
        root.remove();
      }
    };
  }
  window.GlintPlayer = GlintPlayer;

  var eb = document.getElementById('embed-boot');
  if (eb) {
    try {
      var data = JSON.parse(eb.textContent);
      var c = data.clip;
      GlintPlayer(document.getElementById('embed'), { src: c.videoUrl, poster: c.thumbnail, width: c.width, height: c.height, duration: c.durationSec,
        shareUrl: c.url, label: c.title, globalKeys: true, noPip: false });
    } catch (e) {}
  }
})();
