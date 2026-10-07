/**
 * What a wind turbine makes, moment by moment. The weather model has no wind of its own, so it gets
 * one here, in the same spirit (weather.ts): smooth value noise, a pure function of time. The
 * passing weather systems that bring the clouds bring the wind too (so wind tends to blow when the
 * sun doesn't), with gusts on top, and more of it in winter. That gives, for every moment, how windy
 * it is as a quantile; each turbine reads it through its site's own wind distribution from the
 * federal wind atlas (Weibull A and k at hub height) and the power curve.
 *
 * The noise isn't exactly uniform, so each site is calibrated once: its output over a reference
 * year is scaled to what the atlas's distribution gives on average — the year's energy is the
 * atlas's, the timing the weather's.
 */

import { CUT_IN_MS, CUT_OUT_MS, RATED_MS, WIND_AVAILABILITY, WIND_WINTER_SHIFT } from "../config/wind";
import type { PowerPlant } from "../data/types";
import { dayOfYear, toDateMs } from "./calendar";
import { valueNoise } from "./valueNoise";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 3_600_000;

/** The share of rated power at wind speed `v` (m/s). */
export function powerCurve(v: number): number {
  if (v < CUT_IN_MS || v >= CUT_OUT_MS) return 0;
  if (v >= RATED_MS) return 1;
  return (v ** 3 - CUT_IN_MS ** 3) / (RATED_MS ** 3 - CUT_IN_MS ** 3);
}

/** How windy it is at a moment, as a quantile of the site's wind distribution (0-1). */
function windQuantile(simTimeMs: number): number {
  const dateMs = toDateMs(simTimeMs);
  const z = 0.7 * valueNoise("cloud-system", dateMs, 5 * DAY_MS) + 0.5 * valueNoise("wind-system", dateMs, 2.5 * DAY_MS) + 0.25 * valueNoise("wind-gust", dateMs, 6 * HOUR_MS);
  const season = WIND_WINTER_SHIFT * Math.cos((2 * Math.PI * (dayOfYear(dateMs) - 15)) / 365.25);
  const u = 1 / (1 + Math.exp(-2.2 * z)) + season;
  return Math.min(0.999, Math.max(0.001, u));
}

function speedAt(u: number, a: number, k: number): number {
  return a * Math.pow(-Math.log(1 - u), 1 / k);
}

/** The atlas's capacity factor for a site: the power curve averaged over its Weibull distribution. */
export function expectedCapacityFactor(a: number, k: number): number {
  let sum = 0;
  const dv = 0.1;
  for (let v = dv / 2; v < 30; v += dv) sum += powerCurve(v) * (k / a) * Math.pow(v / a, k - 1) * Math.exp(-Math.pow(v / a, k)) * dv;
  return sum * WIND_AVAILABILITY;
}

const calibration = new Map<string, number>();

/** The scale that makes a site's simulated year give the atlas's energy. */
function calibrationFor(a: number, k: number): number {
  const key = `${a}:${k}`;
  let scale = calibration.get(key);
  if (scale === undefined) {
    let sum = 0;
    const n = 2_920; // every three hours of a year
    for (let i = 0; i < n; i++) sum += powerCurve(speedAt(windQuantile(i * 3 * HOUR_MS), a, k));
    const simulated = (sum / n) * WIND_AVAILABILITY;
    scale = simulated > 0 ? expectedCapacityFactor(a, k) / simulated : 1;
    calibration.set(key, scale);
  }
  return scale;
}

/** A wind plant's output at a moment (W, positive). */
export function windPowerW(plant: PowerPlant, simTimeMs: number): number {
  if (!plant.wind || !plant.capacityKw) return 0;
  const { a, k } = plant.wind;
  const share = powerCurve(speedAt(windQuantile(simTimeMs), a, k)) * WIND_AVAILABILITY * calibrationFor(a, k);
  return plant.capacityKw * 1000 * Math.min(1, share);
}
