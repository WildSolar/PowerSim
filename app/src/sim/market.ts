/**
 * Market prices (config/market.ts): what heating oil, gas, petrol and wholesale electricity cost in a
 * given month — a base path plus any supply shocks so far. The shocks are drawn once from the
 * municipality's seed, year by year, so the whole price history is fixed from the start and needs no
 * saving; nobody in the game can see them coming.
 *
 * Wholesale electricity also follows the forward market, as the utility buys it: each year's power
 * mostly bought in tranches over the three years before, at those years' forward prices (drawn from
 * the seed too), the rest at the month's spot price. So the price moves every year, but the next
 * year's is mostly known by the time the tariff is set (hedgedPrice).
 */

import { interpolateCurve } from "../config/curve";
import {
  MARKET_BASE,
  SHOCK_CHANCE_PER_YEAR,
  SHOCK_DECAY_MONTHS,
  SHOCK_EXPOSURE,
  SHOCK_SIZE_RANGE,
  WHOLESALE_FORWARD_PERSISTENCE,
  WHOLESALE_FORWARD_SIGMA,
  WHOLESALE_HEDGE_YEARS,
  WHOLESALE_HEDGED_SHARE,
  WHOLESALE_SPOT_MONTHLY_SIGMA,
  type Commodity,
} from "../config/market";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { hashSeed, mulberry32 } from "./rng";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const LAST_YEAR = 2100;

export interface MarketShock {
  startMs: number;
  /** The lift at its peak, as a share of the base price (before each price's exposure). */
  size: number;
}

/** A standard normal draw from two uniform ones (Box–Muller). */
function normal(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(1e-12, rng()))) * Math.cos(2 * Math.PI * rng());
}

class Market {
  private seed = "market";
  private shocks: MarketShock[] = [];
  /** The forward market's level by year (1 on average), worked out from the seed as asked for. */
  private forward = new Map<number, number>();

  /** Draws the shocks of the whole game from the municipality's seed. */
  init(seed: string): void {
    this.seed = seed;
    this.shocks = [];
    this.forward = new Map();
    for (let year = BASELINE_YEAR + 1; year <= LAST_YEAR; year++) {
      const rng = mulberry32(hashSeed(this.seed, "shock", String(year)));
      if (rng() >= SHOCK_CHANCE_PER_YEAR) continue;
      const month = Math.floor(rng() * 12);
      const [lo, hi] = SHOCK_SIZE_RANGE;
      this.shocks.push({ startMs: toSimTimeMs(Date.UTC(year, month, 1)), size: lo + rng() * (hi - lo) });
    }
  }

  /** The forward market's level in a year, against the base path (1 on average): a walk that tends to
   * keep its direction for a year or so, drawn from the seed. Before the game starts it is today's —
   * the power bought for the first year cost what it costs — and it wanders off from there. */
  private forwardLevel(year: number): number {
    if (year < BASELINE_YEAR) return 1;
    let level = this.forward.get(year);
    if (level === undefined) {
      const z = (y: number) => normal(mulberry32(hashSeed(this.seed, "wholesale-forward", String(y))));
      // The underlying walk from today's level: each year carries part of the last one's deviation.
      let x = 0;
      for (let y = BASELINE_YEAR; y <= year; y++) x = WHOLESALE_FORWARD_PERSISTENCE * x + Math.sqrt(1 - WHOLESALE_FORWARD_PERSISTENCE ** 2) * z(y);
      level = Math.exp(WHOLESALE_FORWARD_SIGMA * x - WHOLESALE_FORWARD_SIGMA ** 2 / 2);
      this.forward.set(year, level);
    }
    return level;
  }

  /** What the power hedged for a delivery year cost, against the base path: the forward prices of the
   * years it was bought in, a tranche each. */
  private hedgedLevel(year: number): number {
    let sum = 0;
    for (let k = 1; k <= WHOLESALE_HEDGE_YEARS; k++) sum += this.forwardLevel(year - k);
    return sum / WHOLESALE_HEDGE_YEARS;
  }

  /** The spot market in a month, against the base path: the year's forward level, give or take. */
  private spotLevel(year: number, month: number): number {
    const z = normal(mulberry32(hashSeed(this.seed, "wholesale-spot", String(year), String(month))));
    return this.forwardLevel(year) * Math.exp(WHOLESALE_SPOT_MONTHLY_SIGMA * z - WHOLESALE_SPOT_MONTHLY_SIGMA ** 2 / 2);
  }

  /** What a delivery year's hedged power costs (Rp/kWh), without shocks — known in full by the year
   * before, which is when the tariff for it is set. */
  hedgedPrice(year: number): number {
    return interpolateCurve(MARKET_BASE.wholesale, year + 0.5) * this.hedgedLevel(year);
  }

  /** A price in the month of `atMs`. */
  price(commodity: Commodity, atMs: number): number {
    const d = new Date(toDateMs(atMs));
    const year = d.getUTCFullYear() + d.getUTCMonth() / 12;
    let base = interpolateCurve(MARKET_BASE[commodity], year);
    if (commodity === "wholesale") {
      const y = d.getUTCFullYear();
      base *= WHOLESALE_HEDGED_SHARE * this.hedgedLevel(y) + (1 - WHOLESALE_HEDGED_SHARE) * this.spotLevel(y, d.getUTCMonth());
    }
    // Priced by the month: a shock in force from its first day, fading month by month.
    const monthMs = toSimTimeMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    let lift = 0;
    for (const s of this.shocks) {
      if (s.startMs > monthMs) break;
      lift += s.size * Math.exp(-(monthMs - s.startMs) / MONTH_MS / SHOCK_DECAY_MONTHS);
    }
    return base * (1 + SHOCK_EXPOSURE[commodity] * lift);
  }

  /** The underlying price in a year, without the shocks: what to plan a long-lived investment on. */
  basePrice(commodity: Commodity, year: number): number {
    return interpolateCurve(MARKET_BASE[commodity], year);
  }

  /** A price averaged over the months of a calendar year. */
  yearAverage(commodity: Commodity, year: number): number {
    let sum = 0;
    for (let m = 0; m < 12; m++) sum += this.price(commodity, toSimTimeMs(Date.UTC(year, m, 15)));
    return sum / 12;
  }

  /** Shocks that began in `[fromMs, toMs)` — for the utility's letter (letters.ts). */
  shocksBetween(fromMs: number, toMs: number): MarketShock[] {
    return this.shocks.filter((s) => s.startMs >= fromMs && s.startMs < toMs);
  }
}

export const market = new Market();
