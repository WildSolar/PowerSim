/**
 * The prices in force (tariff.ts): the utility's tariff sheet for the year, plus the market's prices
 * for the month (market.ts) and the grid upkeep.
 *
 * Like a Swiss utility, the municipality publishes next year's tariff once a year — by the end of
 * August, taking effect on 1 January. (In the game's first year, which starts late, next year's
 * tariff can still be published until the end of December.) Publishing again before the deadline
 * replaces it. People react to the publication (tariffApproval.ts), not to the bills that follow.
 *
 * Simplification: history sampling and bills use the prices of the moment they look at, not
 * necessarily those in force at each sampled instant; the year's accounts (finances.ts) use the
 * year's own sheet.
 */

import { GRID_UPKEEP_RP_PER_KWH } from "../config/market";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { market } from "./market";
import { DEFAULT_SHEET, type Tariff, type TariffSheet } from "./tariff";

export interface TariffPublication {
  atMs: number;
  /** The year it takes effect. */
  year: number;
  sheet: TariffSheet;
  /** The sheet it replaces for that year (the one that would otherwise have applied). */
  previous: TariffSheet;
}

function yearOf(atMs: number): number {
  return new Date(toDateMs(atMs)).getUTCFullYear();
}

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

class TariffStore {
  /** Published sheets, by the year each takes effect. */
  private sheets = new Map<number, TariffSheet>([[BASELINE_YEAR, { ...DEFAULT_SHEET }]]);
  private current: Tariff = this.compose(0);
  private currentMonth = Number.NaN;
  private readonly listeners = new Set<() => void>();
  private readonly publishListeners = new Set<(p: TariffPublication) => void>();
  private unsubscribeClock: (() => void) | null = null;

  /** A new game: the starting sheet, in force this year and next. */
  init(): void {
    this.sheets = new Map([[BASELINE_YEAR, { ...DEFAULT_SHEET }]]);
    this.currentMonth = Number.NaN;
    this.refresh();
    this.unsubscribeClock?.();
    this.unsubscribeClock = simClock.subscribe(() => {
      if (monthIndex(simClock.getSimTimeMs()) !== this.currentMonth) this.refresh();
    });
  }

  /** Every price in force right now (the same object until the month or the sheet changes). */
  get(): Tariff {
    return this.current;
  }

  /** Every price in force at `atMs`. */
  at(atMs: number): Tariff {
    return monthIndex(atMs) === this.currentMonth ? this.current : this.compose(atMs);
  }

  /** The sheet in force in a year: the latest published for it or before. */
  sheetFor(year: number): TariffSheet {
    let best = BASELINE_YEAR;
    for (const y of this.sheets.keys()) if (y <= year && y > best) best = y;
    return this.sheets.get(best) ?? DEFAULT_SHEET;
  }

  /** Whether a sheet has been published for exactly this year. */
  isPublished(year: number): boolean {
    return this.sheets.has(year);
  }

  /** The year a tariff published at `atMs` takes effect: next year until the end of August (all
   * of the game's first year), the year after from September. */
  publishableYear(atMs: number): number {
    const d = new Date(toDateMs(atMs));
    const year = d.getUTCFullYear();
    return year === BASELINE_YEAR || d.getUTCMonth() <= 7 ? year + 1 : year + 2;
  }

  /** The last moment a tariff for `year` can be published. */
  deadlineMs(year: number): number {
    return year - 1 === BASELINE_YEAR ? toSimTimeMs(Date.UTC(year, 0, 1)) - 1 : toSimTimeMs(Date.UTC(year - 1, 8, 1)) - 1;
  }

  /** Publishes next year's tariff (see publishableYear). */
  publish(sheet: TariffSheet, atMs: number): TariffPublication {
    const year = this.publishableYear(atMs);
    const publication: TariffPublication = { atMs, year, sheet: { ...sheet }, previous: this.sheetFor(year) };
    this.sheets.set(year, publication.sheet);
    this.publishListeners.forEach((l) => l(publication));
    this.refresh();
    return publication;
  }

  onPublish(listener: (p: TariffPublication) => void): () => void {
    this.publishListeners.add(listener);
    return () => this.publishListeners.delete(listener);
  }

  /** For the dev scenario runner: change the sheet in force from the start, without publishing. */
  set(patch: Partial<TariffSheet>): void {
    const sheet = { ...this.sheetFor(BASELINE_YEAR) };
    for (const key of Object.keys(DEFAULT_SHEET) as (keyof TariffSheet)[]) if (patch[key] !== undefined) sheet[key] = patch[key] as number;
    this.sheets = new Map([[BASELINE_YEAR, sheet]]);
    this.refresh();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { sheets: this.sheets };
  }

  restore(s: ReturnType<TariffStore["snapshot"]>): void {
    this.sheets = new Map([...s.sheets].map(([y, sheet]) => [y, { ...DEFAULT_SHEET, ...sheet }]));
    this.refresh();
  }

  private compose(atMs: number): Tariff {
    return {
      ...this.sheetFor(yearOf(atMs)),
      oilPriceRpPerLiter: market.price("oil", atMs),
      gasPriceRpKWh: market.price("gas", atMs),
      petrolPriceRpPerLiter: market.price("petrol", atMs),
      wholesalePriceRpKWh: market.price("wholesale", atMs),
      gridMaintenanceRpKWh: GRID_UPKEEP_RP_PER_KWH,
    };
  }

  private refresh(): void {
    const now = simClock.getSimTimeMs();
    this.currentMonth = monthIndex(now);
    this.current = this.compose(now);
    this.listeners.forEach((l) => l());
  }
}

export const tariffStore = new TariffStore();
