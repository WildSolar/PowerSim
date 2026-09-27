/**
 * Whether the grid can take a new connection where a building stands — asked by every decision that
 * would add one (a heat pump, a wallbox, a depot charger, a large solar array). grid.ts answers; it
 * registers itself here at init, so the decision models don't depend on the grid model (which reads
 * all of them). Until it does, everything connects.
 */

import type { Building } from "../data/types";

// Solar arrays up to this size connect even where the area's feed-in is at its limit (a household
// system); bigger ones wait.
export const SMALL_SOLAR_KWP = 30;

let drawBlocked: (b: Building, atMs: number) => boolean = () => false;
let feedInBlocked: (b: Building, atMs: number) => boolean = () => false;

export function setGridLimits(draw: typeof drawBlocked, feedIn: typeof feedInBlocked): void {
  drawBlocked = draw;
  feedInBlocked = feedIn;
}

/** No new heat pumps, wallboxes or depot chargers here: the area's winter peak is over capacity. */
export function gridDrawBlockedAt(b: Building, atMs: number): boolean {
  return drawBlocked(b, atMs);
}

/** No new large solar arrays here: the area's summer feed-in is over capacity. */
export function gridFeedInBlockedAt(b: Building, atMs: number): boolean {
  return feedInBlocked(b, atMs);
}
