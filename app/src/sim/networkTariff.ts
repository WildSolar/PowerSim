/**
 * The network fee, as the regulator (ElCom) has it: cost-plus. For each year, the revenue the grid
 * may earn is fixed once next year's tariff is due (the end of August): what the grid costs to run
 * per kWh (config/market.ts) on the electricity it carried over the last twelve months, a return on
 * top, and the capital cost of the reinforcements and batteries the town has paid for — less what
 * it collected beyond its allowance in the years before (handed back over three years), or plus
 * what it fell short. The utility chooses only the fee's shape (config/tariff.ts): a monthly base
 * fee per meter, and how much cheaper off-peak is; the rest of the allowance comes in per kWh.
 *
 * A meter is a household's, or a business's (one per building with business use).
 */

import { GRID_UPKEEP_RP_PER_KWH } from "../config/market";
import {
  NETWORK_CAPITAL_ANNUITY,
  NETWORK_COVERAGE_YEARS,
  NETWORK_KWH_PER_METER_FALLBACK,
  NETWORK_OFF_PEAK_KWH_SHARE,
  NETWORK_RETURN,
} from "../config/tariff";
import type { Building } from "../data/types";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { commercialCategory } from "./commercial";
import { simClock } from "./engine";
import { existsAt } from "./lifetime";
import { monthRecords } from "./monthRecords";
import { treasury } from "./treasury";

export interface NetworkAllowance {
  /** What the grid may earn in the year (Rp), base fees included. */
  allowedRp: number;
  /** The electricity it expects to carry (kWh), and the meters it serves. */
  expectedKWh: number;
  meters: number;
  /** The capital cost of the grid investments counted in it (Rp a year). */
  capitalRp: number;
  /** The share of the electricity carried in off-peak hours, which the fee is split by. */
  offPeakShare: number;
}

export interface NetworkFees {
  peakRpKWh: number;
  offPeakRpKWh: number;
  baseFeeRpPerMonth: number;
}

function yearOf(atMs: number): number {
  return new Date(toDateMs(atMs)).getUTCFullYear();
}

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** When a year's tariff is due (tariffStore.ts's deadline): its network allowance is fixed then. */
function dueMs(year: number): number {
  return year - 1 === BASELINE_YEAR ? toSimTimeMs(Date.UTC(year, 0, 1)) - 1 : toSimTimeMs(Date.UTC(year - 1, 8, 1)) - 1;
}

class NetworkTariff {
  private allowances = new Map<number, NetworkAllowance>();
  private buildingsProvider: () => Building[] = () => [];
  private unsubscribeClock: (() => void) | null = null;
  private metersCache: { month: number; meters: number } | null = null;
  /** Provisional allowances (a year not yet due), by year and the month they were worked out in. */
  private provisional = new Map<string, NetworkAllowance>();

  init(buildingsProvider: () => Building[]): void {
    this.unsubscribeClock?.();
    this.buildingsProvider = buildingsProvider;
    this.allowances = new Map();
    this.metersCache = null;
    this.provisional.clear();
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
  }

  /** Fixes next year's allowance once its tariff is due (the clock calls it; so do the dev runners). */
  advance(atMs: number): void {
    const next = yearOf(atMs) + 1;
    if (atMs > dueMs(next) && !this.allowances.has(next)) this.allowances.set(next, this.compute(next, atMs));
  }

  /** The household and business meters on the grid at `atMs`. */
  meters(atMs: number): number {
    const month = monthIndex(atMs);
    if (this.metersCache?.month === month) return this.metersCache.meters;
    let meters = 0;
    for (const b of this.buildingsProvider()) {
      if (!existsAt(b, atMs)) continue;
      meters += b.dwellings.length + (commercialCategory(b) ? 1 : 0);
    }
    this.metersCache = { month, meters };
    return meters;
  }

  /** A year's allowance: fixed once its tariff was due; before that, as it would be fixed at `atMs`. */
  allowance(year: number, atMs = simClock.getSimTimeMs()): NetworkAllowance {
    const fixed = this.allowances.get(year);
    if (fixed) return fixed;
    const key = `${year}:${monthIndex(atMs)}`;
    let a = this.provisional.get(key);
    if (!a) {
      a = this.compute(year, atMs);
      if (this.provisional.size > 50) this.provisional.clear();
      this.provisional.set(key, a);
    }
    // The starting year's is what the grid has always charged: fixed the first time it is asked for.
    if (year <= BASELINE_YEAR && a.meters > 0) this.allowances.set(year, a);
    return a;
  }

