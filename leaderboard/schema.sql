-- The leaderboard's tables (src/store.ts). Applied once:
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
