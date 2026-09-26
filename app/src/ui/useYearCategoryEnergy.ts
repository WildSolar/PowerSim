import { useEffect, useState } from "react";
import type { MunicipalityDataset } from "../data/types";
import type { CategoryEnergyKWh } from "../sim/energy";
import { yearCategoryEnergyKWh } from "../sim/yearReport";

/** A completed calendar year's municipality-wide energy per category, from yearReport.ts's shared
 * year pass — the same one emissions and finances read, so the report card's sections share a
 * single sampling of the year rather than each doing their own. */
export function useYearCategoryEnergy(dataset: MunicipalityDataset, year: number): { data: CategoryEnergyKWh | null; loading: boolean } {
  const [data, setData] = useState<CategoryEnergyKWh | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setLoading(true);
    yearCategoryEnergyKWh(dataset.buildings, dataset.powerPlants, year).then((energy) => {
      if (cancelled) return;
      setData(energy);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dataset, year]);

  return { data, loading };
}
