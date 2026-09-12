/**
 * Baseline device models for milestone 1: deliberately simple placeholder stochastic
 * models for a dwelling's fridge and lighting load. Each device's instantaneous power
 * is a *pure function* of (seed, simulated time) — nothing needs to be simulated
 * tick-by-tick and remembered; any point in time can be evaluated directly. That's
 * the property the fuller design later relies on to reconcile aggregate statistics
 * with on-demand per-entity detail.
 */

import { mulberry32, bucketRandom } from "./rng";

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
  const t = (simTimeMs + profile.phaseOffsetMs) % profile.cyclePeriodMs;
  return t < profile.cyclePeriodMs * profile.onFraction ? profile.wattageOn : 0;
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
