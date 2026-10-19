/**
 * Commune Zéro's server: the leaderboard and feedback, a Cloudflare Worker with a D1 database and
 * an R2 bucket (README.md for setting it up).
 *
 *   GET    /boards          every board that has entries, with how many
 *   GET    /scores?version=&slug=&difficulty=&startYear=&limit=   a board's best, highest first
 *   POST   /submit          a finished run (rules.ts Submission) → its id, rank and the board's size
 *   DELETE /scores/:id      removes an entry (admin)
 *   POST   /feedback        feedback from the game (rules.ts FeedbackSubmission), its save to R2,
 *                           and an e-mail to the admin (mail.ts)
 *   GET    /admin           the admin page (adminPage.ts), which uses:
 *   GET    /admin/feedback, GET /admin/feedback/:id/save, POST /admin/feedback/:id/status,
 *   DELETE /admin/feedback/:id                        (admin: Authorization: Bearer ADMIN_TOKEN)
 *
 * Nothing is taken on trust: the score is worked out again from the run's years (rules.ts
 * checkScore), the name goes through the same filter as in the game (nameProblem), a run goes on
 * once, and one address submits at most a few runs an hour. The address itself is never stored —
 * only a salted hash, for a day, for that limit.
 */

import {
  boardId,
  checkScore,
  DIFFICULTIES,
  feedbackProblem,
  nameProblem,
  tidyName,
  wellFormed,
  type BoardKey,
  type FeedbackSubmission,
  type LeaderboardDifficulty,
} from "../../app/src/leaderboard/rules";
import { adminPage } from "./adminPage";
import { feedbackMail, resendMailer, type MailConfig, type SendMail } from "./mail";
import { D1Store, R2Blobs, saveKey, type Blobs, type D1Database, type R2Bucket, type Store } from "./store";

export interface Env extends MailConfig {
  DB: D1Database;
  /** Feedback's saves. */
  FEEDBACK_SAVES: R2Bucket;
  /** The game's origins allowed to call (comma-separated, e.g. "https://name.github.io,http://localhost:5173"); empty: any. */
  ALLOWED_ORIGINS?: string;
  /** For removing entries (a Worker secret). */
  ADMIN_TOKEN?: string;
  /** Salt for hashing addresses (a Worker secret). */
  IP_SALT?: string;
}

const MAX_BODY_BYTES = 16_000;
const MAX_FEEDBACK_BYTES = 32_000_000;
const SUBMISSIONS_PER_HOUR = 5;
const FEEDBACK_PER_HOUR = 6;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_LIMIT = 100;

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(request, new D1Store(env.DB), env, Date.now(), {
      blobs: env.FEEDBACK_SAVES ? new R2Blobs(env.FEEDBACK_SAVES) : null,
      sendMail: resendMailer(env),
      waitUntil: (p) => ctx.waitUntil(p),
    });
  },
};

/** What the handler needs besides the store: where saves go, how mail goes, and how to finish work
 * after answering. */
export interface Deps {
  blobs: Blobs | null;
  sendMail: SendMail | null;
  waitUntil: (p: Promise<unknown>) => void;
}

const NO_DEPS: Deps = { blobs: null, sendMail: null, waitUntil: () => {} };

function corsHeaders(request: Request, env: Pick<Env, "ALLOWED_ORIGINS">): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  // Host names are case-insensitive, and browsers send them in lower case.
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const allow = allowed.length === 0 ? "*" : allowed.includes(origin.toLowerCase()) ? origin : "";
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

/** Whether the request carries the admin token. */
async function isAdmin(request: Request, env: Pick<Env, "ADMIN_TOKEN">): Promise<boolean> {
  const token = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  return !!env.ADMIN_TOKEN && token.length === env.ADMIN_TOKEN.length && (await sha256(token)) === (await sha256(env.ADMIN_TOKEN));
}

/** One more submission of this kind from this address, unless it has had its share this hour. */
async function withinLimit(request: Request, store: Store, env: Pick<Env, "IP_SALT">, kind: string, perHour: number, now: number): Promise<boolean> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const ipHash = await sha256(`${env.IP_SALT ?? "commune-zero"}|${kind}|${Math.floor(now / DAY_MS)}|${ip}`);
  await store.pruneSubmissions(now - DAY_MS);
  if ((await store.submissionsSince(ipHash, now - HOUR_MS)) >= perHour) return false;
  await store.logSubmission(ipHash, now);
  return true;
}

