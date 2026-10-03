// Switching early (sim/renewal.ts): an owner with a working oil or gas boiler, or a petrol/diesel car,
// now and then considers replacing it before it wears out — likelier the bigger the municipal grant
// (against the price of the new one) and with energy advice in town. Whether they do is the same
// cost comparison as at the end of a system's life, except that keeping the old one costs only its
// running costs and growing repairs, and switching early carries a hassle premium.
// Informed placeholders; tuned so grants bring switches forward without a stampede.

export interface EarlySwitchSpec {
  /** The system has to be at least this old before its owner would think of it. */
  minAgeYears: number;
  /** The yearly chance of seriously considering it, with no grant on offer. */
  baseChancePerYear: number;
  /** How much a grant raises that chance: x (1 + boost x grant / price of the new system). */
  grantBoost: number;
  /** Repairs on the old system: this much a year for every year of age beyond minAgeYears (CHF). */
  repairChfPerYearOfAge: number;
  /** The disruption of switching while the old one still works, as a yearly cost (CHF). */
  hassleChfPerYear: number;
}

export const EARLY_SWITCH: Record<"heating" | "car", EarlySwitchSpec> = {
  heating: { minAgeYears: 8, baseChancePerYear: 0.025, grantBoost: 15, repairChfPerYearOfAge: 35, hassleChfPerYear: 150 },
  car: { minAgeYears: 4, baseChancePerYear: 0.03, grantBoost: 12, repairChfPerYearOfAge: 90, hassleChfPerYear: 200 },
};

// An owner who is actively looking into it is less set in their ways: the indifference band of an
// early decision is this share of the usual one.
export const EARLY_SWITCH_UNCERTAINTY_SHARE = 0.5;

// Energy advice (the information measures that narrow the uncertainty band) also makes owners
// likelier to look into it: the chance is multiplied by (1 + this x how much the band is narrowed).
export const EARLY_SWITCH_ADVICE_BOOST = 1.5;
