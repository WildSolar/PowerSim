/**
 * The town's power, hour by hour, as the utility trades it (config/spotMarket.ts): in each hour the
 * town either draws more than it makes — the rest comes over the long-term contracts, at the
 * month's wholesale price — or makes more than it uses, and the surplus is sold on the spot market at
 * that hour's price, which sinks on sunny middays and can fall below zero.
 *
 * The neighbourhood batteries (grid.ts) take what they can of the surplus and give it back when the
 * town draws again, so less is sold cheap and less is bought: at most their power at any moment, and
 * one full cycle a day. They store from the top of the surplus — the sunniest hours, when it sells
 * cheapest — and give back into the top of the draw (peakShave.ts).
 *
 * Read off the month's samples (yearReport.ts): each sample stands for its share of the month, so
 * the month's hours are represented, not each hour of it.
 */

import { GRID_BATTERY_ROUND_TRIP, SPOT_BASE_SHARE, SPOT_SOLAR_DIP_SHARE } from "../config/spotMarket";
import { interpolateCurve } from "../config/curve";
import { toDateMs } from "./calendar";
import { topSliceLevel } from "./peakShave";
import { market } from "./market";
import { ghiWm2 } from "./pv";

/** The spot price at `atMs` as a share of the month's wholesale price. */
export function spotShare(atMs: number): number {
  const year = new Date(toDateMs(atMs)).getUTCFullYear();
  return SPOT_BASE_SHARE - interpolateCurve(SPOT_SOLAR_DIP_SHARE, year) * (ghiWm2(atMs) / 1000);
}

/** The spot price at `atMs` (Rp/kWh): the month's wholesale price times spotShare. */
export function spotPriceRpKWh(atMs: number): number {
  return market.price("wholesale", atMs) * spotShare(atMs);
}

export interface PowerFlows {
  /** Bought over the contracts (kWh). */
  boughtKWh: number;
  /** Sold on the spot market (kWh), and what it earned (Rp; below zero when the price was). */
  soldKWh: number;
  soldRp: number;
  /** Taken in by the neighbourhood batteries and given back (kWh). */
  storedKWh: number;
  returnedKWh: number;
}

/** Each sample's share of the month, in hours (the same weighting as energy.ts's energyKWh). */
function sampleHours(times: number[]): number[] {
  return times.map((_, i) => {
    const before = i > 0 ? (times[i] - times[i - 1]) / 2 : 0;
    const after = i < times.length - 1 ? (times[i + 1] - times[i]) / 2 : 0;
    return (before + after) / 3_600_000;
  });
}

/** A month's trade: the town's draw and its local generation at each sample (W), the neighbourhood
 * batteries in service (kW, kWh), and the month's wholesale price (Rp/kWh). */
export function powerFlows(times: number[], drawW: number[], generationW: number[], battery: { kw: number; kwh: number }, wholesaleRpKWh: number): PowerFlows {
  const hours = sampleHours(times);
  const days = hours.reduce((a, b) => a + b, 0) / 24;
  const netKw = times.map((_, i) => (drawW[i] - generationW[i]) / 1000);

  // What the batteries could take from the surplus, and give back into the draw.
  let canStore = 0;
  let canReturn = 0;
  netKw.forEach((kw, i) => {
    if (kw < 0) canStore += Math.min(battery.kw, -kw) * hours[i];
    else canReturn += Math.min(battery.kw, kw) * hours[i];
  });
  const stored = Math.min(canStore, battery.kwh * days, canReturn / GRID_BATTERY_ROUND_TRIP);
  const returned = stored * GRID_BATTERY_ROUND_TRIP;
  // Taken from the top of the surplus: above this level (kW), up to the batteries' power.
  const level = topSliceLevel(netKw.map((kw) => -kw), hours, battery.kw, stored);

  let drawn = 0;
  let soldKWh = 0;
  let soldRp = 0;
  netKw.forEach((kw, i) => {
    if (kw >= 0) {
      drawn += kw * hours[i];
      return;
    }
    const kWh = (-kw - (stored > 0 ? Math.min(battery.kw, Math.max(0, -kw - level)) : 0)) * hours[i];
    soldKWh += kWh;
    soldRp += kWh * wholesaleRpKWh * spotShare(times[i]);
  });
  return { boughtKWh: Math.max(0, drawn - returned), soldKWh, soldRp, storedKWh: stored, returnedKWh: returned };
}
