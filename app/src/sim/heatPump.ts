/**
 * Heat pump electrical load — a building-level device (GWR records heating per
 * building, not per dwelling, and it's one shared system), unlike fridge/lighting/EV
 * which are per-dwelling. Whether — and which kind of — heat pump a building has
 * is resolved through heatingRenewal.ts rather than read directly off GWR: it
 * starts from the real GWR-observed system, but can change over simulated time
 * as that system reaches end of life and gets replaced (see heatingRenewal.ts).
 *
 * Simple heat-loss model (spaceHeating.ts): heat demand scales with the
 * building's envelope surface area times how far outside temperature sits below
 * a comfort setpoint, converted to electrical draw via a temperature-dependent
 * COP that also depends on whether the reservoir is air or ground/water (ground
 * stays milder, so it's both more efficient and more stable). Whether a day
 * needs heating at all is decided once per day from the day's characteristic
 * temperature (weather.ts's dailyMeanTempC) rather than the fluctuating
 * instantaneous reading, so heating doesn't flicker on and off across a single
 * cold night — but the power draw within a heating day still scales with the
 * actual instantaneous outside temperature, including its diurnal swing (colder
 * nights draw more).
 */

import type { Building } from "../data/types";
import { currentHeatingSystemId } from "./heatingRenewal";
import { copAt, spaceHeatingThermalDemandW } from "./spaceHeating";
import { dailyMeanTempC, weatherAt } from "./weather";

export function hasHeatPump(building: Building, simTimeMs: number): boolean {
  const id = currentHeatingSystemId(building, simTimeMs);
  return id === "airHeatPump" || id === "groundHeatPump";
}

/** Takes weather already evaluated by the caller — worth it when scanning many
 * buildings at the same instant (history sampling), since weather doesn't vary by
 * building and recomputing it per building per timestep is pure waste. */
export function heatPumpPowerWWithWeather(building: Building, dailyMeanC: number, outsideTempC: number, simTimeMs: number): number {
  const id = currentHeatingSystemId(building, simTimeMs);
  if (id !== "airHeatPump" && id !== "groundHeatPump") return 0;
  const thermalPowerW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC, simTimeMs);
  if (thermalPowerW === 0) return 0;
  return thermalPowerW / copAt(outsideTempC, id === "groundHeatPump" ? "ground" : "air");
}

export function heatPumpPowerW(building: Building, simTimeMs: number): number {
  return heatPumpPowerWWithWeather(building, dailyMeanTempC(simTimeMs), weatherAt(simTimeMs).tempC, simTimeMs);
}
