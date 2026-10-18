/**
 * What solar feed-in earns, as the federal law has it since 2026: the quarter's reference market
 * price — the spot price weighted by when solar produces, so it sinks as the region's panels crowd
 * into the same sunny hours (spotMarket.ts) — but never less than the federal minimum for small
 * plants (config/feedIn.ts). On top, the utility may pay a bonus of its own (the tariff's
 * feedInBonusRpKWh), typically for the power's certificate of origin.
 *
 * Bills and the utility's accounts pay each quarter's price; owners weighing panels look at the
 * year's, as the forward market would tell them.
 */

import { FEED_IN_MINIMUM_RP_KWH, FEED_IN_SAMPLE_HOURS } from "../config/feedIn";
import { toDateMs, toSimTimeMs } from "./calendar";
import { market } from "./market";
import { ghiWm2 } from "./pv";
import { spotShare } from "./spotMarket";

const HOUR_MS = 3_600_000;

const cache = new Map<string, number>();

/** Forget the prices worked out for another game's market. */
export function resetFeedIn(): void {
  cache.clear();
}

/** The reference market price of a quarter (Rp/kWh): the spot price, weighted by the sun. */
export function referencePriceRpKWh(year: number, quarter: number): number {
  const key = `${year}:${quarter}`;
  let price = cache.get(key);
  if (price === undefined) {
    const from = toSimTimeMs(Date.UTC(year, quarter * 3, 1));
    const to = toSimTimeMs(Date.UTC(year, quarter * 3 + 3, 1));
    let weighted = 0;
    let sun = 0;
    for (let t = from + (FEED_IN_SAMPLE_HOURS / 2) * HOUR_MS; t < to; t += FEED_IN_SAMPLE_HOURS * HOUR_MS) {
      const ghi = ghiWm2(t);
      if (ghi <= 0) continue;
      weighted += ghi * market.price("wholesale", t) * spotShare(t);
      sun += ghi;
    }
    price = sun > 0 ? weighted / sun : market.price("wholesale", from);
    cache.set(key, price);
  }
  return price;
}

/** What feed-in pays per kWh at `atMs`, before the utility's bonus: the quarter's reference price,
 * or the federal minimum if that is more. */
export function feedInBaseRpKWh(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return Math.max(FEED_IN_MINIMUM_RP_KWH, referencePriceRpKWh(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3)));
}

/** The same over a year (each quarter weighted alike): what an owner weighing panels expects. */
export function feedInYearBaseRpKWh(year: number): number {
  let sum = 0;
  for (let q = 0; q < 4; q++) sum += Math.max(FEED_IN_MINIMUM_RP_KWH, referencePriceRpKWh(year, q));
  return sum / 4;
}
