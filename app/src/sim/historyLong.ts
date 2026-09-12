/**
 * Longer-range energy history for the municipality, a single building, or a
 * single dwelling — day/week/month bars, each a full trapezoidal integration over
 * its own period (reusing energy.ts, the same machinery the existing 24h charts
 * use), not a derived or approximated rollup. Deliberately doesn't know *how* to
 * sample a CategorySeries itself — the caller hands in a `PeriodSampler` closure
 * (sampleMunicipalityCategorySeries/sampleBuildingCategorySeries/
 * sampleDwellingCategorySeries from history.ts, whichever fits what's being
 * shown), so this module only owns period math, caching, and chunking. Every
 * caller is identified by `entityId` (the municipality's name, a building's EGID,
 * or `${egid}:${ewid}` for a dwelling) so the cache below can't mix views up.
 *
 * Only *fully completed* periods are ever shown (today isn't part of the "last 7
 * days," this month isn't part of the "last 12 months") — deliberately, so every
 * bar is a fixed, immutable quantity the moment it's computed (a finished day/
 * week/month is a pure function of its own closed time range, and never changes
 * again), which is what makes caching it forever both correct and simple: no bar
 * ever needs to be recomputed once it exists, only newly-completed ones need to be
 * added as simulated time moves forward.
 *
 * Even at a modest per-bar sample count, a whole municipality-wide tier's worth of
 * bars costs real time (each sample re-evaluates every dwelling — measured
 * ~12-13ms/sample on a mid-range machine, so a 12-13 bar tier at 24 samples/bar is
 * ~3.5-4s) — too long to block the main thread in one synchronous call, so
 * computing an uncached tier is chunked one period at a time with a yield back to
 * the event loop between each, rather than all at once. A single building or
 * dwelling's sampler makes the same computation effectively instant, but reuses
 * the identical chunked path rather than a special-cased fast one.
 */

import { dayOfWeek, MONTH_NAMES, toDateMs, toSimTimeMs, WEEKDAY_NAMES } from "./calendar";
import { categoryEnergyFromSeries, type CategoryEnergyKWh } from "./energy";
import type { CategorySeries } from "./history";

export type PeriodTier = "day" | "week" | "month";

const DAY_MS = 24 * 60 * 60_000;
const SAMPLES_PER_PERIOD = 24;
const TIER_COUNT: Record<PeriodTier, number> = { day: 7, week: 13, month: 12 };

export interface Period {
  startMs: number; // simTimeMs
  endMs: number; // simTimeMs
  label: string;
}

function startOfUtcDay(dateMs: number): number {
  return Math.floor(dateMs / DAY_MS) * DAY_MS;
}

function startOfUtcWeek(dateMs: number): number {
  const dayStart = startOfUtcDay(dateMs);
  const daysSinceMonday = (dayOfWeek(dayStart) + 6) % 7; // dayOfWeek: 0 Sun - 6 Sat
  return dayStart - daysSinceMonday * DAY_MS;
}

function startOfUtcMonth(dateMs: number): number {
  const d = new Date(dateMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** The N most recent fully-completed periods for a tier, ending at the most
 * recent period boundary at or before `nowSimTimeMs` — so "now" being mid-week
 * never produces a truncated, still-growing bar. Boundary arithmetic is done in
 * real calendar terms (a "week" means Monday-Sunday, a "month" means an actual
 * calendar month) and converted back to simTimeMs at the end, since that's the
 * domain every sampling function downstream expects. */
export function periodsForTier(tier: PeriodTier, nowSimTimeMs: number): Period[] {
  const nowDateMs = toDateMs(nowSimTimeMs);
  const count = TIER_COUNT[tier];
  const periods: Period[] = [];

  if (tier === "day") {
    const todayStart = startOfUtcDay(nowDateMs);
    for (let i = count; i >= 1; i--) {
      const startMs = todayStart - i * DAY_MS;
      const d = new Date(startMs);
      periods.push({
        startMs: toSimTimeMs(startMs),
        endMs: toSimTimeMs(startMs + DAY_MS),
        label: `${WEEKDAY_NAMES[dayOfWeek(startMs)]} ${d.getUTCDate()}`,
      });
    }
  } else if (tier === "week") {
    const thisWeekStart = startOfUtcWeek(nowDateMs);
    for (let i = count; i >= 1; i--) {
      const startMs = thisWeekStart - i * 7 * DAY_MS;
      const d = new Date(startMs);
      periods.push({
        startMs: toSimTimeMs(startMs),
        endMs: toSimTimeMs(startMs + 7 * DAY_MS),
        label: `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`,
      });
    }
  } else {
    const thisMonthStart = startOfUtcMonth(nowDateMs);
    const thisMonthD = new Date(thisMonthStart);
    for (let i = count; i >= 1; i--) {
      const startMs = Date.UTC(thisMonthD.getUTCFullYear(), thisMonthD.getUTCMonth() - i, 1);
      const endMs = Date.UTC(thisMonthD.getUTCFullYear(), thisMonthD.getUTCMonth() - i + 1, 1);
      const d = new Date(startMs);
      periods.push({
        startMs: toSimTimeMs(startMs),
        endMs: toSimTimeMs(endMs),
        label: `${MONTH_NAMES[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`,
      });
    }
  }
  return periods;
}

const periodCache = new Map<string, CategoryEnergyKWh>();

function cacheKey(entityId: string, tier: PeriodTier, period: Period, tariffKey: string): string {
  return `${entityId}:${tier}:${period.startMs}:${tariffKey}`;
}

export function getCachedPeriodEnergy(entityId: string, tier: PeriodTier, period: Period, tariffKey: string): CategoryEnergyKWh | undefined {
  return periodCache.get(cacheKey(entityId, tier, period, tariffKey));
}

/** Produces a CategorySeries for whatever entity a caller is showing, given the
 * timestamps to sample at — history.ts's sampleMunicipalityCategorySeries,
 * sampleBuildingCategorySeries, and sampleDwellingCategorySeries all already have
 * this exact shape once their other arguments (buildings/tariff/plants, or a
 * dwelling) are bound via a closure at the call site. */
export type PeriodSampler = (times: number[]) => CategorySeries;

function samplePeriodEnergy(sampler: PeriodSampler, period: Period): CategoryEnergyKWh {
  const stepMs = (period.endMs - period.startMs) / (SAMPLES_PER_PERIOD - 1);
  const times = Array.from({ length: SAMPLES_PER_PERIOD }, (_, i) => period.startMs + i * stepMs);
  return categoryEnergyFromSeries(times, sampler(times));
}

/** Computes and caches every not-yet-cached period in `periods`, one at a time
 * with a yield to the event loop between each — see module docs for why this
 * can't just be a plain loop. `onPeriodDone` fires after each period lands in the
 * cache, so a caller can re-render progressively instead of waiting for the whole
 * tier. */
export async function ensurePeriodsCached(
  entityId: string,
  tier: PeriodTier,
  periods: Period[],
  sampler: PeriodSampler,
  tariffKey: string,
  onPeriodDone?: () => void,
): Promise<void> {
  const missing = periods.filter((p) => getCachedPeriodEnergy(entityId, tier, p, tariffKey) === undefined);
  for (let i = 0; i < missing.length; i++) {
    const period = missing[i];
    const energy = samplePeriodEnergy(sampler, period);
    periodCache.set(cacheKey(entityId, tier, period, tariffKey), energy);
    onPeriodDone?.();
    if (i < missing.length - 1) await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
