import type { Building } from "../data/types";

/** Whether the building stands and is in use at `simTimeMs`. A building that
 * simply existed when the game started has neither field set. */
export function existsAt(building: Building, simTimeMs: number): boolean {
  return (building.builtAtMs ?? Number.NEGATIVE_INFINITY) <= simTimeMs && simTimeMs < (building.demolishedAtMs ?? Number.POSITIVE_INFINITY);
}

/** A building site between groundbreaking and completion — shown on the map but
 * drawing no power and housing nobody. */
export function underConstructionAt(building: Building, simTimeMs: number): boolean {
  return (
    building.constructionStartMs !== undefined &&
    building.constructionStartMs <= simTimeMs &&
    building.builtAtMs !== undefined &&
    simTimeMs < building.builtAtMs
  );
}

/** Existing or under construction — everything the map draws. */
export function visibleAt(building: Building, simTimeMs: number): boolean {
  return existsAt(building, simTimeMs) || underConstructionAt(building, simTimeMs);
}
