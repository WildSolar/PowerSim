/**
 * Market prices (config/market.ts): what heating oil, gas, petrol and wholesale electricity cost in a
 * given month — a base path plus any supply shocks so far. The shocks are drawn once from the
 * municipality's seed, year by year, so the whole price history is fixed from the start and needs no
 * saving; nobody in the game can see them coming.
 */

import { interpolateCurve } from "../config/curve";
import { MARKET_BASE, SHOCK_CHANCE_PER_YEAR, SHOCK_DECAY_MONTHS, SHOCK_EXPOSURE, SHOCK_SIZE_RANGE, type Commodity } from "../config/market";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { hashSeed, mulberry32 } from "./rng";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const LAST_YEAR = 2100;

export interface MarketShock {
  startMs: number;
  /** The lift at its peak, as a share of the base price (before each price's exposure). */
  size: number;
}

class Market {
  private seed = "market";
  private shocks: MarketShock[] = [];

  /** Draws the shocks of the whole game from the municipality's seed. */
  init(seed: string): void {
    this.seed = seed;
    this.shocks = [];
    for (let year = BASELINE_YEAR + 1; year <= LAST_YEAR; year++) {
      const rng = mulberry32(hashSeed(this.seed, "shock", String(year)));
      if (rng() >= SHOCK_CHANCE_PER_YEAR) continue;
      const month = Math.floor(rng() * 12);
      const [lo, hi] = SHOCK_SIZE_RANGE;
      this.shocks.push({ startMs: toSimTimeMs(Date.UTC(year, month, 1)), size: lo + rng() * (hi - lo) });
    }
  }

  /** A price in the month of `atMs`. */
  price(commodity: Commodity, atMs: number): number {
    const d = new Date(toDateMs(atMs));
    const year = d.getUTCFullYear() + d.getUTCMonth() / 12;
    const base = interpolateCurve(MARKET_BASE[commodity], year);
    // Priced by the month: a shock in force from its first day, fading month by month.
    const monthMs = toSimTimeMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    let lift = 0;
    for (const s of this.shocks) {
      if (s.startMs > monthMs) break;
      lift += s.size * Math.exp(-(monthMs - s.startMs) / MONTH_MS / SHOCK_DECAY_MONTHS);
    }
    return base * (1 + SHOCK_EXPOSURE[commodity] * lift);
  }

  /** A price averaged over the months of a calendar year. */
  yearAverage(commodity: Commodity, year: number): number {
    let sum = 0;
    for (let m = 0; m < 12; m++) sum += this.price(commodity, toSimTimeMs(Date.UTC(year, m, 15)));
    return sum / 12;
  }

  /** Shocks that began in `[fromMs, toMs)` — for the paper. */
  shocksBetween(fromMs: number, toMs: number): MarketShock[] {
    return this.shocks.filter((s) => s.startMs >= fromMs && s.startMs < toMs);
  }
}

export const market = new Market();
