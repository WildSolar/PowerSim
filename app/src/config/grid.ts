// The local electricity grid (sim/grid.ts). There's no public data on where a town's transformer
// stations are or how big, so the areas are drawn from the buildings themselves and sized like a
// real network would have been. Placeholders to balance.

// Transformer areas are sized so each serves roughly this winter peak (a typical MV/LV station).
export const TARGET_AREA_PEAK_KW = 500;
// Standard transformer sizes (kVA, taken as kW); bigger stations have two or more units.
export const TRANSFORMER_SIZES_KVA = [250, 400, 630, 800, 1000, 1250, 1600];
export const MULTI_TRANSFORMER_STEP_KVA = 1000;
// When the network was built, each station was sized with some headroom over the peak it served.
export const START_HEADROOM_RANGE: [number, number] = [1.4, 2.0];

// When the utility measures peaks: after each winter and after each summer.
export const WINTER_MEASURED_MONTH = 2; // March 1 (0-based month): January and February's coldest evenings
export const SUMMER_MEASURED_MONTH = 8; // September 1: May to August's sunniest middays
export const WINTER_PEAK_DAYS = 3;
export const WINTER_PEAK_HOURS = [18.5, 19.5];
export const SUMMER_PEAK_DAYS = 3;
export const SUMMER_PEAK_HOUR = 13;

// Heat pump load control: at a peak moment, this share of the enrolled heat pumps is off (they're
// switched off in turns, so each is off only for short spells).
export const LOAD_CONTROL_OFF_SHARE_AT_PEAK = 0.5;

// Load bands for the map and panel (share of capacity).
export const GRID_TIGHT_SHARE = 0.75;
export const GRID_FULL_SHARE = 0.9;

// The utility's own routine programme, paid from grid upkeep: after each reading it reinforces this many
// of the most overloaded areas (worst first). Demand outruns it; the player speeds it up.
export const ROUTINE_REINFORCEMENTS_PER_READING = 1;

// Reinforcing an area: the next transformer size up (and the cables with it).
export const REINFORCE_BASE_CHF = 80_000;
export const REINFORCE_CHF_PER_KVA = 150;
export const REINFORCE_MONTHS = 9;

// Neighbourhood batteries at a station: each covers its power of the area's peak, in either
// direction, and stores two hours of it. Today's installed prices (container, inverter, connection
// and site work — cells are well under half), with some economy of scale; they then fall along the
// "gridBattery" price trajectory (config/costTrends.ts).
export const GRID_BATTERY_SIZES: { kw: number; kwh: number; costChf: number }[] = [
  { kw: 250, kwh: 500, costChf: 350_000 },
  { kw: 500, kwh: 1000, costChf: 600_000 },
  { kw: 1000, kwh: 2000, costChf: 1_050_000 },
];
export const BATTERY_MONTHS = 6;
