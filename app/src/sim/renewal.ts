/**
 * Generic stock-renewal engine: infrastructure (a heating system today; EVs,
 * solar, and other categories later — see heatingRenewal.ts for the one
 * consumer so far) has a service lifetime, and when it ends, its owner picks a
 * replacement shaped by four factors — availability, a lifetime financial
 * comparison, a size-dependent "isn't clearly better" indifference band, and a
 * hidden progressive/conservative leaning. This module owns the *mechanism*
 * (chain caching, lifetime timing, the choice rule) — category-specific
 * candidate lists, costs, and lifetimes are supplied by the caller.
 *
 * Each entity (e.g. one building's heating) gets a chain of events: the
 * initially-observed system (installed at an unknown past date we don't try to
 * reconstruct) followed by however many renewals simulated time has reached so
 * far. Only *committed* events — ones whose installedAtMs has already been
 * reached — are ever generated or cached; the next renewal's timing is drawn
 * fresh (and cheaply) on every call until it's actually due, and its choice is
 * decided using whatever candidate costs/tariff apply *at the moment it
 * commits*, then frozen forever — the same "only cache what's actually
 * finished" principle historyLong.ts uses for completed history periods. A
 * player changing the tariff later never rewrites a past decision, and a
 * renewal that hasn't happened yet always reflects the current tariff once it
 * does.
 */

import { policyStore } from "./policy";
import { EARLY_SWITCH_UNCERTAINTY_SHARE } from "../config/earlySwitch";
import { subsidyCategoryForDecision, treasury } from "./treasury";
import { logCandidateDecision, type DecisionCandidateLog, type DecisionLogKind } from "./decisionLog";
import { hashSeed, mulberry32 } from "./rng";
import { weibullAgedRemainder, weibullConditionalRemainder, weibullSample } from "./weibull";
import { recordSubsidisedDecision } from "./additionality";

export interface RenewalCandidate<T extends string> {
  id: T;
  available: boolean;
  annualizedCostRp: number; // straight-line: (installCost - subsidy) / lifetime + running cost, all per year
  lifetimeMeanYears: number;
  /** The part of the up-front cost the municipality pays (already netted out of annualizedCostRp).
   * Recorded on the event when this candidate wins, so the treasury can be charged for it then. */
  municipalSubsidyRp?: number;
  /** Called when this candidate wins and the decision commits (e.g. to book the car to the public
   * charger it will rely on). */
  onChosen?: (atMs: number) => void;
  /** Signed "how renewable/progressive this option reads" — positive leans
   * renewable, negative leans fossil/conventional. Scaled by the entity's own
   * bias trait when ranking; never shown to the player. */
  greenness: number;
  /** Available only by an exception to a rule (e.g. a fossil heating ban when nothing else is
   * possible) — why, for the player. Carried onto the event when this candidate wins. */
  exception?: string;
}

/** "early": replaced before the end of its life (EarlySwitch). */
export type RenewalReasonKind = "initial" | "inKind" | "forcedByAvailability" | "financial" | "early";

export interface RenewalEvent<T extends string> {
  installedAtMs: number;
  system: T;
  previousSystem: T | null; // null only for the synthetic "initial" event
  reasonKind: RenewalReasonKind;
  /** Municipal subsidy paid out when this event committed (the winning candidate's), if any. */
  municipalSubsidyRp?: number;
  /** Only set for "forcedByAvailability": the option that would have won on
   * cost alone if it had been available. */
  bestOverallId: T | null;
  /** The winner was allowed by an exception (its candidate's `exception`). */
  exception?: string;
}

