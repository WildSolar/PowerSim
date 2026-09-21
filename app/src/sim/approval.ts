/**
 * Public approval. The player sees one number; behind it sit several voter blocs
 * (config/approval.ts) that each feel differently about each measure (the per-measure
 * stances in measureCatalog.ts). Three things move it:
 *
 *  - Decisions land at once: enacting a measure moves each bloc immediately, in proportion
 *    to how it feels about it; repealing gives most of that back but looks indecisive.
 *  - A bloc then drifts toward a resting level set by the measures in force — with
 *    diminishing returns, so piling up popular measures stops paying. With nothing contentious
 *    in force everyone rests at the base level.
 *  - Votes. Laws can go to a referendum — always for the big bans, and for others when they are
 *    contested. The voters' verdict comes from the blocs' feelings and the general mood plus some
 *    campaign luck; a rejected measure is struck down. Beforehand there is a poll, with its own error.
 *
 * Very low approval ends the game: a recall after months in the basement, or a lost election
 * (every four years). Approval also scales the government's yearly allocation a little.
 */

import {
  ALLOCATION_APPROVAL_SENSITIVITY,
  BASE_APPROVAL,
  BLOC_LABEL,
  BLOC_ORDER,
  BLOC_WEIGHT,
  ELECTION_FIRST_YEAR,
  ELECTION_INTERVAL_YEARS,
  ELECTION_MONTH,
  ELECTION_THRESHOLD,
  ENACT_SHOCK_POINTS,
  FISCAL_BLOC_WEIGHT,
  FISCAL_FULL_RATIO,
  FISCAL_MAX_PENALTY_POINTS,
  MAX_SWING,
  OPTIONAL_REFERENDUM_STANCE,
  POLL_NOISE_POINTS,
  RECALL_APPROVAL,
  RECALL_MONTHS,
  RELAXATION_MONTHS,
  REPEAL_PENALTY_POINTS,
  REPEAL_RECOVERY_FRACTION,
  STANCE_SATURATION,
  START_JITTER,
  VOTE_DELAY_MONTHS,
  VOTE_LOST_POINTS,
  VOTE_MOOD_SENSITIVITY,
  VOTE_NOISE_POINTS,
  VOTE_STANCE_SENSITIVITY,
  VOTE_WON_POINTS,
  WARNING_APPROVAL,
  type Bloc,
} from "../config/approval";
import { DEFAULT_DIFFICULTY, DIFFICULTY_SPECS, type Difficulty } from "../config/difficulty";
import { toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import type { MeasureDef, MeasureParams } from "./measureTypes";
import { measures, type MeasureEvent } from "./measures";
import { hashSeed, mulberry32 } from "./rng";
import { treasury } from "./treasury";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;

export interface ApprovalLogEntry {
  atMs: number;
  text: string;
}

export interface GameOver {
  reason: "recall" | "election";
  atMs: number;
  headline: string;
  text: string;
}

export interface MeasureReaction {
  label: string;
  tone: "good" | "neutral" | "bad";
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

class ApprovalEngine {
  private levels: Record<Bloc, number> = { homeowners: 60, tenants: 60, drivers: 60, business: 60, climate: 60 };
  private history: { atMs: number; approval: number }[] = [];
  private log: ApprovalLogEntry[] = [];
  private votes = new Map<string, { atMs: number; params: MeasureParams }>();
  private gameOver: GameOver | null = null;
  private lowMonths = 0;
  private warned = false;
  private lastStepMonth: number | null = null;
  private electionsHeld = 0;
  private sensitivity = 1;
  private seed = "approval";
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribers: (() => void)[] = [];

  // --- lifecycle ---

  init(difficulty: Difficulty = DEFAULT_DIFFICULTY, seed = "approval"): void {
    this.unsubscribers.forEach((u) => u());
    this.seed = seed;
    this.sensitivity = DIFFICULTY_SPECS[difficulty].approvalSensitivity;
    this.votes = new Map();
    this.log = [];
    this.gameOver = null;
    this.lowMonths = 0;
    this.warned = false;
    this.lastStepMonth = null;
    this.electionsHeld = 0;
    for (const bloc of BLOC_ORDER) {
      const jitter = (mulberry32(hashSeed(seed, "start", bloc))() * 2 - 1) * START_JITTER;
      this.levels[bloc] = BASE_APPROVAL + jitter;
    }
    this.history = [{ atMs: simClock.getSimTimeMs(), approval: this.aggregate() }];
    this.unsubscribers = [simClock.subscribe(() => this.advance(simClock.getSimTimeMs())), measures.onEvent((e) => this.onMeasureEvent(e))];
    this.bump();
  }

  // --- reading ---

  /** The one number the player sees: every bloc's approval, weighted by its share of the electorate. */
  getApproval(): number {
    return this.aggregate();
  }

  /** Approval as it stood on 1 January of `year` (the level at game start for years before it). */
  atYearStart(year: number): number {
    const ms = toSimTimeMs(Date.UTC(year, 0, 1));
    let value = this.history[0]?.approval ?? BASE_APPROVAL;
    for (const point of this.history) {
      if (point.atMs > ms) break;
      value = point.approval;
    }
    return value;
  }

  getHistory(): { atMs: number; approval: number }[] {
    return this.history;
  }

  getLog(): ApprovalLogEntry[] {
    return this.log;
  }

  getGameOver(): GameOver | null {
    return this.gameOver;
  }

  /** Simulated time of the next election, or null once the game is over. */
  nextElectionMs(): number | null {
    if (this.gameOver) return null;
    const year = ELECTION_FIRST_YEAR + this.electionsHeld * ELECTION_INTERVAL_YEARS;
    return toSimTimeMs(Date.UTC(year, ELECTION_MONTH, 15));
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Debug/test: every bloc's own approval. */
  getBlocLevels(): Record<Bloc, number> {
    return { ...this.levels };
  }

  /** The vote scheduled on a measure and what a poll shows right now. */
  getVoteInfo(id: string, def: MeasureDef, nowMs: number): { atMs: number; pollYes: number } | null {
    const vote = this.votes.get(id);
    if (!vote) return null;
    return { atMs: vote.atMs, pollYes: this.yesShare(def, vote.params, hashSeed(this.seed, "poll", id, String(Math.floor(nowMs / MONTH_MS))), POLL_NOISE_POINTS) };
  }

  /** How the public is likely to take a measure, deliberately coarse: enough to tell a crowd-pleaser
   * from a fight, not enough to read off the blocs. */
  reaction(def: MeasureDef, params: MeasureParams): MeasureReaction {
    const stances = this.stancesOf(def, params);
    const values = BLOC_ORDER.map((b) => stances[b] ?? 0);
    const net = this.netStance(def, params);
    if (Math.max(...values) >= 0.3 && Math.min(...values) <= -0.3) return { label: "Divisive", tone: "bad" };
    if (net >= 0.2) return { label: "Widely welcomed", tone: "good" };
    if (net >= 0.05) return { label: "Mostly welcomed", tone: "good" };
    if (net > -0.05) return { label: "Little reaction", tone: "neutral" };
    if (net > -0.2) return { label: "Unpopular with some", tone: "bad" };
    return { label: "Widely resented", tone: "bad" };
  }

  // --- time ---

  advance(nowMs: number): void {
    if (this.gameOver) return;

    for (const [id, vote] of [...this.votes]) {
      if (nowMs >= vote.atMs) this.holdVote(id, vote, nowMs);
    }

    const election = this.nextElectionMs();
    if (election !== null && nowMs >= election) this.holdElection(election);

    const month = Math.floor(nowMs / MONTH_MS);
    if (this.lastStepMonth === null) {
      this.lastStepMonth = month;
      return;
    }
    const first = Math.max(this.lastStepMonth + 1, month - 24);
    for (let m = first; m <= month && !this.gameOver; m++) this.monthlyStep(m * MONTH_MS);
    this.lastStepMonth = month;
  }

  // --- internals ---

  private aggregate(): number {
    return BLOC_ORDER.reduce((sum, b) => sum + BLOC_WEIGHT[b] * this.levels[b], 0);
  }

  private stancesOf(def: MeasureDef, params: MeasureParams): Partial<Record<Bloc, number>> {
    return def.approval?.(params) ?? {};
  }

  /** The electorate-weighted stance toward a measure, -1 to +1. */
  private netStance(def: MeasureDef, params: MeasureParams): number {
    const stances = this.stancesOf(def, params);
    return BLOC_ORDER.reduce((sum, b) => sum + BLOC_WEIGHT[b] * (stances[b] ?? 0), 0);
  }

  private shift(bloc: Bloc, points: number): void {
    this.levels[bloc] = clamp(this.levels[bloc] + points, 0, 100);
  }

  private shiftAll(points: number): void {
    for (const b of BLOC_ORDER) this.shift(b, points);
  }

  /** Where a bloc settles given the measures in force. */
  private restingLevel(bloc: Bloc, fiscalPenalty: number): number {
    let stance = 0;
    for (const { def, params } of measures.getActiveMeasures()) stance += this.stancesOf(def, params)[bloc] ?? 0;
    const level = BASE_APPROVAL + MAX_SWING * this.sensitivity * Math.tanh(STANCE_SATURATION * stance);
    return clamp(level - fiscalPenalty * FISCAL_BLOC_WEIGHT[bloc] * this.sensitivity, 0, 100);
  }

  /** How far the last twelve months' spending overshot the government's allocation, as approval points. */
  private fiscalPenalty(atMs: number): number {
    const budget = treasury.allocationRp(measures.getDwellingCount(atMs));
    if (budget <= 0) return 0;
    const spent = treasury.paidOutTotal(atMs - 12 * MONTH_MS, atMs);
    const overshoot = (spent / budget - 1) / (FISCAL_FULL_RATIO - 1);
    return FISCAL_MAX_PENALTY_POINTS * clamp(overshoot, 0, 1);
  }

  private monthlyStep(atMs: number): void {
    const k = 1 - Math.exp(-1 / RELAXATION_MONTHS);
    const penalty = this.fiscalPenalty(atMs);
    for (const b of BLOC_ORDER) this.levels[b] += (this.restingLevel(b, penalty) - this.levels[b]) * k;

    const approval = this.aggregate();
    this.history.push({ atMs, approval });

    if (approval < WARNING_APPROVAL && !this.warned) {
      this.warned = true;
      this.addLog(atMs, `Approval has fallen to ${Math.round(approval)}%. If it stays this low the municipality will lose patience.`);
    } else if (approval >= WARNING_APPROVAL + 5) {
      this.warned = false;
    }

    this.lowMonths = approval < RECALL_APPROVAL ? this.lowMonths + 1 : 0;
    if (this.lowMonths >= RECALL_MONTHS) {
      this.endGame({
        reason: "recall",
        atMs,
        headline: "Recalled",
        text: `Approval stayed below ${RECALL_APPROVAL}% for ${RECALL_MONTHS} months. The municipality has had enough and recalled you.`,
      });
      return;
    }
    this.bump();
  }

  private onMeasureEvent(event: MeasureEvent): void {
    if (this.gameOver) return;
    const sens = this.sensitivity;
    if (event.kind === "enacted" || event.kind === "changed") {
      const now = this.stancesOf(event.def, event.params);
      const before = event.previousParams ? this.stancesOf(event.def, event.previousParams) : {};
      for (const b of BLOC_ORDER) this.shift(b, ((now[b] ?? 0) - (before[b] ?? 0)) * ENACT_SHOCK_POINTS * sens);
      this.scheduleVoteIfNeeded(event.id, event.def, event.params, event.atMs);
    } else if (event.kind === "repealed") {
      const stances = this.stancesOf(event.def, event.params);
      for (const b of BLOC_ORDER) this.shift(b, -(stances[b] ?? 0) * ENACT_SHOCK_POINTS * sens * REPEAL_RECOVERY_FRACTION);
      this.shiftAll(-REPEAL_PENALTY_POINTS * sens);
      this.votes.delete(event.id);
    }
    this.bump();
  }

  private scheduleVoteIfNeeded(id: string, def: MeasureDef, params: MeasureParams, atMs: number): void {
    this.votes.delete(id);
    measures.setVote(id, null);
    if (!def.referendum) return;
    if (def.referendum === "optional" && this.netStance(def, params) >= OPTIONAL_REFERENDUM_STANCE) return;
    const delayMonths = Math.max(1, Math.min(VOTE_DELAY_MONTHS, def.leadTimeMonths - 1));
    const voteAt = atMs + delayMonths * MONTH_MS;
    this.votes.set(id, { atMs: voteAt, params });
    measures.setVote(id, voteAt);
    const when = new Date(toDateMs(voteAt)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    this.addLog(atMs, `${def.title} goes to a public vote in ${when}.`);
  }

  /** The share of voters in favour, in percent. */
  private yesShare(def: MeasureDef, params: MeasureParams, noiseSeed: number, noisePoints: number): number {
    const noise = (mulberry32(noiseSeed)() * 2 - 1) * noisePoints;
    return clamp(50 + 50 * VOTE_STANCE_SENSITIVITY * this.netStance(def, params) + (this.aggregate() - 50) * VOTE_MOOD_SENSITIVITY + noise, 0, 100);
  }

  private holdVote(id: string, vote: { atMs: number; params: MeasureParams }, nowMs: number): void {
    this.votes.delete(id);
    const def = measures.getDef(id);
    if (!def) return;
    const yes = this.yesShare(def, vote.params, hashSeed(this.seed, "vote", id, String(vote.atMs | 0)), VOTE_NOISE_POINTS);
    const accepted = yes >= 50;
    if (accepted) {
      this.shiftAll(VOTE_WON_POINTS * this.sensitivity);
      this.addLog(nowMs, `Voters approved ${def.title} (${Math.round(yes)}% in favour).`);
    } else {
      const stances = this.stancesOf(def, vote.params);
      for (const b of BLOC_ORDER) this.shift(b, -(stances[b] ?? 0) * ENACT_SHOCK_POINTS * this.sensitivity * REPEAL_RECOVERY_FRACTION);
      this.shiftAll(-VOTE_LOST_POINTS * this.sensitivity);
      this.addLog(nowMs, `Voters rejected ${def.title} (${Math.round(yes)}% in favour). It is struck down.`);
    }
    measures.resolveVote(id, accepted, nowMs);
    this.bump();
  }

  private holdElection(electionMs: number): void {
    const approval = this.aggregate();
    this.electionsHeld++;
    if (approval >= ELECTION_THRESHOLD) {
      this.addLog(electionMs, `Election: you are re-elected, with approval at ${Math.round(approval)}%.`);
      this.bump();
      return;
    }
    this.endGame({
      reason: "election",
      atMs: electionMs,
      headline: "Voted out",
      text: `Approval stood at ${Math.round(approval)}% on election day — below the ${ELECTION_THRESHOLD}% you needed. The voters chose someone else.`,
    });
  }

  private endGame(over: GameOver): void {
    this.gameOver = over;
    this.addLog(over.atMs, `Game over: ${over.headline}.`);
    measures.freeze();
    simClock.pauseAt(simClock.getSimTimeMs());
    this.bump();
  }

  private addLog(atMs: number, text: string): void {
    this.log = [{ atMs, text }, ...this.log].slice(0, 100);
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export const approval = new ApprovalEngine();

/** Multiplier on the government's yearly allocation: a well-regarded department gets more to work with. */
export function allocationApprovalFactor(approvalPct: number): number {
  return 1 + (ALLOCATION_APPROVAL_SENSITIVITY * (approvalPct - BASE_APPROVAL)) / 100;
}

export { BLOC_LABEL };
