/**
 * A lightweight sibling to renewal.ts for choices that reassign by a plain
 * weighted-random draw from a target distribution rather than a cost
 * comparison — mobility.ts's *mode* tier (car/bike/other), reassigned by
 * "life events" (a new job, a child, ...) rather than anything wearing out.
 *
 * Deliberately a separate, smaller engine rather than reusing renewal.ts:
 * the two "decide" rules are genuinely different (a four-factor cost
 * comparison vs. a flat weighted redraw), and renewal.ts's
 * RenewalCandidate/RenewalEvent shapes are already built around the cost
 * comparison's own vocabulary (annualizedCostRp, reasonKind, bestOverallId)
 * that doesn't fit a life-event reassignment. The chain-timing/caching shell
 * below intentionally mirrors renewal.ts's — see that module's own doc —
 * since both model the same underlying idea: a chain of dated events, only
 * ever extended up to a requested instant and frozen once committed, so a
 * later change to the target shares (a future policy lever) only ever
 * affects renewals still to come, never rewrites one already decided.
 */

import { hashSeed, mulberry32 } from "./rng";
import { weibullAgedRemainder, weibullSample } from "./weibull";

const YEAR_MS = 365.25 * 24 * 60 * 60_000;
const MAX_EVENTS_PER_CALL = 2000; // higher than renewal.ts's — mode changes are on a shorter mean cadence than heating's

export interface ModeEvent<T extends string> {
  installedAtMs: number;
  choice: T;
  previousChoice: T | null; // null only for the synthetic "initial" event
}

export interface ModeRenewalParams<T extends string> {
  /** Unique per entity, e.g. `${egid}:${ewid}:mobility-mode:${slotIndex}`. */
  entityKey: string;
  weibullShape: number;
  lifetimeMeanYears: number;
  /** Target shares (need not sum to exactly 1 — normalized internally),
   * evaluated fresh every time a choice is actually drawn — a policy lever
   * changing these takes effect from the next life event on, the same way a
   * changed tariff only affects a heating decision not yet made. */
  targetShares: () => Record<T, number>;
}

const chainCache = new Map<string, ModeEvent<string>[]>();

function weightedPick<T extends string>(shares: Record<T, number>, u: number): T {
  const entries = Object.entries(shares) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  if (total <= 0) return entries[0][0];
  const target = u * total;
  let acc = 0;
  for (const [key, w] of entries) {
    acc += Math.max(0, w);
    if (target < acc) return key;
  }
  return entries[entries.length - 1][0];
}

function nextLifetimeMs(entityKey: string, eventIndex: number, shape: number, meanYears: number): number {
  const rng = mulberry32(hashSeed(entityKey, "mode-lifetime", String(eventIndex)));
  return weibullSample(rng, shape, meanYears * YEAR_MS);
}

function firstRemainingLifetimeMs(entityKey: string, shape: number, meanYears: number): number {
  const ageRng = mulberry32(hashSeed(entityKey, "mode-initial-age"));
  const lifeRng = mulberry32(hashSeed(entityKey, "mode-initial-lifetime"));
  return weibullAgedRemainder(ageRng, lifeRng, shape, meanYears * YEAR_MS);
}

/** Every event for this entity up to and including `uptoMs` — see
 * renewal.ts's renewalEventsUpTo for the identical caching contract. */
export function modeEventsUpTo<T extends string>(params: ModeRenewalParams<T>, uptoMs: number): ModeEvent<T>[] {
  let chain = chainCache.get(params.entityKey);
  if (!chain) {
    // No per-dwelling real data exists to anchor an "initial" mode to
    // (unlike heating's real GWR snapshot), so the very first choice is
    // itself a weighted-random draw from the same target shares — seeded
    // independently of the lifetime draws below.
    const initialRng = mulberry32(hashSeed(params.entityKey, "mode-initial-choice"));
    const initialChoice = weightedPick(params.targetShares(), initialRng());
    chain = [{ installedAtMs: Number.NEGATIVE_INFINITY, choice: initialChoice, previousChoice: null }];
    chainCache.set(params.entityKey, chain);
  }

  let guard = 0;
  for (; guard < MAX_EVENTS_PER_CALL; guard++) {
    const last = chain[chain.length - 1] as ModeEvent<T>;
    const eventIndex = chain.length;
    const nextInstalledAtMs =
      eventIndex === 1
        ? firstRemainingLifetimeMs(params.entityKey, params.weibullShape, params.lifetimeMeanYears)
        : last.installedAtMs + nextLifetimeMs(params.entityKey, eventIndex, params.weibullShape, params.lifetimeMeanYears);
    if (nextInstalledAtMs > uptoMs) break;

    const rng = mulberry32(hashSeed(params.entityKey, "mode-choice", String(eventIndex)));
    const choice = weightedPick(params.targetShares(), rng());
    chain.push({ installedAtMs: nextInstalledAtMs, choice, previousChoice: last.choice });
  }
  if (guard === MAX_EVENTS_PER_CALL) {
    console.warn(`modeRenewal.ts: ${params.entityKey} hit the ${MAX_EVENTS_PER_CALL}-event generation cap before reaching uptoMs=${uptoMs}`);
  }

  return chain as ModeEvent<T>[];
}

export function modeAt<T extends string>(events: ModeEvent<T>[], simTimeMs: number): T {
  let current = events[0].choice;
  for (const event of events) {
    if (event.installedAtMs > simTimeMs) break;
    current = event.choice;
  }
  return current;
}
