/**
 * Starting values and formula parameters for the player-adjustable policy
 * levers (sim/policy.ts defines the Policy shape and policyStore.ts holds
 * the live, player-editable value — this is only where it *starts* and how
 * outreach turns into a hazard multiplier).
 */

import type { Policy } from "../sim/policy";

export const DEFAULT_POLICY: Policy = {
  solarOutreachLevel: 0,
  solarSubsidyRpPerKwp: 0,
  newBuildSolarMandatePct: 0,
  newBuildInsulationLevel: 0,
  newBuildFossilHeatingAllowed: false,
  growthMultiplier: 1,
  renewalRateMultiplier: 1,
  retrofitSubsidyRpPerM2: 0,
  retrofitMinClass: "none",
};

// outreachHazardMultiplier(level) = 1 + (level/100) * OUTREACH_MAX_MULTIPLIER_BONUS
// -> 1x at no outreach, up to (1 + bonus)x at full (100%) outreach.
export const OUTREACH_MAX_MULTIPLIER_BONUS = 2; // -> 3x at full outreach