/** The request handler, apart from Cloudflare's entry point so it can be tried against any Store. */
export async function handle(request: Request, store: Store, env: Omit<Env, "DB" | "FEEDBACK_SAVES">, now = Date.now(), deps: Deps = NO_DEPS): Promise<Response> {
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

      if (!(await withinLimit(request, store, env, "score", SUBMISSIONS_PER_HOUR, now))) return json({ error: "That's enough for now — try again in an hour." }, 429, cors);

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
      if (!(await isAdmin(request, env))) return json({ error: "Not allowed." }, 403, cors);
      return (await store.delete(Number(remove[1]))) ? json({ deleted: Number(remove[1]) }, 200, cors) : json({ error: "No such entry." }, 404, cors);
    }

    if (request.method === "POST" && url.pathname === "/feedback") {
      const text = await request.text();
      if (text.length > MAX_FEEDBACK_BYTES) return json({ error: "That's too big to send." }, 413, cors);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return json({ error: "Not feedback." }, 400, cors);
      }
      const problem = feedbackProblem(body);
      if (problem) return json({ error: problem }, 422, cors);
      const f = body as FeedbackSubmission;
      if (!(await withinLimit(request, store, env, "feedback", FEEDBACK_PER_HOUR, now))) return json({ error: "That's a lot of feedback at once — try again in an hour." }, 429, cors);
      const hasSave = f.save !== null && deps.blobs !== null;
      const id = await store.insertFeedback({ kind: f.kind, message: f.message, details: f.details, version: f.version, build: f.build, crash: f.crash, hasSave, createdAt: now });
      if (hasSave) await deps.blobs!.put(saveKey(id), f.save!);
      const item = await store.getFeedback(id);
      if (item && deps.sendMail) {
        const mail = feedbackMail(item, `${url.origin}/admin`);
        deps.waitUntil(deps.sendMail(mail.subject, mail.text).catch(() => {}));
      }
      return json({ id }, 201, cors);
    }

    // --- the admin page and what it calls (same origin: no CORS needed) ---

    if (request.method === "GET" && url.pathname === "/admin") {
      const nonce = crypto.randomUUID().replace(/-/g, "");
      return new Response(adminPage(nonce), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "no-referrer",
        },
      });
    }

    if (url.pathname.startsWith("/admin/")) {
      if (!(await isAdmin(request, env))) return json({ error: "Not allowed." }, 403, cors);
      if (request.method === "GET" && url.pathname === "/admin/feedback") {
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100));
        return json({ items: await store.listFeedback(limit) }, 200, cors);
      }
      const save = /^\/admin\/feedback\/(\d+)\/save$/.exec(url.pathname);
      if (request.method === "GET" && save) {
        const text = deps.blobs ? await deps.blobs.get(saveKey(Number(save[1]))) : null;
        return text === null
          ? json({ error: "No game attached." }, 404, cors)
          : new Response(text, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...cors } });
      }
      const status = /^\/admin\/feedback\/(\d+)\/status$/.exec(url.pathname);
      if (request.method === "POST" && status) {
        const wanted = ((await request.json().catch(() => ({}))) as { status?: string }).status;
        if (wanted !== "new" && wanted !== "done") return json({ error: "new or done?" }, 400, cors);
        return (await store.setFeedbackStatus(Number(status[1]), wanted)) ? json({ ok: true }, 200, cors) : json({ error: "No such feedback." }, 404, cors);
      }
      const one = /^\/admin\/feedback\/(\d+)$/.exec(url.pathname);
      if (request.method === "DELETE" && one) {
        const id = Number(one[1]);
        await deps.blobs?.delete(saveKey(id));
        return (await store.deleteFeedback(id)) ? json({ deleted: id }, 200, cors) : json({ error: "No such feedback." }, 404, cors);
      }
    }

    return json({ error: "Not found." }, 404, cors);
  } catch {
    return json({ error: "Something went wrong on the leaderboard's side." }, 500, cors);
  }
}
