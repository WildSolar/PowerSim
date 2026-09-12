import { useEffect, useState } from "react";
import { simClock } from "../sim/engine";
import { ZERO_CATEGORY_ENERGY_KWH, type CategoryEnergyKWh } from "../sim/energy";
import { ensurePeriodsCached, getCachedPeriodEnergy, periodsForTier, type PeriodSampler, type PeriodTier } from "../sim/historyLong";

const REFRESH_MS = 5000;

export interface LongHistoryBar {
  label: string;
  energy: CategoryEnergyKWh;
}

/** Bars for the given tier, backed by historyLong.ts's cache. `entityId` is
 * whatever identifies `sampler` uniquely (the municipality's name, a building's
 * EGID, or a dwelling's `egid:ewid`), so two different views' caches never
 * collide. Bars for periods not yet computed read as zero
 * (ZERO_CATEGORY_ENERGY_KWH) until the background chunked computation (see
 * historyLong.ts) fills them in — `loading` is only true while there's genuinely
 * missing work, so an already-cached tier never flickers a loading state on the
 * periodic re-check below. */
export function useLongHistory(
  entityId: string,
  tier: PeriodTier,
  sampler: PeriodSampler,
  tariffKey: string,
): { bars: LongHistoryBar[]; loading: boolean } {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const periods = periodsForTier(tier, simClock.getSimTimeMs());
      const hasMissing = periods.some((p) => getCachedPeriodEnergy(entityId, tier, p, tariffKey) === undefined);
      if (hasMissing && !cancelled) setLoading(true);
      await ensurePeriodsCached(entityId, tier, periods, sampler, tariffKey, () => {
        if (!cancelled) setTick((n) => n + 1);
      });
      if (!cancelled) setLoading(false);
    };

    run();
    const interval = setInterval(run, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Deliberately keyed on entityId/tier/tariffKey rather than `sampler` itself:
    // a caller typically builds that closure fresh on every render (it captures
    // the current tariff, building, etc.), and entityId already changes exactly
    // when the thing being sampled conceptually does — keying on the closure's
    // identity too would re-run this effect on every render instead of only when
    // something that actually invalidates the cache changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, tier, tariffKey]);

  const periods = periodsForTier(tier, simClock.getSimTimeMs());
  const bars = periods.map((p) => ({
    label: p.label,
    energy: getCachedPeriodEnergy(entityId, tier, p, tariffKey) ?? ZERO_CATEGORY_ENERGY_KWH,
  }));

  return { bars, loading };
}
