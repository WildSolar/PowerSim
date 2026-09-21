/**
 * Formula parameters for how policy levers act on the simulation (the levers themselves are
 * measures — sim/measureCatalog.ts — resolved into channels by sim/channels.ts).
 */

// outreachHazardMultiplier(level) = 1 + (level/100) * OUTREACH_MAX_MULTIPLIER_BONUS
// -> 1x at no outreach, up to (1 + bonus)x at full (100%) outreach.
export const OUTREACH_MAX_MULTIPLIER_BONUS = 2; // -> 3x at full outreach

// A green-power default: certified renewable supply cuts the emissions attributed to grid electricity
// (the grid mix is only ever partly cleaned by a certificate) and costs the utility a premium per kWh.
export const GREEN_POWER_MAX_EMISSION_REDUCTION = 0.9; // at 100% share
export const GREEN_POWER_PREMIUM_RP_PER_KWH = 1.5; // at 100% share
