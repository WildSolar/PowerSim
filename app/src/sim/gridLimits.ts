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

// Why the town's or the utility's own large array can't go up where the grid is full.
export const GRID_FULL_FOR_SOLAR =
  "The grid here is full at summer middays: its transformer station can't take another large array until the area is reinforced (Grid tool).";

let drawBlocked: (b: Building, atMs: number) => boolean = () => false;
let feedInBlocked: (b: Building, atMs: number) => boolean = () => false;
let feedInBlockedAtPlace: (lon: number, lat: number, atMs: number) => boolean = () => false;

export function setGridLimits(draw: typeof drawBlocked, feedIn: typeof feedInBlocked, feedInAtPlace: typeof feedInBlockedAtPlace): void {
  drawBlocked = draw;
  feedInBlocked = feedIn;
  feedInBlockedAtPlace = feedInAtPlace;
}

/** No new heat pumps, wallboxes or depot chargers here: the area's winter peak is over capacity. */
export function gridDrawBlockedAt(b: Building, atMs: number): boolean {
  return drawBlocked(b, atMs);
}

/** No new large solar arrays here: the area's summer feed-in is over capacity. */
export function gridFeedInBlockedAt(b: Building, atMs: number): boolean {
  return feedInBlocked(b, atMs);
}

/** The same for a place off any building (a car park): the area its station serves there. */
export function gridFeedInBlockedAtPlace(lon: number, lat: number, atMs: number): boolean {
  return feedInBlockedAtPlace(lon, lat, atMs);
}
