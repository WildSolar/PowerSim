/**
 * Electric water heating — ownership is real GWR data (hotWaterEnergySource), like
 * heat pump space heating, but unlike space heating the load doesn't depend on the
 * building envelope or outdoor temperature: hot water demand is driven by occupant
 * behavior (showers, dishes), not heat loss. So instead of heatPump.ts's
 * envelope-area/deltaT model, each dwelling gets its own independently duty-cycling
 * heating element (mirroring devices.ts's fridge/lighting pattern), gated at the
 * building level by whether GWR records an electric hot water system at all.
 * Modeling a shared boiler as N independently-cycling per-dwelling loads is a
 * simplification, but it reproduces what matters: a diurnal shape (morning/evening
 * shower peaks) and a total that scales with how many dwellings the building serves.
 */

import type { Building, Dwelling } from "../data/types";
import { bucketRandom, hashSeed, mulberry32 } from "./rng";

const ELECTRIC_SOURCE = "Elektrizität";

export function hasElectricWaterHeating(building: Building): boolean {
  return building.hotWaterEnergySource === ELECTRIC_SOURCE;
}

export interface WaterHeaterProfile {
  seed: number;
  elementWattage: number;
  bucketMs: number;
}

export function makeWaterHeaterProfile(seed: number): WaterHeaterProfile {
  const rng = mulberry32(seed);
  const elementWattage = 1800 + rng() * 1400; // 1800-3200 W resistive element
  return { seed, elementWattage, bucketMs: 10 * 60_000 };
}

/** Probability the heating element is running, given hour-of-day (0-24): a sharp
 * morning shower peak, a broader evening peak (showers + dishes), and a low but
 * nonzero baseline overnight (thermostat topping the tank back up). Amplitudes are
 * tuned so a dwelling's integrated on-time comes out to ~1-1.5h/day at this profile's
 * wattage — roughly 2.5-4 kWh/day, matching a real modern electric water heater
 * (verified via energy.ts's daily totals once those existed to check against). */
function baseProbability(hourOfDay: number): number {
  const morning = Math.exp(-((hourOfDay - 7) ** 2) / (2 * 1.2 ** 2)) * 0.08;
  const evening = Math.exp(-((hourOfDay - 19) ** 2) / (2 * 1.8 ** 2)) * 0.1;
  return 0.02 + Math.max(morning, evening);
}

export function waterHeaterPowerW(profile: WaterHeaterProfile, simTimeMs: number): number {
  const dayMs = 24 * 60 * 60_000;
  const hourOfDay = (((simTimeMs % dayMs) + dayMs) % dayMs) / 60_000 / 60;
  const prob = baseProbability(hourOfDay);
  const bucket = Math.floor(simTimeMs / profile.bucketMs);
  const draw = bucketRandom(profile.seed, bucket);
  return draw < prob ? profile.elementWattage : 0;
}

export function dwellingWaterHeaterProfile(egid: string, dwelling: Dwelling): WaterHeaterProfile {
  return makeWaterHeaterProfile(hashSeed(egid, dwelling.ewid, "water-heater"));
}

/** Building-level total — zero unless GWR records an electric hot water system. */
export function waterHeatingPowerW(building: Building, simTimeMs: number): number {
  if (!hasElectricWaterHeating(building)) return 0;
  let total = 0;
  for (const dwelling of building.dwellings) {
    total += waterHeaterPowerW(dwellingWaterHeaterProfile(building.egid, dwelling), simTimeMs);
  }
  return total;
}
