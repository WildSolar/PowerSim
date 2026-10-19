/**
 * The leaderboard's rules, shared by the game and the server (leaderboard/ at the repository root):
 * what a submission carries, which board it belongs on, whether a name is acceptable, and the score
 * worked out again from the run's year-by-year emissions — so the server never takes a score on
 * trust. Plain functions, no imports from the simulation: the server bundles this file as it is.
 *
 * A score is only comparable within one town, difficulty and starting year (par differs), and
 * within one minor version (balance changes between them): that is a board.
 */

import { BLOCKED_ANYWHERE, BLOCKED_WORDS, BLOCKED_RAW, ALLOWED_INSIDE } from "./blocklist";

export const DIFFICULTIES = ["easy", "normal", "hard"] as const;
export type LeaderboardDifficulty = (typeof DIFFICULTIES)[number];

export const NAME_MIN = 2;
export const NAME_MAX = 24;
/** The last year that scores (sim/score.ts). */
export const FINAL_YEAR = 2050;

export interface BoardKey {
  /** The minor version, "0.9". */
  version: string;
  slug: string;
  difficulty: LeaderboardDifficulty;
  /** The year the run started in (its baseline). */
  startYear: number;
}

export interface SubmittedYear {
  year: number;
  /** Net emissions per resident (kg CO₂); 0 for a year counted in full after finishing early. */
  perResidentKg: number;
  /** Counted in full after finishing early, not played. */
  projected?: boolean;
}

export interface Submission extends BoardKey {
  /** A random id for the run: one entry per run. */
  runId: string;
  /** The game's full version ("0.9.0") and build (a commit). */
  fullVersion: string;
  build: string;
  name: string;
  /** The starting year's net emissions per resident (kg CO₂). */
  baselinePerResidentKg: number;
  /** Every year from the one after the start through 2050. */
  years: SubmittedYear[];
  /** The year the run was finished early in, if it was. */
  finishedYear: number | null;
  /** What doing nothing scores on this board (par), if the game has it. */
  par: number | null;
  /** The score the game shows, for a check against the one worked out here. */
  score: number;
}

/** "0.9.0-dev" → "0.9". */
export function minorVersion(full: string): string | null {
  const m = /^(\d+)\.(\d+)\.\d+/.exec(full);
  return m ? `${m[1]}.${m[2]}` : null;
}

export function boardId(k: BoardKey): string {
  return `${k.version}|${k.slug}|${k.difficulty}|${k.startYear}`;
}

// --- names ---

