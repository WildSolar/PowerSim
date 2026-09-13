/**
 * Heat pump electrical load — a building-level device (GWR records heating per
 * building, not per dwelling, and it's one shared system), unlike fridge/lighting/EV
 * which are per-dwelling. No ownership draw is needed either: whether a building has
 * a heat pump is already known from real GWR data (heatingGenerator), not something
 * to guess at with a seed.
 *
 * Simple heat-loss model: heat demand scales with the building's envelope surface
 * area (the roof+walls of the extruded volume already shown on the map) times how
 * far outside temperature sits below a comfort setpoint, converted to electrical
 * draw via a temperature-dependent COP (heat pumps get less efficient as it gets
 * colder — a real and well-known characteristic, and simple to include). Whether a
 * day needs heating at all is decided once per day from the day's characteristic
 * temperature (weather.ts's dailyMeanTempC) rather than the fluctuating instantaneous
 * reading, so heating doesn't flicker on and off across a single cold night — but the
 * power draw within a heating day still scales with the actual instantaneous outside
 * temperature, including its diurnal swing (colder nights draw more).
 */

import type { Building } from "../data/types";
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";
import { impliesHeatPump } from "./heatPumpSources";
import { dailyMeanTempC, weatherAt } from "./weather";

const HEATING_THRESHOLD_C = 12; // day's characteristic temp above this -> heating off for the day
const COMFORT_TEMP_C = 20;
const U_VALUE_W_PER_M2K = 1.0; // rough blended envelope heat-loss coefficient

function copAt(outsideTempC: number): number {
  // ~2.0 at -10C (cold, inefficient) rising to ~4.0 at 10C (mild, efficient).
  return Math.min(4.5, Math.max(1.8, 2.0 + (outsideTempC + 10) * 0.1));
}

export function hasHeatPump(building: Building): boolean {
  if (building.heatingGenerator === "Wärmepumpe für ein Gebäude" || building.heatingGenerator === "Wärmepumpe für mehrere Gebäude") {
    return true;
  }
  return impliesHeatPump(building.heatingEnergySource);
}

/** The building's raw heat-loss demand — envelope area times how far outside
 * temperature sits below comfort, gated by the day's characteristic temperature —
 * independent of *how* that heat gets generated. A heat pump is one way to meet
 * it (divide by COP, below); billing.ts uses this same number directly for
 * buildings whose real heating source is gas or district heat instead, since the
 * physical demand doesn't care what's burning to meet it. Returns 0 for a
 * building with no footprint/height data or on a day that doesn't need heating,
 * regardless of what heats it. */
export function spaceHeatingThermalDemandW(building: Building, dailyMeanC: number, outsideTempC: number): number {
  const envelopeAreaM2 = buildingEnvelopeAreaM2(building);
  if (envelopeAreaM2 === null) return 0;
  if (dailyMeanC >= HEATING_THRESHOLD_C) return 0;

  const deltaTC = Math.max(0, COMFORT_TEMP_C - outsideTempC);
  return U_VALUE_W_PER_M2K * envelopeAreaM2 * deltaTC;
}

/** Takes weather already evaluated by the caller — worth it when scanning many
 * buildings at the same instant (history sampling), since weather doesn't vary by
 * building and recomputing it per building per timestep is pure waste. */
export function heatPumpPowerWWithWeather(building: Building, dailyMeanC: number, outsideTempC: number): number {
  if (!hasHeatPump(building)) return 0;
  const thermalPowerW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC);
  if (thermalPowerW === 0) return 0;
  return thermalPowerW / copAt(outsideTempC);
}

export function heatPumpPowerW(building: Building, simTimeMs: number): number {
  return heatPumpPowerWWithWeather(building, dailyMeanTempC(simTimeMs), weatherAt(simTimeMs).tempC);
}
