import { useEffect, useState } from "react";
import type { Building, PowerPlant } from "../data/types";
import { simClock } from "../sim/engine";
import { ZERO_CATEGORY_ENERGY_KWH, type CategoryEnergyKWh } from "../sim/energy";
import { ensurePeriodsCached, getCachedPeriodEnergy, periodsForTier, type PeriodTier } from "../sim/historyLong";
import type { Tariff } from "../sim/tariff";

const REFRESH_MS = 5000;

export interface LongHistoryBar {
  label: string;
  energy: CategoryEnergyKWh;
}

/** Bars for the given tier, backed by historyLong.ts's cache. `entityId` is the
 * municipality's name or a building's EGID — whatever identifies `buildings` (the
 * full municipality list, or a single-element array for one building) uniquely,
 * so two different views' caches never collide. Bars for periods not yet computed
 * read as zero (ZERO_CATEGORY_ENERGY_KWH) until the background chunked computation
 * (see historyLong.ts) fills them in — `loading` is only true while there's
 * genuinely missing work, so an already-cached tier never flickers a loading
 * state on the periodic re-check below. */
export function useLongHistory(
  entityId: string,
  tier: PeriodTier,
  buildings: Building[],
  plants: PowerPlant[],
  tariff: Tariff,
): { bars: LongHistoryBar[]; loading: boolean } {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const tariffKey = `${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}`;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const periods = periodsForTier(tier, simClock.getSimTimeMs());
      const hasMissing = periods.some((p) => getCachedPeriodEnergy(entityId, tier, p, tariffKey) === undefined);
      if (hasMissing && !cancelled) setLoading(true);
      await ensurePeriodsCached(entityId, tier, periods, buildings, plants, tariff, tariffKey, () => {
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
    // Deliberately keyed on entityId rather than `buildings`/`plants` themselves:
    // a caller passing a single building often builds that array fresh (`[building]`)
    // on every render, and entityId (the building's EGID, or "municipality")
    // already changes exactly when the underlying buildings/plants conceptually
    // do — keying on the array reference too would re-run this effect every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, tier, tariffKey]);

  const periods = periodsForTier(tier, simClock.getSimTimeMs());
  const bars = periods.map((p) => ({
    label: p.label,
    energy: getCachedPeriodEnergy(entityId, tier, p, tariffKey) ?? ZERO_CATEGORY_ENERGY_KWH,
  }));

  return { bars, loading };
}
