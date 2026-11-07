'use strict';
// Glint's window: Clips (library + trimmer with per-track audio), Games, Settings. State comes from main via window.glint.
(() => {
  const G = window.glint;
  const I = window.ICONS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const fmt = sec => { const s = Math.max(0, Number(sec) || 0); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
  const fmtShort = sec => { const s = Math.round(Number(sec) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmtDate = ms => {
    const d = new Date(ms), now = new Date();
    const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return `Today, ${time}`;
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' })}, ${time}`;
  };
  const setRange = el => el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, reduced() ? 0 : ms));
  const KIND_ICON = { game: 'gamepad', mic: 'mic', discord: 'message', fluxer: 'message', ember: 'message', desktop: 'monitor' };
  const APP_ICONS = { discord: '../assets/apps/discord.svg', fluxer: '../assets/apps/fluxer.png', ember: '../assets/apps/ember.png' };
  function trackIcon(t, clip) {
    if (APP_ICONS[t.kind]) return `<img class="app-ico" src="${APP_ICONS[t.kind]}" alt="">`;
    if (t.kind === 'game' && clip?.game?.icon) return `<img class="app-ico" src="${esc(clip.game.icon)}" alt="">`;
    if (t.kind === 'app') return t.appId ? `<img class="app-ico" src="glint-media://appicon/${esc(t.appId)}" alt="">` : I.app;
    return I[KIND_ICON[t.kind] || 'volume'];
  }
  const VIS = { public: ['globe', 'Public'], unlisted: ['eyeOff', 'Unlisted'], draft: ['fileText', 'Draft'] };

  const S = { settings: null, status: null, account: { signedIn: false }, update: null, encoders: [], version: '', clips: [], view: 'library', clipId: null, filter: 'all', q: '', uploads: new Map(), failed: new Map(), autoDone: new Set(), clipsDir: '', highlight: null };

  function snack(text, kind = 'ok') {
    const el = h(`<div class="snack ${kind === 'err' ? 'err' : ''}">${kind === 'err' ? I.alert : I.check}<span>${esc(text)}</span></div>`);
    $('#snacks').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 240); }, kind === 'err' ? 5200 : 2800);
  }
  function modal({ title, body, actions }) {
    return new Promise(resolve => {
      const wrap = $('#modal');
      wrap.innerHTML = '';
      const m = h(`<div class="modal"><div class="modal-h"><h3>${esc(title)}</h3><button class="btn ghost sm icon" data-x>${I.x}</button></div><div class="modal-b"></div><div class="modal-f"></div></div>`);
      const b = $('.modal-b', m);
      if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
      const close = v => { wrap.classList.add('out'); document.removeEventListener('keydown', key); setTimeout(() => { wrap.hidden = true; wrap.classList.remove('out'); wrap.innerHTML = ''; }, reduced() ? 0 : 140); resolve(v); };
      const key = e => { if (e.key === 'Escape') close(null); };
      for (const a of actions || []) {
        const btn = h(`<button class="btn ${a.kind || ''}">${a.icon ? I[a.icon] : ''}${esc(a.label)}</button>`);
        btn.onclick = () => close(a.value !== undefined ? a.value : a.label);
        $('.modal-f', m).appendChild(btn);
      }
      if (!actions?.length) $('.modal-f', m).remove();
      $('[data-x]', m).onclick = () => close(null);
      wrap.onclick = e => { if (e.target === wrap) close(null); };
      document.addEventListener('keydown', key);
      wrap.appendChild(m);
      wrap.hidden = false;
      m.closeModal = close;
    });
  }

  function applyAccent(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    const c = m ? `#${m[1]}` : '#9d8ad1';
    const n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const root = document.documentElement.style;
    root.setProperty('--vl', c);
    root.setProperty('--vl-dim', `rgba(${r}, ${g}, ${b}, .14)`);
    root.setProperty('--vl-glow', `rgba(${r}, ${g}, ${b}, .35)`);
    root.setProperty('--vl-ink', lum > 0.55 ? '#16141c' : '#ffffff');
  }

  const encName = e => ({ h264_nvenc: 'NVENC', h264_amf: 'AMD AMF', h264_qsv: 'Intel QSV', libx264: 'x264 (CPU)' })[e] || e || '';
  function voiceIndicator(st) {
    const on = (st.audio || []).filter(a => a.live && !a.dup && isVoiceTrack(a));
    if (!on.length) return '';
    const s = S.settings || {};
    const canStop = s.mic || s.audioDesktop || Object.values(s.audioApps || {}).some(Boolean);
    return `<div class="pill voice-pill" title="Only you see this. Nobody else is told they're being recorded.">${I.mic}<span>${esc(on.map(a => a.label).join(', '))}</span>${canStop ? '<button class="btn ghost sm" data-voice-off>Stop</button>' : ''}</div>`;
  }
  async function stopVoices() {
    const r = await G.setSettings({ mic: false, audioDesktop: false, audioApps: { discord: false, fluxer: false, ember: false } });
    if (r?.settings) { S.settings = r.settings; renderTitlebar(); if (S.view === 'settings') renderView(); }
    snack('Stopped recording voices. Turn them back on in Settings.');
  }
  function renderTitlebar() {
    const st = S.status || {};
    const rec = $('#rec');
    let html;
    if (st.recording) {
      const what = st.game ? st.game.name : 'Desktop';
      const meta = st.size ? `${st.size.height}p${st.fps} · ${encName(st.encoder)}` : '';
      const live = (st.audio || []).filter(a => a.live && !a.dup).length;
      html = `<div class="pill on"><span class="sq"></span><span>Recording</span><b>${esc(what)}</b><span class="meta">${esc(meta)}${live ? ` · ${live} audio` : ''}</span></div>${voiceIndicator(st)}`;
    } else if (st.wanted) html = `<div class="pill"><span class="sq"></span><span>Starting the buffer...</span></div>`;
    else html = `<div class="pill"><span class="sq"></span><span>Waiting for a game</span></div>`;
    if (rec.dataset.html !== html) { rec.dataset.html = html; rec.innerHTML = html; }
    const mute = $('[data-voice-off]', rec);
    if (mute) mute.onclick = stopVoices;
    const up = $('#tb-update');
    const u = S.update || {};
    up.hidden = u.state !== 'ready';
    up.innerHTML = `${I.refresh}<span>Restart to update ${esc(u.version || '')}</span>`;
    up.onclick = () => G.update.install();
    $$('.tbtn').forEach(b => { b.innerHTML = I[{ min: 'minus', max: S.maximized ? 'restore' : 'square', close: 'x' }[b.dataset.win]]; });
    const side = $('#side-clip');
    side.innerHTML = '';
    const btn = h(`<button class="clip-now ${st.recording ? 'live' : ''}" ${st.recording ? '' : 'disabled'}><span class="cn-t">${I.aperture}Save a clip</span><span class="cn-s">${st.recording ? `Last ${S.settings?.clipLength || 30} s · <span class="kbd">${esc(S.settings?.hotkey || '')}</span> in game` : 'Starts recording when a game is running'}</span></button>`);
    btn.onclick = async () => { const r = await G.clipNow(); if (r?.error) snack(r.error === 'not_recording' ? 'Not recording right now.' : "Couldn't save the clip.", 'err'); };
    side.appendChild(btn);
    if (st.hotkeyError) side.appendChild(h(`<p class="err" style="margin:8px 2px 0">The hotkey ${esc(st.hotkey)} is taken by another program - pick another in Settings.</p>`));
  }
  function renderNav() {
    $$('.nav-i').forEach(b => {
      b.classList.toggle('on', b.dataset.view === S.view || (S.view === 'editor' && b.dataset.view === 'library'));
      const ic = $('.ni', b); if (!ic.innerHTML) ic.innerHTML = I[ic.dataset.icon];
      b.onclick = () => go(b.dataset.view);
    });
    $('#nav-count').textContent = S.clips.length ? String(S.clips.length) : '';
  }
  function renderAccount() {
    const a = S.account || {};
    const el = $('#acct');
    if (a.signingIn) {
      el.innerHTML = `<div class="acct-card"><div class="avatar">${I.user}</div><div class="acct-n"><b>Signing in...</b><span>Finish in your browser</span></div><button class="btn ghost sm icon" title="Cancel">${I.x}</button></div>`;
      $('button', el).onclick = () => G.account.cancel();
    } else if (a.signedIn) {
      el.innerHTML = `<div class="acct-card"><div class="avatar">${a.pfp ? `<img src="${esc(a.pfp)}" alt="">` : I.user}</div><div class="acct-n"><b>${esc(a.username || 'Nookara')}</b><span>Nookara account</span></div><button class="btn ghost sm icon" title="Sign out">${I.logOut}</button></div>`;
      $('button', el).onclick = async () => { if (await modal({ title: 'Sign out of Nookara?', body: '<p>Your clips stay on this PC. Uploads stay on Nookara.</p>', actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Sign out', kind: 'danger', value: true }] })) G.account.signOut(); };
    } else {
      el.innerHTML = `<button class="btn full">${I.logIn}Sign in with Nookara</button>`;
      $('button', el).onclick = signIn;
    }
    applyAccent(a.color);
  }
  async function signIn() {
    S.account = { ...S.account, signingIn: 'waiting' };
    renderAccount();
    const r = await G.account.signIn();
    if (r?.ok) snack('Signed in with Nookara.');
    else if (r?.error && r.error !== 'cancelled') {
      const why = r.reason ? ` (${r.reason})` : '';
      snack(r.error === 'network' ? `Glint couldn't reach Nookara${why}. Check your antivirus or VPN - they sometimes block apps but not the browser.`
        : r.error === 'expired' ? `Sign-in timed out - try again.${r.reason ? ` Last network error: ${r.reason}.` : ''}` : `Couldn't sign in right now${why}.`, 'err');
    }
    S.account = await G.account.refresh();
    renderAccount();
    if (S.view === 'editor') renderView();
  }

  function go(view, clipId) {
    S.view = view; S.clipId = clipId || null;
    renderNav();
    renderView();
    $('#main').scrollTop = 0;
  }
  function renderView() {
    const main = $('#main');
    stopEditor();
    main.innerHTML = '';
    try {
      if (S.view === 'library') main.appendChild(viewLibrary());
      else if (S.view === 'editor') main.appendChild(viewEditor());
      else if (S.view === 'games') main.appendChild(viewGames());
      else if (S.view === 'settings') main.appendChild(viewSettings());
    } catch (e) {
      console.error('[glint] view failed', S.view, e);
      S.highlight = null;
      main.innerHTML = '';
      const v = h(`<section class="view"><div class="empty"><div class="ei">${I.alert}</div><h2>Something went wrong showing this page</h2><p class="err"></p><p><button class="btn" data-back>${I.film}Back to clips</button></p></div></section>`);
      $('.err', v).textContent = String(e && e.message || e);
      $('[data-back]', v).onclick = () => { S.view = 'library'; S.filter = 'all'; S.q = ''; renderView(); };
      main.appendChild(v);
    }
  }

  const upTiming = new Map();
  const stageLabel = j => ({ preparing: 'Preparing', rendering: `Rendering${j.presetLabel ? ` · ${j.presetLabel}` : ''} ${Math.round((j.progress || 0) * 100)}%`, uploading: `Uploading ${Math.round((j.progress || 0) * 100)}%`, publishing: 'Publishing', server: 'Rendering on the server' })[j.stage] || 'Working';
  function progressEl(id, compact = false) {
    const el = h(`<div class="up ${compact ? 'compact' : ''}" data-up="${id}"><div class="up-top"><span class="up-lbl"><span></span></span><span class="up-ico"></span></div><div class="up-bar"><i></i></div></div>`);
    setProgress(el, S.uploads.get(id) || { stage: 'preparing', progress: 0 });
    return el;
  }
  function setProgress(el, job) {
    const lbl = $('.up-lbl span', el), bar = $('.up-bar i', el);
    const text = stageLabel(job);
    if (lbl.textContent !== text) {
      const stageChanged = lbl.dataset.stage !== job.stage;
      lbl.textContent = text; lbl.dataset.stage = job.stage;
      if (stageChanged) { lbl.classList.remove('swap'); void lbl.offsetWidth; lbl.classList.add('swap'); }
    }
    const det = job.stage === 'uploading' || job.stage === 'rendering';
    el.classList.toggle('ind', !det);
    el.classList.toggle('rendering', job.stage === 'rendering');
    if (!det) { bar.style.transition = ''; bar.style.width = job.stage === 'publishing' ? '100%' : '6%'; return; }
    if (job.stage === 'rendering') { clearTimeout(el._creep); bar.style.transition = 'width .3s ease-out'; bar.style.width = `${Math.max(3, (job.progress || 0) * 100)}%`; return; }
    const id = el.dataset.up, now = Date.now(), t = upTiming.get(id);
    const p = Math.max(0, Math.min(1, job.progress || 0));
    if (t && t.p !== p) t.dur = Math.min(30000, Math.max(800, now - t.at));
    upTiming.set(id, { at: now, p, dur: t?.dur || 3500 });
    bar.style.transition = 'width .45s cubic-bezier(.2,.8,.2,1)';
    bar.style.width = `${Math.max(4, p * 100)}%`;
    clearTimeout(el._creep);
    const chunks = Math.max(1, job.chunks || 1);
    if (p < 1 && !reduced()) {
      el._creep = setTimeout(() => {
        const next = Math.min(0.97, p + (1 / chunks) * 0.85);
        bar.style.transition = `width ${(upTiming.get(id)?.dur || 3500) / 1000}s linear`;
        bar.style.width = `${next * 100}%`;
      }, 480);
    }
  }
  async function finishProgress(el) {
    if (!el) return;
    clearTimeout(el._creep);
    const bar = $('.up-bar i', el);
    el.classList.remove('ind');
    bar.style.transition = 'width .25s ease-out'; bar.style.width = '100%';
    await wait(260);
    el.classList.add('done');
    $('.up-lbl span', el).textContent = 'Uploaded';
    $('.up-ico', el).innerHTML = I.checkCircle;
    await wait(560);
  }
  function failProgress(el, msg) {
    if (!el) return;
    clearTimeout(el._creep);
    el.classList.remove('ind', 'done');
    el.classList.add('failed');
    $('.up-lbl span', el).textContent = msg || 'Upload failed';
    $('.up-ico', el).innerHTML = I.alert;
  }

  // ── library ──
  function viewLibrary() {
    const v = h(`<section class="view"><div class="vh"><h1>Clips</h1><span class="sub"></span><div class="grow"></div>
      <div class="search">${I.search}<input class="field" placeholder="Search clips" value="${esc(S.q)}"></div>
      <button class="btn ghost" data-folder>${I.folder}Open folder</button></div><div class="hl-banner-slot"></div><div class="chips"></div><div class="groups"></div></section>`);
    $('.sub', v).textContent = S.clips.length ? `${S.clips.length} clip${S.clips.length === 1 ? '' : 's'} on this PC` : '';
    $('[data-folder]', v).onclick = () => G.openClipsDir();
    const inp = $('.search input', v);
    inp.oninput = () => { S.q = inp.value; fill(); };
    const hl = S.highlight && S.highlight.ids.filter(id => S.clips.some(c => c.id === id));
    if (hl && hl.length) {
      const b = h(`<div class="hl-banner"><div class="hb-i">${I.sparkles}</div><div class="hb-t"><b></b><span>Trim them, mute a track or share them - they're highlighted below.</span></div><button class="btn sm" data-edit>${I.scissors}Edit the latest</button><button class="btn ghost sm icon" data-x title="Dismiss">${I.x}</button></div>`);
      $('b', b).textContent = S.highlight.single ? 'Your upload is highlighted below' : `${hl.length} new clip${hl.length === 1 ? '' : 's'} from ${S.highlight.game || 'your game'}`;
      if (S.highlight.single) { $('.hb-t span', b).textContent = 'Click it any time to trim, re-share or change who can see it.'; $('[data-edit]', b).remove(); }
      else $('[data-edit]', b).onclick = () => { const id = hl[hl.length - 1]; go('editor', id); };
      $('[data-x]', b).onclick = () => { S.highlight = null; G.highlightSeen(); b.classList.add('out'); setTimeout(() => renderView(), 180); };
      $('.hl-banner-slot', v).appendChild(b);
    }
    const games = new Map();
    for (const c of S.clips) { const k = c.game?.key || 'desktop'; const g = games.get(k) || { key: k, name: c.game?.name || 'Desktop', icon: c.game?.icon || '', n: 0 }; g.n++; games.set(k, g); }
    const chips = $('.chips', v);
    if (games.size > 1) {
      const all = h(`<button class="chip ${S.filter === 'all' ? 'on' : ''}">All games <em>${S.clips.length}</em></button>`);
      all.onclick = () => { S.filter = 'all'; renderView(); };
      chips.appendChild(all);
      for (const g of games.values()) {
        const c = h(`<button class="chip ${S.filter === g.key ? 'on' : ''}">${g.icon ? `<img src="${esc(g.icon)}" alt="">` : ''}${esc(g.name)} <em>${g.n}</em></button>`);
        c.onclick = () => { S.filter = S.filter === g.key ? 'all' : g.key; renderView(); };
        chips.appendChild(c);
      }
    }
    const fill = () => {
      const box = $('.groups', v);
      box.innerHTML = '';
      if (!S.clips.length) {
        box.appendChild(h(`<div class="empty"><div class="ei">${I.aperture}</div><h2>No clips yet</h2><p>Start a game - Glint quietly keeps the last ${S.settings?.clipLength || 30} seconds.</p><p>Press <span class="kbd">${esc(S.settings?.hotkey || 'Alt+C')}</span> when something great happens.</p></div>`));
        return;
      }
      const q = S.q.trim().toLowerCase();
      const list = S.clips.filter(c => (S.filter === 'all' || (c.game?.key || 'desktop') === S.filter) && (!q || `${c.title} ${c.game?.name}`.toLowerCase().includes(q)));
      if (!list.length) { box.appendChild(h(`<div class="empty"><div class="ei">${I.search}</div><h2>Nothing matches</h2><p>Try another search.</p></div>`)); return; }
      const byGame = new Map();
      for (const c of list) { const k = c.game?.key || 'desktop'; if (!byGame.has(k)) byGame.set(k, []); byGame.get(k).push(c); }
      let i = 0;
      for (const [, clips] of byGame) {
        const g = clips[0].game || {};
        const sec = h(`<div class="group"><div class="group-h"><div class="gicon">${g.icon ? `<img src="${esc(g.icon)}" alt="">` : I.gamepad}</div><h2>${esc(g.name || 'Desktop')}</h2><span>${clips.length}</span></div><div class="grid"></div></div>`);
        for (const c of clips) $('.grid', sec).appendChild(card(c, i++, hl && hl.includes(c.id)));
        box.appendChild(sec);
      }
    };
    fill();
    return v;
  }
  function card(c, i, highlighted) {
    const len = c.trim ? c.trim.out - c.trim.in : c.duration;
    const up = c.upload;
    const el = h(`<button class="card ${highlighted ? 'hl' : ''}" data-card="${c.id}" style="--i:${Math.min(i, 14)}"><div class="thumb">${c.hasThumb ? `<img src="glint-media://thumb/${c.id}?v=${c.thumbV || 0}" alt="" loading="lazy">` : `<div class="none">${I.film}</div>`}
      ${c.missing ? `<span class="badge miss">${I.alert}File missing</span>` : up ? `<span class="badge up ${up.visibility === 'draft' ? 'draft' : ''}">${I[VIS[up.visibility]?.[0] || 'cloud']}${up.status === 'rendering' ? 'Rendering' : VIS[up.visibility]?.[1] || 'Uploaded'}</span>` : ''}
      ${c.trim || c.crop ? `<span class="badge trim">${c.trim ? `${I.scissors}Trimmed` : ''}${c.trim && c.crop ? ' · ' : ''}${c.crop ? `${I.crop}Cropped` : ''}</span>` : ''}<span class="badge dur">${fmtShort(len)}</span><div class="card-up-slot"></div></div>
      <div class="card-b"><div class="card-t"></div><div class="card-s">${esc(fmtDate(c.createdAt))}${(c.audioTracks || []).length > 1 ? ` · ${c.audioTracks.length} tracks` : ''}</div></div></button>`);
    $('.card-t', el).textContent = c.title;
    if (S.uploads.has(c.id)) $('.card-up-slot', el).appendChild(progressEl(c.id, true));
    el.onclick = () => {
      if (S.uploads.has(c.id)) return openUV(c.id, 'progress');
      if (S.autoDone.has(c.id) && c.upload && c.upload.visibility !== 'draft') return openUV(c.id, 'share');
      go('editor', c.id);
    };
    return el;
  }

  let ed = null;
  function stopEditor() {
    if (!ed) return;
    try { ed.crop?.stop(); } catch {  }
    cancelAnimationFrame(ed.raf);
    document.removeEventListener('keydown', ed.key);
    for (const a of ed.audios || []) { try { a.el.pause(); a.el.removeAttribute('src'); a.el.load(); } catch {  } }
    try { ed.video.pause(); ed.video.removeAttribute('src'); ed.video.load(); } catch {  }
    ed = null;
  }
  function viewEditor() {
    const c = S.clips.find(x => x.id === S.clipId);
    if (!c) { setTimeout(() => go('library'), 0); return h('<div></div>'); }
    const v = h(`<section class="ed">
      <div class="ed-top"><button class="btn ghost icon" data-back title="Back to clips">${I.back}</button><input class="field title-in" maxlength="100"><button class="btn ghost sm" data-reveal>${I.folder}Show in folder</button></div>
      <div class="ed-l">
        <div class="player paused"><video preload="auto"></video><div class="big">${I.play}</div></div>
        <div class="ctrl"><button class="btn icon" data-play>${I.play}</button><div class="time"><b data-cur>0:00.0</b> / <span data-dur>0:00.0</span></div><div class="grow"></div>
          <div class="vol" title="Preview volume">${I.volume}<input type="range" min="0" max="1" step="0.01" value="${localStorage.getItem('glint.vol') || '0.8'}"></div></div>
        <div class="tl"><div class="tl-strip"></div><div class="tl-shade l"></div><div class="tl-shade r"></div><div class="tl-sel"></div><div class="tl-h in" title="Start"></div><div class="tl-h out" title="End"></div><div class="tl-head"></div></div>
        <div class="tl-scale"><span>0:00</span><span data-mid></span><span data-end></span></div>
        <div class="trim-bar">
          <button class="btn ghost sm" data-in>${I.scissors}Start here <span class="kbd">I</span></button>
          <button class="btn ghost sm" data-out>${I.scissors}End here <span class="kbd">O</span></button>
          <button class="btn ghost sm" data-reset>${I.undo}Untrim</button>
          <button class="btn ghost sm" data-crop>${I.crop}Crop</button>
          <span class="tlen">Clip length <b data-len></b></span>
        </div>
        <div class="panel tracks-panel"><div class="panel-h">${I.headphones}Audio tracks<span class="ph-note">mute, solo and volume - saved, never changes the file</span></div><div class="tracks"></div></div>
      </div>
      <div class="ed-r"></div></section>`);
    const video = $('video', v);
    ed = { clip: c, video, trim: c.trim ? { ...c.trim } : { in: 0, out: c.duration }, raf: 0, audios: [], solo: null };
    const mine = ed;
    const title = $('.title-in', v);
    title.value = c.title;
    title.onchange = async () => { const t = title.value.trim(); if (!t) { title.value = c.title; return; } await G.library.update(c.id, { title: t }); c.title = t; };
    title.onkeydown = e => { if (e.key === 'Enter') title.blur(); };
    $('[data-back]', v).onclick = () => go('library');
    $('[data-reveal]', v).onclick = () => G.library.reveal(c.id);

    const player = $('.player', v), playBtn = $('[data-play]', v);
    const vol = $('.vol input', v);
    setRange(vol);
    const master = () => Number(vol.value);
    video.volume = master();
    vol.oninput = () => { setRange(vol); video.volume = master(); applyTrackVolumes(); try { localStorage.setItem('glint.vol', vol.value); } catch {  } };
    if (!c.missing) video.src = `glint-media://clip/${c.id}`;
    const dur = () => (Number.isFinite(video.duration) && video.duration > 0 ? video.duration : c.duration) || 1;

    const tracksList = (c.audioTracks || []).map(t => ({ ...t }));
    function applyTrackVolumes() {
      for (const a of ed?.audios || []) {
        const t = tracksList.find(x => x.index === a.index);
        const audible = t && (ed.solo != null ? ed.solo === t.index : t.enabled);
        a.el.volume = audible ? Math.min(1, t.volume * master()) : 0;
      }
    }
    const syncAudio = force => {
      for (const a of ed?.audios || []) {
        if (force || Math.abs(a.el.currentTime - video.currentTime) > 0.06) { try { a.el.currentTime = video.currentTime; } catch {  } }
        if (!video.paused && a.el.paused) a.el.play().catch(() => {});
        if (video.paused && !a.el.paused) a.el.pause();
      }
    };
    G.library.tracks(c.id).then(idx => {
      if (ed !== mine || !Array.isArray(idx) || !idx.length) return;
      ed.audios = idx.map(k => { const el = new Audio(`glint-media://track/${c.id}/${k}`); el.preload = 'auto'; return { index: k, el }; });
      video.muted = true;
      applyTrackVolumes();
      syncAudio(true);
    });
    const saveTracks = () => {
      clearTimeout(ed.trackT);
      ed.trackT = setTimeout(async () => { const r = await G.library.update(c.id, { audioTracks: tracksList }); if (r) c.audioTracks = r.audioTracks; }, 300);
    };
    const tbox = $('.tracks', v);
    if (!tracksList.length) tbox.appendChild(h(`<p class="muted" style="margin:12px 14px">This clip has no audio.</p>`));
    tracksList.forEach((t, i) => {
      const row = h(`<div class="trk" style="--i:${i}"><div class="trk-i ${APP_ICONS[t.kind] || (t.kind === 'game' && c.game?.icon) || (t.kind === 'app' && t.appId) ? 'img' : ''}">${trackIcon(t, c)}</div><div class="trk-n"><b></b><span>${esc(t.kind === 'desktop' && t.label !== 'Audio' ? 'Everything on the PC' : t.kind === 'game' ? 'The game only' : t.kind === 'mic' ? 'Your voice' : t.kind === 'app' ? (t.app?.exe || 'App audio') : t.label === 'Audio' ? 'Mixed audio' : 'Voice chat')}</span></div>
        <button class="tbtn2 m" title="Mute">M</button><button class="tbtn2 s" title="Solo (preview only)">S</button>
        <div class="trk-v"><input type="range" min="0" max="2" step="0.05"><span></span></div></div>`);
      $('.trk-n b', row).textContent = t.label;
      const m = $('.m', row), so = $('.s', row), r = $('input', row), pct = $('.trk-v span', row);
      const paint = () => {
        m.classList.toggle('on', !t.enabled); so.classList.toggle('on', ed?.solo === t.index);
        row.classList.toggle('muted', !t.enabled || (ed?.solo != null && ed.solo !== t.index));
        r.value = t.volume; setRange(r); pct.textContent = `${Math.round(t.volume * 100)}%`;
      };
      m.onclick = () => { t.enabled = !t.enabled; paintAll(); applyTrackVolumes(); saveTracks(); };
      so.onclick = () => { ed.solo = ed.solo === t.index ? null : t.index; paintAll(); applyTrackVolumes(); };
      r.oninput = () => { t.volume = Number(r.value); paint(); applyTrackVolumes(); };
      r.onchange = saveTracks;
      row._paint = paint;
      tbox.appendChild(row);
    });
    const paintAll = () => $$('.trk', tbox).forEach(r => r._paint());
    paintAll();

    const toggle = () => {
      if (video.paused) { if (video.currentTime >= ed.trim.out - 0.05 || video.currentTime < ed.trim.in) video.currentTime = ed.trim.in; video.play().catch(() => {}); }
      else video.pause();
    };
    playBtn.onclick = toggle;
    player.onclick = toggle;
    video.onplay = () => { player.classList.remove('paused'); playBtn.innerHTML = I.pause; syncAudio(true); };
    video.onpause = () => { player.classList.add('paused'); playBtn.innerHTML = I.play; syncAudio(false); };
    video.onseeked = () => syncAudio(true);
    video.onloadedmetadata = () => { if (ed.trim.out > dur() || !ed.trim.out) ed.trim.out = dur(); video.currentTime = ed.trim.in; draw(); };

    const tl = $('.tl', v), hin = $('.tl-h.in', v), hout = $('.tl-h.out', v), head = $('.tl-head', v), sel = $('.tl-sel', v), shL = $('.tl-shade.l', v), shR = $('.tl-shade.r', v);
    const pct = t => `${(t / dur()) * 100}%`;
    function draw() {
      const d = dur();
      hin.style.left = pct(ed.trim.in); hout.style.left = pct(ed.trim.out);
      sel.style.left = pct(ed.trim.in); sel.style.width = `${((ed.trim.out - ed.trim.in) / d) * 100}%`;
      shL.style.left = '0'; shL.style.width = pct(ed.trim.in);
      shR.style.left = pct(ed.trim.out); shR.style.right = '0';
      head.style.left = pct(video.currentTime || 0);
      $('[data-cur]', v).textContent = fmt(video.currentTime || 0);
      $('[data-dur]', v).textContent = fmt(d);
      $('[data-len]', v).textContent = fmt(ed.trim.out - ed.trim.in);
      $('[data-mid]', v).textContent = fmtShort(d / 2);
      $('[data-end]', v).textContent = fmtShort(d);
      $('[data-reset]', v).disabled = ed.trim.in <= 0.05 && ed.trim.out >= d - 0.05;
    }
    let lastSync = 0;
    const tick = () => {
      if (ed !== mine) return;
      if (!video.paused && video.currentTime >= ed.trim.out) { video.pause(); video.currentTime = ed.trim.out; }
      if (!video.paused && performance.now() - lastSync > 250) { lastSync = performance.now(); syncAudio(false); }
      draw();
      ed.raf = requestAnimationFrame(tick);
    };
    ed.raf = requestAnimationFrame(tick);
    const timeAt = x => { const r = tl.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)) * dur(); };
    const saveTrim = () => {
      clearTimeout(ed.saveT);
      const clip = ed.clip, t = { ...ed.trim };
      ed.saveT = setTimeout(async () => { const r = await G.library.update(clip.id, { trim: t }); if (r) clip.trim = r.trim; }, 350);
    };
    const drag = which => e => {
      e.preventDefault(); e.stopPropagation();
      const hEl = which === 'in' ? hin : hout;
      hEl.classList.add('drag'); tl.classList.add('dragging');
      const move = ev => {
        const t = timeAt(ev.clientX);
        if (which === 'in') ed.trim.in = Math.min(t, ed.trim.out - 0.5);
        else ed.trim.out = Math.max(t, ed.trim.in + 0.5);
        ed.trim.in = Math.max(0, ed.trim.in); ed.trim.out = Math.min(dur(), ed.trim.out);
        video.currentTime = which === 'in' ? ed.trim.in : ed.trim.out;
        draw();
      };
      const up = () => { hEl.classList.remove('drag'); tl.classList.remove('dragging'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); saveTrim(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    hin.onpointerdown = drag('in');
    hout.onpointerdown = drag('out');
    tl.onpointerdown = e => {
      video.currentTime = Math.max(ed.trim.in, Math.min(ed.trim.out, timeAt(e.clientX)));
      const move = ev => { video.currentTime = Math.max(ed.trim.in, Math.min(ed.trim.out, timeAt(ev.clientX))); };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    const bump = el => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };
    const setIn = () => { ed.trim.in = Math.max(0, Math.min(video.currentTime, ed.trim.out - 0.5)); draw(); saveTrim(); bump(hin); };
    const setOut = () => { ed.trim.out = Math.min(dur(), Math.max(video.currentTime, ed.trim.in + 0.5)); draw(); saveTrim(); bump(hout); };
    $('[data-in]', v).onclick = setIn;
    $('[data-out]', v).onclick = setOut;
    $('[data-reset]', v).onclick = () => { ed.trim = { in: 0, out: dur() }; draw(); saveTrim(); bump(hin); bump(hout); };
    ed.key = e => {
      if (e.target.closest('input, textarea, select') || $('#modal').hidden === false) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'i' || e.key === 'I') setIn();
      else if (e.key === 'o' || e.key === 'O') setOut();
      else if (e.key === 'ArrowLeft') video.currentTime = Math.max(0, video.currentTime - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === 'ArrowRight') video.currentTime = Math.min(dur(), video.currentTime + (e.shiftKey ? 1 : 1 / 30));
    };
    document.addEventListener('keydown', ed.key);
    G.library.strip(c.id).then(ok => { if (ok && ed === mine) { const s = $('.tl-strip', v); s.style.backgroundImage = `url("glint-media://strip/${c.id}")`; s.classList.add('in'); } });
    draw();
    ed.crop = setupCrop(v, c, video, player);
    renderSidePanel($('.ed-r', v), c);
    return v;
  }

  function renderSidePanel(box, c, fresh = false) {
    box.innerHTML = '';
    const size = c.width ? `${c.width} x ${c.height}` : '-';
    const info = h(`<div class="panel"><div class="panel-h">${I.info}Details</div><div class="panel-b"><dl class="kv">
      <dt>Game</dt><dd></dd><dt>Recorded</dt><dd>${esc(fmtDate(c.createdAt))}</dd><dt>Length</dt><dd>${fmtShort(c.duration)}</dd><dt>Video</dt><dd>${esc(size)}</dd>
      <dt>Audio</dt><dd>${(c.audioTracks || []).length} track${(c.audioTracks || []).length === 1 ? '' : 's'}</dd>
      <dt>File</dt><dd class="path" title="Show in folder"></dd></dl>${c.missing ? `<div class="note warn" style="margin-top:12px">${I.alert}<span>The video file was moved or deleted outside Glint.</span></div>` : ''}</div></div>`);
    $$('dd', info)[0].textContent = c.game?.name || 'Desktop';
    const p = $('.path', info); p.textContent = c.file; p.onclick = () => G.library.reveal(c.id);
    box.appendChild(info);

    const ex = h(`<div class="panel"><div class="panel-h">${I.download}Export</div><div class="panel-b"><div class="row"><button class="btn ghost" data-mp4>${I.video}MP4</button><button class="btn ghost" data-mp3>${I.music}MP3</button></div>
      <p class="muted" style="margin:10px 0 0">Uses your trim and crop and mixes the tracks that are on (MP3: trim + tracks). The original clip stays untouched.</p></div></div>`);
    const doExport = kind => async e => {
      const b = e.currentTarget; const old = b.innerHTML; b.disabled = true; b.classList.add('busy'); b.innerHTML = `${I.refresh}Exporting...`;
      const r = await G.exportClip(c.id, kind);
      b.disabled = false; b.classList.remove('busy'); b.innerHTML = old;
      if (r?.ok) snack(`Exported ${kind.toUpperCase()}.`); else if (r?.error) snack(r.error, 'err');
    };
    $('[data-mp4]', ex).onclick = doExport('mp4');
    $('[data-mp3]', ex).onclick = doExport('mp3');
    if (c.missing) $$('button', ex).forEach(b => { b.disabled = true; });
    box.appendChild(ex);

    box.appendChild(sharePanel(c, fresh));

    const del = h(`<div class="panel"><div class="panel-b"><button class="btn danger full">${I.trash}Delete clip</button></div></div>`);
    $('button', del).onclick = async () => {
      const body = h(`<div><p>Remove "<b></b>" from your library?</p><label class="check"><input type="checkbox" checked> Also delete the video file from this PC</label>${c.upload ? '<p style="margin-top:12px">The upload on Glint stays - delete it from the Share panel first if you want it gone too.</p>' : ''}</div>`);
      $('b', body).textContent = c.title;
      const ok = await modal({ title: 'Delete clip', body, actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Delete', kind: 'danger', icon: 'trash', value: true }] });
      if (!ok) return;
      await G.library.remove(c.id, $('input', body).checked);
      snack('Clip deleted.');
      go('library');
    };
    box.appendChild(del);
  }

  function visSeg(cur, allowDraft, onPick) {
    const el = h(`<div class="seg vis"></div>`);
    for (const v of allowDraft ? ['draft', 'unlisted', 'public'] : ['unlisted', 'public']) {
      const b = h(`<button data-v="${v}">${I[VIS[v][0]]}${VIS[v][1]}</button>`);
      b.classList.toggle('on', v === cur);
      b.onclick = () => { $$('button', el).forEach(x => x.classList.toggle('on', x === b)); onPick(v); };
      el.appendChild(b);
    }
    return el;
  }
  const visHint = v => ({ draft: 'Only you can see it. Uploads the tracks that are on, so you can keep editing it here or on the web, then publish.', unlisted: 'Anyone with the link can watch it, and they can pass the link on.', public: 'Listed on clips.nookara.cc and your profile.' })[v];
  const isVoiceTrack = t => !!t && (t.kind !== 'game' || t.label === 'System audio');
  function sharePanel(c, fresh = false) {
    const el = h(`<div class="panel share-panel ${fresh ? 'fresh' : ''}"><div class="panel-h">${I.globe}Share on Glint</div><div class="panel-b stack"></div></div>`);
    const b = $('.panel-b', el);
    const job = S.uploads.get(c.id);
    if (!S.account.signedIn) {
      b.appendChild(h(`<p class="muted" style="margin:0">Upload clips to your Nookara account and get a link at clips.nookara.cc.</p>`));
      const btn = h(`<button class="btn full">${I.logIn}Sign in with Nookara</button>`); btn.onclick = signIn; b.appendChild(btn);
      return el;
    }
    if (job) {
      b.appendChild(progressEl(c.id));
      if (!job.auto) { const cancel = h(`<button class="btn ghost full">${I.x}Cancel</button>`); cancel.onclick = () => G.upload.cancel(c.id); b.appendChild(cancel); }
      else b.appendChild(h(`<p class="muted" style="margin:0">Auto-uploading in the background.</p>`));
      return el;
    }
    const failed = S.failed.get(c.id);
    if (failed && !c.upload) {
      const p = progressEl(c.id); failProgress(p, failed.error); b.appendChild(p);
      const retry = h(`<button class="btn full">${I.refresh}Try again</button>`);
      retry.onclick = () => { S.failed.delete(c.id); startUpload(c, failed.opts || { visibility: S.settings.autoUploadVisibility, title: c.title, voiceOff: true }); };
      b.appendChild(retry);
      const dismiss = h(`<button class="btn ghost full">Dismiss</button>`); dismiss.onclick = () => { S.failed.delete(c.id); renderSidePanelAgain(c); };
      b.appendChild(dismiss);
      return el;
    }
    if (c.upload) {
      const u = c.upload;
      const draft = u.visibility === 'draft';
      if (fresh) b.appendChild(h(`<div class="up-done">${I.checkCircle}<span>${draft ? 'Draft uploaded' : 'Uploaded'}</span></div>`));
      const link = h(`<div class="slide"><div class="lbl">${draft ? 'Draft link (only you)' : 'Share link'}</div><div class="share"><input class="field" readonly><button class="btn icon" title="Copy link">${I.copy}</button></div></div>`);
      $('input', link).value = u.url;
      $('button', link).onclick = () => { navigator.clipboard.writeText(u.url).then(() => snack('Link copied.')); };
      b.appendChild(link);
      if (draft) {
        if (u.status === 'rendering') {
          b.appendChild(h(`<div class="slide"><div class="up ind"><div class="up-top"><span class="up-lbl"><span>Rendering on the server</span></span><span class="up-ico"></span></div><div class="up-bar"><i style="width:100%"></i></div></div></div>`));
        } else {
          let pv = 'public';
          const pub = h(`<div class="slide"><div class="lbl">Publish as</div></div>`);
          pub.appendChild(visSeg('public', false, v => { pv = v; }));
          b.appendChild(pub);
          b.appendChild(h(`<p class="muted slide" style="margin:0">You can keep editing right here - trim and tracks sync to the draft. Publishing renders it on this PC and replaces the draft.</p>`));
          const row = h(`<div class="row slide"><button class="btn ghost">${I.pencil}Edit on web</button><button class="btn">${I.send}Publish</button></div>`);
          const [edit, go2] = $$('button', row);
          edit.onclick = () => G.openExternal(`https://clips.nookara.cc/c/${u.id}`);
          go2.onclick = () => publishFlow(c, { visibility: pv, title: c.title, publish: true });
          b.appendChild(row);
          if (u.status === 'failed') b.appendChild(h(`<div class="note warn slide">${I.alert}<span>The last publish didn't go through - try again (it renders on this PC).</span></div>`));
        }
      } else {
        const vis = h(`<div class="slide"><div class="lbl">Who can see it</div></div>`);
        vis.appendChild(visSeg(u.visibility, false, async v => {
          if (v === u.visibility) return;
          const r = await G.upload.patch(c.id, { visibility: v });
          if (r?.ok) { c.upload = r.clip.upload; snack(v === 'public' ? 'Now public.' : 'Now unlisted - only people with the link can see it.'); renderSidePanelAgain(c); } else snack(r?.error || 'Could not change that.', 'err');
        }));
        b.appendChild(vis);
        const tt = h(`<div class="slide"><div class="lbl">Title on Glint</div><div class="row" style="margin:0"><input class="field" maxlength="100" style="flex:1"><button class="btn ghost sm" style="flex:none">Save</button></div></div>`);
        $('input', tt).value = u.title || c.title;
        $('button', tt).onclick = async () => {
          const r = await G.upload.patch(c.id, { title: $('input', tt).value });
          if (r?.ok) { c.upload = r.clip.upload; snack('Title saved.'); } else snack(r?.error || 'Could not save.', 'err');
        };
        b.appendChild(tt);
        const row2 = h(`<div class="row slide"><button class="btn ghost">${I.external}Open on Glint</button><button class="btn">${I.link}Share</button></div>`);
        const [open, share] = $$('button', row2);
        open.onclick = () => G.openExternal(u.url);
        share.onclick = () => openUV(c.id, 'share');
        b.appendChild(row2);
      }
      const del = h(`<button class="btn danger full slide">${I.trash}Delete upload</button>`);
      del.onclick = async () => {
        const ok = await modal({ title: 'Delete the upload?', body: '<p>The clip is removed from Glint and its video is deleted from your Nookara uploads. The clip on this PC stays.</p>', actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Delete upload', kind: 'danger', value: true }] });
        if (!ok) return;
        const r = await G.upload.remove(c.id);
        if (r?.ok) { c.upload = null; snack('Upload deleted.'); renderSidePanelAgain(c); } else snack(r?.error || 'Could not delete it.', 'err');
      };
      b.appendChild(del);
      return el;
    }
    if (c.uploadGone) b.appendChild(h(`<div class="note warn">${I.cloudOff}<span>This clip was removed from Nookara, so it's no longer uploaded.</span></div>`));
    let visibility = ['public', 'unlisted', 'draft'].includes(localStorage.getItem('glint.visibility')) ? localStorage.getItem('glint.visibility') : 'public';
    let preset = S.settings.uploadPreset || 'balanced';
    let custom = { ...(S.settings.uploadCustom || {}) };
    const form = h(`<div class="stack"><div><div class="lbl">Title</div><input class="field full" maxlength="100"></div><div class="review-slot"></div><div class="vis-slot"><div class="lbl">Upload as</div></div><p class="muted vis-hint" style="margin:0"></p>
      <div class="preset-slot"><div class="lbl">Compression</div></div><div class="est"><span class="est-size"></span><span class="est-save"></span></div><div class="storage-slot"></div>
      <button class="btn full" data-go>${I.cloudUpload}<span></span></button></div>`);
    $('input', form).value = c.title;
    const goBtn = $('[data-go]', form);
    let lastEst = null, space = null;
    const refreshEst = async () => {
      const e = await G.upload.estimate(c.id, { preset, custom, draft: visibility === 'draft' });
      lastEst = e;
      const sz = $('.est-size', form), sv = $('.est-save', form);
      if (!e) { sz.textContent = ''; sv.textContent = ''; return; }
      sz.textContent = `About ${fmtBytes(e.bytes)}${e.plan && !e.plan.original ? ` · ${e.plan.height}p${e.plan.fps}` : ''}`;
      sv.textContent = e.saves > 1e6 ? `saves ~${fmtBytes(e.saves)} vs original` : '';
      sz.classList.remove('swap'); void sz.offsetWidth; sz.classList.add('swap');
      paintSpace();
    };
    const paintSpace = () => {
      const box = $('.storage-slot', form);
      box.innerHTML = '';
      if (space) box.appendChild(storageLine(space, lastEst?.bytes));
    };
    const paint = () => {
      $('.vis-hint', form).textContent = visHint(visibility);
      $('span', goBtn).textContent = visibility === 'draft' ? 'Upload draft' : `Upload${c.trim ? ' trimmed clip' : ''}`;
    };
    const reviewTracks = (c.audioTracks || []).filter(t => t && Number.isInteger(t.index));
    const hasVoice = reviewTracks.some(isVoiceTrack);
    const trackStates = {};
    let preview = null;
    const stopPreview = () => { if (preview) { preview.el.pause(); preview.btn.innerHTML = I.play; preview = null; } };
    if (hasVoice) {
      const box = $('.review-slot', form);
      box.appendChild(h('<div class="lbl">Audio on this upload</div>'));
      for (const t of reviewTracks) {
        const voice = isVoiceTrack(t);
        trackStates[t.index] = voice ? false : t.enabled !== false;
        const row = h(`<div class="review-trk"><button class="btn ghost sm icon" title="Listen">${I.play}</button><div class="review-n"><b></b>${voice ? "<span>This track may have other people's voices</span>" : ''}</div><button class="toggle ${trackStates[t.index] ? 'on' : ''}"></button></div>`);
        $('b', row).textContent = t.label;
        const listen = $('button', row), sw = $('.toggle', row);
        sw.onclick = () => { trackStates[t.index] = !trackStates[t.index]; sw.classList.toggle('on', trackStates[t.index]); };
        listen.onclick = async () => {
          if (preview?.index === t.index) return stopPreview();
          stopPreview();
          await G.library.tracks(c.id);
          const el = new Audio(`glint-media://track/${c.id}/${t.index}`);
          el.currentTime = c.trim?.in || 0;
          preview = { index: t.index, el, btn: listen };
          listen.innerHTML = I.pause;
          el.onended = stopPreview;
          el.ontimeupdate = () => { if (!form.isConnected || (c.trim && el.currentTime >= c.trim.out)) stopPreview(); };
          el.play().catch(stopPreview);
        };
        box.appendChild(row);
      }
      box.appendChild(h('<p class="muted" style="margin:6px 0 0">Tracks you leave off aren\'t uploaded. On a draft they\'re left out of the file, so turning one on later means uploading again.</p>'));
    }
    $('.vis-slot', form).appendChild(visSeg(visibility, true, v => { visibility = v; try { localStorage.setItem('glint.visibility', v); } catch {  } paint(); refreshEst(); }));
    $('.preset-slot', form).appendChild(presetPicker(preset, custom, (p, cu) => { preset = p; custom = cu; refreshEst(); }));
    paint();
    refreshEst();
    G.storageUsage().then(u => { space = u; paintSpace(); });
    goBtn.disabled = !!c.missing;
    goBtn.onclick = async () => {
      if (space && Number.isFinite(space.remaining) && lastEst && lastEst.bytes > space.remaining) {
        const ok = await modal({ title: 'Not enough Nookara space', body: `<p>This upload is about <b>${fmtBytes(lastEst.bytes)}</b>, but your account only has <b>${fmtBytes(space.remaining)}</b> left.</p><p>Pick a smaller compression preset, trim the clip, or delete some uploads on Nookara first.</p>`, actions: [{ label: 'Change it', kind: 'ghost', value: false }, { label: 'Try anyway', kind: 'danger', value: true }] });
        if (!ok) return;
      }
      stopPreview();
      startUpload(c, { title: $('input', form).value, visibility, preset, custom, ...(hasVoice ? { trackStates } : {}) });
    };
    b.appendChild(form);
    return el;
  }
  async function startUpload(c, opts) {
    S.uploads.set(c.id, { stage: 'preparing', progress: 0, chunks: 1, visibility: opts.visibility, title: opts.title, kind: 'upload' });
    UV.opts = opts; UV.samples = [];
    openUV(c.id, 'progress');
    renderSidePanelAgain(c);
    const r = await G.upload.start(c.id, opts);
    await afterJob(c.id, r, opts, false);
  }
  const CROP_MIN = 64;
  const evenDown = n => Math.max(0, Math.floor(n / 2) * 2);
  function cropPreset(aspect, W, H) {
    if (!aspect) return { x: 0, y: 0, w: evenDown(W), h: evenDown(H) };
    let w = W, hh = W / aspect;
    if (hh > H) { hh = H; w = H * aspect; }
    w = evenDown(w); hh = evenDown(hh);
    return { x: evenDown((W - w) / 2), y: evenDown((H - hh) / 2), w, h: hh };
  }
  function cropFit(r, aspect, W, H) {
    if (!aspect) return r;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    let w = r.w, hh = w / aspect;
    if (hh > r.h) { hh = r.h; w = hh * aspect; }
    if (w > W) { w = W; hh = w / aspect; }
    if (hh > H) { hh = H; w = hh * aspect; }
    if (w < CROP_MIN || hh < CROP_MIN) { const k = Math.max(CROP_MIN / w, CROP_MIN / hh); w *= k; hh *= k; }
    w = evenDown(w); hh = evenDown(hh);
    return { x: evenDown(Math.min(Math.max(0, cx - w / 2), W - w)), y: evenDown(Math.min(Math.max(0, cy - hh / 2), H - hh)), w, h: hh };
  }
  function cropClamp(r, W, H) {
    let w = Math.max(CROP_MIN, Math.min(evenDown(r.w), evenDown(W))), hh = Math.max(CROP_MIN, Math.min(evenDown(r.h), evenDown(H)));
    const x = evenDown(Math.min(Math.max(0, r.x), W - w)), y = evenDown(Math.min(Math.max(0, r.y), H - hh));
    return { x, y, w, h: hh };
  }
  function setupCrop(v, c, video, player) {
    const W = () => video.videoWidth || c.width || 1920, H = () => video.videoHeight || c.height || 1080;
    let crop = c.crop ? { ...c.crop } : null, editing = false, aspectKey = 'free';
    const layer = h(`<div class="crop-layer"><div class="crop-shade"></div><div class="crop-rect"><span class="crop-size"></span>${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(k => `<i class="ch ${k}" data-h="${k}"></i>`).join('')}</div></div>`);
    player.appendChild(layer);
    const rectEl = $('.crop-rect', layer), shade = $('.crop-shade', layer), sizeEl = $('.crop-size', layer);
    const bar = h(`<div class="crop-bar sub-rows"><div class="sub-in"><div class="crop-in">
      <div class="seg crop-asp"></div>
      <div class="crop-num">${['x', 'y', 'w', 'h'].map(k => `<label><span>${k.toUpperCase()}</span><input class="field" type="number" step="2" data-k="${k}"></label>`).join('')}</div>
      <button class="btn ghost sm" data-creset>${I.undo}Reset</button><button class="btn sm" data-cdone>${I.check}Done</button></div></div></div>`);
    $('.trim-bar', v).after(bar);
    const aspects = [['free', 'Free', null], ['16:9', '16:9', 16 / 9], ['9:16', '9:16', 9 / 16], ['1:1', '1:1', 1], ['4:3', '4:3', 4 / 3]];
    if (c.windowRect) aspects.push(['window', 'Game window', 'window']);
    const aspSeg = $('.crop-asp', bar);
    for (const [k, label, a] of aspects) {
      const b = h(`<button>${esc(label)}</button>`);
      b.onclick = () => {
        aspectKey = k;
        $$('button', aspSeg).forEach(x => x.classList.toggle('on', x === b));
        crop = a === 'window' ? { ...c.windowRect } : a ? cropPreset(a, W(), H()) : (crop || cropPreset(null, W(), H()));
        paint(); save();
      };
      b.classList.toggle('on', k === aspectKey);
      aspSeg.appendChild(b);
    }
    const aspect = () => { const a = aspects.find(x => x[0] === aspectKey)?.[2]; return typeof a === 'number' ? a : null; };
    const box = () => {
      const pr = player.getBoundingClientRect(), vw = W(), vh = H();
      const s = Math.min(pr.width / vw, pr.height / vh);
      return { left: (pr.width - vw * s) / 2, top: (pr.height - vh * s) / 2, s, pr };
    };
    function paint() {
      const full = !crop;
      layer.classList.toggle('editing', editing);
      layer.classList.toggle('has', !!crop || editing);
      const r = crop || { x: 0, y: 0, w: W(), h: H() };
      const b = box();
      const L = b.left + r.x * b.s, T = b.top + r.y * b.s, Wd = r.w * b.s, Hd = r.h * b.s;
      Object.assign(rectEl.style, { left: `${L}px`, top: `${T}px`, width: `${Wd}px`, height: `${Hd}px` });
      shade.style.clipPath = full && !editing ? 'none' : `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${L}px ${T}px, ${L + Wd}px ${T}px, ${L + Wd}px ${T + Hd}px, ${L}px ${T + Hd}px, ${L}px ${T}px)`;
      shade.hidden = full;
      sizeEl.textContent = `${r.w} x ${r.h}`;
      for (const inp of $$('[data-k]', bar)) if (document.activeElement !== inp) inp.value = r[inp.dataset.k];
      $('[data-creset]', bar).disabled = full;
    }
    let saveT = null;
    function save() {
      clearTimeout(saveT);
      saveT = setTimeout(async () => {
        const full = crop && crop.x === 0 && crop.y === 0 && crop.w >= evenDown(W()) && crop.h >= evenDown(H());
        const r = await G.library.update(c.id, { crop: full ? null : crop });
        if (r) { c.crop = r.crop; if (!r.crop) crop = null; paint(); }
      }, 300);
    }
    rectEl.onpointerdown = e => {
      if (!editing) return;
      e.preventDefault(); e.stopPropagation();
      const hdl = e.target.dataset.h || 'move';
      const start = { ...(crop || { x: 0, y: 0, w: W(), h: H() }) }, b = box(), x0 = e.clientX, y0 = e.clientY;
      rectEl.classList.add('drag');
      const move = ev => {
        const dx = (ev.clientX - x0) / b.s, dy = (ev.clientY - y0) / b.s;
        let r = { ...start };
        if (hdl === 'move') { r.x = start.x + dx; r.y = start.y + dy; }
        else {
          if (hdl.includes('w')) { r.x = Math.min(start.x + dx, start.x + start.w - CROP_MIN); r.w = start.w - (r.x - start.x); }
          if (hdl.includes('e')) r.w = start.w + dx;
          if (hdl.includes('n')) { r.y = Math.min(start.y + dy, start.y + start.h - CROP_MIN); r.h = start.h - (r.y - start.y); }
          if (hdl.includes('s')) r.h = start.h + dy;
          const a = aspect();
          if (a) { if (hdl === 'n' || hdl === 's') r.w = r.h * a; else r.h = r.w / a; if (hdl.includes('n')) r.y = start.y + start.h - r.h; if (hdl.includes('w')) r.x = start.x + start.w - r.w; }
        }
        crop = cropClamp(r, W(), H());
        if (aspect()) crop = cropFit(crop, aspect(), W(), H());
        paint();
      };
      const up = () => { rectEl.classList.remove('drag'); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); save(); };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    };
    for (const inp of $$('[data-k]', bar)) {
      inp.onchange = () => {
        const r = { ...(crop || { x: 0, y: 0, w: W(), h: H() }), [inp.dataset.k]: Number(inp.value) || 0 };
        crop = cropClamp(r, W(), H());
        if (aspect()) crop = cropFit(crop, aspect(), W(), H());
        paint(); save();
      };
    }
    $('[data-creset]', bar).onclick = () => { crop = null; aspectKey = 'free'; $$('button', aspSeg).forEach((x, i) => x.classList.toggle('on', i === 0)); paint(); save(); };
    const toggle = on => {
      editing = on;
      bar.classList.toggle('open', on);
      $('[data-crop]', v)?.classList.toggle('on', on);
      if (on && !crop) crop = cropPreset(null, W(), H());
      paint();
    };
    $('[data-cdone]', bar).onclick = () => { toggle(false); save(); };
    $('[data-crop]', v).onclick = () => toggle(!editing);
    video.addEventListener('loadedmetadata', paint);
    const ro = new ResizeObserver(() => paint());
    ro.observe(player);
    paint();
    return { stop: () => ro.disconnect(), isEditing: () => editing };
  }

  const PRESETS = [['original', 'Original'], ['high', 'High'], ['balanced', 'Balanced'], ['small', 'Small'], ['tiny', 'Tiny'], ['custom', 'Custom']];
  const PRESET_NOTE = { original: 'No re-encode unless the trim or the track mix needs one', high: 'Up to 1440p, ~12 Mbps', balanced: '1080p, ~6 Mbps - the sweet spot', small: '720p, ~3 Mbps', tiny: '720p 30 fps, ~1.2 Mbps', custom: 'Your own resolution, frame rate and quality' };
  function presetPicker(cur, custom, onChange) {
    const el = h(`<div class="preset"><div class="seg pr"></div><p class="muted pr-note"></p><div class="sub-rows ${cur === 'custom' ? 'open' : ''}"><div class="sub-in"><div class="pr-custom">
      <label><span>Max resolution</span><select class="field" data-k="maxH"><option value="0">Original</option><option value="1440">1440p</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></label>
      <label><span>Frame rate</span><select class="field" data-k="fps"><option value="60">Up to 60</option><option value="30">30</option></select></label>
      <label><span>Audio</span><select class="field" data-k="audioK"><option value="96">96 kbps</option><option value="128">128 kbps</option><option value="160">160 kbps</option><option value="192">192 kbps</option></select></label>
      <label class="wide"><span>Quality <b data-q></b></span><input type="range" min="0" max="100" data-k="quality"></label></div></div></div></div>`);
    let p = cur, cu = { maxH: 1080, fps: 60, quality: 60, audioK: 128, ...(custom || {}) };
    const seg = $('.pr', el), note = $('.pr-note', el), sub = $('.sub-rows', el);
    for (const [id, label] of PRESETS) {
      const b = h(`<button>${esc(label)}</button>`);
      b.classList.toggle('on', id === p);
      b.onclick = () => { p = id; $$('button', seg).forEach(x => x.classList.toggle('on', x === b)); note.textContent = PRESET_NOTE[id]; sub.classList.toggle('open', id === 'custom'); onChange(p, cu); };
      seg.appendChild(b);
    }
    note.textContent = PRESET_NOTE[p] || '';
    for (const inp of $$('[data-k]', el)) {
      const k = inp.dataset.k;
      inp.value = String(cu[k]);
      if (inp.type === 'range') { setRange(inp); $('[data-q]', el).textContent = `${cu.quality}`; }
      inp.oninput = () => { if (inp.type === 'range') { setRange(inp); $('[data-q]', el).textContent = inp.value; } };
      inp.onchange = () => { cu = { ...cu, [k]: Number(inp.value) }; onChange(p, cu); };
    }
    return el;
  }
  function storageLine(u, need) {
    if (u.needsSignIn) {
      const el = h(`<p class="muted store"><a class="link">Sign in again to see your storage</a></p>`);
      $('a', el).onclick = signIn;
      return el;
    }
    const pct = Math.min(100, (u.usage / Math.max(1, u.limit)) * 100);
    const over = need && need > u.remaining;
    const el = h(`<div class="store ${over ? 'over' : ''}"><div class="store-t"><span>Nookara space</span><span>${fmtBytes(u.usage)} of ${fmtBytes(u.limit)} · ${fmtBytes(u.remaining)} free</span></div><div class="store-bar"><i style="width:${pct}%"></i>${need ? `<em style="left:${pct}%;width:${Math.min(100 - pct, (need / Math.max(1, u.limit)) * 100)}%"></em>` : ''}</div>${over ? `<p class="err" style="margin:6px 0 0">Bigger than the space left - pick a smaller preset.</p>` : ''}</div>`);
    return el;
  }

  const UV = { id: null, mode: null, opts: null, samples: [] };
  const fmtBytes = b => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1e3))} KB`);
  const fmtEta = s => (s == null || !isFinite(s) ? '' : s < 60 ? `${Math.ceil(s)} s left` : `${Math.floor(s / 60)} min ${Math.ceil(s % 60)} s left`);
  function rateOf(samples, total) {
    if (samples.length < 2) return { bps: 0, eta: null };
    const last = samples[samples.length - 1], first = samples.find(x => last.t - x.t <= 8000) || samples[0];
    const dt = (last.t - first.t) / 1000, bps = dt > 0 ? Math.max(0, (last.sent - first.sent) / dt) : 0;
    return { bps, eta: bps > 0 ? Math.max(0, total - last.sent) / bps : null };
  }
  function uvRoot() {
    let el = $('#uv');
    if (!el) { el = h(`<div class="uv" id="uv" hidden></div>`); document.body.appendChild(el); }
    return el;
  }
  function uvMedia(c) {
    const trim = c.trim || { in: 0, out: c.duration };
    if (c.missing) return h(`<div class="uv-media">${c.hasThumb ? `<img src="glint-media://thumb/${c.id}" alt="">` : `<div class="none">${I.film}</div>`}</div>`);
    const m = h(`<div class="uv-media"><video muted playsinline preload="auto" ${c.hasThumb ? `poster="glint-media://thumb/${c.id}"` : ''}></video><span class="badge dur">${fmtShort(trim.out - trim.in)}</span></div>`);
    const v = $('video', m);
    v.src = `glint-media://clip/${c.id}`;
    v.onloadedmetadata = () => { v.currentTime = trim.in; v.play().catch(() => {}); };
    v.ontimeupdate = () => { if (v.currentTime >= trim.out - 0.05 || v.currentTime < trim.in - 0.5) v.currentTime = trim.in; };
    if (reduced()) v.onloadedmetadata = () => { v.currentTime = trim.in + Math.min(1.5, (trim.out - trim.in) / 3); };
    return m;
  }
  function uvHead(c, job) {
    const vis = job?.visibility || c.upload?.visibility || 'public';
    const head = h(`<div class="uv-head"><div class="uv-kick"></div><h2></h2><div class="uv-meta"><span class="gicon sm">${c.game?.icon ? `<img src="${esc(c.game.icon)}" alt="">` : I.gamepad}</span><span class="uv-game"></span><span class="tag acc">${I[VIS[vis]?.[0] || 'globe']}${VIS[vis]?.[1] || ''}</span>${(c.audioTracks || []).length ? `<span class="uv-tracks">${c.audioTracks.filter(t => t.enabled).map(t => `<span class="ti" title="${esc(t.label)}">${trackIcon(t, c)}</span>`).join('')}</span>` : ''}</div></div>`);
    $('.uv-kick', head).textContent = job?.kind === 'publish' ? 'Publishing your draft' : vis === 'draft' ? 'Uploading a draft' : 'Uploading to Glint';
    $('h2', head).textContent = job?.title || c.upload?.title || c.title;
    $('.uv-game', head).textContent = c.game?.name || 'Desktop';
    return head;
  }
  function openUV(id, mode = 'progress') {
    const c = S.clips.find(x => x.id === id);
    if (!c) return;
    const root = uvRoot();
    const already = !root.hidden && UV.id === id;
    UV.id = id; UV.mode = mode;
    const job = S.uploads.get(id);
    root.innerHTML = '';
    const box = h(`<div class="uv-in"><button class="btn ghost icon uv-x" title="Close">${I.x}</button><div class="uv-l"></div><div class="uv-r"></div></div>`);
    $('.uv-l', box).appendChild(uvMedia(c));
    const r = $('.uv-r', box);
    r.appendChild(uvHead(c, job));
    $('.uv-x', box).onclick = () => (mode === 'progress' ? backgroundUV() : closeUV(true));
    if (mode === 'progress') {
      const pe = progressEl(id); pe.classList.add('big'); r.appendChild(pe);
      r.appendChild(h(`<div class="uv-stats"><span data-bytes></span><span data-speed></span><span data-eta></span></div>`));
      const act = h(`<div class="uv-act"><button class="btn ghost">${I.layers}Keep in background</button><button class="btn danger">${I.x}Cancel</button></div>`);
      const [bg, cancel] = $$('button', act);
      bg.onclick = backgroundUV;
      cancel.onclick = async () => { cancel.disabled = true; cancel.innerHTML = `${I.refresh}Cancelling...`; cancel.classList.add('busy'); await G.upload.cancel(id); };
      if (job?.stage === 'server') cancel.innerHTML = `${I.x}Stop watching`;
      r.appendChild(act);
      uvStats(job);
    } else if (mode === 'share') r.appendChild(shareDialog(c));
    else if (mode === 'failed') {
      const pe = progressEl(id); pe.classList.add('big'); failProgress(pe, UV.error || 'Upload failed'); r.appendChild(pe);
      r.appendChild(h(`<p class="uv-err"></p>`)); $('.uv-err', r).textContent = UV.error || '';
      const act = h(`<div class="uv-act"><button class="btn ghost">Close</button><button class="btn">${I.refresh}Retry</button></div>`);
      const [cl, retry] = $$('button', act);
      cl.onclick = () => closeUV(false);
      retry.onclick = () => { const o = UV.opts; S.failed.delete(id); if (o?.publish) publishFlow(c, o); else startUpload(c, o || { voiceOff: true, visibility: 'public', title: c.title }); };
      r.appendChild(act);
    }
    root.appendChild(box);
    if (root.hidden) { root.hidden = false; root.classList.remove('out'); }
    if (!already) { box.classList.add('enter'); }
    document.addEventListener('keydown', uvKey);
    renderDock();
  }
  const uvKey = e => { if (e.key === 'Escape' && UV.id && !$('#uv').hidden) { if (UV.mode === 'progress') backgroundUV(); else closeUV(UV.mode === 'share'); } };
  function hideUV() {
    const root = $('#uv');
    if (!root || root.hidden) return;
    document.removeEventListener('keydown', uvKey);
    root.classList.add('out');
    const v = $('video', root); if (v) v.pause();
    setTimeout(() => { root.hidden = true; root.classList.remove('out'); root.innerHTML = ''; }, reduced() ? 0 : 200);
  }
  function backgroundUV() { const id = UV.id; UV.id = null; hideUV(); renderDock(); if (id) snack('Still uploading - it keeps going in the background.'); }
  function closeUV(highlight) {
    const id = UV.id; UV.id = null; hideUV(); renderDock();
    if (highlight && id) { S.highlight = { ids: [id], game: S.clips.find(x => x.id === id)?.game?.name || '' , single: true }; go('library'); setTimeout(() => $(`[data-card="${id}"]`)?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }), 80); }
  }
  function uvStats(job) {
    const root = $('#uv');
    if (!root || root.hidden || !job) return;
    const by = $('[data-bytes]', root), sp = $('[data-speed]', root), et = $('[data-eta]', root);
    if (!by) return;
    if (job.stage === 'uploading' && job.size) {
      UV.samples.push({ t: Date.now(), sent: job.sent || 0 });
      if (UV.samples.length > 40) UV.samples.shift();
      const r = rateOf(UV.samples, job.size);
      by.textContent = `${fmtBytes(job.sent || 0)} / ${fmtBytes(job.size)}`;
      sp.textContent = r.bps ? `${fmtBytes(r.bps)}/s` : '';
      et.textContent = fmtEta(r.eta);
    } else {
      UV.samples = [];
      by.textContent = { preparing: 'Getting the clip ready', rendering: 'Trimming and mixing the tracks on this PC', publishing: 'Almost there', server: "Your PC doesn't have the original any more - the server renders it" }[job.stage] || '';
      sp.textContent = ''; et.textContent = '';
    }
  }
  // the share dialog (also the end state of the fullscreen view)
  function shareDialog(c) {
    const u = c.upload;
    const el = h(`<div class="sd"></div>`);
    if (!u) { el.appendChild(h(`<p class="muted">Not uploaded.</p>`)); return el; }
    const draft = u.visibility === 'draft';
    el.appendChild(h(`<div class="up-done">${I.checkCircle}<span>${draft ? 'Draft uploaded - only you can see it' : u.visibility === 'unlisted' ? 'Uploaded - unlisted' : 'Uploaded - public'}</span></div>`));
    const link = h(`<div class="sd-link slide"><input class="field" readonly><button class="btn sd-copy">${I.copy}<span>Copy</span></button></div>`);
    $('input', link).value = u.url;
    const copyBtn = $('.sd-copy', link);
    const copied = (btn, text, label = 'Copied') => navigator.clipboard.writeText(text).then(() => {
      const old = btn.innerHTML; btn.classList.add('copied'); btn.innerHTML = `${I.check}<span>${label}</span>`;
      clearTimeout(btn._t); btn._t = setTimeout(() => { btn.classList.remove('copied'); btn.innerHTML = old; }, 1600);
    });
    copyBtn.onclick = () => copied(copyBtn, u.url);
    $('input', link).onclick = e => e.target.select();
    el.appendChild(link);
    const title = u.title || c.title;
    const quick = h(`<div class="sd-quick slide"><button class="btn ghost sm" data-q="chat">${I.message}<span>Copy for Discord / Ember</span></button><button class="btn ghost sm" data-q="md">${I.fileText}<span>Copy markdown</span></button><button class="btn ghost sm" data-q="open">${I.external}<span>Open in browser</span></button></div>`);
    $('[data-q="chat"]', quick).onclick = e => copied(e.currentTarget, `${title}\n${u.url}`);
    $('[data-q="md"]', quick).onclick = e => copied(e.currentTarget, `[${title.replace(/[[\]]/g, '')}](${u.url})`);
    $('[data-q="open"]', quick).onclick = () => G.openExternal(u.url);
    el.appendChild(quick);
    if (draft) {
      let pv = 'public';
      const pub = h(`<div class="slide"><div class="lbl">Publish as</div></div>`);
      pub.appendChild(visSeg('public', false, v => { pv = v; }));
      el.appendChild(pub);
      el.appendChild(h(`<p class="muted slide" style="margin:0">Publishing renders the final video on this PC (your latest trim + the tracks that are on, whether you edited here or on the web) and replaces the draft.</p>`));
      const row = h(`<div class="uv-act slide"><button class="btn ghost">${I.pencil}Edit on web</button><button class="btn ghost">${I.pencil}Edit in app</button><button class="btn">${I.send}Publish</button></div>`);
      const [web, edit, pubBtn] = $$('button', row);
      web.onclick = () => G.openExternal(`https://clips.nookara.cc/c/${u.id}`);
      edit.classList.remove('ghost');
      edit.onclick = () => { const here = S.view === 'editor' && S.clipId === c.id; closeUV(false); if (!here) go('editor', c.id); };
      pubBtn.onclick = () => publishFlow(c, { visibility: pv, title: c.title, publish: true });
      el.appendChild(row);
    } else {
      const vis = h(`<div class="slide"><div class="lbl">Who can see it</div></div>`);
      vis.appendChild(visSeg(u.visibility, false, async v => {
        if (v === c.upload.visibility) return;
        const r = await G.upload.patch(c.id, { visibility: v });
        if (r?.ok) { c.upload = r.clip.upload; snack(v === 'public' ? 'Now public.' : 'Now unlisted - only people with the link can see it.'); $('.up-done span', el).textContent = v === 'unlisted' ? 'Uploaded - unlisted' : 'Uploaded - public'; }
        else snack(r?.error || 'Could not change that.', 'err');
      }));
      el.appendChild(vis);
    }
    const done = h(`<div class="uv-act slide"><button class="btn ghost">${I.check}Done</button></div>`);
    $('button', done).onclick = () => closeUV(true);
    el.appendChild(done);
    return el;
  }
  async function publishFlow(c, opts) {
    S.uploads.set(c.id, { stage: 'preparing', progress: 0, kind: 'publish', visibility: opts.visibility, title: opts.title });
    UV.opts = opts;
    openUV(c.id, 'progress');
    const r = await G.upload.publish(c.id, { visibility: opts.visibility, title: opts.title });
    await afterJob(c.id, r, opts, true);
  }
  async function afterJob(id, r, opts, isPublish) {
    const inView = UV.id === id && !$('#uv').hidden;
    const bar = inView ? $('#uv [data-up]') : $(`.share-panel [data-up="${id}"]`);
    if (r?.ok) await finishProgress(bar);
    S.uploads.delete(id);
    await refreshLibrary();
    const fresh = S.clips.find(x => x.id === id);
    if (r?.ok) {
      S.autoDone.delete(id);
      if (r.fromWeb) snack('Used the edits you made on the web.');
      if (r.server) snack('Rendered on the server - this PC no longer had the original clip.');
      if (inView && fresh) openUV(id, 'share');
      else snack(isPublish ? 'Published!' : r.draft ? 'Draft uploaded.' : 'Uploaded!');
      if (fresh) renderSidePanelAgain(fresh, true);
    } else if (r?.cancelled) {
      if (inView) { UV.id = null; hideUV(); }
      snack(r.error || 'Cancelled.');
      if (fresh) renderSidePanelAgain(fresh);
    } else {
      S.failed.set(id, { error: r?.error, opts });
      if (inView) { failProgress(bar, r?.error); await wait(420); UV.error = r?.error; UV.opts = opts; openUV(id, 'failed'); }
      else snack(r?.error || 'Upload failed.', 'err');
      if (fresh) renderSidePanelAgain(fresh);
    }
    renderDock();
  }
  function renderDock() {
    let dock = $('#dock');
    if (!dock) { dock = h(`<div class="dock" id="dock"></div>`); document.body.appendChild(dock); }
    const ids = [...S.uploads.keys()].filter(id => id !== UV.id || $('#uv')?.hidden);
    for (const n of $$('.dock-i', dock)) if (!ids.includes(n.dataset.id)) { n.classList.add('out'); setTimeout(() => n.remove(), 180); }
    for (const id of ids) {
      if ($(`.dock-i[data-id="${id}"]`, dock)) continue;
      const c = S.clips.find(x => x.id === id);
      const it = h(`<button class="dock-i" data-id="${id}"><span class="dock-t"></span></button>`);
      $('.dock-t', it).textContent = c?.title || 'Upload';
      const pe = progressEl(id, false); pe.classList.add('mini'); it.appendChild(pe);
      it.onclick = () => openUV(id, 'progress');
      dock.appendChild(it);
    }
  }
  function renderSidePanelAgain(c, fresh = false) {
    if (S.view !== 'editor' || S.clipId !== c.id) return;
    const old = $('.ed-r .share-panel');
    if (old) old.replaceWith(sharePanel(c, fresh));
  }

  // ── games ──
  function viewGames() {
    const v = h(`<section class="view"><div class="vh"><h1>Games</h1><span class="sub">Glint records while one of these is running</span></div><div class="g-body"></div></section>`);
    const body = $('.g-body', v);
    G.games.list().then(data => {
      if (!data) return;
      body.innerHTML = '';
      const cur = data.current;
      const now = h(`<div class="sec"><div class="sec-h"><div class="si">${I.monitor}</div><div><h2>Right now</h2><p>Checked every few seconds</p></div></div>
        <div class="now"><div class="gicon">${cur?.image ? `<img src="${esc(cur.image)}" alt="">` : I.gamepad}</div><div style="flex:1;min-width:0"><b></b><span></span></div>${cur ? '<span class="tag live">Recording</span>' : ''}</div></div>`);
      $('.now b', now).textContent = cur ? cur.name : 'No game running';
      $('.now span', now).textContent = cur ? `Detected via ${srcName(cur.source)}` : (S.settings.alwaysRecord ? 'Always record is on - recording the desktop' : 'Start a game and Glint begins buffering automatically');
      body.appendChild(now);
      body.appendChild(notDetectedSection());
      const mine = h(`<div class="sec"><div class="sec-h"><div class="si">${I.plus}</div><div style="flex:1"><h2>Your games</h2><p>Added by you, detected automatically from now on</p></div><button class="btn ghost sm" data-exe>${I.folder}Browse .exe</button></div><div class="glist"></div></div>`);
      const list = $('.glist', mine);
      if (!data.custom.length) list.appendChild(h(`<div class="gi"><span class="muted">Nothing added yet.</span></div>`));
      data.custom.forEach((g, i) => {
        const row = h(`<div class="gi" style="--i:${i}"><div class="gicon">${g.icon ? `<img src="${esc(g.icon)}" alt="">` : I.gamepad}</div><div class="gt"><b></b><span></span></div><button class="btn ghost sm icon" title="Rename">${I.pencil}</button><button class="btn ghost sm icon" title="Remove">${I.trash}</button></div>`);
        $('.gt b', row).textContent = g.name; $('.gt span', row).textContent = g.path || g.exe;
        const [ren, rem] = $$('button', row);
        ren.onclick = async () => { const name = await askName('Rename game', g.name); if (name) { await G.games.update(g.id, { name }); S.settings = (await G.state()).settings; renderView(); } };
        rem.onclick = async () => { row.classList.add('out'); await G.games.remove(g.id); S.settings = (await G.state()).settings; setTimeout(renderView, 160); snack(`${g.name} removed.`); };
        list.appendChild(row);
      });
      $('[data-exe]', mine).onclick = async () => {
        const p = await G.games.pickExe(); if (!p) return;
        const name = await askName('Name this game', prettyExe(p)); if (!name) return;
        addGame(p, name);
      };
      body.appendChild(mine);
      const others = (data.running || []).filter(g => !cur || g.key !== cur.key);
      if (others.length) {
        const run = h(`<div class="sec"><div class="sec-h"><div class="si">${I.layers}</div><div><h2>Also running</h2><p>The newest game started is the one Glint records</p></div></div><div class="glist"></div></div>`);
        for (const g of others) {
          const row = h(`<div class="gi"><div class="gicon">${g.image ? `<img src="${esc(g.image)}" alt="">` : I.gamepad}</div><div class="gt"><b></b><span></span></div></div>`);
          $('.gt b', row).textContent = g.name; $('.gt span', row).textContent = srcName(g.source);
          $('.glist', run).appendChild(row);
        }
        body.appendChild(run);
      }
      body.appendChild(h(`<div class="sec"><div class="sec-h"><div class="si">${I.info}</div><div><h2>Detected automatically</h2><p>The same game list Ember uses, plus HYPERFOCUS</p></div></div>
        <div class="src-list"><div class="src"><b>Discord's game list</b>Thousands of known games - Roblox, Fortnite, Valorant, osu!...</div><div class="src"><b>Your Steam library</b>Every installed Steam game</div>
        <div class="src"><b>Minecraft: Java</b>Any launcher</div><div class="src"><b>HYPERFOCUS</b>Every game installed through Hyperfocus, with its name and icon</div></div></div>`));
    });
    return v;
  }
  const srcName = s => ({ custom: 'your list', hyperfocus: 'HYPERFOCUS' })[s] || "Ember's game list";
  const prettyExe = p => String(p).split(/[\\/]/).pop().replace(/\.exe$/i, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
  async function addGame(p, name) {
    const r = await G.games.add({ path: p, name });
    if (r?.ok) { snack(`${name} added - Glint records it whenever it runs.`); S.settings = (await G.state()).settings; renderView(); } else snack(r?.error || 'Could not add it.', 'err');
  }
  async function askName(title, value) {
    const body = h(`<div><div class="lbl">Name</div><input class="field full" maxlength="80"></div>`);
    const inp = $('input', body); inp.value = value || '';
    setTimeout(() => { inp.focus(); inp.select(); }, 30);
    inp.onkeydown = e => { if (e.key === 'Enter') body.closest('.modal')?.closeModal?.(true); };
    const ok = await modal({ title, body, actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Save', value: true }] });
    return ok ? inp.value.trim() : null;
  }
  function runningPicker({ mode, actionLabel, empty, onPick }) {
    const wrap = h(`<div class="set picker"><div class="dd"><button class="dd-btn"><span class="dd-cur"><span class="muted">Choose a running program...</span></span>${I.chevronDown}</button><div class="dd-list" hidden></div></div>
      <button class="btn ghost icon" data-refresh title="Refresh">${I.refresh}</button><button class="btn" data-add disabled>${I.plus}${esc(actionLabel)}</button></div>`);
    const dd = $('.dd', wrap), btn = $('.dd-btn', wrap), listEl = $('.dd-list', wrap), add = $('[data-add]', wrap), ref = $('[data-refresh]', wrap);
    let chosen = null, items = [];
    const row = p => `<span class="dd-ico">${p.icon ? `<img src="${esc(p.icon)}" alt="">` : I.app}</span><span class="dd-t"><b>${esc(p.name)}</b><span>${esc(p.title || p.path)}</span></span>`;
    const load = async refresh => {
      ref.classList.add('spin');
      items = (await G.games.running(refresh, mode)) || [];
      ref.classList.remove('spin');
      listEl.innerHTML = '';
      if (!items.length) listEl.appendChild(h(`<div class="dd-empty muted">${esc(empty)}</div>`));
      items.forEach((p, i) => {
        const it = h(`<button class="dd-i" style="--i:${Math.min(i, 12)}">${row(p)}</button>`);
        it.onclick = () => { chosen = p; $('.dd-cur', wrap).innerHTML = row(p); add.disabled = false; close(); };
        listEl.appendChild(it);
      });
    };
    const close = () => { dd.classList.remove('open'); setTimeout(() => { if (!dd.classList.contains('open')) listEl.hidden = true; }, 150); document.removeEventListener('pointerdown', outside); };
    const outside = e => { if (!dd.contains(e.target)) close(); };
    btn.onclick = async () => {
      if (dd.classList.contains('open')) return close();
      listEl.hidden = false; void listEl.offsetWidth; dd.classList.add('open');
      document.addEventListener('pointerdown', outside);
      if (!items.length) await load(false);
    };
    ref.onclick = async () => { chosen = null; add.disabled = true; $('.dd-cur', wrap).innerHTML = '<span class="muted">Choose a running program...</span>'; await load(true); if (!dd.classList.contains('open')) btn.click(); };
    add.onclick = () => { if (chosen) onPick(chosen); };
    wrap.setDisabled = on => { btn.disabled = on; add.disabled = on || !chosen; wrap.classList.toggle('off', on); };
    return wrap;
  }
  function notDetectedSection() {
    const sec = h(`<div class="sec"><div class="sec-h"><div class="si">${I.search}</div><div><h2>Game not detected?</h2><p>Pick it from what's running - Glint remembers it and starts recording now</p></div></div></div>`);
    sec.appendChild(runningPicker({ mode: 'games', actionLabel: 'Add & record', empty: 'No game-like programs with a window are running.', onPick: async p => { const name = await askName('Name this game', p.name); if (name) addGame(p.path, name); } }));
    return sec;
  }

  // ── settings ──
  function viewSettings() {
    const s = S.settings;
    const v = h(`<section class="view"><div class="vh"><h1>Settings</h1><span class="sub">Changes apply right away</span></div></section>`);
    const set = patch => G.setSettings(patch).then(r => {
      if (r?.error) { snack(r.error === 'in_use' ? 'That hotkey is already used by another program.' : "That hotkey doesn't work.", 'err'); return false; }
      if (r?.settings) S.settings = r.settings;
      renderTitlebar();
      return true;
    });
    let secN = 0;
    const section = (icon, title, sub) => { const el = h(`<div class="sec" style="--i:${secN++}"><div class="sec-h"><div class="si">${I[icon]}</div><div><h2>${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div></div></div>`); v.appendChild(el); return el; };
    const row = (sec, title, sub, control, cls = '') => { const el = h(`<div class="set ${cls}"><div class="st"><b>${esc(title)}</b>${sub ? `<span>${sub}</span>` : ''}</div><div class="sc"></div></div>`); if (control) $('.sc', el).appendChild(control); sec.appendChild(el); return el; };
    const toggle = (on, fn) => { const t = h(`<button class="toggle ${on ? 'on' : ''}"></button>`); t.onclick = async () => { const nv = !t.classList.contains('on'); t.classList.toggle('on', nv); await fn(nv); }; return t; };
    const seg = (opts, cur, fn) => { const el = h(`<div class="seg"></div>`); for (const [val, label, icon] of opts) { const b = h(`<button>${icon ? I[icon] : ''}${esc(label)}</button>`); b.classList.toggle('on', String(val) === String(cur)); b.onclick = async () => { $$('button', el).forEach(x => x.classList.remove('on')); b.classList.add('on'); await fn(val); }; el.appendChild(b); } return el; };
    const slider = (val, min, max, fn, suffix = '%') => {
      const el = h(`<div class="row" style="width:220px;margin:0"><input type="range" min="${min}" max="${max}" value="${val}"><span class="muted" style="width:52px;text-align:right;font-family:var(--mono)">${val}${suffix}</span></div>`);
      const r = $('input', el); setRange(r);
      r.oninput = () => { setRange(r); $('span', el).textContent = `${r.value}${suffix}`; };
      r.onchange = () => fn(Number(r.value));
      return el;
    };
    const reveal = (sec, after, rows) => {
      const box = h(`<div class="sub-rows ${after ? 'open' : ''}"><div class="sub-in"></div></div>`);
      rows($('.sub-in', box));
      sec.appendChild(box);
      return on => box.classList.toggle('open', on);
    };

    const clip = section('aperture', 'Clipping', 'How clips are made');
    const hk = h(`<button class="hk"></button>`);
    hk.textContent = s.hotkey;
    hk.onclick = () => listenHotkey(hk, async accel => { if (await set({ hotkey: accel })) snack(`Clip hotkey is now ${accel}.`); hk.textContent = S.settings.hotkey; });
    row(clip, 'Clip hotkey', 'Press it in game to save a clip. Click, then press the new combo (Esc cancels).', hk);
    const lens = [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']];
    const custom = !lens.some(l => l[0] === s.clipLength);
    const lenWrap = h(`<div class="row" style="margin:0"></div>`);
    const customIn = h(`<input class="field" type="number" min="5" max="600" style="width:84px" title="Custom length in seconds">`);
    customIn.value = custom ? s.clipLength : ''; customIn.placeholder = 'Custom';
    customIn.onchange = async () => { const n = Math.round(Number(customIn.value)); if (n >= 5 && n <= 600) { await set({ clipLength: n }); renderView(); } };
    lenWrap.appendChild(seg(lens, s.clipLength, val => { customIn.value = ''; return set({ clipLength: val }); }));
    lenWrap.appendChild(customIn);
    row(clip, 'Clip length', 'How far back a clip goes (custom: 5 - 600 seconds)', lenWrap);

    const au = section('headphones', 'Audio', 'Every source is its own track in the clip - mute or rebalance them later in the trimmer');
    const gameT = toggle(s.audioGame, async nv => { await set({ audioGame: nv }); openGame(nv); });
    row(au, 'Game audio', "Only the game's own sound (its whole process tree) - no music or notifications. Falls back to the whole system mix on older Windows.", gameT);
    const openGame = reveal(au, s.audioGame, box => row(box, 'Game volume', '', slider(s.sysVolume, 0, 200, val => set({ sysVolume: val })), 'sub'));
    row(au, 'Microphone', 'Your voice, on its own track. Captured before you press save, in the rolling buffer', toggle(s.mic, async nv => { await set({ mic: nv }); openMic(nv); }));
    const openMic = reveal(au, s.mic, box => {
      const mic = h(`<select class="field" style="max-width:280px"><option value="default">Windows default microphone</option></select>`);
      G.mics().then(list => { for (const m of list || []) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name + (m.default ? ' (default)' : ''); o.selected = s.micDevice === m.id; mic.appendChild(o); } });
      mic.onchange = () => set({ micDevice: mic.value });
      row(box, 'Input device', '', mic, 'sub');
      row(box, 'Mic volume', '', slider(s.micVolume, 0, 200, val => set({ micVolume: val })), 'sub');
    });
    for (const [k, label] of [['discord', 'Discord'], ['ember', 'Ember'], ['fluxer', 'Fluxer']]) {
      const rr = row(au, `${label} voice chat`, `Records other people, and they aren't told. You need their permission where the law requires it. Its own track while ${label} is running${k === 'discord' ? ' (Canary / PTB too)' : ''}, captured before you press save`, toggle(s.audioApps?.[k] !== false, nv => set({ audioApps: { [k]: nv } })));
      $('.st b', rr).insertAdjacentHTML('afterbegin', `<img class="app-ico inline" src="${APP_ICONS[k]}" alt="">`);
    }
    const appBox = h(`<div class="apps-box"><div class="apps-h"><b>App audio</b><span>Any program on its own track while it's running - like Spotify or a browser. Up to 8 tracks in total.</span></div><div class="apps-list"></div></div>`);
    au.appendChild(appBox);
    const builtinCount = () => { const st = S.settings; return (st.audioGame !== false ? 1 : 0) + (st.mic ? 1 : 0) + ['discord', 'fluxer', 'ember'].filter(k => st.audioApps?.[k] !== false).length + (st.audioDesktop ? 1 : 0); };
    const full = () => builtinCount() + S.settings.audioCustomApps.filter(a => a.enabled).length >= 8;
    const paintApps = () => {
      const list = $('.apps-list', appBox);
      list.innerHTML = '';
      S.settings.audioCustomApps.forEach((a, i) => {
        const r = h(`<div class="set app-row" style="--i:${i}"><div class="st"><b><img class="app-ico inline" src="glint-media://appicon/${esc(a.id)}" alt=""></b><span></span></div><div class="sc"></div></div>`);
        $('.st b', r).appendChild(document.createTextNode(a.name)); $('.st span', r).textContent = a.exe;
        const sc = $('.sc', r);
        sc.appendChild(slider(a.volume, 0, 200, val => set({ audioCustomApps: S.settings.audioCustomApps.map(x => (x.id === a.id ? { ...x, volume: val } : x)) })));
        sc.appendChild(toggle(a.enabled, async nv => {
          if (nv && full()) { snack('That would be more than 8 audio tracks - turn another source off first.', 'err'); paintApps(); return; }
          await set({ audioCustomApps: S.settings.audioCustomApps.map(x => (x.id === a.id ? { ...x, enabled: nv } : x)) }); syncFull();
        }));
        const rm = h(`<button class="btn ghost sm icon" title="Remove">${I.trash}</button>`);
        rm.onclick = async () => { r.classList.add('out'); const res = await G.audioApps.remove(a.id); if (res?.settings) S.settings = res.settings; setTimeout(() => { paintApps(); syncFull(); }, 160); };
        sc.appendChild(rm);
        list.appendChild(r);
      });
      if (!S.settings.audioCustomApps.length) list.appendChild(h(`<p class="muted" style="margin:0 18px 12px">No apps added yet.</p>`));
    };
    const addApp = async (p, suggested) => {
      const name = await askName('Name this audio source', suggested || prettyExe(p));
      if (!name) return;
      const r = await G.audioApps.add({ path: p, name });
      if (r?.error) { snack(r.error, 'err'); return; }
      S.settings = r.settings || S.settings;
      snack(`${name} gets its own track while it's running.`);
      paintApps(); syncFull();
    };
    const picker = runningPicker({ mode: 'apps', actionLabel: 'Add app', empty: 'No programs with a window are running.', onPick: p => addApp(p.path, p.name) });
    const browse = h(`<button class="btn ghost" title="Browse for .exe">${I.folder}Browse</button>`);
    browse.onclick = async () => { const p = await G.games.pickExe(); if (p) addApp(p); };
    picker.appendChild(browse);
    appBox.appendChild(picker);
    const syncFull = () => { const f = full(); picker.setDisabled(f); browse.disabled = f; $('.apps-h span', appBox).textContent = f ? 'All 8 audio tracks are in use - turn a source off to add another.' : "Any program on its own track while it's running - like Spotify or a browser. Up to 8 tracks in total."; };
    paintApps(); syncFull();
    row(au, 'Entire desktop audio', 'An extra track with everything you hear on the PC (music, notifications...)', toggle(s.audioDesktop, nv => set({ audioDesktop: nv })));
    row(au, 'Audio sync fine-tune', 'Glint lines audio up automatically. If clips still sound early or late, nudge it here (new clips).', slider(s.audioOffsetMs, -300, 300, val => set({ audioOffsetMs: val }), ' ms'));

    const vid = section('video', 'Video quality', S.encoders.length ? `Encoder found: ${S.encoders.filter(e => e !== 'libx264').map(encName).join(', ') || 'CPU only'}` : '');
    row(vid, 'Capture', 'Game window = just the game when it runs in a window (fullscreen / borderless games always record the whole monitor). Whole monitor = everything on that screen.', seg([['window', 'Game window (auto)'], ['monitor', 'Whole monitor']], s.captureMode || 'window', val => set({ captureMode: val })));
    row(vid, 'Resolution', 'Native is the lightest: frames go straight from the GPU to the encoder. Lower resolutions are scaled on the CPU.', seg([['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['native', 'Native']], s.resolution, val => set({ resolution: val })));
    row(vid, 'Frame rate', '', seg([[30, '30 fps'], [60, '60 fps']], s.fps, val => set({ fps: val })));
    row(vid, 'Quality', 'Higher = sharper clips, bigger files', seg([['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']], s.bitrate, val => set({ bitrate: val })));
    const enc = h(`<select class="field"></select>`);
    for (const e of ['auto', ...S.encoders]) { const o = document.createElement('option'); o.value = e; o.textContent = e === 'auto' ? 'Automatic (best available)' : encName(e); o.selected = s.encoder === e; enc.appendChild(o); }
    enc.onchange = () => set({ encoder: enc.value });
    row(vid, 'Encoder', "Hardware encoders barely touch your game's performance", enc);
    row(vid, 'Show the mouse cursor', '', toggle(s.cursor, nv => set({ cursor: nv })));
    row(vid, 'Always record', 'Keep the buffer running even when no game is detected (uses a little GPU all the time)', toggle(s.alwaysRecord, nv => set({ alwaysRecord: nv })));

    const so = section('bell', 'Sound & popups');
    const grid = h(`<div class="sounds"></div>`);
    const names = { shutter: 'Shutter', sparkle: 'Sparkle', coin: 'Coin', whoosh: 'Whoosh', glint: 'Glint' };
    const choices = [...Object.entries(names), ['custom', s.customSound ? 'Custom' : 'Custom...'], ['off', 'No sound']];
    for (const [k, label] of choices) {
      const b = h(`<button class="snd ${s.sound === k ? 'on' : ''}"><span class="sp">${k === 'off' ? I.volumeOff : k === 'custom' ? I.upload2 : I.play}</span><b>${label}</b></button>`);
      b.onclick = async () => {
        if (k === 'custom' && (!S.settings.customSound || S.settings.sound === 'custom')) {
          const r = await G.pickCustomSound();
          if (r?.error) { snack(r.error, 'err'); return; }
          if (!r?.ok) return;
          S.settings = r.settings || S.settings; snack(`Clip sound: ${r.name}`); preview('custom'); renderView(); return;
        }
        $$('.snd', grid).forEach(x => x.classList.remove('on')); b.classList.add('on');
        await set({ sound: k }); if (k !== 'off') preview(k);
      };
      if (k === 'custom' && s.customSound) b.title = 'Click again to pick a different file';
      grid.appendChild(b);
    }
    so.appendChild(grid);
    row(so, 'Sound volume', '', slider(s.soundVolume, 0, 100, async val => { await set({ soundVolume: val }); if (S.settings.sound !== 'off') preview(S.settings.sound); }));
    row(so, 'Clip popup over the game', 'Shows the moment you press the hotkey - never ends up in your clips', toggle(s.overlay, nv => set({ overlay: nv })));
    row(so, '"Glint is recording" popup', 'When a game is detected and the buffer starts', toggle(s.detectPopup, nv => set({ detectPopup: nv })));
    const corners = h(`<div class="corners"></div>`);
    for (const c of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) {
      const b = h(`<button title="${c.replace('-', ' ')}" class="${s.overlayCorner === c ? 'on' : ''}"></button>`);
      b.onclick = () => { $$('button', corners).forEach(x => x.classList.remove('on')); b.classList.add('on'); set({ overlayCorner: c }); };
      corners.appendChild(b);
    }
    row(so, 'Popup corner', '', corners);
    row(so, 'Open Glint when a game closes', "If you made clips, Glint pops up with them ready to edit (not while another game is running)", toggle(s.openOnGameClose, nv => set({ openOnGameClose: nv })));

    const ul = section('cloudUpload', 'Uploads', S.account.signedIn ? 'To your Nookara account, shown on clips.nookara.cc' : 'Sign in with Nookara to upload');
    row(ul, 'Auto-upload', 'Upload new clips in the background, with game audio only. Upload by hand if you want voices on a clip', seg([['off', 'Off'], ['on_clip', 'When clipped'], ['on_game_close', 'When the game closes']], s.autoUpload, async val => { await set({ autoUpload: val }); openAuto(val !== 'off'); }));
    const openAuto = reveal(ul, s.autoUpload !== 'off', box => {
      const vs = h(`<div></div>`);
      vs.appendChild(visSeg(s.autoUploadVisibility, true, val => set({ autoUploadVisibility: val })));
      row(box, 'Auto uploads are', 'Draft = only you, editable here or on the web before you publish', vs, 'sub');
      const ap = h(`<select class="field"></select>`);
      for (const [id, label] of PRESETS) { const o = document.createElement('option'); o.value = id; o.textContent = label; o.selected = s.autoUploadPreset === id; ap.appendChild(o); }
      ap.onchange = () => set({ autoUploadPreset: ap.value });
      row(box, 'Auto-upload compression', 'Custom uses the settings below', ap, 'sub');
    });
    const pp = h(`<div class="set-preset"></div>`);
    pp.appendChild(presetPicker(s.uploadPreset, s.uploadCustom, (p, cu) => set({ uploadPreset: p, uploadCustom: cu })));
    const prow = row(ul, 'Default compression', 'Smaller uploads leave more room on your Nookara account. You can change it per upload too.', null);
    prow.classList.add('stacked'); $('.sc', prow).appendChild(pp);
    if (S.account.signedIn) {
      const srow = row(ul, 'Nookara space', '', null);
      srow.classList.add('stacked');
      G.storageUsage().then(u => { if (u) $('.sc', srow).appendChild(storageLine(u)); else srow.remove(); });
    }

    const st = section('hardDrive', 'Storage');
    const dir = h(`<div class="row" style="margin:0"><button class="btn ghost sm">${I.folder}Open</button><button class="btn ghost sm">Change...</button></div>`);
    const [openB, changeB] = $$('button', dir);
    openB.onclick = () => G.openClipsDir();
    changeB.onclick = async () => { const p = await G.pickFolder(); if (p) { await set({ clipsDir: p }); S.clipsDir = p; renderView(); snack('New clips will be saved there.'); } };
    row(st, 'Clips folder', `<span style="font-family:var(--mono)">${esc(S.clipsDir)}</span><br>New clips go into a folder per game.`, dir);

    const nd = notDetectedSection(); nd.style.setProperty('--i', secN++); v.appendChild(nd);

    const ap = section('app', 'App', `Glint ${S.version}`);
    row(ap, 'Start with Windows', 'Glint waits quietly in the tray until you play', toggle(s.startWithWindows, nv => set({ startWithWindows: nv })));
    row(ap, 'Start minimized to the tray', '', toggle(s.startMinimized, nv => set({ startMinimized: nv })));
    const upd = h(`<button class="btn ghost sm">${I.refresh}Check now</button>`);
    upd.onclick = async () => { upd.disabled = true; upd.classList.add('spin'); const r = await G.update.check(); upd.disabled = false; upd.classList.remove('spin'); S.update = r; snack({ latest: "You're on the newest version.", dev: 'Updates only work in the installed app.', ready: `Version ${r?.version} is ready - restart to update.`, error: "Couldn't check for updates." }[r?.state] || 'Checking...', r?.state === 'error' ? 'err' : 'ok'); renderTitlebar(); };
    row(ap, 'Install updates automatically', 'Downloads in the background, installs when you restart Glint', toggle(s.autoUpdate, nv => set({ autoUpdate: nv })));
    row(ap, 'Updates', esc(updateText()), upd);
    return v;
  }
  function updateText() {
    const u = S.update || {};
    if (u.state === 'downloading') return `Downloading ${u.version} (${u.progress || 0}%)`;
    if (u.state === 'ready') return `Version ${u.version} is ready to install`;
    if (u.state === 'latest') return "You're up to date";
    return `Glint ${S.version}`;
  }
  let audio = null;
  function preview(name) {
    try {
      audio?.pause();
      const src = name === 'custom' ? `glint-media://sound/custom?t=${Date.now()}` : `../assets/sounds/${name}.wav`;
      audio = new Audio(src); audio.volume = (S.settings?.soundVolume ?? 70) / 100; audio.play().catch(() => {});
    } catch {  }
  }
  function listenHotkey(btn, done) {
    btn.classList.add('listening');
    btn.textContent = 'Press a combo...';
    const MAP = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', '+': 'Plus' };
    const key = e => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { finish(); btn.textContent = S.settings.hotkey; return; }
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
      const k = MAP[e.key] || (e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : e.code.startsWith('Numpad') ? `num${e.code.slice(6).toLowerCase()}` : e.key.length === 1 ? e.key.toUpperCase() : e.key);
      const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean);
      if (!mods.length && !/^F\d{1,2}$/.test(k)) { btn.textContent = 'Add Ctrl / Alt / Shift'; return; }
      finish();
      done([...mods, k].join('+'));
    };
    const finish = () => { btn.classList.remove('listening'); window.removeEventListener('keydown', key, true); };
    window.addEventListener('keydown', key, true);
  }

  async function refreshLibrary() {
    const list = await G.library.list();
    if (Array.isArray(list)) {
      const v = new Map(S.clips.map(c => [c.id, c.thumbV]));
      S.clips = list.map(c => ({ ...c, thumbV: v.get(c.id) }));
    }
    renderNav();
  }

  async function askAboutMic() {
    await askMicOnce();
    await askVoiceOnce();
  }
  async function askVoiceOnce() {
    if (S.settings.voiceAsked) return;
    const on = await modal({
      title: 'Record voice chat?',
      body: `<p>Glint can save what you hear in Discord, Fluxer and Ember, each on its own track. <b>That records other people</b>, and they aren't told.</p><p>You need their permission where the law requires it. Rules differ between countries, and this setting can't get that permission for you.</p><p>While a game runs, Glint keeps a rolling recording of the last while, so this is captured before you press save. Nothing leaves your PC until you upload.</p><p>It stays off unless you turn it on, and you can change this any time in Settings.</p>`,
      actions: [{ label: 'Turn it on', value: true, kind: 'ghost' }, { label: 'Keep it off', value: false }],
    });
    const yes = on === true;
    const r = await G.setSettings({ audioApps: { discord: yes, fluxer: yes, ember: yes }, voiceAsked: true });
    if (r?.settings) { S.settings = r.settings; if (S.view === 'settings') renderView(); }
  }
  async function askMicOnce() {
    if (S.settings.micAsked) return;
    const on = await modal({
      title: 'Record your microphone?',
      body: `<p>Glint can save your voice in your clips, on its own track that you can mute before uploading.</p><p>While a game runs, Glint keeps a rolling recording of the last while, so this is captured before you press save. Nothing leaves your PC until you upload.</p><p>It stays off unless you turn it on, and you can change this any time in Settings.</p>`,
      actions: [{ label: 'Turn it on', value: true, kind: 'ghost' }, { label: 'Keep it off', value: false }],
    });
    const r = await G.setSettings({ mic: on === true, micAsked: true });
    if (r?.settings) { S.settings = r.settings; if (S.view === 'settings') renderView(); }
  }

  async function init() {
    document.addEventListener('error', e => {
      const img = e.target;
      if (img && img.tagName === 'IMG' && img.classList.contains('app-ico')) { const sp = document.createElement('span'); sp.className = 'app-ico-fb'; sp.innerHTML = I.app; img.replaceWith(sp); }
    }, true);
    const st = await G.state();
    Object.assign(S, { settings: st.settings, status: st.status, account: st.account, update: st.update, encoders: st.encoders || [], version: st.version, clipsDir: st.clipsDir, highlight: st.highlight || null });
    for (const u of st.uploads || []) S.uploads.set(u.id, u);
    $$('[data-win]').forEach(b => { b.onclick = async () => { S.maximized = await G.win(b.dataset.win); renderTitlebar(); }; });
    await refreshLibrary();
    renderTitlebar(); renderAccount(); renderNav(); renderView();
    askAboutMic();
    G.onStatus(s => { S.status = s; renderTitlebar(); });
    G.onSettings?.(s => { S.settings = s; renderTitlebar(); if (S.view === 'settings') renderView(); });
    G.onAccount(a => { S.account = a; renderAccount(); if (S.view === 'editor') { const c = S.clips.find(x => x.id === S.clipId); if (c) renderSidePanelAgain(c); } });
    G.onUpdate(u => { S.update = u; renderTitlebar(); });
    G.onWin(w => { S.maximized = w.maximized; renderTitlebar(); });
    G.onNotice(n => { if (n.kind === 'draftsync') snack("Couldn't sync your edit to the draft - it's saved here and will go out with the next change.", 'err'); if (n.kind === 'update-wait') snack(`The update installs as soon as your ${n.why === 'sign-in' ? 'sign-in' : n.why === 'upload' ? 'upload' : 'clip'} is done.`); if (n.kind === 'encoder') snack(`${encName(n.encoder)} didn't start - switched to the next encoder.`, 'err'); });
    G.onHighlight(async hl => {
      S.highlight = hl;
      await refreshLibrary();
      if (S.view !== 'editor') go('library');
      const first = $(`[data-card="${hl.ids[0]}"]`);
      if (first) first.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    });
    G.onLibrary(async ev => {
      await refreshLibrary();
      if (ev?.added) { const c = S.clips.find(x => x.id === ev.added); if (c) c.thumbV = Date.now(); }
      if (S.view === 'library') renderView();
      else if (S.view === 'editor' && (ev?.changed === S.clipId || ev?.changed === '*')) { const c = S.clips.find(x => x.id === S.clipId); if (c && !S.uploads.has(c.id)) renderSidePanelAgain(c); }
      else if (S.view === 'editor' && ev?.removed === S.clipId) go('library');
    });
    G.onUpload(async u => {
      const bars = () => $$(`[data-up="${u.id}"]`);
      if (u.stage === 'done' || u.stage === 'failed') {
        if (!u.auto) return;
        if (u.stage === 'done') { await Promise.all(bars().map(finishProgress)); S.uploads.delete(u.id); S.autoDone.add(u.id); snack('Clip auto-uploaded - click it to share.'); renderDock(); }
        else { S.uploads.delete(u.id); S.failed.set(u.id, { error: u.error, opts: { visibility: S.settings.autoUploadVisibility, voiceOff: true } }); bars().forEach(b => failProgress(b, 'Auto-upload failed')); snack(u.error || 'Auto-upload failed.', 'err'); await wait(900); renderDock(); }
        if (UV.id === u.id && !$('#uv').hidden) { await refreshLibrary(); if (u.stage === 'done') openUV(u.id, 'share'); else { UV.error = u.error; openUV(u.id, 'failed'); } }
        await refreshLibrary();
        if (S.view === 'library') renderView();
        else if (S.view === 'editor' && S.clipId === u.id) { const c = S.clips.find(x => x.id === u.id); if (c) renderSidePanelAgain(c, u.stage === 'done'); }
        return;
      }
      const isNew = !S.uploads.has(u.id);
      S.uploads.set(u.id, u);
      if (UV.id === u.id) uvStats(u);
      if (isNew) renderDock();
      const els = bars();
      if (els.length) els.forEach(el => setProgress(el, u));
      else if (isNew) {
        const slot = $(`[data-card="${u.id}"] .card-up-slot`);
        if (slot) slot.appendChild(progressEl(u.id, true));
        if (S.view === 'editor' && S.clipId === u.id) { const c = S.clips.find(x => x.id === u.id); if (c) renderSidePanelAgain(c); }
      }
    });
  }
  init();
})();
