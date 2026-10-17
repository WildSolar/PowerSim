// The local electricity grid (sim/grid.ts). There's no public data on where a town's transformer
// stations are or how big, so the areas are drawn from the buildings themselves and sized like a
// real network would have been. Placeholders to balance.

// Transformer areas are sized so each serves roughly this winter peak (a typical MV/LV station) in
// a town whose own winter peak is AREA_PEAK_REFERENCE_KW. A bigger town has somewhat bigger stations
// on average (denser streets, more large buildings), a smaller one somewhat smaller: the target
// scales with the town's total peak to the power AREA_PEAK_SIZE_EXPONENT.
export const TARGET_AREA_PEAK_KW = 650;
export const AREA_PEAK_REFERENCE_KW = 15_000;
export const AREA_PEAK_SIZE_EXPONENT = 0.15;
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

// Automatic reinforcement (the player's setting): after each reading, an overloaded station gets the
// smallest size that carries its peak with this much headroom.
export const AUTO_REINFORCE_HEADROOM = 1.25;

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

// How much of a peak a neighbourhood battery can shave depends on its storage as well as its power:
// a peak is a hump on top of the rest of the day, and holding the station below a level means
// covering everything above it for as long as the hump lasts. The hump is taken as a triangle this
// share of the peak high and this many hours wide — the winter evening peak rising above the
// afternoon's level, the summer feed-in rising from nothing at dawn to its midday top.
export const WINTER_PEAK_HUMP = { share: 0.4, hours: 6 };
export const SUMMER_PEAK_HUMP = { share: 1, hours: 8 };
