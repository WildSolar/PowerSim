import { useEffect, useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { simClock } from "../sim/engine";
import { ZERO_CATEGORY_ENERGY_KWH, type CategoryEnergyKWh } from "../sim/energy";
import { ensurePeriodsCached, getCachedPeriodEnergy, periodsForTier, type PeriodTier } from "../sim/historyLong";
import type { Tariff } from "../sim/tariff";

const REFRESH_MS = 5000;

export interface LongHistoryBar {
  label: string;
  energy: CategoryEnergyKWh;
}

/** Bars for the given tier, backed by historyLong.ts's cache. Bars for periods not
 * yet computed read as zero (ZERO_CATEGORY_ENERGY_KWH) until the background chunked
 * computation (see historyLong.ts) fills them in — `loading` is only true while
 * there's genuinely missing work, so an already-cached tier never flickers a
 * loading state on the periodic re-check below. */
export function useLongHistory(tier: PeriodTier, dataset: MunicipalityDataset, tariff: Tariff): { bars: LongHistoryBar[]; loading: boolean } {
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const tariffKey = `${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}`;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const periods = periodsForTier(tier, simClock.getSimTimeMs());
      const hasMissing = periods.some((p) => getCachedPeriodEnergy(tier, p, tariffKey) === undefined);
      if (hasMissing && !cancelled) setLoading(true);
      await ensurePeriodsCached(tier, periods, dataset, tariff, tariffKey, () => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier, dataset, tariffKey]);

  const periods = periodsForTier(tier, simClock.getSimTimeMs());
  const bars = periods.map((p) => ({
    label: p.label,
    energy: getCachedPeriodEnergy(tier, p, tariffKey) ?? ZERO_CATEGORY_ENERGY_KWH,
  }));

  return { bars, loading };
}
