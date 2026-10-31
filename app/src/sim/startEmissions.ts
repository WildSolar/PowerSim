/**
 * Where a town's emissions come from at the start, before the game has counted a year of its own:
 * each goal's share, computed ahead of time with the game itself (dev/par.ts,
 * scripts/start-emissions.mjs) and shipped as public/data/start-emissions.json. Only the measures
 * page reads it, as a first picture until January's count replaces it.
 */

import { dataUrl } from "../data/loadDataset";
import type { MeasureTopic } from "./measureTypes";

export type EmissionShares = Partial<Record<MeasureTopic, number>>;

let current: EmissionShares | null = null;

/** Loads a municipality's starting shares (none if they haven't been computed). */
export async function loadStartEmissions(slug: string): Promise<void> {
  current = null;
  try {
    const response = await fetch(dataUrl("start-emissions.json"));
    if (!response.ok) return;
    const towns = (await response.json()) as Record<string, EmissionShares>;
    current = towns[slug] ?? null;
  } catch {
    current = null;
  }
}

export function startEmissionShares(): EmissionShares | null {
  return current;
}
