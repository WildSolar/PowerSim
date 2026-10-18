/**
 * Market access: a business using 100 MWh a year or more at one site may buy its energy on the open
 * market instead of from the utility's basic supply — and once it has left, it can't come back.
 * Those that have left still pay the network fee (and the base fee) here; their energy is their
 * supplier's, bought on the market.
 *
 * At the start, the sites for whom leaving was worth the bother have left already. Every October,
 * once next year's tariff is out, the rest compare it with what a supplier offers for next year —
 * the forward price of the year's power (market.ts) and the supplier's margin — and leave if the
 * saving is worth their bother (a sum per site, seeded). So an energy price well above the market's
 * drains the big customers away, for good; one close to it keeps them.
 */

import {
  MARKET_ACCESS_BUSINESS_PEAK_SHARE,
  MARKET_ACCESS_DECISION_MONTH,
  MARKET_ACCESS_HURDLE_MEDIAN_RP_KWH,
  MARKET_ACCESS_HURDLE_SPREAD,
  MARKET_ACCESS_MIN_KWH,
  MARKET_SUPPLIER_MARGIN_RP_KWH,
} from "../config/marketAccess";
import type { Building } from "../data/types";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { commercialPowerW } from "./commercial";
import { simClock } from "./engine";
import { fleets } from "./fleet";
import { existsAt } from "./lifetime";
import { market } from "./market";
import { hashSeed, mulberry32 } from "./rng";
import type { TariffSheet } from "./tariff";

const HOUR_MS = 3_600_000;
const WEEKS_PER_YEAR = 365.25 / 7;

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** What a business pays for energy on average under a sheet (it uses most of its power by day). */
export function businessEnergyRpKWh(sheet: TariffSheet): number {
  return MARKET_ACCESS_BUSINESS_PEAK_SHARE * sheet.energyPeakRpKWh + (1 - MARKET_ACCESS_BUSINESS_PEAK_SHARE) * sheet.energyOffPeakRpKWh;
}

/** What a supplier on the open market offers for a year's energy (Rp/kWh). */
export function marketOfferRpKWh(year: number): number {
  return market.hedgedPrice(year) + MARKET_SUPPLIER_MARGIN_RP_KWH;
}

class MarketAccess {
  /** The sites on the open market, by egid, and since when. */
  private onMarket = new Map<string, number>();
  /** The last year a round was held for. */
  private lastRoundYear = BASELINE_YEAR;
  private buildingsProvider: () => Building[] = () => [];
  private sheetFor: (year: number) => TariffSheet = () => {
    throw new Error("marketAccess: not initialised");
  };
  private seed = "";
  private yearlyKWh = new Map<string, number>();
  private unsubscribeClock: (() => void) | null = null;
  private businessCache: { month: number; total: number; onMarket: number } | null = null;

  /** A new game: the sites for whom leaving basic supply was worth it at the start have left. */
  init(buildingsProvider: () => Building[], sheetFor: (year: number) => TariffSheet, seed: string): void {
    this.unsubscribeClock?.();
    this.buildingsProvider = buildingsProvider;
    this.sheetFor = sheetFor;
    this.seed = seed;
    this.yearlyKWh = new Map();
    this.onMarket = new Map();
    this.businessCache = null;
    const now = simClock.getSimTimeMs();
    this.lastRoundYear = new Date(toDateMs(now)).getUTCFullYear();
    for (const b of this.eligible(now)) if (this.wouldLeave(b, BASELINE_YEAR)) this.onMarket.set(b.egid, -Infinity);
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
  }

  /** A business meter's yearly use (kWh): its business, from a typical week. */
  businessKWh(b: Building): number {
    let kWh = this.yearlyKWh.get(b.egid);
    if (kWh === undefined) {
      const week = toSimTimeMs(Date.UTC(BASELINE_YEAR, 4, 4)); // a Monday in May
      let wh = 0;
      for (let h = 0; h < 168; h++) wh += commercialPowerW(b, week + h * HOUR_MS);
      kWh = (wh / 1000) * WEEKS_PER_YEAR;
      this.yearlyKWh.set(b.egid, kWh);
    }
    return kWh;
  }

