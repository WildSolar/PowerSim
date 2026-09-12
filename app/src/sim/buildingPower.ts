import type { Building, PowerPlant } from "../data/types";
import { acPowerW } from "./ac";
import { dwellingDevicePowerW } from "./devices";
import { buildingEvTraits, evPowerWFromTraits } from "./ev";
import { heatPumpPowerW } from "./heatPump";
import { pvPowerForBuildingW } from "./pv";
import { snowDepthCm } from "./snow";
import { tariffStore } from "./tariffStore";

/** Net of every dwelling's live device draw, the building's own heat pump and AC (if
 * any), and any rooftop solar (negative — a credit), at a point in simulated time.
 * `snowCoverCm` can be precomputed once by a caller scanning many buildings at the
 * same instant (see MapView's power-draw tick) rather than have each one redo the
 * same 30-day snow lookback; defaults to computing it fresh for a single call. */
export function buildingPowerW(building: Building, simTimeMs: number, plants: PowerPlant[], snowCoverCm?: number): number {
  const snow = snowCoverCm ?? snowDepthCm(simTimeMs);
  let total =
    heatPumpPowerW(building, simTimeMs) + acPowerW(building, simTimeMs) + pvPowerForBuildingW(building.egid, plants, simTimeMs, snow);
  const tariff = tariffStore.get();
  for (const dwelling of building.dwellings) {
    const { fridgeW, lightingW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
    const evW = evPowerWFromTraits(building.egid, dwelling, buildingEvTraits(building, dwelling), simTimeMs, tariff);
    total += fridgeW + lightingW + evW;
  }
  return total;
}
