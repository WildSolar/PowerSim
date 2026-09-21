/**
 * Every tunable number behind building energy classes and insulation retrofits
 * (sim/energyClass.ts, sim/retrofit.ts). Costs are order-of-magnitude Swiss-market
 * ballpark figures, not real quotes: the point is the economic shape — a retrofit
 * only just pays for itself on a fossil-heated house at current prices, and clearly
 * does not on an already heat-pump-heated one, so subsidies and information matter.
 */

export type EnergyClassId = "unrenovated" | "basic" | "standard" | "minergie" | "minergieP";

export interface EnergyClassSpec {
  id: EnergyClassId;
  label: string;
  /** Blended envelope U-value (W/m2K) a building of this class is renovated to. */
  targetUValue: number;
  /** Cumulative envelope work cost, CHF-Rappen per m2 of envelope, relative to unrenovated.
   * An upgrade pays the difference between the target's and the current class's figure,
   * on top of the maintenance every envelope needs anyway (MAINTENANCE_RP_PER_M2). */
  cumulativeCostRpPerM2: number;
  /** Federal/cantonal building-program grant for reaching this class, Rp per m2 of envelope. */
  programSubsidyRpPerM2: number;
  /** Mean years before the owner next reconsiders the envelope (facade, windows, roof cycle). */
  reconsiderMeanYears: number;
  /** Signed "how green this reads" — nudges the hidden progressive/conservative trait. */
  greenness: number;
  color: string;
}

// Ordered worst -> best. Class boundaries (below) sit at the geometric mean of neighbouring
// targets; today's building-code new build (U ~0.22) lands in "minergie".
export const ENERGY_CLASS_ORDER: EnergyClassId[] = ["unrenovated", "basic", "standard", "minergie", "minergieP"];

export const ENERGY_CLASS_CATALOG: Record<EnergyClassId, EnergyClassSpec> = {
  unrenovated: { id: "unrenovated", label: "Unrenovated", targetUValue: 1.25, cumulativeCostRpPerM2: 0, programSubsidyRpPerM2: 0, reconsiderMeanYears: 40, greenness: -1, color: "#c7d7d1" },
  basic: { id: "basic", label: "Partly insulated", targetUValue: 0.8, cumulativeCostRpPerM2: 45_00, programSubsidyRpPerM2: 0, reconsiderMeanYears: 40, greenness: -0.3, color: "#93bfae" },
  standard: { id: "standard", label: "Current standard", targetUValue: 0.5, cumulativeCostRpPerM2: 105_00, programSubsidyRpPerM2: 20_00, reconsiderMeanYears: 45, greenness: 0.3, color: "#5fa68a" },
  minergie: { id: "minergie", label: "Minergie", targetUValue: 0.28, cumulativeCostRpPerM2: 185_00, programSubsidyRpPerM2: 35_00, reconsiderMeanYears: 50, greenness: 0.8, color: "#2b8566" },
  minergieP: { id: "minergieP", label: "Minergie-P", targetUValue: 0.15, cumulativeCostRpPerM2: 300_00, programSubsidyRpPerM2: 45_00, reconsiderMeanYears: 50, greenness: 1.1, color: "#0d5b44" },
};

/** Maintenance every envelope needs when it is renewed at all (paint, repairs, roof), per m2 —
 * paid whatever the choice, so only the premium above it is a real decision. */
export const MAINTENANCE_RP_PER_M2 = 60_00;

/** Municipal top-up can cover at most this share of the premium, so it never pays owners to renovate. */
export const MAX_MUNICIPAL_SUBSIDY_SHARE = 0.7;

export const FALLBACK_ENVELOPE_AREA_M2 = 250; // no footprint: a mid-size house

// --- the renewal-decision engine's own parameters for this category ---

export const RETROFIT_WEIBULL_SHAPE = 2.5;
export const RETROFIT_BASE_UNCERTAINTY_FRACTION = 0.05;
export const RETROFIT_EXTRA_UNCERTAINTY_FRACTION = 0.3; // a retrofit is a bigger, less certain undertaking than a boiler swap
export const RETROFIT_UNCERTAINTY_DECAY_DWELLINGS = 6;
export const RETROFIT_BIAS_MAGNITUDE_RP_PER_YEAR = 100_000;

// Spread of a retrofitted building's U-value around its class target (workmanship).
export const RETROFIT_QUALITY_FACTOR_RANGE: [number, number] = [0.9, 1.12];
