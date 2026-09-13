import { useEffect, useState } from "react";
import { simClock } from "../sim/engine";
import { ZERO_CATEGORY_ENERGY_KWH, type CategoryEnergyKWh } from "../sim/energy";
import { ensurePeriodsCached, getCachedPeriodEnergy, periodsForTier, type PeriodSampler, type PeriodTier } from "../sim/historyLong";

export type PieGranularity = "day" | "week" | "month" | "year";

const REFRESH_MS = 5000;

function addEnergy(a: CategoryEnergyKWh, b: CategoryEnergyKWh): CategoryEnergyKWh {
  const sum = { ...a } as Record<keyof CategoryEnergyKWh, number>;
  for (const key of Object.keys(sum) as (keyof CategoryEnergyKWh)[]) sum[key] += b[key];
  return sum as CategoryEnergyKWh;
}

/** Which of historyLong.ts's periods to read for a given granularity: `week`/
 * `month` want just the single most recently completed period of that tier,
 * `year` sums the last 12 completed months (mirroring the Bill's own Day/Month/
 * Year convention — see useBillSummary.ts's monthAndYearBills). `day` has no
 * tier here at all: it's the live rolling last-24h reading the caller already
 * computes for the Net power chart, reused as-is rather than duplicated. */
function periodsNeeded(granularity: "week" | "month" | "year", nowSimTimeMs: number): { tier: PeriodTier; periods: ReturnType<typeof periodsForTier> } {
  const tier: PeriodTier = granularity === "week" ? "week" : "month";
  const all = periodsForTier(tier, nowSimTimeMs);
  return { tier, periods: granularity === "year" ? all : all.slice(-1) };
}

/** Energy for the most recently completed period of `granularity`, backed by
 * historyLong.ts's cache — so it's instant and free if the History tab already
 * computed the same tier, and does no background work at all while `day` is
 * selected (the caller handles that case itself). */
export function usePeriodPieEnergy(
  entityId: string,
  granularity: PieGranularity,
  sampler: PeriodSampler,
  tariffKey: string,
): { energy: CategoryEnergyKWh | null; loading: boolean } {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (granularity === "day") return;
    let cancelled = false;
    const { tier, periods } = periodsNeeded(granularity, simClock.getSimTimeMs());

    const run = async () => {
      await ensurePeriodsCached(entityId, tier, periods, sampler, tariffKey, () => {
        if (!cancelled) setTick((n) => n + 1);
      });
    };

    run();
    const interval = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Deliberately excludes `sampler` — see useLongHistory.ts's identical note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, granularity, tariffKey]);

  if (granularity === "day") return { energy: null, loading: false };

  const { tier, periods } = periodsNeeded(granularity, simClock.getSimTimeMs());
  const energies = periods.map((p) => getCachedPeriodEnergy(entityId, tier, p, tariffKey));
  if (energies.some((e) => e === undefined)) return { energy: null, loading: true };
  return { energy: (energies as CategoryEnergyKWh[]).reduce(addEnergy, ZERO_CATEGORY_ENERGY_KWH), loading: false };
}
