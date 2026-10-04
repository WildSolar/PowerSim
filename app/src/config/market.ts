// Market prices the municipality doesn't set (sim/market.ts): heating fuels, petrol and diesel, and
// wholesale electricity. Each follows a base path over the years — the fossil fuels including the
// federal CO2 levy on heating fuels (CHF 120/t) — and now and then a shock: a supply crisis that
// lifts prices and fades over a year or two. Informed placeholders, not forecasts.

import type { CurvePoint } from "./curve";

export type Commodity = "oil" | "gas" | "petrol" | "wholesale";

/** Base prices by year: oil and petrol in Rp per litre, gas and wholesale electricity in Rp per kWh. */
export const MARKET_BASE: Record<Commodity, CurvePoint[]> = {
  oil: [
    { x: 2026, y: 100 },
    { x: 2035, y: 108 },
    { x: 2050, y: 118 },
  ],
  gas: [
    { x: 2026, y: 10 },
    { x: 2035, y: 11 },
    { x: 2050, y: 12 },
  ],
  petrol: [
    { x: 2026, y: 180 },
    { x: 2050, y: 190 },
  ],
  wholesale: [
    { x: 2026, y: 9 },
    { x: 2035, y: 8.5 },
    { x: 2050, y: 8 },
  ],
};

/** The yearly chance of a supply shock, from the game's second year on. */
export const SHOCK_CHANCE_PER_YEAR = 0.1;
/** How much a shock lifts prices at its peak (a share of the base), drawn in this range. */
export const SHOCK_SIZE_RANGE: [number, number] = [0.25, 0.7];
/** How fast it fades: the lift falls by about two thirds every this many months. */
export const SHOCK_DECAY_MONTHS = 15;
/** How exposed each price is to a shock: gas most, petrol least. */
export const SHOCK_EXPOSURE: Record<Commodity, number> = { oil: 0.7, gas: 1, petrol: 0.4, wholesale: 0.8 };

// The local grid's upkeep per kWh delivered — the utility's cost, not a price anyone sets. Grid usage
// fees in Switzerland run around 10-12 Rp/kWh plus levies; 13 covers the grid (and its capital costs)
// and leaves the utility a margin of a few million on a town of 20,000.
export const GRID_UPKEEP_RP_PER_KWH = 13;
