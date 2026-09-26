/**
 * Small pure formulas behind solarAdoption.ts's three questions (what gets
 * installed, sized against a building's own footprint; what it costs; what
 * a panel converts sunlight at) — every tunable number they use lives in
 * config/solar.ts; edit that file to recalibrate, not this one.
 */

import { interpolateCurve } from "../config/curve";
import {
  AGE_EXCLUSION_YEARS,
  FEDERAL_SUBSIDY_MAX_KWP,
  FEDERAL_SUBSIDY_RP_PER_KWP,
  GRID_KWH_PER_M2_AT_STC,
  INSTALL_COST_CURVE_A_RP_PER_KWP,
  INSTALL_COST_CURVE_EXPONENT,
  INSTALL_COST_FLOOR_RP_PER_KWP,
  MAX_USABLE_FRACTION,
  MEDIAN_USABLE_FRACTION,
  MIN_USABLE_FRACTION,
  MODULE_EFFICIENCY_CURVE,
  PANEL_LIFETIME_MEAN_YEARS,
  USABLE_FRACTION_LOG_SPREAD,
} from "../config/solar";

export { PANEL_LIFETIME_MEAN_YEARS, AGE_EXCLUSION_YEARS };

/** Module efficiency for a panel installed in `year` — interpolated between
 * config/solar.ts's MODULE_EFFICIENCY_CURVE milestones, held flat beyond
 * either end. A panel keeps whatever efficiency it was installed with for
 * its whole life (no retrofitting), so this is only ever evaluated once, at
 * adoption time. */
export function moduleEfficiencyFractionAt(year: number): number {
  return interpolateCurve(MODULE_EFFICIENCY_CURVE, year);
}

/** kWp per m2 of footprint a panel installed in `year` can extract from fully
 * usable roof — module efficiency directly, since 1000 W/m2 STC times an
 * efficiency fraction times 1 m2 is exactly that many kWp. */
export function kwpPerM2At(year: number): number {
  return moduleEfficiencyFractionAt(year) * GRID_KWH_PER_M2_AT_STC;
}

export function usableRoofFractionFromDraw(u: number): number {
  const fraction = MEDIAN_USABLE_FRACTION * Math.pow(2, (u - 0.5) * USABLE_FRACTION_LOG_SPREAD);
  return Math.min(MAX_USABLE_FRACTION, Math.max(MIN_USABLE_FRACTION, fraction));
}

/** Today's install price per kWp for a system of this size, times `priceFactor` (costTrends.ts)
 * for another year's prices. */
export function installCostRpPerKwp(capacityKw: number, priceFactor = 1): number {
  const raw = INSTALL_COST_CURVE_A_RP_PER_KWP * Math.pow(Math.max(capacityKw, 1), -INSTALL_COST_CURVE_EXPONENT);
  return Math.max(INSTALL_COST_FLOOR_RP_PER_KWP, raw) * priceFactor;
}

export function federalSubsidyRp(capacityKw: number): number {
  return Math.min(capacityKw, FEDERAL_SUBSIDY_MAX_KWP) * FEDERAL_SUBSIDY_RP_PER_KWP;
}
