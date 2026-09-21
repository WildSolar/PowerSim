/**
 * The measure engine: which measures are enacted, when they take effect, what they cost
 * as they run, and the effect channels (channels.ts) that result. The rest of the game
 * reads only the channels, through policyStore.
 *
 * Lifecycle of a player measure: enacting it (or changing its options) pays any one-off
 * cost at once and starts a lead time — a subsidy takes a month to set up, a law a year or
 * more to take effect. Until the lead time has passed the old version (if any) stays in
 * force. Once in effect it costs its running cost every month until repealed; repealing is
 * immediate. Measures from the canton and the federal government follow a fixed schedule set
 * by the difficulty (config/externalMeasures.ts); they cost the player nothing, are announced
 * some years ahead, and feed the same channels.
 */

import { DEFAULT_DIFFICULTY, DIFFICULTY_SPECS, type Difficulty } from "../config/difficulty";
import { EXTERNAL_MEASURES, type ExternalMeasureDef } from "../config/externalMeasures";
import { RESIDENTS_PER_DWELLING } from "../config/treasury";
import { toDateMs, toSimTimeMs } from "./calendar";
import { combineChannels, type Channels } from "./channels";
import { simClock } from "./engine";
import { MEASURE_BY_ID } from "./measureCatalog";
import { defaultParams, sanitizeParams, type MeasureDef, type MeasureParams } from "./measureTypes";
import { treasury } from "./treasury";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;

interface MeasureState {
  /** In force right now, or null while the first enactment is still in its lead time. */
  active: MeasureParams | null;
  /** Enacted or changed, waiting out its lead time. */
  pending: { params: MeasureParams; activeFromMs: number } | null;
  enactedAtMs: number;
  /** A public vote is scheduled on this measure (approval.ts): if it is lost, the measure is struck down. */
  vote: { atMs: number } | null;
}

export type MeasureEvent =
  | { kind: "enacted" | "changed"; id: string; def: MeasureDef; params: MeasureParams; previousParams: MeasureParams | null; atMs: number }
  | { kind: "repealed"; id: string; def: MeasureDef; params: MeasureParams; atMs: number }
  | { kind: "activated"; id: string; def: MeasureDef; params: MeasureParams; atMs: number };

export interface MeasureLogEntry {
  atMs: number;
  text: string;
}

export interface ExternalOutlookEntry {
  id: string;
  source: ExternalMeasureDef["source"];
  title: string;
  summary: string;
  startYear: number;
  inEffect: boolean;
}

function sameParams(a: MeasureParams, b: MeasureParams): boolean {
  return Object.keys(a).every((k) => a[k] === b[k]);
}

class MeasureEngine {
  private difficulty: Difficulty = DEFAULT_DIFFICULTY;
  private states = new Map<string, MeasureState>();
  private externalActive = new Set<string>();
  private externalAnnounced = new Set<string>();
  private history: MeasureLogEntry[] = [];
  private channels: Channels = combineChannels([]);
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribeClock: (() => void) | null = null;
  private lastChargedMonth: number | null = null;
  private dwellingCount: (atMs: number) => number = () => 0;
  private readonly eventListeners = new Set<(event: MeasureEvent) => void>();
  private frozen = false;

  // --- lifecycle ---

  init(difficulty: Difficulty): void {
    this.unsubscribeClock?.();
    this.difficulty = difficulty;
    this.states = new Map();
    this.externalActive = new Set();
    this.externalAnnounced = new Set();
    this.history = [];
    this.lastChargedMonth = null;
    this.frozen = false;
    treasury.setDifficulty(DIFFICULTY_SPECS[difficulty]);
    this.recompute();
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    this.advance(simClock.getSimTimeMs());
  }

  /** How many dwellings the municipality has at a moment — costs of campaigns scale with population. */
  setDwellingCounter(counter: (atMs: number) => number): void {
    this.dwellingCount = counter;
  }

  // --- reading ---

  getDifficulty(): Difficulty {
    return this.difficulty;
  }