// Letters that look like Latin ones, folded to them before the name is checked (so a Cyrillic "а"
// can't slip a word past the list).
const CONFUSABLES: Record<string, string> = {
  а: "a", в: "b", е: "e", ё: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x", і: "i", ї: "i", ј: "j", ѕ: "s", ԁ: "d", ɡ: "g", ո: "n", ս: "u",
  α: "a", β: "b", ε: "e", η: "n", ι: "i", κ: "k", μ: "u", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w",
};
// Digits and signs used for letters.
const LEET: Record<string, string> = { "0": "o", "1": "i", "2": "z", "3": "e", "4": "a", "5": "s", "6": "g", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i", "|": "i", "€": "e", "£": "l", "+": "t", "¡": "i" };

/** A name as typed, tidied: Unicode-normalised, single spaces, no spaces at the ends. */
export function tidyName(raw: string): string {
  return raw.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

/** Lower case, look-alikes and digits folded to letters, accents dropped. */
function fold(s: string): string {
  const lower = s.toLowerCase();
  let out = "";
  for (const ch of lower) out += CONFUSABLES[ch] ?? LEET[ch] ?? ch;
  return out.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Runs of the same letter shortened to one ("fuuuck" → "fuck"; the list is shortened the same way). */
function squeeze(s: string): string {
  return s.replace(/(.)\1+/gu, "$1");
}

const ANYWHERE = BLOCKED_ANYWHERE.map((w) => squeeze(fold(w)));
// Whole words as written, and — for the longer ones, where shortening can't make an ordinary word
// ("ass" would become "as") — shortened too.
const WORDS = new Set(BLOCKED_WORDS.map(fold));
const WORDS_SQUEEZED = new Set(BLOCKED_WORDS.map((w) => squeeze(fold(w))).filter((w) => w.length >= 4));
const ALLOWED = ALLOWED_INSIDE.map((w) => squeeze(fold(w)));

const ALLOWED_CHARS = /^[\p{L}\p{N} '’\-_.&]+$/u;
const LINK = /(https?:|www\.|\.(com|ch|net|org|io|de|fr|it|at|gg|xyz|ru|tv|me|co)\b)/iu;

/** Why a name can't go on the leaderboard, or null when it can. */
export function nameProblem(raw: string): string | null {
  const name = tidyName(raw);
  const length = [...name].length;
  if (length < NAME_MIN) return `At least ${NAME_MIN} characters.`;
  if (length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!ALLOWED_CHARS.test(name)) return "Letters, digits, spaces and - _ . ' & only.";
  if ((name.match(/\p{L}/gu) ?? []).length < 2) return "At least two letters.";
  if (/(.)\1{4,}/u.test(name)) return "Not so many of the same character in a row.";
  if (LINK.test(name)) return "No links, please.";

  // Digits and letters as typed (for number codes), then everything folded to letters.
  const plain = name.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "");
  if (BLOCKED_RAW.some((r) => r.test(plain))) return "Please choose another name.";
  const folded = fold(name);
  // Joined up (catches "f u c k" and "f.u.c.k"), with words known to be innocent taken out first.
  let compact = squeeze(folded.replace(/[^\p{L}]/gu, ""));
  for (const ok of ALLOWED) compact = compact.split(ok).join(" ");
  if (ANYWHERE.some((w) => compact.includes(w))) return "Please choose another name.";
  const words = folded.split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some((w) => WORDS.has(w) || WORDS_SQUEEZED.has(squeeze(w)))) return "Please choose another name.";
  return null;
}

// --- the score ---

/** A year's points: the cut per resident against the start, in percent (sim/score.ts yearPoints). */
export function yearPoints(perResidentKg: number, baselinePerResidentKg: number): number {
  return baselinePerResidentKg > 0 ? 100 * (1 - perResidentKg / baselinePerResidentKg) : 0;
}

/** The score worked out from a submission's years, or why it doesn't add up. */
export function checkScore(s: Submission): { score: number; netZeroYear: number | null } | { problem: string } {
  if (!Number.isInteger(s.startYear) || s.startYear < 2020 || s.startYear >= FINAL_YEAR) return { problem: "start year" };
  const base = s.baselinePerResidentKg;
  if (!Number.isFinite(base) || base < 100 || base > 100_000) return { problem: "baseline" };
  const expected = FINAL_YEAR - s.startYear;
  if (!Array.isArray(s.years) || s.years.length !== expected) return { problem: "years" };
  if (s.finishedYear !== null && (!Number.isInteger(s.finishedYear) || s.finishedYear <= s.startYear || s.finishedYear > FINAL_YEAR)) return { problem: "finished year" };
  let score = 0;
  let netZeroYear: number | null = null;
  for (let i = 0; i < s.years.length; i++) {
    const y = s.years[i];
    if (y.year !== s.startYear + 1 + i || !Number.isFinite(y.perResidentKg)) return { problem: "years" };
    const afterFinish = s.finishedYear !== null && y.year > s.finishedYear;
    if (!!y.projected !== afterFinish) return { problem: "finished years" };
    if (afterFinish) {
      score += 100;
      continue;
    }
    // A town can't emit more than a few times its start, nor remove much more than it emits.
    if (y.perResidentKg > base * 4 || y.perResidentKg < -base) return { problem: "emissions" };
    score += yearPoints(y.perResidentKg, base);
    if (netZeroYear === null && y.perResidentKg <= 0) netZeroYear = y.year;
  }
  // Finishing early is only for a town at net zero.
  if (s.finishedYear !== null && (netZeroYear === null || netZeroYear > s.finishedYear)) return { problem: "finished early without net zero" };
  if (!Number.isFinite(s.score) || Math.abs(s.score - score) > 1) return { problem: "score" };
  if (s.par !== null && (!Number.isFinite(s.par) || Math.abs(s.par) > 100 * expected * 2)) return { problem: "par" };
  return { score, netZeroYear };
}

/** Whether a submission's fields are the right kinds, before anything else is checked. */
export function wellFormed(x: unknown): x is Submission {
  if (!x || typeof x !== "object") return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.version === "string" &&
    /^\d+\.\d+$/.test(s.version) &&
    typeof s.fullVersion === "string" &&
    s.fullVersion.length <= 32 &&
    minorVersion(s.fullVersion) === s.version &&
    typeof s.build === "string" &&
    /^[0-9a-z+.-]{1,40}$/i.test(s.build) &&
    typeof s.slug === "string" &&
    /^[a-z0-9-]{1,60}$/.test(s.slug) &&
    typeof s.difficulty === "string" &&
    (DIFFICULTIES as readonly string[]).includes(s.difficulty) &&
    typeof s.startYear === "number" &&
    typeof s.runId === "string" &&
    /^[0-9a-f-]{16,40}$/i.test(s.runId) &&
    typeof s.name === "string" &&
    s.name.length <= 200 &&
    typeof s.baselinePerResidentKg === "number" &&
    Array.isArray(s.years) &&
    (s.finishedYear === null || typeof s.finishedYear === "number") &&
    (s.par === null || typeof s.par === "number") &&
    typeof s.score === "number"
  );
}

// --- what the server answers ---

export interface LeaderboardEntry {
  id: number;
  name: string;
  score: number;
  par: number | null;
  netZeroYear: number | null;
  finishedYear: number | null;
  /** When it was submitted (ms since 1970). */
  submittedAt: number;
}

export interface BoardSummary extends BoardKey {
  entries: number;
}

export interface SubmitResult {
  id: number;
  rank: number;
  entries: number;
}