export interface RenewalParams<T extends string> {
  /** Unique per entity+category, e.g. `${building.egid}:heating` — seeds every
   * random draw for this chain and keys its cache entry. */
  entityKey: string;
  /** The building this chain belongs to — decisionLog.ts's own building
   * identifier, distinct from entityKey (which may also carry a dwelling/slot
   * suffix a log viewer doesn't need to parse out). */
  egid: string;
  /** decisionLog.ts's category for this chain — "heating" or a mobility
   * vehicle-type kind. */
  kind: DecisionLogKind;
  /** Human-readable label per candidate id, for the decision log only (never
   * used by the decision itself). */
  labelFor: (id: T) => string;
  initialSystem: T;
  /** When the initial system was actually installed, for a brand-new building; the first
   * renewal is then a full lifetime later. Absent for a system observed at game start,
   * whose install date is unknown (its first renewal comes after an assumed-aged remainder). */
  initialInstalledAtMs?: number;
  /** Draw an observed system's remaining life conditional on its assumed age (no overdue pile-up),
   * instead of the legacy floor-at-minimum behaviour. */
  conditionalFirstLifetime?: boolean;
  weibullShape: number;
  /** This entity's indifference band, as a fraction of the incumbent's own
   * annualized cost — smaller for entities that can justify a more careful
   * comparison (see heatingRenewal.ts's building-size scaling). */
  uncertaintyFraction: number;
  /** This entity's fixed, seeded progressive(+)/conservative(-) trait, already
   * scaled to Rp/year — see RenewalCandidate.greenness. */
  biasStrengthRp: number;
  /** Cheap, static per-system lookup — used to time the *next* renewal, kept
   * separate from candidatesAt (which does the real cost computation) so timing
   * a not-yet-due renewal never pays for one. */
  lifetimeMeanYearsFor: (system: T) => number;
  /** The full candidate list (every system, available or not) as of `atMs`,
   * evaluated against the then-current tariff. Only called when an event is
   * actually about to commit. */
  candidatesAt: (atMs: number, incumbent: T) => RenewalCandidate<T>[];
  /** Called for every decision as it commits, before the winner's own onChosen. */
  onCommit?: (event: RenewalEvent<T>) => void;
  /** Switching before the end of a system's life (config/earlySwitch.ts): once a year from a minimum
   * age, an owner may consider it; if they do, the early candidates are compared, and a switch
   * becomes an event of its own. */
  early?: EarlySwitch<T>;
}

export interface EarlySwitch<T extends string> {
  /** Whether a system is one an owner would switch away from early (the fossil ones). */
  eligible: (system: T) => boolean;
  minAgeYears: number;
  /** The chance of seriously considering it in the year from `atMs`. */
  chanceAt: (atMs: number, incumbent: T) => number;
  /** The comparison: keeping the incumbent costs its running costs and repairs at `ageYears`; the
   * alternatives as at a renewal, plus the hassle of switching early. */
  candidatesAt: (atMs: number, incumbent: T, ageYears: number) => RenewalCandidate<T>[];
}

const YEAR_MS = 365.25 * 24 * 60 * 60_000;

const MAX_EVENTS_PER_CALL = 1000; // defensive cap against a misconfigured/runaway chain, not a real limit

/** One entity's chain, plus when its next event falls due: until then the chain is complete, so a
 * lookup need not rebuild its params or redraw a lifetime (the hot path in municipality-wide
 * sampling). The entry keeps its identity for good (it is extended in place), so a hot caller may
 * hold on to it and skip the keyed lookup altogether — see mobility.ts's slot handles. */
export interface RenewalChainEntry<T extends string> {
  events: RenewalEvent<T>[];
  nextDueMs: number;
  /** Early reviews already held, through this moment — decided once, never redone. */
  reviewedThroughMs?: number;
}

const chains = new Map<string, RenewalChainEntry<string>>();

export function renewalChainEntry<T extends string>(entityKey: string): RenewalChainEntry<T> | undefined {
  return chains.get(entityKey) as RenewalChainEntry<T> | undefined;
}

/** The cached chain for `entityKey` if it is already complete up to `uptoMs`, else null. */
export function peekRenewalChain<T extends string>(entityKey: string, uptoMs: number): RenewalEvent<T>[] | null {
  const entry = chains.get(entityKey);
  return entry && uptoMs < entry.nextDueMs ? (entry.events as RenewalEvent<T>[]) : null;
}

/** Exported for solarAdoption.ts, which reuses this exact four-factor
 * comparison for a binary "stay without / install" choice — same shape,
 * just without renewalEventsUpTo's periodic wear-out timing around it (solar
 * adoption is triggered by a hazard check, not a fixed service lifetime). */
export function chooseNext<T extends string>(
  candidates: RenewalCandidate<T>[],
  incumbent: T,
  uncertaintyFraction: number,
  biasStrengthRp: number,
): { chosen: T; reasonKind: RenewalReasonKind; bestOverallId: T | null } {
  const scored = candidates.map((c) => ({ ...c, effectiveCostRp: c.annualizedCostRp - biasStrengthRp * c.greenness }));
  const available = scored.filter((c) => c.available);
  if (available.length === 0) return { chosen: incumbent, reasonKind: "inKind", bestOverallId: null };

  const bestOverall = scored.reduce((a, b) => (b.effectiveCostRp < a.effectiveCostRp ? b : a));
  const bestAvailable = available.reduce((a, b) => (b.effectiveCostRp < a.effectiveCostRp ? b : a));
  const incumbentEntry = scored.find((c) => c.id === incumbent);

  if (incumbentEntry?.available) {
    const band = uncertaintyFraction * Math.abs(incumbentEntry.effectiveCostRp);
    if (incumbentEntry.effectiveCostRp <= bestAvailable.effectiveCostRp + band) {
      return { chosen: incumbent, reasonKind: "inKind", bestOverallId: null };
    }
  }
  if (bestOverall.id !== bestAvailable.id) {
    return { chosen: bestAvailable.id, reasonKind: "forcedByAvailability", bestOverallId: bestOverall.id };
  }
  return { chosen: bestAvailable.id, reasonKind: "financial", bestOverallId: null };
}

