/**
 * Snow cover depth on the ground/panels — unlike everything else in this codebase,
 * a genuinely path-dependent quantity: whether panels are covered right now depends
 * on whether it's snowed recently and how much warmth there's been since to melt it,
 * not just the current instant. Modelled as a bounded backward walk (accumulate on a
 * snow day, melt on "degree-days" above freezing) rather than an incrementally
 * simulated/remembered value — still a deterministic pure function of simTime,
 * callable for any t independently, just one that does real work per call instead of
 * O(1) work. Shared across the whole municipality like the rest of weather.ts (snow
 * cover doesn't vary building to building), and only consumed by pv.ts for now.
 */

import { dailyMeanTempC, weatherAt } from "./weather";

const DAY_MS = 24 * 60 * 60_000;
const LOOKBACK_DAYS = 30; // enough for a cold snap's snowpack to fully accumulate and melt
const SNOWFALL_CM_PER_SNOW_DAY = 3;
const MELT_CM_PER_DEGREE_DAY = 0.8;
const FULL_BLOCK_CM = 2; // snow depth at which panels are considered fully covered

export function snowDepthCm(simTimeMs: number): number {
  const nowDay = Math.floor(simTimeMs / DAY_MS);
  let depth = 0;
  for (let d = nowDay - LOOKBACK_DAYS; d <= nowDay; d++) {
    const middayMs = d * DAY_MS + 12 * 60 * 60_000;
    if (weatherAt(middayMs).condition === "snow") {
      depth += SNOWFALL_CM_PER_SNOW_DAY;
    }
    const dayTempC = dailyMeanTempC(middayMs);
    if (dayTempC > 0) {
      depth = Math.max(0, depth - dayTempC * MELT_CM_PER_DEGREE_DAY);
    }
  }
  return depth;
}

/** 1 = panels clear, 0 = fully snow-covered, linear in between. */
export function snowPvBlockingFactor(snowCoverCm: number): number {
  return Math.max(0, 1 - snowCoverCm / FULL_BLOCK_CM);
}
