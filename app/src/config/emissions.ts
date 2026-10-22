/**
 * Every tunable number behind emissions: the grid-carbon-intensity curve
 * (sim/gridCarbon.ts) and the operational combustion emission factors
 * (sim/emissionFactors.ts).
 *
 * Grid carbon curve source: VSE (Verband Schweizerischer Elektrizitätsunternehmen
 * — the Swiss electricity industry association), "CO2-Gehalt des Strommix
 * Schweiz bis 2050", Ergebnisse 2026 (strom.ch, Feb 2026). This is the Swiss
 * *consumption* mix (location-based, imports included, already net of grid
 * distribution losses — "at the meter"), not the much cleaner domestic
 * production mix — imports from neighboring grids dominate the figure and
 * its year-to-year noise (hydro reservoir levels, French nuclear
 * availability). The milestones below are their own real historical
 * readings (2016/2022/2025) plus their modeled EZ2050 projection
 * (REF/2030/2040/2050) — including the projection's one deliberately
 * non-monotonic feature: a bump in 2040 from the Gösgen nuclear plant's
 * retirement pulling in more (partly gas-fired) imports, before the
 * long-term decline resumes toward 2050.
 *
 * Emission factor sources: BAFU (Bundesamt für Umwelt), "Faktenblatt
 * CO2-Emissionsfaktoren des Treibhausgasinventars der Schweiz" — petrol 2.32
 * kgCO2/L, diesel 2.62 kgCO2/L, heating oil (Heizöl extraleicht) 2.65
 * kgCO2/L. Natural gas (0.198 kgCO2/kWh) is a standard, widely-cited
 * combustion factor (IPCC/GHG-Protocol range ~0.18-0.20), cross-checked
 * against Switzerland's own 2026 CO2 levy rate (2.158 Rp/kWh at CHF
 * 120/tCO2 implies ~0.18 kgCO2/kWh) — consistent within normal rounding.
 */

import type { CurvePoint } from "./curve";

// Interpolated via config/curve.ts; add/move/extend points here to recalibrate.
export const GRID_CARBON_CURVE: CurvePoint[] = [
  { x: 2016, y: 179 },
  { x: 2022, y: 135 },
  { x: 2025, y: 90 },
  { x: 2026, y: 78 }, // VSE's "REF" (today)
  { x: 2030, y: 57 },
  { x: 2040, y: 62 }, // the Gösgen-retirement bump
  { x: 2050, y: 46 },
];

// When in the year and the day (sim/gridCarbon.ts). The Swiss consumption mix is dirtiest on winter
// nights, when much of it is imported (largely from Germany), and cleanest at sunny middays, when
// hydro and solar cover it — on one December day, 275 g/kWh at midnight and 39 g at noon, against
// about 98 g on average over 2017-2021 (University of Geneva's hourly estimates: Romano, Patel &
// Hollmuller, Energy 2024). The curve above stays the average over a year of ordinary use; these
// only shape it: a season (winter about 1.5 times the year's figure, summer about half), an hour
// (night high, midday low), and the sun (a sunny hour cleaner still).
export const GRID_CARBON_SEASON_AMPLITUDE = 0.47;
export const GRID_CARBON_HOUR_SHAPE = [
  1.6, 1.62, 1.65, 1.65, 1.6, 1.5, 1.3, 1.1, 0.9, 0.75, 0.62, 0.52, 0.48, 0.5, 0.56, 0.66, 0.8, 0.95, 1.05, 1.15, 1.25, 1.35, 1.45, 1.55,
];
export const GRID_CARBON_SUN_DIP = 0.35; // at 1,000 W/m² of sunshine, this much less
// The ordinary use the year's figure is the average over: more in winter, most in the evening.
export const GRID_CARBON_USE_SEASON = 0.2;
export const GRID_CARBON_USE_HOUR_SHAPE = [
  0.6, 0.55, 0.5, 0.5, 0.5, 0.55, 0.7, 0.9, 1.0, 1.0, 1.0, 1.05, 1.05, 1.0, 1.0, 1.0, 1.05, 1.15, 1.3, 1.35, 1.25, 1.1, 0.9, 0.75,
];

export const NATURAL_GAS_KG_CO2_PER_KWH = 0.198;
export const HEATING_OIL_KG_CO2_PER_LITER = 2.65;

// mobility.ts blends petrol and diesel into one "ICE car" figure (a single
// L/100km consumption rate), so the emission factor blends the same way —
// petrol 2.32 and diesel 2.62 kgCO2/L, averaged toward roughly Switzerland's
// actual petrol-leaning car fleet split.
export const ICE_CAR_FUEL_KG_CO2_PER_LITER = 2.45;
