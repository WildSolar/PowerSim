/**
 * Technology prices over time (config/costTrends.ts): the factor a catalog price — today's, the
 * price at the start of the game — is multiplied by at a given moment. Every purchase decision
 * prices its options with it — heating systems, cars and bikes, business vans and lorries, rooftop
 * solar, insulation work — and so do the things the municipality builds (chargers, district heating
 * pipes). Subsidies stay the amounts they are set to, so as a technology gets cheaper the same
 * grant covers more of it.
 */

import { COST_TRENDS, type CostTrendId } from "../config/costTrends";
import { toSimTimeMs } from "./calendar";

const YEAR_MS = 365.25 * 24 * 3_600_000;

// Dev only: the scenario runner can freeze every price at today's, to measure what the trends do.
let enabled = true;
export function setCostTrendsEnabled(on: boolean): void {
  enabled = on;
}

/** The factor on a technology's catalog price at `simTimeMs` (1 at the start of the game). */
export function priceFactor(id: CostTrendId, simTimeMs: number): number {
  if (!enabled) return 1;
  const { level, years } = COST_TRENDS[id];
  return level + (1 - level) * Math.exp(-Math.max(0, simTimeMs / YEAR_MS) / years);
}

/** The same, for a whole calendar year (its middle) — for decisions settled once a year (solar). */
export function priceFactorInYear(id: CostTrendId, year: number): number {
  return priceFactor(id, toSimTimeMs(Date.UTC(year, 6, 1)));
}
