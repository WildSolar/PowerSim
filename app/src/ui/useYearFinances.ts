import { useEffect, useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { computeCumulativeBalanceRp, computeMunicipalFinancesForYear, type MunicipalFinances } from "../sim/finances";
import { BASELINE_YEAR } from "./useYearEmissions";

export interface YearFinances {
  current: MunicipalFinances;
  balanceRp: number; // treasury balance accumulated from BASELINE_YEAR through this year, inclusive
}

/** This year's own revenue/cost breakdown plus the running treasury balance
 * through this year — the balance only ever costs *this* year's computation
 * once every earlier year has already been seen (computeCumulativeBalanceRp
 * caches by year forever), which is the normal way play proceeds since the
 * clock always pauses at each year boundary. */
export function useYearFinances(dataset: MunicipalityDataset, year: number): { data: YearFinances | null; loading: boolean } {
  const [data, setData] = useState<YearFinances | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoading(true);

    (async () => {
      const current = await computeMunicipalFinancesForYear(dataset.buildings, dataset.powerPlants, year, () => cancelled);
      if (cancelled) return;
      const balanceRp = await computeCumulativeBalanceRp(dataset.buildings, dataset.powerPlants, year, BASELINE_YEAR, () => cancelled);
      if (cancelled) return;
      setData({ current, balanceRp });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dataset, year]);

  return { data, loading };
}
