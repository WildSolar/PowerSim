import type { Building, PowerPlant } from "../data/types";
import { dwellingDevicePowerW } from "./devices";
import { buildingEvTraits, evPowerWFromTraits } from "./ev";
import { heatPumpPowerW } from "./heatPump";
import { pvPowerForBuildingW } from "./pv";
import { tariffStore } from "./tariffStore";

/** Net of every dwelling's live device draw, the building's own heat pump (if any),
 * and any rooftop solar (negative — a credit), at a point in simulated time. */
export function buildingPowerW(building: Building, simTimeMs: number, plants: PowerPlant[]): number {
  let total = heatPumpPowerW(building, simTimeMs) + pvPowerForBuildingW(building.egid, plants, simTimeMs);
  const tariff = tariffStore.get();
  for (const dwelling of building.dwellings) {
    const { fridgeW, lightingW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
    const evW = evPowerWFromTraits(building.egid, dwelling, buildingEvTraits(building, dwelling), simTimeMs, tariff);
    total += fridgeW + lightingW + evW;
  }
  return total;
}