  /** The resolved channels — a new object only when something changed. */
  getChannels(): Channels {
    return this.channels;
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(id: string): MeasureState | undefined {
    return this.states.get(id);
  }

  /** Measures that are in force right now, with the settings they are in force under. */
  getActiveMeasures(): { def: MeasureDef; params: MeasureParams }[] {
    const active: { def: MeasureDef; params: MeasureParams }[] = [];
    for (const [id, state] of this.states) {
      const def = MEASURE_BY_ID.get(id);
      if (def && state.active) active.push({ def, params: state.active });
    }
    return active;
  }

  getDef(id: string): MeasureDef | undefined {
    return MEASURE_BY_ID.get(id);
  }

  onEvent(listener: (event: MeasureEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** After game over nothing can be enacted or repealed any more. */
  freeze(): void {
    this.frozen = true;
    this.bump();
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  getHistory(): MeasureLogEntry[] {
    return this.history;
  }

  /** The canton's and the federal government's measures that have been announced (or are in effect). */
  externalOutlook(nowMs: number): ExternalOutlookEntry[] {
    const entries: ExternalOutlookEntry[] = [];
    for (const ext of EXTERNAL_MEASURES) {
      const startYear = ext.startYear[this.difficulty];
      if (startYear === null) continue;
      const announcedMs = toSimTimeMs(Date.UTC(startYear - ext.announcedYearsBefore, 0, 1));
      if (nowMs < announcedMs) continue;
      entries.push({ id: ext.id, source: ext.source, title: ext.title, summary: ext.summary, startYear, inEffect: this.externalActive.has(ext.id) });
    }
    return entries.sort((a, b) => a.startYear - b.startYear);
  }

  costPreview(def: MeasureDef, params: MeasureParams): { oneOffRp: number; annualRp: number } {
    const ctx = { residents: this.dwellingCount(simClock.getSimTimeMs()) * RESIDENTS_PER_DWELLING };
    const clean = sanitizeParams(def, params);
    return { oneOffRp: def.oneOffCostRp?.(clean, ctx) ?? 0, annualRp: def.annualCostRp?.(clean, ctx) ?? 0 };
  }

  // --- acting ---

  /** Enacts a measure, or changes an enacted one's options. Returns false if nothing changed. */
  enact(id: string, rawParams: MeasureParams = {}): boolean {
    const def = MEASURE_BY_ID.get(id);
    if (!def || this.frozen) return false;
    const params = sanitizeParams(def, { ...defaultParams(def), ...rawParams });
    const now = simClock.getSimTimeMs();

    const existing = this.states.get(id);
    const latest = existing?.pending?.params ?? existing?.active ?? null;
    if (latest && sameParams(latest, params)) return false;

    const ctx = { residents: this.dwellingCount(now) * RESIDENTS_PER_DWELLING };
    const oneOffRp = def.oneOffCostRp?.(params, ctx) ?? 0;
    if (oneOffRp > 0) treasury.recordPayout(def.costCategory ?? "programs", now, oneOffRp, id);

    const state: MeasureState = existing ?? { active: null, pending: null, enactedAtMs: now, vote: null };
    state.pending = { params, activeFromMs: now + def.leadTimeMonths * MONTH_MS };
    this.states.set(id, state);
    this.log(now, `${existing ? "Changed" : "Enacted"}: ${def.title}. In effect from ${this.formatDate(state.pending.activeFromMs)}.`);
    this.emit({ kind: existing ? "changed" : "enacted", id, def, params, previousParams: latest, atMs: now });
    this.advance(now); // a measure with no lead time takes effect immediately
    this.bump();
    return true;
  }

  /** Repeals a measure — immediately, and it stops costing. */
  repeal(id: string): boolean {
    const def = MEASURE_BY_ID.get(id);
    const state = this.states.get(id);
    if (!def || !state || this.frozen) return false;
    this.states.delete(id);
    const now = simClock.getSimTimeMs();
    this.log(now, `Repealed: ${def.title}.`);
    this.emit({ kind: "repealed", id, def, params: state.pending?.params ?? (state.active as MeasureParams), atMs: now });
    this.recompute();
    return true;
  }

  /** approval.ts: schedules (or clears) the public vote on a measure. */
  setVote(id: string, atMs: number | null): void {
    const state = this.states.get(id);
    if (!state) return;
    state.vote = atMs === null ? null : { atMs };
    this.bump();
  }

  /** approval.ts: the vote is in. A measure the voters reject is struck down (its one-off cost stays spent). */
  resolveVote(id: string, accepted: boolean, atMs: number): void {
    const state = this.states.get(id);
    const def = MEASURE_BY_ID.get(id);
    if (!state || !def) return;
    state.vote = null;
    if (!accepted) {
      this.states.delete(id);
      this.log(atMs, `Struck down by the voters: ${def.title}.`);
      this.recompute();
      return;
    }
    this.bump();
  }

  // --- time ---

  advance(nowMs: number): void {
    let changed = false;

    for (const [id, state] of this.states) {
      if (state.pending && nowMs >= state.pending.activeFromMs) {
        state.active = state.pending.params;
        state.pending = null;
        this.log(nowMs, `In effect: ${MEASURE_BY_ID.get(id)?.title ?? id}.`);
        const activated = MEASURE_BY_ID.get(id);
        if (activated) this.emit({ kind: "activated", id, def: activated, params: state.active, atMs: nowMs });
        changed = true;
      }
    }

    for (const ext of EXTERNAL_MEASURES) {
      const startYear = ext.startYear[this.difficulty];
      if (startYear === null) continue;
      if (!this.externalAnnounced.has(ext.id) && nowMs >= toSimTimeMs(Date.UTC(startYear - ext.announcedYearsBefore, 0, 1))) {
        this.externalAnnounced.add(ext.id);
        this.log(nowMs, `Announced: ${ext.title} — from ${startYear}.`);
        changed = true;
      }
      if (!this.externalActive.has(ext.id) && nowMs >= toSimTimeMs(Date.UTC(startYear, 0, 1))) {
        this.externalActive.add(ext.id);
        this.log(nowMs, `Takes effect: ${ext.title}.`);
        changed = true;
      }
    }

    this.chargeRunningCosts(nowMs);
    if (changed) this.recompute();
  }

  private chargeRunningCosts(nowMs: number): void {
    const month = Math.floor(nowMs / MONTH_MS);
    if (this.lastChargedMonth === null) {
      this.lastChargedMonth = month;
      return;
    }
    const first = Math.max(this.lastChargedMonth + 1, month - 24); // a long jump does not charge years of history
    for (let m = first; m <= month; m++) {
      const ctx = { residents: this.dwellingCount(m * MONTH_MS) * RESIDENTS_PER_DWELLING };
      for (const [id, state] of this.states) {
        const def = MEASURE_BY_ID.get(id);
        const annualRp = state.active && def?.annualCostRp ? def.annualCostRp(state.active, ctx) : 0;
        if (annualRp > 0) treasury.recordPayout(def?.costCategory ?? "programs", m * MONTH_MS, annualRp / 12, id);
      }
    }
    this.lastChargedMonth = month;
  }

  // --- internals ---

  private recompute(): void {
    const patches: Partial<Channels>[] = [];
    for (const ext of EXTERNAL_MEASURES) if (this.externalActive.has(ext.id)) patches.push(ext.effects);
    const active = [...this.states.entries()].filter(([, s]) => s.active).sort((a, b) => a[1].enactedAtMs - b[1].enactedAtMs);
    for (const [id, state] of active) {
      const def = MEASURE_BY_ID.get(id);
      if (def) patches.push(def.effects(state.active as MeasureParams));
    }
    this.channels = combineChannels(patches);
    this.bump();
  }

  private emit(event: MeasureEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private log(atMs: number, text: string): void {
    this.history = [{ atMs, text }, ...this.history].slice(0, 100);
  }

  private formatDate(simTimeMs: number): string {
    const d = new Date(toDateMs(simTimeMs));
    return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  }
}

export const measures = new MeasureEngine();
