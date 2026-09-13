/**
 * The CO2 intensity of grid electricity, year by year — held constant for
 * whichever year it's queried in (per the design brief: no real-time
 * simulation of a coal plant in Poland, and one municipality's own choices
 * don't move the national/European grid mix), but not constant *across*
 * years: the grid itself decarbonizes over the game's timeline the same way
 * the real one is expected to.
 *
 * Source: VSE (Verband Schweizerischer Elektrizitätsunternehmen — the Swiss
 * electricity industry association), "CO2-Gehalt des Strommix Schweiz bis
 * 2050", Ergebnisse 2026 (strom.ch, Feb 2026). This is the Swiss
 * *consumption* mix (location-based, imports included, already net of grid
 * distribution losses — "at the meter"), not the much cleaner domestic
 * production mix — imports from neighboring grids dominate the figure and
 * its year-to-year noise (hydro reservoir levels, French nuclear
 * availability). The milestones below are their own real historical
 * readings (2016/2022/2025) plus their modeled EZ2050 projection
 * (REF/2030/2040/2050) — including the projection's one deliberately
 * non-monotonic feature: a bump in 2040 from the Gösgen nuclear plant's
 * retirement pulling in more (partly gas-fired) imports, before the
 * long-term decline resumes toward 2050. Interpolated linearly between
 * milestones and held flat beyond either end, the same shape
 * spaceHeating.ts's construction-era U-value curve already uses.
 */

import { toDateMs } from "./calendar";

interface GridCarbonMilestone {
  year: number;
  gCO2PerKWh: number;
}

const GRID_CARBON_MILESTONES: GridCarbonMilestone[] = [
  { year: 2016, gCO2PerKWh: 179 },
  { year: 2022, gCO2PerKWh: 135 },
  { year: 2025, gCO2PerKWh: 90 },
  { year: 2026, gCO2PerKWh: 78 }, // VSE's "REF" (today)
  { year: 2030, gCO2PerKWh: 57 },
  { year: 2040, gCO2PerKWh: 62 }, // the Gösgen-retirement bump
  { year: 2050, gCO2PerKWh: 46 },
];

export function gridCarbonIntensityGPerKWh(year: number): number {
  const points = GRID_CARBON_MILESTONES;
  if (year <= points[0].year) return points[0].gCO2PerKWh;
  if (year >= points[points.length - 1].year) return points[points.length - 1].gCO2PerKWh;
  for (let i = 1; i < points.length; i++) {
    if (year <= points[i].year) {
      const a = points[i - 1];
      const b = points[i];
      const t = (year - a.year) / (b.year - a.year);
      return a.gCO2PerKWh + (b.gCO2PerKWh - a.gCO2PerKWh) * t;
    }
  }
  return points[points.length - 1].gCO2PerKWh;
}

export function gridCarbonIntensityGPerKWhAt(simTimeMs: number): number {
  return gridCarbonIntensityGPerKWh(new Date(toDateMs(simTimeMs)).getUTCFullYear());
}
