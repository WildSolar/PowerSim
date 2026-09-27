/**
 * Whether the networks can take a new connection — asked by every decision that would add one: the
 * electricity grid where a building stands (a heat pump, a wallbox, a depot charger, a large solar
 * array), and the district heating network's source. grid.ts and App register the answers here at
 * init, so the decision models don't depend on the network models (which read all of them). Until
 * they do, everything connects.
 */

import type { Building } from "../data/types";

// Solar arrays up to this size connect even where the area's feed-in is at its limit (a household
// system); bigger ones wait.
export const SMALL_SOLAR_KWP = 30;

let drawBlocked: (b: Building, atMs: number) => boolean = () => false;
let districtHeatFull: (atMs: number) => boolean = () => false;

/** Registered by App: whether the district heating network's winter peak has reached its source. */
export function setDistrictHeatLimit(full: typeof districtHeatFull): void {
  districtHeatFull = full;
}

/** No new district heating connections: the network's winter peak is over what its source delivers. */
export function districtHeatFullAt(atMs: number): boolean {
  return districtHeatFull(atMs);
}
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
