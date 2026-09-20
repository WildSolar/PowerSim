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

import { logCandidateDecision, type DecisionCandidateLog, type DecisionLogKind } from "./decisionLog";
import { hashSeed, mulberry32 } from "./rng";
import { weibullAgedRemainder, weibullSample } from "./weibull";

export interface RenewalCandidate<T extends string> {
  id: T;
  available: boolean;
  annualizedCostRp: number; // straight-line: (installCost - subsidy) / lifetime + running cost, all per year
  lifetimeMeanYears: number;
  /** Signed "how renewable/progressive this option reads" — positive leans
   * renewable, negative leans fossil/conventional. Scaled by the entity's own
   * bias trait when ranking; never shown to the player. */
  greenness: number;
}

export type RenewalReasonKind = "initial" | "inKind" | "forcedByAvailability" | "financial";

export interface RenewalEvent<T extends string> {
  installedAtMs: number;
  system: T;
  previousSystem: T | null; // null only for the synthetic "initial" event
  reasonKind: RenewalReasonKind;
  /** Only set for "forcedByAvailability": the option that would have won on
   * cost alone if it had been available. */
  bestOverallId: T | null;
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
}

const MAX_EVENTS_PER_CALL = 1000; // defensive cap against a misconfigured/runaway chain, not a real limit

const chainCache = new Map<string, RenewalEvent<string>[]>();

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

function firstRemainingLifetimeMs(entityKey: string, shape: number, meanYears: number): number {
  const ageRng = mulberry32(hashSeed(entityKey, "renewal-initial-age"));
  const lifeRng = mulberry32(hashSeed(entityKey, "renewal-initial-lifetime"));
  return weibullAgedRemainder(ageRng, lifeRng, shape, meanYears * 365.25 * 24 * 60 * 60_000);
}

/** Every event for this entity up to and including `uptoMs`, extending and
 * permanently caching the chain as needed. Cheap and side-effect-free to call
 * repeatedly with the same or a larger `uptoMs` (the common case — every
 * render just asks "up to right now"). */
export function renewalEventsUpTo<T extends string>(params: RenewalParams<T>, uptoMs: number): RenewalEvent<T>[] {
  let chain = chainCache.get(params.entityKey);
  if (!chain) {
    chain = [{ installedAtMs: Number.NEGATIVE_INFINITY, system: params.initialSystem, previousSystem: null, reasonKind: "initial", bestOverallId: null }];
    chainCache.set(params.entityKey, chain);
  }

  let guard = 0;
  for (; guard < MAX_EVENTS_PER_CALL; guard++) {
    const last = chain[chain.length - 1] as RenewalEvent<T>;
    const eventIndex = chain.length;
    const meanYears = params.lifetimeMeanYearsFor(last.system);
    const nextInstalledAtMs =
      eventIndex === 1 && params.initialInstalledAtMs === undefined
        ? firstRemainingLifetimeMs(params.entityKey, params.weibullShape, meanYears)
        : (eventIndex === 1 ? (params.initialInstalledAtMs as number) : last.installedAtMs) +
          nextLifetimeMs(params.entityKey, eventIndex, params.weibullShape, meanYears);
    if (nextInstalledAtMs > uptoMs) break;

    const candidates = params.candidatesAt(nextInstalledAtMs, last.system);
    const { chosen, reasonKind, bestOverallId } = chooseNext(candidates, last.system, params.uncertaintyFraction, params.biasStrengthRp);
    chain.push({ installedAtMs: nextInstalledAtMs, system: chosen, previousSystem: last.system, reasonKind, bestOverallId });
    logCandidateDecision({
      atMs: nextInstalledAtMs,
      kind: params.kind,
      egid: params.egid,
      entityKey: params.entityKey,
      incumbent: last.system,
      chosen,
      reasonKind,
      candidates: candidateLogEntries(candidates, params.biasStrengthRp, params.labelFor),
      uncertaintyFraction: params.uncertaintyFraction,
      biasStrengthRp: params.biasStrengthRp,
    });
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
