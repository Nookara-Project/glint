const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const CLIPS_SQL = `
    CREATE TABLE clips (
      id           TEXT PRIMARY KEY,             -- 10-char base62
      user_id      INTEGER NOT NULL,
      video_url    TEXT NOT NULL,
      media_id     INTEGER NOT NULL,
      title        TEXT NOT NULL,
      game         TEXT NOT NULL,
      game_key     TEXT NOT NULL,                -- lower-case game, for filtering / grouping
      game_icon    TEXT,                         -- served icon path or https URL
      duration     REAL NOT NULL,
      width        INTEGER NOT NULL,
      height       INTEGER NOT NULL,
      visibility   TEXT NOT NULL CHECK (visibility IN ('public','unlisted','draft')),
      has_thumb    INTEGER NOT NULL DEFAULT 0,
      views        INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','gone')),   -- does the Nookara media still exist
      last_checked INTEGER NOT NULL DEFAULT 0,
      gone_at      INTEGER,
      -- v1.1 drafts
      trim_start   REAL,
      trim_end     REAL,
      audio_tracks TEXT,                         -- JSON [{index, kind, label, enabled, volume}]
      job_status   TEXT NOT NULL DEFAULT 'ready' CHECK (job_status IN ('ready','rendering','failed')),
      job_error    TEXT,
      job_updated  INTEGER,
      last_edit    INTEGER,
      likes        INTEGER NOT NULL DEFAULT 0,
      comments     INTEGER NOT NULL DEFAULT 0
    )`;
const LATE_COLS = { likes: 'INTEGER NOT NULL DEFAULT 0', comments: 'INTEGER NOT NULL DEFAULT 0', crop: 'TEXT'  };
const COLS = ['id', 'user_id', 'video_url', 'media_id', 'title', 'game', 'game_key', 'game_icon', 'duration', 'width', 'height',
  'visibility', 'has_thumb', 'views', 'created_at', 'status', 'last_checked', 'gone_at'];

function open(dataDir) {
  for (const d of ['thumbs', 'icons', 'drafts', 'work']) fs.mkdirSync(path.join(dataDir, d), { recursive: true });
  const db = new Database(path.join(dataDir, 'glint.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY,           -- Nookara user id
      username    TEXT NOT NULL,
      username_lc TEXT NOT NULL,
      pfp_url     TEXT,
      color       TEXT,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_name ON users(username_lc);
  `);
  const cur = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='clips'").get();
  if (!cur) db.exec(CLIPS_SQL);
  else if (!cur.sql.includes("'draft'")) {
    db.transaction(() => {
      db.exec('ALTER TABLE clips RENAME TO clips_v10');
      db.exec(CLIPS_SQL);
      db.exec(`INSERT INTO clips (${COLS.join(',')}) SELECT ${COLS.join(',')} FROM clips_v10`);
      db.exec('DROP TABLE clips_v10');
    })();
  }
  const have = new Set(db.prepare('PRAGMA table_info(clips)').all().map(c => c.name));
  for (const [c, def] of Object.entries(LATE_COLS)) if (!have.has(c)) db.exec(`ALTER TABLE clips ADD COLUMN ${c} ${def}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS likes (
      clip_id    TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (clip_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      clip_id    TEXT NOT NULL,
      user_id    INTEGER NOT NULL,
      body       TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS comments_clip ON comments(clip_id, id);
    CREATE UNIQUE INDEX IF NOT EXISTS clips_media ON clips(media_id);
    CREATE INDEX IF NOT EXISTS clips_user ON clips(user_id, created_at);
    CREATE INDEX IF NOT EXISTS clips_new ON clips(status, visibility, created_at);
    CREATE INDEX IF NOT EXISTS clips_top ON clips(status, visibility, views);
    CREATE INDEX IF NOT EXISTS clips_game ON clips(game_key);
  `);
  db.prepare("UPDATE clips SET job_status='failed', job_error='interrupted' WHERE job_status='rendering'").run();
  return db;
}

module.exports = { open };
