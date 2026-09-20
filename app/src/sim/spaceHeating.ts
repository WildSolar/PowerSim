/**
 * The physical space-heating model shared by the live simulation (heatPump.ts,
 * billing.ts) and the stock-renewal financial comparison (heatingRenewal.ts) —
 * split out from heatPump.ts so both can depend on it without heatPump.ts and
 * heatingRenewal.ts depending on each other (heatPump.ts needs to ask
 * heatingRenewal.ts "what's installed right now", and heatingRenewal.ts needs
 * this module's demand/COP model to estimate a candidate's running cost — a
 * cycle if this physics lived in either of those files instead).
 *
 * Heat-loss model: heat demand scales with the building's envelope surface
 * area (the roof+walls of the extruded volume already shown on the map) times
 * how far outside temperature sits below an effective comfort setpoint,
 * through a per-building U-value (buildingThermalProfile below) rather than
 * one flat number for every building — see that function's own doc for the
 * three factors (age, usage, a random quality draw) it combines. A heat
 * pump's COP (electricity in -> heat out) also lives here since it's the
 * other half of "how much energy does meeting this demand with a heat pump
 * actually cost" — ground/water-source reservoirs stay near a stable ~10C
 * year-round, so they get a flatter, higher COP than an air-source pump,
 * which has to work much harder against a sub-zero outside temperature.
 */

import type { Building } from "../data/types";
import {
  COMFORT_TEMP_C,
  FALLBACK_U_VALUE,
  HEATING_THRESHOLD_C,
  U_VALUE_ERA_CURVE,
  U_VALUE_QUALITY_FACTOR_MAX,
  U_VALUE_QUALITY_FACTOR_MIN,
} from "../config/heating";
import { interpolateCurve } from "../config/curve";
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";
import { commercialCategory } from "./commercial";
import { hashSeed, mulberry32 } from "./rng";

export { COMFORT_TEMP_C, HEATING_THRESHOLD_C };

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

// Construction-era -> typical blended U-value (W/m²K) — see config/heating.ts's
// U_VALUE_ERA_CURVE for the actual milestone points and the real-Swiss-
// building-stock reasoning behind their shape; GWR's construction year is
// real data, only the U-value each era implies is a guess.
export function baseUValueForYear(year: number | null): number {
  if (year === null) return FALLBACK_U_VALUE;
  return interpolateCurve(U_VALUE_ERA_CURVE, year);
}

/** Occupancy/usage knocks a bit off the effective comfort gap rather than
 * off the U-value — people, appliances, and (for a commercial building)
 * equipment and lighting all give off heat, so a more heavily-used building
 * needs less *active* heating to hold the same indoor temperature. Scales
 * with dwelling count (a proxy for occupant density — real per-dwelling
 * occupancy isn't in GWR) plus a flat bump for any recognized commercial use
 * (commercial.ts), capped well short of ever cancelling demand outright. */
function usageInternalGainOffsetC(building: Building): number {
  const residentialGainC = Math.min(2.0, building.dwellings.length * 0.15);
  const commercialGainC = commercialCategory(building) ? 1.0 : 0;
  return Math.min(2.5, residentialGainC + commercialGainC);
}

export interface BuildingThermalProfile {
  uValueWPerM2K: number;
  comfortTempC: number; // BASE_COMFORT_TEMP_C net of this building's usage offset
}

const thermalProfileCache = new Map<string, BuildingThermalProfile>();

/** A building's own heat-loss characteristics, computed once and cached
 * (like buildingGeometry.ts's envelope-area cache) rather than re-derived
 * every call — three factors, each independently justified:
 *  - Age: GWR's real construction year, through the era curve above.
 *  - Usage: occupancy/equipment internal gains offsetting the comfort gap
 *    (see usageInternalGainOffsetC).
 *  - Random: a seeded +-25% multiplier on the age-implied U-value, standing
 *    in for everything age alone doesn't explain — workmanship quality, an
 *    unlisted renovation, general draftiness — fixed for the building's life
 *    rather than redrawn, the same way every other seeded per-building trait
 *    in this codebase (bias, uncertainty, uncounted traits) works. */
export function buildingThermalProfile(building: Building): BuildingThermalProfile {
  const cached = thermalProfileCache.get(building.egid);
  if (cached) return cached;

  // A new build carries its own U-value, fixed at permit time from the building code
  // and the insulation policy (see newBuild.ts) — no era lookup or random quality draw.
  let uValueWPerM2K = building.uValueWPerM2K;
  if (uValueWPerM2K === undefined) {
    const baseUValue = baseUValueForYear(building.constructionYear);
    const qualityRange = U_VALUE_QUALITY_FACTOR_MAX - U_VALUE_QUALITY_FACTOR_MIN;
    const qualityFactor = U_VALUE_QUALITY_FACTOR_MIN + mulberry32(hashSeed(building.egid, "thermal-quality"))() * qualityRange;
    uValueWPerM2K = baseUValue * qualityFactor;
  }

  const profile: BuildingThermalProfile = {
    uValueWPerM2K,
    comfortTempC: COMFORT_TEMP_C - usageInternalGainOffsetC(building),
  };
  thermalProfileCache.set(building.egid, profile);
  return profile;
}

/** The building's raw heat-loss demand — envelope area times how far outside
 * temperature sits below its own effective comfort setpoint, through its own
 * U-value (see buildingThermalProfile) — gated by the day's characteristic
 * temperature, independent of *how* that heat gets generated. A heat pump is
 * one way to meet it (divide by COP); billing.ts uses this same number
 * directly for buildings whose real heating source is gas or district heat
 * instead, since the physical demand doesn't care what's burning to meet it.
 * Returns 0 for a building with no footprint/height data or on a day that
 * doesn't need heating, regardless of what heats it. */
export function spaceHeatingThermalDemandW(building: Building, dailyMeanC: number, outsideTempC: number): number {
  const envelopeAreaM2 = buildingEnvelopeAreaM2(building);
  if (envelopeAreaM2 === null) return 0;
  if (dailyMeanC >= HEATING_THRESHOLD_C) return 0;

  const profile = buildingThermalProfile(building);
  const deltaTC = Math.max(0, profile.comfortTempC - outsideTempC);
  return profile.uValueWPerM2K * envelopeAreaM2 * deltaTC;
}
