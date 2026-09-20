/**
 * The CO2 intensity of grid electricity, year by year — held constant for
 * whichever year it's queried in (per the design brief: no real-time
 * simulation of a coal plant in Poland, and one municipality's own choices
 * don't move the national/European grid mix), but not constant *across*
 * years: the grid itself decarbonizes over the game's timeline the same way
 * the real one is expected to. The curve itself (sourcing, milestones) lives
 * in config/emissions.ts — edit that file to recalibrate.
 */

import { toDateMs } from "./calendar";
import { GRID_CARBON_CURVE } from "../config/emissions";
import { interpolateCurve } from "../config/curve";

export function gridCarbonIntensityGPerKWh(year: number): number {
  return interpolateCurve(GRID_CARBON_CURVE, year);
}

export function gridCarbonIntensityGPerKWhAt(simTimeMs: number): number {
  return gridCarbonIntensityGPerKWh(new Date(toDateMs(simTimeMs)).getUTCFullYear());
}
