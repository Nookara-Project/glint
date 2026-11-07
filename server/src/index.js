const cfg = require('./config');
const { open } = require('./db');
const { createVelora } = require('./velora');
const { createApp } = require('./app');

const db = open(cfg.dataDir);
const velora = createVelora(cfg);
const { app, clips, jobs } = createApp({ cfg, db, velora });

const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`[glint] listening on http://${cfg.host}:${cfg.port} (public ${cfg.publicBase}, data ${cfg.dataDir})`);
});

let sweeping = false;
async function runSweep() {
  if (sweeping) return;
  sweeping = true;
  try { await clips.sweep(); jobs.sweepDrafts(); } catch (e) { console.error('[glint] sweep failed', e); } finally { sweeping = false; }
}
setTimeout(runSweep, 30_000).unref();
setInterval(runSweep, cfg.sweepEveryMs).unref();

function shutdown() {
  server.close(() => { try { db.close(); } catch {} process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
