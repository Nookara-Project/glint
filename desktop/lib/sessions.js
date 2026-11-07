
class Sessions {
  constructor() { this.cur = null; this.ended = null; }
  gameChanged(game, now = Date.now()) {
    let ended = null;
    if (this.cur && (!game || game.key !== this.cur.key)) {
      ended = { ...this.cur, endedAt: now };
      this.ended = ended;
      this.cur = null;
    }
    if (game && !this.cur) this.cur = { key: game.key, name: game.name, clips: [], startedAt: now };
    return ended;
  }
  clipSaved(id, now = Date.now(), graceMs = 25000) {
    if (this.cur) { this.cur.clips.push(id); return { session: this.cur, late: false }; }
    if (this.ended && now - this.ended.endedAt <= graceMs) { this.ended.clips.push(id); return { session: this.ended, late: true }; }
    return { session: null, late: false };
  }
}

function uploadOnSave(settings, { signedIn, late }) {
  if (!signedIn) return false;
  return settings.autoUpload === 'on_clip' || (settings.autoUpload === 'on_game_close' && !!late);
}
function onSessionEnd(settings, session, { signedIn, otherGame }) {
  const ids = session?.clips || [];
  return {
    upload: signedIn && settings.autoUpload === 'on_game_close' ? ids.slice() : [],
    open: !!(settings.openOnGameClose && ids.length && !otherGame),
  };
}

module.exports = { Sessions, uploadOnSave, onSessionEnd };
