/**
 * Carbon removal contracts, settled month by month (the "Carbon removal contracts" measure). Once a
 * counted year has the town's own emissions down to the line — a fifth of the starting year's
 * (config/removals.ts) — the contracts buy, each month, a twelfth of a year's removals: what that
 * year emitted, up to the share of the baseline set in the measure, at the year's price per tonne.
 * What a year bought counts against its emissions, never below nothing (emissions.ts). Until a
 * counted year is down to the line, nothing is bought and nothing is paid.
 */

import { REMOVAL_CAP_SHARE, REMOVAL_PRICE_CHF_PER_T } from "../config/removals";
import { interpolateCurve } from "../config/curve";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import type { EmissionsBreakdown } from "./emissions";
import { policyStore } from "./policy";
import { treasury } from "./treasury";

/** What a tonne removed costs in a year (CHF). */
export function removalPriceChfPerT(year: number): number {
  return interpolateCurve(REMOVAL_PRICE_CHF_PER_T, year);
}

function monthIndexAt(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

class Removals {
  /** Removed, by calendar year (kg CO2). */
  private boughtKg = new Map<number, number>();
  /** The last month settled (year * 12 + month). */
  private lastMonth = 0;
  private counted: (year: number) => EmissionsBreakdown | null = () => null;
  private unsubscribeClock: (() => void) | null = null;

  /** `counted`: a year's emissions if counted already (emissions.ts's cache). */
  init(counted: (year: number) => EmissionsBreakdown | null): void {
    this.unsubscribeClock?.();
    this.counted = counted;
    this.boughtKg = new Map();
    this.lastMonth = monthIndexAt(simClock.getSimTimeMs()) - 1;
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
  }

  /** Settles every month that has ended by `atMs` (the clock calls it; so do the dev runners). */
  advance(atMs: number): void {
    this.settleThrough(monthIndexAt(atMs) - 1);
  }

  /** Settles the months up to and including `month` (year * 12 + month), once each. */
  settleThrough(month: number): void {
    for (let m = this.lastMonth + 1; m <= month; m++) this.settle(m);
    this.lastMonth = Math.max(this.lastMonth, month);
  }

  /** The latest counted year before `year`, if any. */
  private lastCounted(year: number): EmissionsBreakdown | null {
    for (let y = year - 1; y > BASELINE_YEAR; y--) {
      const e = this.counted(y);
      if (e) return e;
    }
    return null;
  }

  /** What a month would buy (kg): a twelfth of the year's contracted removals, if the last counted
   * year was down to the line. */
  monthlyKg(year: number): number {
    const baseline = this.counted(BASELINE_YEAR);
    const last = this.lastCounted(year);
    if (!baseline || !last || last.totalKgCO2 > REMOVAL_CAP_SHARE * baseline.totalKgCO2) return 0;
    const contracted = Math.min(policyStore.get().removalShareOfBaseline / 100, REMOVAL_CAP_SHARE) * baseline.totalKgCO2;
    return Math.min(contracted, last.totalKgCO2) / 12;
  }

  private settle(month: number): void {
    const year = Math.floor(month / 12);
    const kg = this.monthlyKg(year);
    if (kg <= 0) return;
    this.boughtKg.set(year, (this.boughtKg.get(year) ?? 0) + kg);
    const paidAtMs = toSimTimeMs(Date.UTC(year, (month % 12) + 1, 1));
    treasury.recordPayout("removals", paidAtMs, (kg / 1000) * removalPriceChfPerT(year) * 100, `removals-${year}`);
  }

  /** What a year bought (kg) — all of it, once its December is settled. */
  boughtInYear(year: number): number {
    this.settleThrough(year * 12 + 11);
    return this.boughtKg.get(year) ?? 0;
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { boughtKg: this.boughtKg, lastMonth: this.lastMonth };
  }

  restore(s: ReturnType<Removals["snapshot"]>): void {
    this.boughtKg = new Map(s.boughtKg);
    this.lastMonth = s.lastMonth;
  }
}

export const removals = new Removals();
