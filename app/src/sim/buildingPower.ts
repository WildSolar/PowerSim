import type { Building } from "../data/types";
import { dwellingDevicePowerW } from "./devices";

/** Sum of every dwelling's live device draw in a building, at a point in simulated time. */
export function buildingPowerW(building: Building, simTimeMs: number): number {
  let total = 0;
  for (const dwelling of building.dwellings) {
    const { fridgeW, lightingW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
    total += fridgeW + lightingW;
  }
  return total;
}
