/**
 * The CO2 intensity of grid electricity. Each year has its average (config/emissions.ts's curve: the
 * Swiss consumption mix, imports included, decarbonising over the game the way the real one is
 * expected to — one municipality's choices don't move it). Within the year it varies: winter nights,
 * when much is imported, are dirtiest; sunny middays, when hydro and solar cover everything, cleanest.
 * The shape (season, hour, sunshine) is scaled so that a year of ordinary use still averages the
 * year's figure — so it only says *when* a kWh is cleaner or dirtier, not how clean the year is.
 */

import {
  GRID_CARBON_CURVE,
  GRID_CARBON_HOUR_SHAPE,
  GRID_CARBON_SEASON_AMPLITUDE,
  GRID_CARBON_SUN_DIP,
  GRID_CARBON_USE_HOUR_SHAPE,
  GRID_CARBON_USE_SEASON,
} from "../config/emissions";
import { interpolateCurve } from "../config/curve";
import { dayOfYear, toDateMs, toSimTimeMs } from "./calendar";
import { irradianceWm2 } from "./pv";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The year's average (g/kWh). */
export function gridCarbonIntensityGPerKWh(year: number): number {
  return interpolateCurve(GRID_CARBON_CURVE, year);
}

function hourShape(shape: number[], hour: number): number {
  const h0 = Math.floor(hour) % 24;
  const f = hour - Math.floor(hour);
  return shape[h0] * (1 - f) + shape[(h0 + 1) % 24] * f;
}

/** Winter high (around mid-January), summer low. */
function season(dayIndexOfYear: number, amplitude: number): number {
  return 1 + amplitude * Math.cos((2 * Math.PI * (dayIndexOfYear - 15)) / 365);
}

/** The shape before scaling, at `simTimeMs`. */
function rawFactor(simTimeMs: number): number {
  const dateMs = toDateMs(simTimeMs);
  const hour = (((simTimeMs % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
  const sun = Math.min(1, irradianceWm2(simTimeMs) / 1000);
  return season(dayOfYear(dateMs), GRID_CARBON_SEASON_AMPLITUDE) * hourShape(GRID_CARBON_HOUR_SHAPE, hour) * (1 - GRID_CARBON_SUN_DIP * sun);
}

/** Per year: the use-weighted mean of the raw shape (what scales it to average 1), and the mean
 * factor over the heating months (December to February) — what winter-only power is worth. */
const yearScale = new Map<number, { mean: number; winter: number }>();

function scaleFor(year: number): { mean: number; winter: number } {
  let s = yearScale.get(year);
  if (!s) {
    const start = toSimTimeMs(Date.UTC(year, 0, 1));
    let sum = 0;
    let weight = 0;
    let winterSum = 0;
    let winterWeight = 0;
    for (let d = 0; d < 365; d++) {
      const useSeason = season(d, GRID_CARBON_USE_SEASON);
      const winter = d < 59 || d >= 334;
      for (let h = 1; h < 24; h += 2) {
        const raw = rawFactor(start + d * DAY_MS + h * HOUR_MS);
        const w = useSeason * GRID_CARBON_USE_HOUR_SHAPE[h];
        sum += raw * w;
        weight += w;
        if (winter) {
          winterSum += raw * w;
          winterWeight += w;
        }
      }
    }
    const mean = sum / weight;
    s = { mean, winter: winterSum / winterWeight / mean };
    yearScale.set(year, s);
  }
  return s;
}

/** How a kWh at `simTimeMs` compares with the year's average (1: the same). */
export function gridCarbonFactorAt(simTimeMs: number): number {
  return rawFactor(simTimeMs) / scaleFor(new Date(toDateMs(simTimeMs)).getUTCFullYear()).mean;
}

/** The intensity at `simTimeMs` (g/kWh). */
export function gridCarbonIntensityGPerKWhAt(simTimeMs: number): number {
  return gridCarbonIntensityGPerKWh(new Date(toDateMs(simTimeMs)).getUTCFullYear()) * gridCarbonFactorAt(simTimeMs);
}

/** The average over the heating months (g/kWh): what power fed in only in winter (wood plants making
 * power with their heat) displaces. */
export function gridCarbonWinterGPerKWh(year: number): number {
  return gridCarbonIntensityGPerKWh(year) * scaleFor(year).winter;
}
