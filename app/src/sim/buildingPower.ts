import type { Building } from "../data/types";
import { dwellingDevicePowerW } from "./devices";
import { buildingEvTraits, evPowerWFromTraits } from "./ev";
import { tariffStore } from "./tariffStore";

/** Sum of every dwelling's live device draw in a building, at a point in simulated time. */
export function buildingPowerW(building: Building, simTimeMs: number): number {
  let total = 0;
  const tariff = tariffStore.get();
  for (const dwelling of building.dwellings) {
    const { fridgeW, lightingW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
    const evW = evPowerWFromTraits(building.egid, dwelling, buildingEvTraits(building, dwelling), simTimeMs, tariff);
    total += fridgeW + lightingW + evW;
  }
  return total;
}
