import { useEffect, useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import type { CategoryEnergyKWh } from "../sim/energy";
import { yearCategoryEnergyKWh, yearDhHeatPumpKWh } from "../sim/yearReport";

export type YearEnergy = CategoryEnergyKWh & { dhHeatPumpKWh: number };

/** A completed calendar year's municipality-wide energy per category, and what the district heating
 * heat pumps drew, from yearReport.ts's shared year pass — the same one emissions and finances
 * read, so the report card's sections share a single sampling of the year rather than each doing
 * their own. */
export function useYearCategoryEnergy(dataset: MunicipalityDataset, year: number): { data: YearEnergy | null; loading: boolean } {
  const [data, setData] = useState<YearEnergy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoading(true);
    Promise.all([yearCategoryEnergyKWh(dataset.buildings, dataset.powerPlants, year), yearDhHeatPumpKWh(dataset.buildings, dataset.powerPlants, year)]).then(([energy, dhHeatPumpKWh]) => {
      if (cancelled) return;
      setData({ ...energy, dhHeatPumpKWh });
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dataset, year]);

  return { data, loading };
}
