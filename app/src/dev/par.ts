/**
 * Computing par (sim/par.ts): the do-nothing run of a municipality at a difficulty, through 2050,
 * scored exactly as the game scores. Run from the start screen's console, one difficulty per page
 * load (the modules keep state between runs):
 *
 *   window.__x = null; __computePar("schlieren", "normal").then((r) => (window.__x = r));
 *
 * (window.__parProgress says how far it has got), then put the results of the three difficulties
 * into public/data/par/<slug>.json.
 */

import type { Difficulty } from "../config/difficulty";
import { VERSION_LABEL } from "../changelog";
import { BASELINE_YEAR } from "../sim/calendar";
import { cachedEmissionsForYear } from "../sim/emissions";
import { NET_ZERO_TARGET_YEAR, yearPoints } from "../sim/score";
import type { EmissionShares } from "../sim/startEmissions";
import { runScenario } from "./scenario";

/** Each goal's share of a town's emissions in its starting year (sim/startEmissions.ts). */
export async function computeStartEmissions(slug: string): Promise<EmissionShares> {
  await runScenario({ slug, difficulty: "normal", enact: [], reportYears: [BASELINE_YEAR + 1], withEmissions: true });
  const e = cachedEmissionsForYear(BASELINE_YEAR);
  if (!e) throw new Error("start emissions: the baseline year was not counted");
  const share = (kg: number) => Math.round((kg / e.totalKgCO2) * 1000) / 1000;
  return {
    heating: share(e.gasKgCO2 + e.oilKgCO2 + e.districtHeatingKgCO2),
    cars: share(e.carsKgCO2 + e.evCarsKgCO2),
    fleet: share(e.vansKgCO2 + e.lorriesKgCO2 + e.evVansKgCO2 + e.evLorriesKgCO2),
    solar: share(e.electricityKgCO2 - e.evChargingKgCO2),
  };
}

export async function computePar(slug: string, difficulty: Difficulty): Promise<{ version: string; baselineYear: number; difficulty: Difficulty; firstYear: number; points: number[] }> {
  const reportYears = Array.from({ length: NET_ZERO_TARGET_YEAR - BASELINE_YEAR }, (_, i) => BASELINE_YEAR + 2 + i);
  const startedAt = Date.now();
  // Progress, readable from the console while it runs: window.__parProgress.
  const progress = (msg: string) => Object.assign(window, { __parProgress: `${msg} after ${Math.round((Date.now() - startedAt) / 1000)} s` });
  await runScenario({ slug, difficulty, enact: [], reportYears, withEmissions: true }, progress);
  const baseline = cachedEmissionsForYear(BASELINE_YEAR);
  if (!baseline) throw new Error("par: the baseline year was not counted");
  const points: number[] = [];
  for (let year = BASELINE_YEAR + 1; year <= NET_ZERO_TARGET_YEAR; year++) {
    const e = cachedEmissionsForYear(year);
    if (!e) throw new Error(`par: ${year} was not counted`);
    points.push(Math.round(yearPoints(e, baseline) * 100) / 100);
  }
  return { version: VERSION_LABEL, baselineYear: BASELINE_YEAR, difficulty, firstYear: BASELINE_YEAR + 1, points };
}
