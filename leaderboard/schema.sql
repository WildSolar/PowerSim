-- The server's tables (src/store.ts): the leaderboard, and feedback. Applied once, and again after
-- a table is added (every statement only creates what isn't there yet):
--   npx wrangler d1 execute commune-zero-leaderboard --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- "version|slug|difficulty|startYear" (rules.ts boardId), and its parts
  board TEXT NOT NULL,
  version TEXT NOT NULL,
  slug TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  start_year INTEGER NOT NULL,
  -- one entry per run
  run_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  score REAL NOT NULL,
  par REAL,
  net_zero_year INTEGER,
  finished_year INTEGER,
  full_version TEXT NOT NULL,
  build TEXT NOT NULL,
  submitted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS entries_board_score ON entries (board, score DESC, submitted_at);

-- The rate limit: a salted hash of the address and when, kept for a day.
CREATE TABLE IF NOT EXISTS submissions (
  ip_hash TEXT NOT NULL,
  at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS submissions_ip ON submissions (ip_hash, at);

-- Feedback from the game (its save, if attached, is in R2 as feedback/<id>.txt).
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT NOT NULL,
  version TEXT NOT NULL,
  build TEXT NOT NULL,
  crash INTEGER NOT NULL,
  has_save INTEGER NOT NULL,
  -- 'new' or 'done'
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_created ON feedback (created_at DESC);
