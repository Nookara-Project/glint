
const ADD_WINDOW_MS = 5000;
const TOAST_GAP_MS = 900;
const BLOCKED = new Set(['glint.exe', 'electron.exe', 'explorer.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe', 'searchhost.exe',
  'searchapp.exe', 'lockapp.exe', 'textinputhost.exe', 'applicationframehost.exe', 'systemsettings.exe', 'taskmgr.exe', 'dwm.exe', 'csrss.exe',
  'winlogon.exe', 'logonui.exe', 'consent.exe', 'sihost.exe', 'ctfmon.exe', 'rundll32.exe', 'dllhost.exe', 'conhost.exe', 'openconsole.exe',
  'windowsterminal.exe', 'cmd.exe', 'powershell.exe', 'pwsh.exe', 'mmc.exe', 'snippingtool.exe', 'screenclippinghost.exe']);
const base = p => String(p || '').split(/[\\/]/).pop().toLowerCase();

function eligibleApp(fg, selfPid) {
  if (!fg || !fg.path || !/\.exe$/i.test(fg.path)) return null;
  if (selfPid && Number(fg.pid) === Number(selfPid)) return null;
  const b = base(fg.path);
  if (BLOCKED.has(b)) return null;
  if (/[\\/]windows[\\/](system32|syswow64|systemapps|immersivecontrolpanel)[\\/]/i.test(fg.path) || /[\\/]windows[\\/][^\\/]+\.exe$/i.test(fg.path)) return null;
  return { path: fg.path, exe: fg.path.split(/[\\/]/).pop(), name: fg.path.split(/[\\/]/).pop().replace(/\.exe$/i, ''), fullscreen: !!fg.fullscreen };
}

function decide(state, pending, fg, now, lastToastAt = 0, selfPid = 0) {
  if (state.recording) return { action: 'clip' };
  const app = eligibleApp(fg, selfPid);
  if (pending && app && now - pending.at <= ADD_WINDOW_MS && app.path.toLowerCase() === String(pending.path).toLowerCase()) return { action: 'add', app };
  let reason = 'No game detected';
  if (state.wanted) reason = now - (state.startedWantingAt || 0) < 15000 ? 'Recording is starting...' : 'Recording paused';
  return { action: 'idle', reason, offer: state.wanted ? null : app, toast: now - lastToastAt >= TOAST_GAP_MS };
}

module.exports = { decide, eligibleApp, ADD_WINDOW_MS, TOAST_GAP_MS, BLOCKED };
