// What the utility gets for surplus power (sim/spotMarket.ts). It buys the town's power on long-term
// contracts, at the month's wholesale price (config/market.ts); only what the town makes beyond its
// own use in an hour goes to the spot market, at the hour's price — a share of the wholesale price
// that sinks as the sun rises over the whole region's panels.

import type { CurvePoint } from "./curve";

// The spot price as a share of the month's wholesale price, with no sun.
export const SPOT_BASE_SHARE = 0.85;

// How far it falls under a clear midday sky (share of the wholesale price, at 1000 W/m²): ever
// deeper as the region builds solar — below zero on sunny middays from the early 2030s.
export const SPOT_SOLAR_DIP_SHARE: CurvePoint[] = [
  { x: 2026, y: 0.75 },
  { x: 2032, y: 1.0 },
  { x: 2040, y: 1.15 },
  { x: 2050, y: 1.25 },
];

// Neighbourhood batteries: what comes back out of what goes in, and one full cycle a day at most.
export const GRID_BATTERY_ROUND_TRIP = 0.88;
