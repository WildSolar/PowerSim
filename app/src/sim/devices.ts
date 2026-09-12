/**
 * Baseline device models for milestone 1: deliberately simple placeholder stochastic
 * models for a dwelling's fridge and lighting load. Each device's instantaneous power
 * is a *pure function* of (seed, simulated time) — nothing needs to be simulated
 * tick-by-tick and remembered; any point in time can be evaluated directly. That's
 * the property the fuller design later relies on to reconcile aggregate statistics
 * with on-demand per-entity detail.
 */

import { mulberry32, bucketRandom, hashSeed } from "./rng";
import { valueNoise } from "./valueNoise";
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

export interface CookingProfile {
  seed: number;
  wattageOn: number;
  bucketMs: number;
}

export function makeCookingProfile(seed: number): CookingProfile {
  const rng = mulberry32(seed);
  const wattageOn = 800 + rng() * 800; // 800-1600 W while a stove/oven/kettle is in use
  return { seed, wattageOn, bucketMs: 5 * 60_000 };
}

/** Probability something's cooking, given hour-of-day: three meal bursts, dinner
 * widest/most likely, breakfast narrowest and least. Amplitudes are tuned so a
 * dwelling's integrated on-time comes out to roughly 1-1.5h/day at this profile's
 * wattage — ~1-2 kWh/day, matching real household cooking energy (verified via
 * energy.ts's daily totals once those existed to check against). */
function cookingProbability(hourOfDay: number): number {
  const breakfast = Math.exp(-((hourOfDay - 7.5) ** 2) / (2 * 0.7 ** 2)) * 0.12;
  const lunch = Math.exp(-((hourOfDay - 12.5) ** 2) / (2 * 1 ** 2)) * 0.18;
  const dinner = Math.exp(-((hourOfDay - 18.5) ** 2) / (2 * 1.2 ** 2)) * 0.28;
  return Math.max(breakfast, lunch, dinner);
}

export function cookingPowerW(profile: CookingProfile, simTimeMs: number): number {
  const dayMs = 24 * 60 * 60_000;
  const hourOfDay = (((simTimeMs % dayMs) + dayMs) % dayMs) / 60_000 / 60;
  const prob = cookingProbability(hourOfDay);
  const bucket = Math.floor(simTimeMs / profile.bucketMs);
  const draw = bucketRandom(profile.seed, bucket);
  return draw < prob ? profile.wattageOn : 0;
}

const LAUNDRY_DAY_MS = 24 * 60 * 60_000;
const LAUNDRY_DAY_PROBABILITY = 0.35; // roughly one load every ~3 days per dwelling

export interface LaundrySession {
  startMs: number;
  endMs: number;
  wattage: number;
}

/** Whether/when a washer or dryer load runs on the given calendar day — redrawn per
 * day like ev.ts's charging session, rather than tracked as ongoing state. Confined
 * to daytime hours (08:00-20:00 start, <=2.5h long) so a session never needs to check
 * the neighboring day the way EV's overnight charging does. */
export function laundryDailySession(egid: string, dwelling: Dwelling, dayIndex: number): LaundrySession | null {
  const rng = mulberry32(hashSeed(egid, dwelling.ewid, "laundry", String(dayIndex)));
  if (rng() >= LAUNDRY_DAY_PROBABILITY) return null;
  const startHour = 8 + rng() * 12;
  const durationHours = 1.5 + rng() * 1;
  const wattage = 1500 + rng() * 1500; // washer/dryer average, heating-phase-weighted
  const dayStartMs = dayIndex * LAUNDRY_DAY_MS;
  const startMs = dayStartMs + startHour * 3_600_000;
  return { startMs, endMs: startMs + durationHours * 3_600_000, wattage };
}

export function laundryPowerW(egid: string, dwelling: Dwelling, simTimeMs: number): number {
  const dayIndex = Math.floor(simTimeMs / LAUNDRY_DAY_MS);
  const session = laundryDailySession(egid, dwelling, dayIndex);
  if (session && simTimeMs >= session.startMs && simTimeMs < session.endMs) return session.wattage;
  return 0;
}

export interface PlugLoadProfile {
  channel: string;
  baselineW: number;
}

const PLUG_LOAD_NOISE_PERIOD_MS = 2 * 60 * 60_000; // slow wander, ~2h characteristic timescale

export function makePlugLoadProfile(egid: string, dwelling: Dwelling): PlugLoadProfile {
  const rng = mulberry32(hashSeed(egid, dwelling.ewid, "plug-load"));
  const baselineW = 40 + rng() * 60; // 40-100 W always-on baseline: routers, standby, chargers
  return { channel: `plug-${egid}-${dwelling.ewid}`, baselineW };
}

/** Smooth day/evening-higher, overnight-lower multiplier, textured with slow value
 * noise (never literal white noise — see valueNoise.ts) instead of the on/off duty
 * cycling the other devices use, since "always-on background load" is the point. */
function plugLoadDayNightMultiplier(hourOfDay: number): number {
  return 0.7 + 0.3 * Math.cos((2 * Math.PI * (hourOfDay - 15)) / 24);
}

export function plugLoadPowerW(profile: PlugLoadProfile, simTimeMs: number): number {
  const dayMs = 24 * 60 * 60_000;
  const hourOfDay = (((simTimeMs % dayMs) + dayMs) % dayMs) / 60_000 / 60;
  const multiplier = plugLoadDayNightMultiplier(hourOfDay);
  const noise = valueNoise(profile.channel, simTimeMs, PLUG_LOAD_NOISE_PERIOD_MS);
  return profile.baselineW * multiplier * (1 + noise * 0.25);
}

/** A dwelling's device draw at a point in simulated time — the single place that
 * derives per-device seeds from (building EGID, dwelling EWID), so the live
 * inspection panel and the map's aggregate power layer never drift apart. */
export function dwellingDevicePowerW(
  egid: string,
  dwelling: Dwelling,
  simTimeMs: number,
): { fridgeW: number; lightingW: number; cookingW: number; laundryW: number; plugLoadW: number } {
  const fridgeProfile = makeFridgeProfile(hashSeed(egid, dwelling.ewid, "fridge"));
  const lightingProfile = makeLightingProfile(hashSeed(egid, dwelling.ewid, "lighting"));
  const cookingProfile = makeCookingProfile(hashSeed(egid, dwelling.ewid, "cooking"));
  const plugLoadProfile = makePlugLoadProfile(egid, dwelling);
  return {
    fridgeW: fridgePowerW(fridgeProfile, simTimeMs),
    lightingW: lightingPowerW(lightingProfile, simTimeMs),
    cookingW: cookingPowerW(cookingProfile, simTimeMs),
    laundryW: laundryPowerW(egid, dwelling, simTimeMs),
    plugLoadW: plugLoadPowerW(plugLoadProfile, simTimeMs),
  };
}
