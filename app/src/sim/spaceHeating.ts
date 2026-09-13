/**
 * The physical space-heating model shared by the live simulation (heatPump.ts,
 * billing.ts) and the stock-renewal financial comparison (heatingRenewal.ts) —
 * split out from heatPump.ts so both can depend on it without heatPump.ts and
 * heatingRenewal.ts depending on each other (heatPump.ts needs to ask
 * heatingRenewal.ts "what's installed right now", and heatingRenewal.ts needs
 * this module's demand/COP model to estimate a candidate's running cost — a
 * cycle if this physics lived in either of those files instead).
 *
 * Simple heat-loss model: heat demand scales with the building's envelope surface
 * area (the roof+walls of the extruded volume already shown on the map) times how
 * far outside temperature sits below a comfort setpoint. A heat pump's COP
 * (electricity in -> heat out) also lives here since it's the other half of "how
 * much energy does meeting this demand with a heat pump actually cost" — ground/
 * water-source reservoirs stay near a stable ~10C year-round, so they get a
 * flatter, higher COP than an air-source pump, which has to work much harder
 * against a sub-zero outside temperature.
 */

import type { Building } from "../data/types";
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";

export const HEATING_THRESHOLD_C = 12; // day's characteristic temp above this -> heating off for the day
export const COMFORT_TEMP_C = 20;
const U_VALUE_W_PER_M2K = 1.0; // rough blended envelope heat-loss coefficient

export type HeatPumpKind = "air" | "ground";

export function copAt(outsideTempC: number, kind: HeatPumpKind): number {
  if (kind === "ground") {
    // Ground/water reservoirs stay close to a stable ~10C year-round, so the
    // COP barely moves with outside air temperature — a gentle slope standing
    // in for "a little more demand on cold days" rather than true reservoir physics.
    return Math.min(4.6, Math.max(3.6, 4.2 + outsideTempC * 0.01));
  }
  // Air-source: ~2.0 at -10C (cold, inefficient) rising to ~4.0 at 10C (mild, efficient).
  return Math.min(4.5, Math.max(1.8, 2.0 + (outsideTempC + 10) * 0.1));
}

/** The building's raw heat-loss demand — envelope area times how far outside
 * temperature sits below comfort, gated by the day's characteristic temperature —
 * independent of *how* that heat gets generated. A heat pump is one way to meet
 * it (divide by COP); billing.ts uses this same number directly for buildings
 * whose real heating source is gas or district heat instead, since the physical
 * demand doesn't care what's burning to meet it. Returns 0 for a building with
 * no footprint/height data or on a day that doesn't need heating, regardless of
 * what heats it. */
export function spaceHeatingThermalDemandW(building: Building, dailyMeanC: number, outsideTempC: number): number {
  const envelopeAreaM2 = buildingEnvelopeAreaM2(building);
  if (envelopeAreaM2 === null) return 0;
  if (dailyMeanC >= HEATING_THRESHOLD_C) return 0;

  const deltaTC = Math.max(0, COMFORT_TEMP_C - outsideTempC);
  return U_VALUE_W_PER_M2K * envelopeAreaM2 * deltaTC;
}
