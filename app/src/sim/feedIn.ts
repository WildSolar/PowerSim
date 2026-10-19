/**
 * What solar feed-in earns, as the federal law has it since 2026: the quarter's reference market
 * price — the spot price weighted by when solar produces, so it sinks as the region's panels crowd
 * into the same sunny hours (spotMarket.ts) — but never less than the federal minimum, which depends
 * on the plant's size (config/feedIn.ts: in full under 30 kW, on the first 30 kW up to 150 kW, none
 * above). On top, the utility may pay a bonus of its own (the tariff's feedInBonusRpKWh), typically
 * for the power's certificate of origin. The tariff's own feed-in figures are a small plant's.
 *
 * Bills and the utility's accounts pay each quarter's price; owners weighing panels look at the
 * year's, as the forward market would tell them.
 */

import {
  BENCHMARK_FEED_IN_BONUS_RP_KWH,
  BENCHMARK_SOLAR_PER_KWH_SOLD,
  BENCHMARK_SOLAR_PER_KWH_SOLD_GROWTH,
  BENCHMARK_SOLAR_PER_KWH_SOLD_MAX,
  BENCHMARK_SOLAR_UNDER_MINIMUM_SHARE,
  FEED_IN_FULL_MINIMUM_BELOW_KW,
  FEED_IN_MINIMUM_RP_KWH,
  FEED_IN_MINIMUM_UP_TO_KW,
  FEED_IN_SAMPLE_HOURS,
} from "../config/feedIn";
import { BASELINE_YEAR } from "./calendar";
import type { Tariff } from "./tariff";
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

/** The federal minimum for a plant of `kw` (Rp/kWh, over its whole output): in full under 30 kW, on
 * its first 30 kW up to 150 kW, none above. */
export function feedInMinimumRpKWh(kw: number): number {
  if (kw < FEED_IN_FULL_MINIMUM_BELOW_KW) return FEED_IN_MINIMUM_RP_KWH;
  if (kw <= FEED_IN_MINIMUM_UP_TO_KW) return (FEED_IN_MINIMUM_RP_KWH * FEED_IN_FULL_MINIMUM_BELOW_KW) / kw;
  return 0;
}

function quarterOf(atMs: number): { year: number; quarter: number } {
  const d = new Date(toDateMs(atMs));
  return { year: d.getUTCFullYear(), quarter: Math.floor(d.getUTCMonth() / 3) };
}

/** The quarter's reference price at `atMs` (Rp/kWh): what solar fed in is worth on the market. */
export function referencePriceAtRpKWh(atMs: number): number {
  const { year, quarter } = quarterOf(atMs);
  return referencePriceRpKWh(year, quarter);
}

/** What feed-in pays per kWh at `atMs` for a plant of `kw`, before the utility's bonus: the quarter's
 * reference price, or the plant's federal minimum if that is more. Without a size: a small plant. */
export function feedInBaseRpKWh(atMs: number, kw = 0): number {
  return Math.max(feedInMinimumRpKWh(kw), referencePriceAtRpKWh(atMs));
}

/** The same over a year (each quarter weighted alike): what an owner weighing panels expects. */
export function feedInYearBaseRpKWh(year: number, kw = 0): number {
  let sum = 0;
  for (let q = 0; q < 4; q++) sum += Math.max(feedInMinimumRpKWh(kw), referencePriceRpKWh(year, q));
  return sum / 4;
}

/** What a plant of `kw` expects feed-in to pay over `year` under a tariff: the federal price for its
 * size and the utility's bonus. */
export function feedInExpectedRpKWhFor(tariff: Tariff, kw: number, year: number): number {
  return feedInYearBaseRpKWh(year, kw) + tariff.feedInBonusRpKWh;
}

/** What utilities elsewhere pay for solar above its market value in `year`, per kWh they sell
 * (Rp/kWh) — counted in their energy price, as the regulator allows: the minimum where it is above
 * the market, for the plants small enough for it, and the usual bonus. */
export function benchmarkFeedInSurchargeRpKWh(year: number): number {
  const solarPerKWhSold = Math.min(BENCHMARK_SOLAR_PER_KWH_SOLD_MAX, BENCHMARK_SOLAR_PER_KWH_SOLD + BENCHMARK_SOLAR_PER_KWH_SOLD_GROWTH * Math.max(0, year - BASELINE_YEAR));
  let aboveMarket = 0;
  for (let q = 0; q < 4; q++) aboveMarket += Math.max(0, FEED_IN_MINIMUM_RP_KWH - referencePriceRpKWh(year, q)) / 4;
  return solarPerKWhSold * (BENCHMARK_SOLAR_UNDER_MINIMUM_SHARE * aboveMarket + BENCHMARK_FEED_IN_BONUS_RP_KWH);
}
