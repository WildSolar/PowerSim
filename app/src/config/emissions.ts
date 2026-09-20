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

export const NATURAL_GAS_KG_CO2_PER_KWH = 0.198;
export const HEATING_OIL_KG_CO2_PER_LITER = 2.65;

// mobility.ts blends petrol and diesel into one "ICE car" figure (a single
// L/100km consumption rate), so the emission factor blends the same way —
// petrol 2.32 and diesel 2.62 kgCO2/L, averaged toward roughly Switzerland's
// actual petrol-leaning car fleet split.
export const ICE_CAR_FUEL_KG_CO2_PER_LITER = 2.45;

// No official BAFU figure for Schweizer Fernwärme generally — real networks
// vary hugely by heat source (waste incineration with a large biogenic
// share, gas peaking plants, heat pumps, ...). A judgment call in the same
// spirit as heatingSystems.ts's own install-cost figures: well below gas,
// reflecting how much of the Swiss district-heat stock leans on waste heat.
export const DISTRICT_HEATING_KG_CO2_PER_KWH = 0.12;
