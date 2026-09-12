/**
 * Baseline device models for milestone 1: deliberately simple placeholder stochastic
 * models for a dwelling's fridge and lighting load. Each device's instantaneous power
 * is a *pure function* of (seed, simulated time) — nothing needs to be simulated
 * tick-by-tick and remembered; any point in time can be evaluated directly. That's
 * the property the fuller design later relies on to reconcile aggregate statistics
 * with on-demand per-entity detail.
 */

import { mulberry32, bucketRandom, hashSeed } from "./rng";
import type { Dwelling } from "../data/types";

export interface FridgeProfile {
  wattageOn: number;
  cyclePeriodMs: number;
  onFraction: number;
  phaseOffsetMs: number;
}

export function makeFridgeProfile(seed: number): FridgeProfile {
  const rng = mulberry32(seed);
  const wattageOn = 100 + rng() * 50; // 100-150 W while the compressor runs
  const cyclePeriodMs = (20 + rng() * 20) * 60_000; // 20-40 min cycle
  const onFraction = 0.3 + rng() * 0.2; // 30-50% duty cycle
  const phaseOffsetMs = rng() * cyclePeriodMs;
  return { wattageOn, cyclePeriodMs, onFraction, phaseOffsetMs };
}

export function fridgePowerW(profile: FridgeProfile, simTimeMs: number): number {
  // JS `%` keeps the dividend's sign, so a raw modulo goes negative for simTimeMs < 0
  // (true whenever a history window looks back past t=0) — every fridge would then
  // read as permanently "on" (t < a positive threshold is trivially always true for
  // negative t). Double-mod folds it back into [0, cyclePeriodMs) regardless of sign.
  const period = profile.cyclePeriodMs;
  const t = (((simTimeMs + profile.phaseOffsetMs) % period) + period) % period;
  return t < period * profile.onFraction ? profile.wattageOn : 0;
}

export interface LightingProfile {
  seed: number;
  fixtureWattage: number;
  bucketMs: number;
}

export function makeLightingProfile(seed: number): LightingProfile {
  const rng = mulberry32(seed);
  const fixtureWattage = 40 + rng() * 120; // 40-160 W total when lights are on
  return { seed, fixtureWattage, bucketMs: 10 * 60_000 };
}

/** Probability lights are on, given hour-of-day (0-24): low midday, peaks morning/evening, off at night. */
function baseProbability(hourOfDay: number): number {
  const morning = Math.exp(-((hourOfDay - 7) ** 2) / (2 * 1.5 ** 2));
  const evening = Math.exp(-((hourOfDay - 19.5) ** 2) / (2 * 2.5 ** 2));
  const awake = hourOfDay < 5.5 || hourOfDay > 23 ? 0 : 1;
  return Math.min(0.9, 0.15 + 0.75 * Math.max(morning, evening)) * awake;
}

export function lightingPowerW(profile: LightingProfile, simTimeMs: number): number {
  const dayMs = 24 * 60 * 60_000;
  const hourOfDay = ((simTimeMs % dayMs) + dayMs) % dayMs / 60_000 / 60;
  const prob = baseProbability(hourOfDay);
  const bucket = Math.floor(simTimeMs / profile.bucketMs);
  const draw = bucketRandom(profile.seed, bucket);
  return draw < prob ? profile.fixtureWattage : 0;
}

/** A dwelling's fridge + lighting draw at a point in simulated time — the single
 * place that derives per-device seeds from (building EGID, dwelling EWID), so the
 * live inspection panel and the map's aggregate power layer never drift apart. */
export function dwellingDevicePowerW(
  egid: string,
  dwelling: Dwelling,
  simTimeMs: number,
): { fridgeW: number; lightingW: number } {
  const fridgeProfile = makeFridgeProfile(hashSeed(egid, dwelling.ewid, "fridge"));
  const lightingProfile = makeLightingProfile(hashSeed(egid, dwelling.ewid, "lighting"));
  return {
    fridgeW: fridgePowerW(fridgeProfile, simTimeMs),
    lightingW: lightingPowerW(lightingProfile, simTimeMs),
  };
}
