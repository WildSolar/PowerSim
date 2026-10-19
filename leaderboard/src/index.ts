/**
 * Commune Zéro's leaderboard: a Cloudflare Worker with a D1 database (README.md for setting it up).
 *
 *   GET    /boards          every board that has entries, with how many
 *   GET    /scores?version=&slug=&difficulty=&startYear=&limit=   a board's best, highest first
 *   POST   /submit          a finished run (rules.ts Submission) → its id, rank and the board's size
 *   DELETE /scores/:id      removes an entry (Authorization: Bearer ADMIN_TOKEN)
 *
 * Nothing is taken on trust: the score is worked out again from the run's years (rules.ts
 * checkScore), the name goes through the same filter as in the game (nameProblem), a run goes on
 * once, and one address submits at most a few runs an hour. The address itself is never stored —
 * only a salted hash, for a day, for that limit.
 */

import { boardId, checkScore, DIFFICULTIES, nameProblem, tidyName, wellFormed, type BoardKey, type LeaderboardDifficulty } from "../../app/src/leaderboard/rules";
import { D1Store, type D1Database, type Store } from "./store";

export interface Env {
  DB: D1Database;
  /** The game's origins allowed to call (comma-separated, e.g. "https://name.github.io,http://localhost:5173"); empty: any. */
  ALLOWED_ORIGINS?: string;
  /** For removing entries (a Worker secret). */
  ADMIN_TOKEN?: string;
  /** Salt for hashing addresses (a Worker secret). */
  IP_SALT?: string;
}

const MAX_BODY_BYTES = 16_000;
const SUBMISSIONS_PER_HOUR = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_LIMIT = 100;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, new D1Store(env.DB), env);
  },
};

function corsHeaders(request: Request, env: Pick<Env, "ALLOWED_ORIGINS">): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const allow = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : "";
  return {
    ...(allow ? { "Access-Control-Allow-Origin": allow } : {}),
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors } });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function boardFromQuery(url: URL): BoardKey | null {
  const version = url.searchParams.get("version") ?? "";
  const slug = url.searchParams.get("slug") ?? "";
  const difficulty = url.searchParams.get("difficulty") ?? "";
  const startYear = Number(url.searchParams.get("startYear"));
  if (!/^\d+\.\d+$/.test(version) || !/^[a-z0-9-]{1,60}$/.test(slug) || !(DIFFICULTIES as readonly string[]).includes(difficulty) || !Number.isInteger(startYear)) return null;
  return { version, slug, difficulty: difficulty as LeaderboardDifficulty, startYear };
}

/** The request handler, apart from Cloudflare's entry point so it can be tried against any Store. */
export async function handle(request: Request, store: Store, env: Omit<Env, "DB">, now = Date.now()): Promise<Response> {
  const cors = corsHeaders(request, env);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  try {
    if (request.method === "GET" && url.pathname === "/boards") {
      return json({ boards: await store.boards() }, 200, cors);
    }

    if (request.method === "GET" && url.pathname === "/scores") {
      const board = boardFromQuery(url);
      if (!board) return json({ error: "Which board?" }, 400, cors);
      const limit = Math.max(1, Math.min(MAX_LIMIT, Number(url.searchParams.get("limit")) || 50));
      return json({ entries: await store.top(boardId(board), limit) }, 200, cors);
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      const text = await request.text();
      if (text.length > MAX_BODY_BYTES) return json({ error: "Too much." }, 413, cors);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "Not a run." }, 400, cors);
      }
      if (!wellFormed(body)) return json({ error: "Not a run." }, 400, cors);
      const name = tidyName(body.name);
      const problem = nameProblem(name);
      if (problem) return json({ error: problem }, 422, cors);
      const checked = checkScore(body);
      if ("problem" in checked) return json({ error: "The run doesn't add up." }, 422, cors);
      if ((await store.findByRun(body.runId)) !== null) return json({ error: "This run is already on the leaderboard." }, 409, cors);

      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const ipHash = await sha256(`${env.IP_SALT ?? "commune-zero"}|${Math.floor(now / DAY_MS)}|${ip}`);
      await store.pruneSubmissions(now - DAY_MS);
      if ((await store.submissionsSince(ipHash, now - HOUR_MS)) >= SUBMISSIONS_PER_HOUR) return json({ error: "That's enough for now — try again in an hour." }, 429, cors);
      await store.logSubmission(ipHash, now);

      const board = boardId(body);
      const score = Math.round(checked.score * 10) / 10;
      const id = await store.insert({
        board,
        version: body.version,
        slug: body.slug,
        difficulty: body.difficulty,
        startYear: body.startYear,
        runId: body.runId,
        name,
        score,
        par: body.par === null ? null : Math.round(body.par * 10) / 10,
        netZeroYear: checked.netZeroYear,
        finishedYear: body.finishedYear,
        fullVersion: body.fullVersion,
        build: body.build,
        submittedAt: now,
      });
      return json({ id, rank: await store.rank(board, score, now), entries: await store.count(board) }, 201, cors);
    }

    const remove = /^\/scores\/(\d+)$/.exec(url.pathname);
    if (request.method === "DELETE" && remove) {
      const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      if (!env.ADMIN_TOKEN || token.length !== env.ADMIN_TOKEN.length || (await sha256(token)) !== (await sha256(env.ADMIN_TOKEN))) return json({ error: "Not allowed." }, 403, cors);
      return (await store.delete(Number(remove[1]))) ? json({ deleted: Number(remove[1]) }, 200, cors) : json({ error: "No such entry." }, 404, cors);
    }

    return json({ error: "Not found." }, 404, cors);
  } catch {
    return json({ error: "Something went wrong on the leaderboard's side." }, 500, cors);
  }
}
