import type { CurvePoint } from "./curve";

// Carbon removal (sim/emissions.ts, the "Carbon removal contracts" measure): the municipality pays
// for tonnes of CO2 taken out of the air — biochar, direct air capture, CCS at a waste-to-energy
// plant — to balance what it can't avoid. As in Swiss climate law, removals are for the
// hard-to-avoid rest: they count only once the town's own emissions are down to this share of
// what they were at the start, so the rest has to be cut first.
export const REMOVAL_CAP_SHARE = 0.2;

// CHF per tonne removed, by year: informed placeholders — today's mix of biochar and direct air
// capture, getting cheaper as the technologies scale up.
export const REMOVAL_PRICE_CHF_PER_T: CurvePoint[] = [
  { x: 2026, y: 450 },
  { x: 2030, y: 380 },
  { x: 2040, y: 270 },
  { x: 2050, y: 200 },
];
