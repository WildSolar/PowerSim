import { useEffect, useState } from "react";
import type { Building } from "../data/types";
import {
  computeHeatingRenewalTally,
  computeHeatingTechnologyBreakdown,
  type HeatingTechnologyEnergyKWh,
  type RenewalTallyEntry,
} from "../sim/yearReport";

export interface YearHeatingReport {
  technology: HeatingTechnologyEnergyKWh;
  renewals: RenewalTallyEntry[];
}

/** Runs yearReport.ts's two computations for one completed calendar year —
 * the (expensive, chunked) technology breakdown first, then the (cheap,
 * synchronous) renewal tally, exposed as one loading state since the report
 * card shows both together. Recomputes if `buildings` or `year` change, which
 * in practice only happens when a new year's report card replaces the last
 * one (the report card unmounts/remounts per year — see ReportCardModal). */
export function useYearHeatingReport(buildings: Building[], year: number): { data: YearHeatingReport | null; loading: boolean } {
  const [data, setData] = useState<YearHeatingReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoading(true);

    computeHeatingTechnologyBreakdown(buildings, year, () => cancelled).then((technology) => {
      if (cancelled) return;
      const renewals = computeHeatingRenewalTally(buildings, year);
      setData({ technology, renewals });
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [buildings, year]);

  return { data, loading };
}
