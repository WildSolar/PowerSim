import { useMemo } from "react";
import type { Building, PowerPlant } from "../data/types";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";

const DAY_MS = 24 * 60 * 60_000;

/** Real Pronovo plants plus every solar adoption reached so far, for a
 * building/dwelling panel's live view — memoized to whole simulated days,
 * matching the day-level precision of solar adoption's own random
 * install-day draw (see solarAdoption.ts), so a panel re-rendering every
 * frame via useSimTime doesn't redo effectivePowerPlantsAt's work (an
 * iteration over every adopted building) on every single one of those
 * frames — only when the simulated day actually changes. */
export function useLivePowerPlants(allBuildings: Building[], realPlants: PowerPlant[], simTimeMs: number): PowerPlant[] {
  const dayBucketMs = Math.floor(simTimeMs / DAY_MS) * DAY_MS;
  return useMemo(
    () => effectivePowerPlantsAt(allBuildings, realPlants, dayBucketMs),
    [allBuildings, realPlants, dayBucketMs],
  );
}
