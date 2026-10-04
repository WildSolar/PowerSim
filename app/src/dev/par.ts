/**
 * Computing par (sim/par.ts): the do-nothing run of a municipality at a difficulty, through 2050,
 * scored exactly as the game scores. Run from the start screen's console, one difficulty per page
 * load (the modules keep state between runs):
 *
 *   window.__x = null; __computePar("schlieren", "normal").then((r) => (window.__x = r));
 *
 * then put the results of the three difficulties into public/data/par/<slug>.json.
 */

import type { Difficulty } from "../config/difficulty";
import { VERSION_LABEL } from "../changelog";
import { BASELINE_YEAR } from "../sim/calendar";
import { cachedEmissionsForYear } from "../sim/emissions";
import { NET_ZERO_TARGET_YEAR, yearPoints } from "../sim/score";
import { runScenario } from "./scenario";

export async function computePar(slug: string, difficulty: Difficulty): Promise<{ version: string; baselineYear: number; difficulty: Difficulty; firstYear: number; points: number[] }> {
  const reportYears = Array.from({ length: NET_ZERO_TARGET_YEAR - BASELINE_YEAR }, (_, i) => BASELINE_YEAR + 2 + i);
  await runScenario({ slug, difficulty, enact: [], reportYears, withEmissions: true });
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