/** Shared between renewalEventsUpTo below and solarAdoption.ts's own direct
 * chooseNext call — the same effectiveCostRp math chooseNext itself uses
 * internally, exposed so a decision log entry can show what was actually
 * compared (not just the raw annualizedCostRp before the bias adjustment). */
export function candidateLogEntries<T extends string>(
  candidates: RenewalCandidate<T>[],
  biasStrengthRp: number,
  labelFor: (id: T) => string,
): DecisionCandidateLog[] {
  return candidates.map((c) => ({
    id: c.id,
    label: labelFor(c.id),
    available: c.available,
    annualizedCostRp: c.annualizedCostRp,
    effectiveCostRp: c.annualizedCostRp - biasStrengthRp * c.greenness,
    greenness: c.greenness,
  }));
}

function nextLifetimeMs(entityKey: string, eventIndex: number, shape: number, meanYears: number): number {
  const rng = mulberry32(hashSeed(entityKey, "renewal-lifetime", String(eventIndex)));
  return weibullSample(rng, shape, meanYears * 365.25 * 24 * 60 * 60_000);
}

function firstRemainingLifetimeMs(entityKey: string, shape: number, meanYears: number, conditional: boolean): number {
  const ageRng = mulberry32(hashSeed(entityKey, "renewal-initial-age"));
  const lifeRng = mulberry32(hashSeed(entityKey, "renewal-initial-lifetime"));
  const draw = conditional ? weibullConditionalRemainder : weibullAgedRemainder;
  return draw(ageRng, lifeRng, shape, meanYears * 365.25 * 24 * 60 * 60_000);
}

/** Every event for this entity up to and including `uptoMs`, extending and
 * permanently caching the chain as needed. Cheap and side-effect-free to call
 * repeatedly with the same or a larger `uptoMs` (the common case — every
 * render just asks "up to right now"). */
