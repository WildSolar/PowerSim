/**
 * The game's side of the leaderboard: the server's address (from the build — VITE_LEADERBOARD_URL,
 * set in the deploy workflow from the repository variable LEADERBOARD_URL; without it there is no
 * leaderboard), the run's submission, and the requests. What the server checks is in rules.ts.
 */

import { VERSION_LABEL } from "../changelog";
import { BASELINE_YEAR } from "../sim/calendar";
import { parThrough } from "../sim/par";
import { getRunId, NET_ZERO_TARGET_YEAR, scoreSoFar } from "../sim/score";
import { GAME_VERSION } from "../sim/saveGame";
import { boardId, minorVersion, tidyName, type BoardKey, type BoardSummary, type LeaderboardDifficulty, type LeaderboardEntry, type Submission, type SubmitResult } from "./rules";

export const LEADERBOARD_URL: string = ((import.meta.env.VITE_LEADERBOARD_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
export const LEADERBOARD_ENABLED = /^https?:\/\//.test(LEADERBOARD_URL);

/** The board this run belongs on. */
export function runBoard(slug: string, difficulty: LeaderboardDifficulty): BoardKey {
  return { version: minorVersion(VERSION_LABEL) ?? VERSION_LABEL, slug, difficulty, startYear: BASELINE_YEAR };
}

/** Whether this run may go on the leaderboard: it reached 2050, or finished early. */
export function runEligible(): boolean {
  const score = scoreSoFar();
  return score.finishedYear !== null || score.years.some((y) => y.year === NET_ZERO_TARGET_YEAR);
}

/** The run, as the server wants it. */
export function buildSubmission(slug: string, difficulty: LeaderboardDifficulty, name: string): Submission {
  const score = scoreSoFar();
  return {
    ...runBoard(slug, difficulty),
    runId: getRunId(),
    fullVersion: VERSION_LABEL,
    build: GAME_VERSION,
    name: tidyName(name),
    baselinePerResidentKg: score.baselinePerResidentKg ?? 0,
    years: score.years.map((y) => ({ year: y.year, perResidentKg: y.perResidentKg, ...(y.projected ? { projected: true } : {}) })),
    finishedYear: score.finishedYear,
    par: parThrough(NET_ZERO_TARGET_YEAR),
    score: score.total,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${LEADERBOARD_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? `The leaderboard didn't answer (${response.status}).`);
  return body;
}

export function submitRun(submission: Submission): Promise<SubmitResult> {
  return request<SubmitResult>("/submit", { method: "POST", body: JSON.stringify(submission) });
}

export function fetchBoards(): Promise<{ boards: BoardSummary[] }> {
  return request("/boards");
}

export function fetchBoard(key: BoardKey, limit = 100): Promise<{ entries: LeaderboardEntry[] }> {
  const q = new URLSearchParams({ version: key.version, slug: key.slug, difficulty: key.difficulty, startYear: String(key.startYear), limit: String(limit) });
  return request(`/scores?${q}`);
}

// --- this browser's own entries (to mark them, and not to submit a run twice) ---

const MINE_KEY = "commune-zero.leaderboard";

interface Mine {
  /** Run id → entry id. */
  runs: Record<string, number>;
  /** The last name used, offered again. */
  name: string;
}

function readMine(): Mine {
  try {
    const raw = localStorage.getItem(MINE_KEY);
    return raw ? { runs: {}, name: "", ...(JSON.parse(raw) as Partial<Mine>) } : { runs: {}, name: "" };
  } catch {
    return { runs: {}, name: "" };
  }
}

export function rememberSubmission(runId: string, entryId: number, name: string): void {
  const mine = readMine();
  mine.runs[runId] = entryId;
  mine.name = name;
  try {
    localStorage.setItem(MINE_KEY, JSON.stringify(mine));
  } catch {
    // Not kept: only the marking is lost.
  }
}

export function submittedEntryId(runId: string): number | null {
  return readMine().runs[runId] ?? null;
}

export function myEntryIds(): Set<number> {
  return new Set(Object.values(readMine().runs));
}

export function lastName(): string {
  return readMine().name;
}

export { boardId };
