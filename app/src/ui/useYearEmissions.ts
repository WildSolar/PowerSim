import { useEffect, useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import { EPOCH_MS } from "../sim/calendar";
import { computeEmissionsForYear, type EmissionsBreakdown } from "../sim/emissions";

/** The calendar year simulated time started in — "the initial state's
 * emissions" the design calls for as the net-zero baseline. */
export const BASELINE_YEAR = new Date(EPOCH_MS).getUTCFullYear();

// A single end-goal for now — no interim checkpoints or difficulty-setting
// yet (both still genuinely undecided), just the headline target.
export const NET_ZERO_TARGET_YEAR = 2050;

export interface YearEmissions {
  current: EmissionsBreakdown;
  baseline: EmissionsBreakdown;
}

/** This year's emissions plus the baseline year's — the baseline is only
 * ever computed once (computeEmissionsForYear caches by year forever), so
 * every report after the very first one gets it for free. */
export function useYearEmissions(dataset: MunicipalityDataset, year: number): { data: YearEmissions | null; loading: boolean } {
  const [data, setData] = useState<YearEmissions | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoading(true);

    (async () => {
      const current = await computeEmissionsForYear(dataset.buildings, dataset.powerPlants, year, () => cancelled);
      if (cancelled) return;
      const baseline =
        year === BASELINE_YEAR ? current : await computeEmissionsForYear(dataset.buildings, dataset.powerPlants, BASELINE_YEAR, () => cancelled);
      if (cancelled) return;
      setData({ current, baseline });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [dataset, year]);

  return { data, loading };
}