  /** The year's network fees under a sheet's structure. */
  fees(year: number, sheet: { baseFeeChfPerMonth: number; networkOffPeakShare: number }, atMs?: number): NetworkFees {
    const a = this.allowance(year, atMs);
    const baseFeeRpPerMonth = sheet.baseFeeChfPerMonth * 100;
    // Before the town's meters are known (the very start), what a typical meter's share would be.
    const perKWh =
      a.expectedKWh > 0 && a.meters > 0
        ? Math.max(0, (a.allowedRp - baseFeeRpPerMonth * 12 * a.meters) / a.expectedKWh)
        : Math.max(0, this.costPerKWh() - (baseFeeRpPerMonth * 12) / NETWORK_KWH_PER_METER_FALLBACK);
    const share = Math.min(1, Math.max(0, sheet.networkOffPeakShare));
    const q = a.offPeakShare ?? NETWORK_OFF_PEAK_KWH_SHARE;
    const peakRpKWh = perKWh / (1 - q + q * share);
    return { peakRpKWh, offPeakRpKWh: share * peakRpKWh, baseFeeRpPerMonth };
  }

  /** What the grid is allowed for each kWh it carries, before any base fee: its costs and return. */
  private costPerKWh(): number {
    return GRID_UPKEEP_RP_PER_KWH * (1 + NETWORK_RETURN);
  }

  private compute(year: number, atMs: number): NetworkAllowance {
    const meters = this.meters(atMs);
    // The starting year: what the grid has always charged, on a typical meter's use.
    if (year <= BASELINE_YEAR) {
      const expectedKWh = meters * NETWORK_KWH_PER_METER_FALLBACK;
      return { allowedRp: this.costPerKWh() * expectedKWh, expectedKWh, meters, capitalRp: 0, offPeakShare: NETWORK_OFF_PEAK_KWH_SHARE };
    }
    // The electricity carried over the last twelve months settled.
    const month = monthIndex(atMs);
    const recent = monthRecords.all().filter((r) => r.utility && r.month < month && r.month >= month - 12);
    const carried = recent.reduce((sum, r) => sum + (r.utility!.networkKWh ?? r.utility!.deliveredKWh), 0);
    const expectedKWh = recent.length > 0 ? (carried * 12) / recent.length : meters * NETWORK_KWH_PER_METER_FALLBACK;
    const offPeakKWh = recent.reduce((sum, r) => sum + (r.utility!.networkOffPeakKWh ?? 0), 0);
    const offPeakShare = carried > 0 && offPeakKWh > 0 ? offPeakKWh / carried : NETWORK_OFF_PEAK_KWH_SHARE;
    // The reinforcements and grid batteries paid for so far, as a yearly capital cost.
    let invested = 0;
    for (const p of treasury.getPayouts()) if (p.category === "grid" && p.atMs <= atMs) invested += p.amountRp;
    const capitalRp = invested * NETWORK_CAPITAL_ANNUITY;
    // What the grid collected beyond (or short of) its allowance in the years just before, a third a year.
    let correctionRp = 0;
    for (let b = year - 2 - NETWORK_COVERAGE_YEARS + 1; b <= year - 2; b++) {
      if (b <= BASELINE_YEAR) continue;
      const months = monthRecords.all().filter((r) => r.utility && Math.floor(r.month / 12) === b);
      if (months.length < 12) continue;
      const collected = months.reduce((sum, r) => sum + (r.utility!.networkRevenueRp ?? 0), 0);
      const kWh = months.reduce((sum, r) => sum + (r.utility!.networkKWh ?? r.utility!.deliveredKWh), 0);
      const allowed = this.costPerKWh() * kWh + (this.allowances.get(b)?.capitalRp ?? 0);
      correctionRp += (collected - allowed) / NETWORK_COVERAGE_YEARS;
    }
    return { allowedRp: Math.max(0, this.costPerKWh() * expectedKWh + capitalRp - correctionRp), expectedKWh, meters, capitalRp, offPeakShare };
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { allowances: this.allowances };
  }

  restore(s: ReturnType<NetworkTariff["snapshot"]>): void {
    this.allowances = new Map(s.allowances);
    this.metersCache = null;
    this.provisional.clear();
  }
}

export const networkTariff = new NetworkTariff();
