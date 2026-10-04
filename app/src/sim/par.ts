/**
 * Par: what a municipality scores if the player does nothing at all — the grid getting cleaner,
 * things wearing out and being replaced, technology getting cheaper. Computed ahead of time with
 * the game itself (dev/par.ts) for each difficulty, and shipped as public/data/par/<slug>.json.
 * It belongs to the build that computed it: a balance change needs it computed again.
 */

import { dataUrl } from "../data/loadDataset";
import type { Difficulty } from "../config/difficulty";
import { BASELINE_YEAR } from "./calendar";

export interface ParFile {
  /** The public version it was computed with. */
  version: string;
  /** The starting year it was computed from: par only fits a game that started in the same year. */
  baselineYear: number;
  /** Points per year, from the year after the start through 2050. */
  difficulties: Partial<Record<Difficulty, { firstYear: number; points: number[] }>>;
}

let current: { firstYear: number; points: number[] } | null = null;

/** Loads a municipality's par for a difficulty (none if it hasn't been computed). */
export async function loadPar(slug: string, difficulty: Difficulty): Promise<void> {
  current = null;
  try {
    const response = await fetch(dataUrl(`par/${slug}.json`));
    if (!response.ok) return;
    const file = (await response.json()) as ParFile;
    current = file.baselineYear === BASELINE_YEAR ? (file.difficulties[difficulty] ?? null) : null;
  } catch {
    current = null;
  }
}

/** Par's points through `throughYear`, or null if there is no par for this game. */
export function parThrough(throughYear: number): number | null {
  if (!current) return null;
  let total = 0;
  current.points.forEach((p, i) => {
    if (current!.firstYear + i <= throughYear) total += p;
  });
  return total;
}

/** Par's points for each year (for the chart), or null. */
export function parYears(): { year: number; points: number }[] | null {
  return current ? current.points.map((points, i) => ({ year: current!.firstYear + i, points })) : null;
}