  /** The sites standing at `atMs` that may choose their supplier. */
  eligible(atMs: number): Building[] {
    return this.buildingsProvider().filter((b) => existsAt(b, atMs) && this.businessKWh(b) >= MARKET_ACCESS_MIN_KWH);
  }

  /** How much cheaper per kWh the market has to be before a site bothers to leave (Rp). */
  private hurdleRpKWh(egid: string): number {
    const rng = mulberry32(hashSeed(this.seed, "market-access-hurdle", egid));
    const normal = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
    return MARKET_ACCESS_HURDLE_MEDIAN_RP_KWH * Math.exp(MARKET_ACCESS_HURDLE_SPREAD * normal);
  }

  /** Whether a site would leave basic supply for `year`: the market's offer beats the year's energy
   * price by more than its hurdle. */
  private wouldLeave(b: Building, year: number): boolean {
    return businessEnergyRpKWh(this.sheetFor(year)) - marketOfferRpKWh(year) > this.hurdleRpKWh(b.egid);
  }

  /** Every October, once next year's tariff is out: the sites still in basic supply decide whether
   * to leave on 1 January (the clock calls it; so do the dev runners). */
  advance(atMs: number): void {
    const month = monthIndex(atMs);
    const year = Math.floor(month / 12);
    if (month % 12 < MARKET_ACCESS_DECISION_MONTH) return;
    const next = year + 1;
    if (this.lastRoundYear >= next) return;
    this.lastRoundYear = next;
    const fromMs = toSimTimeMs(Date.UTC(next, 0, 1));
    for (const b of this.eligible(atMs)) if (!this.onMarket.has(b.egid) && this.wouldLeave(b, next)) this.onMarket.set(b.egid, fromMs);
    this.businessCache = null;
  }

  /** Whether a site buys on the open market at `atMs`. */
  isOnMarket(egid: string, atMs: number): boolean {
    const since = this.onMarket.get(egid);
    return since !== undefined && since <= atMs;
  }

  /** The business use of the sites on the open market at `atMs` (W): their energy is not the utility's. */
  marketPowerW(buildings: Building[], atMs: number): number {
    if (this.onMarket.size === 0) return 0;
    let w = 0;
    for (const b of buildings) {
      if (!this.isOnMarket(b.egid, atMs) || !existsAt(b, atMs)) continue;
      w += commercialPowerW(b, atMs) + fleets.depotPowerW(b, atMs);
    }
    return w;
  }

  /** The sites on the open market, the sites that may choose, and the share of the town's business
   * use that is on the market, at `atMs`. */
  stats(atMs: number): { sites: number; eligible: number; businessShare: number } {
    let eligible = 0;
    let sites = 0;
    for (const b of this.eligible(atMs)) {
      eligible++;
      if (this.isOnMarket(b.egid, atMs)) sites++;
    }
    return { sites, eligible, businessShare: this.businessShareOnMarket(atMs) };
  }

  /** The share of all business use in town that buys on the open market (by yearly use). */
  businessShareOnMarket(atMs: number): number {
    const month = monthIndex(atMs);
    if (this.businessCache?.month !== month) {
      let total = 0;
      let onMarket = 0;
      for (const b of this.buildingsProvider()) {
        if (!existsAt(b, atMs)) continue;
        const kWh = this.businessKWh(b);
        total += kWh;
        if (this.isOnMarket(b.egid, atMs)) onMarket += kWh;
      }
      this.businessCache = { month, total, onMarket };
    }
    return this.businessCache.total > 0 ? this.businessCache.onMarket / this.businessCache.total : 0;
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { onMarket: this.onMarket, lastRoundYear: this.lastRoundYear };
  }

  restore(s: ReturnType<MarketAccess["snapshot"]>): void {
    this.onMarket = new Map(s.onMarket);
    this.lastRoundYear = s.lastRoundYear;
    this.businessCache = null;
  }
}

export const marketAccess = new MarketAccess();