export function renewalEventsUpTo<T extends string>(params: RenewalParams<T>, uptoMs: number): RenewalEvent<T>[] {
  let entry = chains.get(params.entityKey) as RenewalChainEntry<T> | undefined;
  if (entry && uptoMs < entry.nextDueMs) return entry.events;
  if (!entry) {
    entry = {
      events: [{ installedAtMs: Number.NEGATIVE_INFINITY, system: params.initialSystem, previousSystem: null, reasonKind: "initial", bestOverallId: null }],
      nextDueMs: Number.NEGATIVE_INFINITY,
    };
    chains.set(params.entityKey, entry as RenewalChainEntry<string>);
  }
  const chain = entry.events;

  const commit = (atMs: number, incumbent: T, candidates: RenewalCandidate<T>[], early: boolean): T => {
    // Information measures narrow the band; an owner actively looking into an early switch is less set in their ways.
    const uncertaintyFraction = params.uncertaintyFraction * policyStore.get().uncertaintyMultiplier * (early ? EARLY_SWITCH_UNCERTAINTY_SHARE : 1);
    const bias = params.biasStrengthRp + policyStore.get().progressiveNudgeRp;
    const decision = chooseNext(candidates, incumbent, uncertaintyFraction, bias);
    const { chosen, bestOverallId } = decision;
    const reasonKind: RenewalReasonKind = early && chosen !== incumbent ? "early" : decision.reasonKind;
    const winner = candidates.find((c) => c.id === chosen);
    logCandidateDecision({
      atMs,
      kind: params.kind,
      egid: params.egid,
      entityKey: params.entityKey,
      incumbent,
      chosen,
      reasonKind: early ? (chosen !== incumbent ? "early" : "keptEarly") : reasonKind,
      candidates: candidateLogEntries(candidates, params.biasStrengthRp, params.labelFor),
      uncertaintyFraction: params.uncertaintyFraction,
      biasStrengthRp: params.biasStrengthRp,
    });
    if (early && chosen === incumbent) return chosen; // considered it, kept it: no event
    const event: RenewalEvent<T> = {
      installedAtMs: atMs,
      system: chosen,
      previousSystem: incumbent,
      reasonKind,
      bestOverallId,
      municipalSubsidyRp: winner?.municipalSubsidyRp,
      ...(winner?.exception ? { exception: winner.exception } : {}),
    };
    chain.push(event);
    params.onCommit?.(event);
    winner?.onChosen?.(atMs);
    // The money leaves the treasury now, when the decision happens — never before, never for an option nobody takes.
    const category = subsidyCategoryForDecision(params.kind);
    if (category && winner?.municipalSubsidyRp) {
      treasury.recordPayout(category, atMs, winner.municipalSubsidyRp, params.egid);
      // The ground truth for evaluation studies: the same decision without the municipality's money.
      const without = candidates.map((c) => ({ ...c, annualizedCostRp: c.annualizedCostRp + (c.municipalSubsidyRp ?? 0) / c.lifetimeMeanYears }));
      const counterfactual = chooseNext(without, incumbent, uncertaintyFraction, bias).chosen;
      if (category === "heating" || category === "vehicle" || category === "retrofit" || category === "solar") {
        recordSubsidisedDecision({ atMs, category, subsidyRp: winner.municipalSubsidyRp, additional: counterfactual !== chosen });
      }
    }
    return chosen;
  };

  let guard = 0;
  for (; guard < MAX_EVENTS_PER_CALL; guard++) {
    const last = chain[chain.length - 1] as RenewalEvent<T>;
    const eventIndex = chain.length;
    const meanYears = params.lifetimeMeanYearsFor(last.system);
    const nextInstalledAtMs =
      eventIndex === 1 && params.initialInstalledAtMs === undefined
        ? firstRemainingLifetimeMs(params.entityKey, params.weibullShape, meanYears, params.conditionalFirstLifetime === true)
        : (eventIndex === 1 ? (params.initialInstalledAtMs as number) : last.installedAtMs) +
          nextLifetimeMs(params.entityKey, eventIndex, params.weibullShape, meanYears);

    // Before it wears out: once a year from a minimum age, the owner may consider switching early.
    const early = params.early;
    if (early && early.eligible(last.system)) {
      // Its age: from its install, or for a system observed at the start, as far as its expected
      // life says it has come.
      const installedAtMs =
        eventIndex === 1 && params.initialInstalledAtMs === undefined
          ? nextInstalledAtMs - meanYears * YEAR_MS
          : eventIndex === 1
            ? (params.initialInstalledAtMs as number)
            : last.installedAtMs;
      // Each owner on their own day of the year, not all at once at the start.
      const phaseMs = mulberry32(hashSeed(params.entityKey, "early-phase"))() * YEAR_MS;
      let review = Math.max(installedAtMs + early.minAgeYears * YEAR_MS, phaseMs);
      const reviewed = entry.reviewedThroughMs ?? Number.NEGATIVE_INFINITY;
      if (review <= reviewed) review += Math.ceil((reviewed - review) / YEAR_MS + 1e-9) * YEAR_MS;
      let switched = false;
      for (; review < nextInstalledAtMs && review <= uptoMs; review += YEAR_MS) {
        entry.reviewedThroughMs = review;
        const draw = mulberry32(hashSeed(params.entityKey, "early-switch", String(eventIndex), String(Math.round(review / 86_400_000))))();
        if (draw >= early.chanceAt(review, last.system)) continue;
        const ageYears = (review - installedAtMs) / YEAR_MS;
        if (commit(review, last.system, early.candidatesAt(review, last.system, ageYears), true) !== last.system) {
          switched = true;
          break;
        }
      }
      if (switched) continue;
      if (review < nextInstalledAtMs && review > uptoMs) {
        entry.nextDueMs = review; // the next review, before it would wear out
        break;
      }
    }

    if (nextInstalledAtMs > uptoMs) {
      entry.nextDueMs = nextInstalledAtMs;
      break;
    }
    commit(nextInstalledAtMs, last.system, params.candidatesAt(nextInstalledAtMs, last.system), false);
  }
  // Exhausting the guard (rather than breaking out of it) means the chain still
  // hasn't reached `uptoMs` — under engine.ts's MAX_SIM_TIME_MS clock ceiling
  // this shouldn't be reachable for a realistic entity, so it's worth knowing
  // about rather than silently handing back a chain that understates how many
  // renewals have actually happened by `uptoMs`.
  if (guard === MAX_EVENTS_PER_CALL) {
    console.warn(`renewal.ts: ${params.entityKey} hit the ${MAX_EVENTS_PER_CALL}-event generation cap before reaching uptoMs=${uptoMs}`);
  }

  return chain as RenewalEvent<T>[];
}

