import type { Building, PowerPlant } from "../data/types";
import { acPowerW } from "./ac";
import { existsAt } from "./lifetime";
import { commercialPowerW } from "./commercial";
import { dwellingDevicePowerW } from "./devices";
import { heatPumpPowerW } from "./heatPump";
import { mobilityChargingPowerW } from "./mobility";
import { fleets } from "./fleet";
import { pvPowerForBuildingW } from "./pv";
import { snowDepthCm } from "./snow";
import { tariffStore } from "./tariffStore";
import { waterHeatingPowerW } from "./waterHeating";

/** Net of every dwelling's live device draw, the building's own heat pump, AC,
 * electric water heating, non-residential/commercial use (if any), its businesses' electric vans
 * and lorries charging at the depot (fleet.ts), and any
 * rooftop solar (negative — a credit), at a point in simulated time. `snowCoverCm`
 * can be precomputed once by a caller scanning many buildings at the same instant
 * (see MapView's power-draw tick) rather than have each one redo the same 30-day
 * snow lookback; defaults to computing it fresh for a single call. */
export function buildingPowerW(building: Building, simTimeMs: number, plants: PowerPlant[], snowCoverCm?: number): number {
  if (!existsAt(building, simTimeMs)) return 0; // not built yet, or already demolished
  const snow = snowCoverCm ?? snowDepthCm(simTimeMs);
  let total =
    heatPumpPowerW(building, simTimeMs) +
    acPowerW(building, simTimeMs) +
    waterHeatingPowerW(building, simTimeMs) +
    commercialPowerW(building, simTimeMs) +
    fleets.depotPowerW(building, simTimeMs) +
    pvPowerForBuildingW(building.egid, plants, simTimeMs, snow);
  const tariff = tariffStore.get();
  for (const dwelling of building.dwellings) {
    const { fridgeW, lightingW, cookingW, laundryW, plugLoadW } = dwellingDevicePowerW(building.egid, dwelling, simTimeMs);
    const evW = mobilityChargingPowerW(building.egid, dwelling, simTimeMs, tariff);
    total += fridgeW + lightingW + cookingW + laundryW + plugLoadW + evW;
  }
  return total;
}
