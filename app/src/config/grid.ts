// The local electricity grid (sim/grid.ts). There's no public data on where a town's transformer
// stations are or how big, so the areas are drawn from the buildings themselves and sized like a
// real network would have been. Placeholders to balance.

// Transformer areas are sized so each serves roughly this winter peak (a typical MV/LV station).
export const TARGET_AREA_PEAK_KW = 500;
// Standard transformer sizes (kVA, taken as kW); bigger stations have two or more units.
export const TRANSFORMER_SIZES_KVA = [250, 400, 630, 800, 1000, 1250, 1600];
export const MULTI_TRANSFORMER_STEP_KVA = 1000;
// When the network was built, each station was sized with some headroom over the peak it served.
export const START_HEADROOM_RANGE: [number, number] = [1.2, 1.7];

// When the utility measures peaks: after each winter and after each summer.
export const WINTER_MEASURED_MONTH = 2; // March 1 (0-based month): January and February's coldest evenings
export const SUMMER_MEASURED_MONTH = 8; // September 1: May to August's sunniest middays
export const WINTER_PEAK_DAYS = 3;
export const WINTER_PEAK_HOURS = [18.5, 19.5];
export const SUMMER_PEAK_DAYS = 3;
export const SUMMER_PEAK_HOUR = 13;

// Load bands for the map and panel (share of capacity).
export const GRID_TIGHT_SHARE = 0.75;
export const GRID_FULL_SHARE = 0.9;

// Reinforcing an area: the next transformer size up (and the cables with it).
export const REINFORCE_BASE_CHF = 80_000;
export const REINFORCE_CHF_PER_KVA = 150;
export const REINFORCE_MONTHS = 9;

// A neighbourhood battery: it covers this much of an area's peak, in either direction.
export const BATTERY_KW = 250;
export const BATTERY_KWH = 500;
export const BATTERY_COST_CHF = 350_000;
export const BATTERY_MONTHS = 6;
