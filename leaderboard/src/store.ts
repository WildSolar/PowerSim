/**
 * Where the leaderboard keeps its entries: the Store the request handler (index.ts) talks to, and
 * its implementation on Cloudflare D1 (SQLite) — schema.sql. Every value goes in as a bound
 * parameter, never into the SQL text.
 */

import type { BoardSummary, LeaderboardDifficulty, LeaderboardEntry } from "../../app/src/leaderboard/rules";

export interface NewEntry {
  board: string;
  version: string;
  slug: string;
  difficulty: LeaderboardDifficulty;
  startYear: number;
  runId: string;
  name: string;
  score: number;
  par: number | null;
  netZeroYear: number | null;
  finishedYear: number | null;
  fullVersion: string;
  build: string;
  submittedAt: number;
}

export interface Store {
  /** The entry a run already has, if any. */
  findByRun(runId: string): Promise<number | null>;
  insert(e: NewEntry): Promise<number>;
  /** An entry's place on its board: ahead of it, every higher score and every equal one submitted earlier. */
  rank(board: string, score: number, submittedAt: number): Promise<number>;
  count(board: string): Promise<number>;
  top(board: string, limit: number): Promise<LeaderboardEntry[]>;
  boards(): Promise<BoardSummary[]>;
  /** Submissions from one (hashed) address since a moment — the rate limit. */
  submissionsSince(ipHash: string, sinceMs: number): Promise<number>;
  logSubmission(ipHash: string, atMs: number): Promise<void>;
  pruneSubmissions(beforeMs: number): Promise<void>;
  delete(id: number): Promise<boolean>;
}

// --- Cloudflare D1 ---

interface D1Result<T> {
  results?: T[];
  meta?: { last_row_id?: number; changes?: number };
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<never>>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

interface EntryRow {
  id: number;
  name: string;
  score: number;
  par: number | null;
  net_zero_year: number | null;
  finished_year: number | null;
  submitted_at: number;
}

export class D1Store implements Store {
  constructor(private readonly db: D1Database) {}

  async findByRun(runId: string): Promise<number | null> {
    const row = await this.db.prepare("SELECT id FROM entries WHERE run_id = ?").bind(runId).first<{ id: number }>();
    return row?.id ?? null;
  }

  async insert(e: NewEntry): Promise<number> {
    const result = await this.db
      .prepare(
        "INSERT INTO entries (board, version, slug, difficulty, start_year, run_id, name, score, par, net_zero_year, finished_year, full_version, build, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(e.board, e.version, e.slug, e.difficulty, e.startYear, e.runId, e.name, e.score, e.par, e.netZeroYear, e.finishedYear, e.fullVersion, e.build, e.submittedAt)
      .run();
    return Number(result.meta?.last_row_id ?? 0);
  }

  async rank(board: string, score: number, submittedAt: number): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS n FROM entries WHERE board = ? AND (score > ? OR (score = ? AND submitted_at < ?))")
      .bind(board, score, score, submittedAt)
      .first<{ n: number }>();
    return (row?.n ?? 0) + 1;
  }

  async count(board: string): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM entries WHERE board = ?").bind(board).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async top(board: string, limit: number): Promise<LeaderboardEntry[]> {
    const { results } = await this.db
      .prepare("SELECT id, name, score, par, net_zero_year, finished_year, submitted_at FROM entries WHERE board = ? ORDER BY score DESC, submitted_at ASC LIMIT ?")
      .bind(board, limit)
      .all<EntryRow>();
    return (results ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      score: r.score,
      par: r.par,
      netZeroYear: r.net_zero_year,
      finishedYear: r.finished_year,
      submittedAt: r.submitted_at,
    }));
  }

  async boards(): Promise<BoardSummary[]> {
    const { results } = await this.db
      .prepare("SELECT version, slug, difficulty, start_year, COUNT(*) AS n FROM entries GROUP BY version, slug, difficulty, start_year ORDER BY version DESC, slug, difficulty, start_year DESC")
      .all<{ version: string; slug: string; difficulty: LeaderboardDifficulty; start_year: number; n: number }>();
    return (results ?? []).map((r) => ({ version: r.version, slug: r.slug, difficulty: r.difficulty, startYear: r.start_year, entries: r.n }));
  }

  async submissionsSince(ipHash: string, sinceMs: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM submissions WHERE ip_hash = ? AND at >= ?").bind(ipHash, sinceMs).first<{ n: number }>();
    return row?.n ?? 0;
  }

  async logSubmission(ipHash: string, atMs: number): Promise<void> {
    await this.db.prepare("INSERT INTO submissions (ip_hash, at) VALUES (?, ?)").bind(ipHash, atMs).run();
  }

  async pruneSubmissions(beforeMs: number): Promise<void> {
    await this.db.prepare("DELETE FROM submissions WHERE at < ?").bind(beforeMs).run();
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
    return (result.meta?.changes ?? 0) > 0;
  }
}