/** Whichever system was in force at `simTimeMs` — the last event not later than it. */
export function systemAt<T extends string>(events: RenewalEvent<T>[], simTimeMs: number): T {
  let current = events[0].system;
  for (const event of events) {
    if (event.installedAtMs > simTimeMs) break;
    current = event.system;
  }
  return current;
}

// --- saving (saveGame.ts) ---

/** A saved event, as a short array rather than an object with long keys (there are tens of
 * thousands): installedAtMs (null for the starting event's "always"), system, previousSystem,
 * reasonKind, bestOverallId, and — only when set — the municipal subsidy and the exception. */
type SavedEvent = [number | null, string, string | null, RenewalReasonKind, string | null, (number | null)?, string?];
/** A saved entry: its events and — if any were held — how far early reviews went. When the next
 * event falls due is not saved: it is a seeded draw from the last event, made again on the next
 * lookup, exactly as the chain made it the first time. */
type SavedEntry = [SavedEvent[], number?];

export interface RenewalChainsSnapshot {
  /** Chains with a history, or with early reviews held. */
  full: Map<string, SavedEntry>;
  /** Chains that still hold only their starting system: just that. Their next renewal date is
   * a seeded draw, worked out again the next time they are asked. */
  initial: Map<string, string>;
}

function isUntouched(entry: RenewalChainEntry<string>): boolean {
  if (entry.events.length !== 1 || entry.reviewedThroughMs !== undefined) return false;
  const e = entry.events[0];
  return (
    e.installedAtMs === Number.NEGATIVE_INFINITY &&
    e.previousSystem === null &&
    e.reasonKind === "initial" &&
    e.bestOverallId === null &&
    e.municipalSubsidyRp === undefined &&
    e.exception === undefined
  );
}

function packEvent(e: RenewalEvent<string>): SavedEvent {
  const t: SavedEvent = [e.installedAtMs === Number.NEGATIVE_INFINITY ? null : e.installedAtMs, e.system, e.previousSystem, e.reasonKind, e.bestOverallId];
  if (e.exception !== undefined) t.push(e.municipalSubsidyRp ?? null, e.exception);
  else if (e.municipalSubsidyRp !== undefined) t.push(e.municipalSubsidyRp);
  return t;
}

/** Back to the event as the chain builds it (same keys, same order). */
function unpackEvent(t: SavedEvent): RenewalEvent<string> {
  const e: RenewalEvent<string> = { installedAtMs: t[0] ?? Number.NEGATIVE_INFINITY, system: t[1], previousSystem: t[2], reasonKind: t[3], bestOverallId: t[4] };
  if (t[5] !== undefined && t[5] !== null) e.municipalSubsidyRp = t[5];
  if (t[6] !== undefined) e.exception = t[6];
  return e;
}

export function snapshotRenewalChains(): RenewalChainsSnapshot {
  const full = new Map<string, SavedEntry>();
  const initial = new Map<string, string>();
  for (const [key, entry] of chains) {
    if (isUntouched(entry)) {
      initial.set(key, entry.events[0].system);
    } else {
      const saved: SavedEntry = [entry.events.map(packEvent)];
      if (entry.reviewedThroughMs !== undefined) saved.push(entry.reviewedThroughMs);
      full.set(key, saved);
    }
  }
  return { full, initial };
}

/** Puts the saved chains back. Entries that already exist are updated in place, since other
 * modules keep references to them (mobility.ts's slot handles, fleet.ts's vehicles). */
export function restoreRenewalChains(saved: RenewalChainsSnapshot): void {
  const put = (key: string, events: RenewalEvent<string>[], nextDueMs: number, reviewedThroughMs: number | undefined) => {
    const existing = chains.get(key);
    if (existing) {
      existing.events = events;
      existing.nextDueMs = nextDueMs;
      existing.reviewedThroughMs = reviewedThroughMs;
    } else {
      const entry: RenewalChainEntry<string> = { events, nextDueMs };
      if (reviewedThroughMs !== undefined) entry.reviewedThroughMs = reviewedThroughMs;
      chains.set(key, entry);
    }
  };
  for (const [key, [events, reviewedThroughMs]] of saved.full) put(key, events.map(unpackEvent), Number.NEGATIVE_INFINITY, reviewedThroughMs);
  for (const [key, system] of saved.initial) {
    put(key, [{ installedAtMs: Number.NEGATIVE_INFINITY, system, previousSystem: null, reasonKind: "initial", bestOverallId: null }], Number.NEGATIVE_INFINITY, undefined);
  }
  for (const key of [...chains.keys()]) if (!saved.full.has(key) && !saved.initial.has(key)) chains.delete(key);
}
