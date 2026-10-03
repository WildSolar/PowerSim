/**
 * The market interest rate over the game: what a well-rated Swiss municipality pays to borrow for
 * ten years. It starts near today's level and drifts back towards a slowly rising long-run level,
 * with month-to-month noise — and now and then a jump (an inflation scare, a crisis) that fades over
 * a couple of years. Seeded, so a game's path is fixed from the start, but the player only ever
 * sees the past and the present.
 */

import {
  RATE_LONG_RUN_PCT,
  RATE_LONG_RUN_YEARS,
  RATE_MAX_PCT,
  RATE_MIN_PCT,
  RATE_NOISE_PCT_PER_MONTH,
  RATE_REVERSION_PER_MONTH,
  RATE_SHOCK_CHANCE_PER_MONTH,
  RATE_SHOCK_HALF_LIFE_MONTHS,
  RATE_SHOCK_PCT,
  RATE_START_PCT,
} from "../config/borrowing";
import { toDateMs } from "./calendar";
import { hashSeed, mulberry32 } from "./rng";

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

class InterestRates {
  private seed = "rates";
  private startMonth = 0;
  private base: number[] = [];
  private shock: number[] = [];

  init(seed: string, startMs: number): void {
    this.seed = seed;
    this.startMonth = monthIndex(startMs);
    this.base = [RATE_START_PCT];
    this.shock = [0];
  }

  /** The market rate (percent a year) in the month of `atMs`. */
  marketPct(atMs: number): number {
    const i = Math.max(0, monthIndex(atMs) - this.startMonth);
    this.extendTo(i);
    return Math.min(RATE_MAX_PCT, Math.max(RATE_MIN_PCT, this.base[i] + this.shock[i]));
  }

  /** The rate a year ago, for the paper and the panel. */
  history(atMs: number, months: number): { atMs: number; pct: number }[] {
    const out: { atMs: number; pct: number }[] = [];
    const monthMs = (365.25 * 24 * 3600e3) / 12;
    for (let k = months; k >= 0; k--) {
      const t = atMs - k * monthMs;
      if (monthIndex(t) < this.startMonth) continue;
      out.push({ atMs: t, pct: this.marketPct(t) });
    }
    return out;
  }

  private extendTo(i: number): void {
    const decay = Math.pow(0.5, 1 / RATE_SHOCK_HALF_LIFE_MONTHS);
    for (let m = this.base.length; m <= i; m++) {
      const rng = mulberry32(hashSeed(this.seed, "month", String(m)));
      const years = m / 12;
      const longRun = RATE_LONG_RUN_PCT[0] + (RATE_LONG_RUN_PCT[1] - RATE_LONG_RUN_PCT[0]) * Math.min(1, years / RATE_LONG_RUN_YEARS);
      const noise = (rng() + rng() + rng() - 1.5) * 2 * RATE_NOISE_PCT_PER_MONTH; // roughly normal
      const prev = this.base[m - 1];
      this.base.push(prev + RATE_REVERSION_PER_MONTH * (longRun - prev) + noise);
      let shock = this.shock[m - 1] * decay;
      if (rng() < RATE_SHOCK_CHANCE_PER_MONTH) shock += RATE_SHOCK_PCT[0] + rng() * (RATE_SHOCK_PCT[1] - RATE_SHOCK_PCT[0]);
      this.shock.push(shock);
    }
  }
}

export const interestRates = new InterestRates();
