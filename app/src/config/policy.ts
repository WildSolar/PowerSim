/**
 * Formula parameters for how policy levers act on the simulation (the levers themselves are
 * measures — sim/measureCatalog.ts — resolved into channels by sim/channels.ts).
 */

// outreachHazardMultiplier(level) = 1 + (level/100) * OUTREACH_MAX_MULTIPLIER_BONUS
// -> 1x at no outreach, up to (1 + bonus)x at full (100%) outreach.
export const OUTREACH_MAX_MULTIPLIER_BONUS = 2; // -> 3x at full outreach
