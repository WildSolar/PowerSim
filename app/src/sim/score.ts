/**
 * The score, and winning. Every counted year from the one after the start through 2050 scores the
 * cut in emissions per resident against the starting year, in percent — net of carbon removals.
 * Summed, that is the share of the starting emissions avoided over the years: early cuts count
 * for every year after them, and towns of any size compare. A year's emissions going up scores
 * below zero. Reaching net zero (net emissions at or below nothing) in any year through 2050 wins.
 *
 * Everything is read from the counted years (emissions.ts), so it needs no state of its own.
 */

import { BASELINE_YEAR } from "./calendar";
import { cachedEmissionsForYear, type EmissionsBreakdown } from "./emissions";

export const NET_ZERO_TARGET_YEAR = 2050;

/** Net emissions per resident (kg CO2). */
export function perResidentKg(e: EmissionsBreakdown): number {
  return e.residents > 0 ? e.netKgCO2 / e.residents : 0;
}

/** A year's points: the cut per resident against the starting year, in percent. */
export function yearPoints(e: EmissionsBreakdown, baseline: EmissionsBreakdown): number {
  const base = perResidentKg(baseline);
  return base > 0 ? 100 * (1 - perResidentKg(e) / base) : 0;
}

export interface ScoredYear {
  year: number;
  points: number;
  netKgCO2: number;
  perResidentKg: number;
}

export interface Score {
  /** The years scored so far, in order. */
  years: ScoredYear[];
  total: number;
  /** The first year with net emissions at or below zero, through 2050. */
  netZeroYear: number | null;
  /** The starting year's emissions per resident, for reference. */
  baselinePerResidentKg: number | null;
}

/** The scored years from 2027 through 2050 (or `throughYear`), as counted so far. */
export function scoreSoFar(throughYear = NET_ZERO_TARGET_YEAR): Score {
  const baseline = cachedEmissionsForYear(BASELINE_YEAR);
  const years: ScoredYear[] = [];
  let netZeroYear: number | null = null;
  if (baseline) {
    for (let year = BASELINE_YEAR + 1; year <= Math.min(throughYear, NET_ZERO_TARGET_YEAR); year++) {
      const e = cachedEmissionsForYear(year);
      if (!e) break;
      years.push({ year, points: yearPoints(e, baseline), netKgCO2: e.netKgCO2, perResidentKg: perResidentKg(e) });
      if (netZeroYear === null && e.netKgCO2 <= 0) netZeroYear = year;
    }
  }
  return {
    years,
    total: years.reduce((sum, y) => sum + y.points, 0),
    netZeroYear,
    baselinePerResidentKg: baseline ? perResidentKg(baseline) : null,
  };
}
