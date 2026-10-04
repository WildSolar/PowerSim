/**
 * The dynamic electricity tariff (config/dynamicTariff.ts). When the year's tariff sheet offers it
 * (a spread above zero, tariffStore.ts), the price moves through the day around the time-of-use
 * tariff's daily average: up to the spread dearer when the grid is expected to be busiest, as much
 * cheaper when it's quiet. The rule is fixed in advance from the hour and the season — like a
 * utility pricing on forecast load — and does not react to what the town actually draws, so if
 * everyone shifts into the same cheap hours, those hours get busy.
 *
 * Who signs up is decided once a year, on 1 January, under that year's sheet: each household
 * weighs what it would save — mostly from charging its car in the cheapest hours — against its own
 * bother of switching; a building's owner does the same for its heat pump, which is on its own
 * meter. Nobody signs up who would only pay more. The decision is a pure function of the year's
 * sheet and the town as it stood on 1 January, so it needs no saving.
 *
 * Households on it respond (ev.ts, heatPump.ts, devices.ts): cars charge in the cheapest window
 * before they're needed, heat pumps run harder when power is cheap and softer when it's dear, and
 * a share of washing machines wait for the cheapest hour.
 */

import {
  DWELLING_BASE_KWH,
  DYNAMIC_SHAPE_SUMMER,
  DYNAMIC_SHAPE_WINTER,
  EV_KWH,
  HEAT_PUMP_SHIFT,
  HOUSEHOLD_LOAD_SHAPE,
  LAUNDRY_KWH,
  LAUNDRY_MAX_DELAY_HOURS,
  SIGN_UP_HASSLE_MEDIAN_CHF,
  SIGN_UP_HASSLE_SPREAD,
  SMART_CHARGE_SPREAD_HOURS,
  SMART_LAUNDRY_SHARE,
} from "../config/dynamicTariff";
import type { Building } from "../data/types";
import { EPOCH_MS, toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { isResponsive } from "./ev";
import { annualHeatDemandKWh, currentHeatingSystemId } from "./heatingRenewal";
import { existsAt } from "./lifetime";
import { currentMobilityMode, currentVehicleType, mobilitySlotCount } from "./mobility";
import { hashSeed, mulberry32 } from "./rng";
import type { TariffSheet } from "./tariff";
import { tariffStore } from "./tariffStore";

const DAY_MS = 24 * 3_600_000;
const HOUR_MS = 3_600_000;
const HEAT_PUMP_COP = 3; // for the owner's estimate of what the heat pump uses

function normalize(shape: number[]): number[] {
  const mean = shape.reduce((a, b) => a + b, 0) / shape.length;
  const shifted = shape.map((v) => v - mean);
  const max = Math.max(...shifted.map(Math.abs));
  return shifted.map((v) => v / max);
}

const WINTER = normalize(DYNAMIC_SHAPE_WINTER);
const SUMMER = normalize(DYNAMIC_SHAPE_SUMMER);

/** 1 in mid-January, 0 in mid-July. */
function winterWeight(simDay: number): number {
  const day = Math.floor(EPOCH_MS / DAY_MS) + simDay;
  return 0.5 + 0.5 * Math.cos((2 * Math.PI * (day - 14)) / 365.2425);
}

/** How busy the grid is expected to be at `simMs`, from -1 (quietest) to 1 (busiest). */
export function loadSignal(simMs: number): number {
  const day = Math.floor(simMs / DAY_MS);
  const w = winterWeight(day);
  // Hourly values sit at the middle of their hour; in between, the signal runs straight.
  const x = (simMs - day * DAY_MS) / HOUR_MS - 0.5;
  const h = Math.floor(x);
  const f = x - h;
  const a = (h + 24) % 24;
  const b = (h + 25) % 24;
  const za = w * WINTER[a] + (1 - w) * SUMMER[a];
  const zb = w * WINTER[b] + (1 - w) * SUMMER[b];
  return za + (zb - za) * f;
}

/** The time-of-use tariff's average over a day, which the dynamic price moves around. */
export function dynamicLevelRpKWh(sheet: TariffSheet): number {
  const offPeakHours = (sheet.offPeakEndHour - sheet.offPeakStartHour + 24) % 24;
  return (offPeakHours * sheet.offPeakPriceRpKWh + (24 - offPeakHours) * sheet.peakPriceRpKWh) / 24;
}

/** The dynamic price at `simMs` under a sheet (Rp/kWh). */
export function dynamicPriceRpKWh(sheet: TariffSheet, simMs: number): number {
  return Math.max(0, dynamicLevelRpKWh(sheet) + sheet.dynamicSpreadRpKWh * loadSignal(simMs));
}

/** Whether a sheet offers the dynamic tariff at all. */
export function offersDynamic(sheet: TariffSheet): boolean {
  return sheet.dynamicSpreadRpKWh > 0;
}

// --- responses ---

const troughCache = new Map<number, number>();

/** The quietest moment of the night that starts on `simDay` (18:00 to 08:00 the next morning). */
function nightTroughMs(simDay: number): number {
  let trough = troughCache.get(simDay);
  if (trough === undefined) {
    const from = simDay * DAY_MS + 18 * HOUR_MS;
    let best = Infinity;
    trough = from;
    for (let t = from; t <= from + 14 * HOUR_MS; t += HOUR_MS / 4) {
      const z = loadSignal(t);
      if (z < best) {
        best = z;
        trough = t;
      }
    }
    if (troughCache.size > 400) troughCache.clear();
    troughCache.set(simDay, trough);
  }
  return trough;
}

/** When a car on the dynamic tariff starts charging: around the night's cheapest hours, but not
 * before it's plugged in and not so late that it isn't full by morning. (The signal falls to one
 * trough each night and rises again, flat at the bottom; chargers don't all aim at the same
 * minute, so each lands somewhere within an hour and a half of it — `draw` in [0, 1).) */
export function smartChargeStartMs(simDay: number, plugInMs: number, latestStartMs: number, durationMs: number, draw = 0.5): number {
  const aim = nightTroughMs(simDay) + (draw - 0.5) * SMART_CHARGE_SPREAD_HOURS * HOUR_MS;
  return Math.min(Math.max(aim - durationMs / 2, plugInMs), latestStartMs);
}

/** How much harder (above 1) or softer a heat pump on the dynamic tariff runs at `simMs`. */
export function heatPumpShiftFactor(simMs: number): number {
  return 1 - HEAT_PUMP_SHIFT * loadSignal(simMs);
}

/** Where a timer-started laundry load moves: the cheapest start within the delay, finishing by midnight. */
export function smartLaundryStartMs(startMs: number, durationMs: number, draw: number): number {
  if (draw >= SMART_LAUNDRY_SHARE) return startMs;
  const dayEnd = Math.floor(startMs / DAY_MS) * DAY_MS + DAY_MS;
  const latest = Math.min(startMs + LAUNDRY_MAX_DELAY_HOURS * HOUR_MS, dayEnd - durationMs);
  let best = startMs;
  let bestZ = loadSignal(startMs + durationMs / 2);
  for (let t = startMs + HOUR_MS / 2; t <= latest; t += HOUR_MS / 2) {
    const z = loadSignal(t + durationMs / 2);
    if (z < bestZ) {
      bestZ = z;
      best = t;
    }
  }
  return best;
}

// --- who signs up ---

/** What a kWh costs each kind of use on either tariff in a year (Rp/kWh), from a sample of days. */
interface YearRates {
  touBase: number;
  dynBase: number;
  touEvPlugIn: number; // a car charging when plugged in, on time-of-use
  touEvOffPeak: number; // one that already waits for off-peak
  dynEv: number;
  touHeatPump: number;
  dynHeatPump: number;
  touLaundry: number;
  dynLaundrySmart: number;
}

function touRate(sheet: TariffSheet, simMs: number): number {
  const hour = ((simMs % DAY_MS) + DAY_MS) % DAY_MS / HOUR_MS;
  const offPeak = hour >= sheet.offPeakStartHour || hour < sheet.offPeakEndHour;
  return offPeak ? sheet.offPeakPriceRpKWh : sheet.peakPriceRpKWh;
}

function yearRates(sheet: TariffSheet, year: number): YearRates {
  let base = [0, 0, 0];
  let hp = [0, 0, 0];
  let ev = [0, 0];
  let laundry = [0, 0];
  let days = 0;
  for (let month = 0; month < 12; month++) {
    const day = Math.floor(toSimTimeMs(Date.UTC(year, month, 15)) / DAY_MS);
    const heating = winterWeight(day) ** 2; // heat pumps run mostly in winter
    days++;
    for (let h = 0; h < 24; h++) {
      const t = day * DAY_MS + (h + 0.5) * HOUR_MS;
      const dyn = dynamicPriceRpKWh(sheet, t);
      const w = HOUSEHOLD_LOAD_SHAPE[h];
      base = [base[0] + w * touRate(sheet, t), base[1] + w * dyn, base[2] + w];
      const f = heatPumpShiftFactor(t);
      hp = [hp[0] + heating * touRate(sheet, t), hp[1] + heating * f * dyn, hp[2] + heating * f];
    }
    // A typical evening: plugged in at 18:30, two hours' charging, gone at 07:00.
    const plugIn = day * DAY_MS + 18.5 * HOUR_MS;
    const duration = 2 * HOUR_MS;
    const start = smartChargeStartMs(day, plugIn, day * DAY_MS + 29 * HOUR_MS, duration);
    ev = [ev[0] + (touRate(sheet, plugIn) + touRate(sheet, plugIn + HOUR_MS)) / 2, ev[1] + dynamicPriceRpKWh(sheet, start + duration / 2)];
    const smartStart = smartLaundryStartMs(day * DAY_MS + 12 * HOUR_MS, 2 * HOUR_MS, 0);
    laundry = [laundry[0] + touRate(sheet, day * DAY_MS + 15 * HOUR_MS), laundry[1] + dynamicPriceRpKWh(sheet, smartStart + HOUR_MS)];
  }
  return {
    touBase: base[0] / base[2],
    dynBase: base[1] / base[2],
    touEvPlugIn: ev[0] / days,
    touEvOffPeak: sheet.offPeakPriceRpKWh,
    dynEv: ev[1] / days,
    touHeatPump: hp[0] / hp[2],
    dynHeatPump: hp[1] / hp[2],
    touLaundry: laundry[0] / days,
    dynLaundrySmart: laundry[1] / days,
  };
}

function hassleChf(kind: "dwelling" | "heatPump", ...key: string[]): number {
  const rng = mulberry32(hashSeed(...key, "dynamic-hassle"));
  const normal = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return SIGN_UP_HASSLE_MEDIAN_CHF[kind] * Math.exp(SIGN_UP_HASSLE_SPREAD * normal);
}

/** A household's yearly saving on the dynamic tariff (CHF; negative if it would pay more). */
function dwellingSavingChf(egid: string, ewid: string, slotCount: number, rates: YearRates, atMs: number): number {
  let rp = DWELLING_BASE_KWH * (rates.touBase - rates.dynBase);
  rp += SMART_LAUNDRY_SHARE * LAUNDRY_KWH * (rates.touLaundry - rates.dynLaundrySmart);
  for (let slot = 0; slot < slotCount; slot++) {
    const mode = currentMobilityMode(egid, ewid, slot, atMs);
    if (mode !== "car" || currentVehicleType(egid, ewid, slot, mode, atMs) !== "carEV") continue;
    const tou = isResponsive(egid, `${ewid}:${slot}`) ? rates.touEvOffPeak : rates.touEvPlugIn;
    rp += EV_KWH * (tou - rates.dynEv);
  }
  return rp / 100;
}

function heatPumpSavingChf(building: Building, rates: YearRates, atMs: number): number {
  const kWh = annualHeatDemandKWh(building, atMs) / HEAT_PUMP_COP;
  return (kWh * (rates.touHeatPump - rates.dynHeatPump)) / 100;
}

export interface DynamicUptake {
  /** Households on it, as `${egid}:${ewid}`. */
  dwellings: Set<string>;
  /** Buildings whose heat pump is on it. */
  heatPumps: Set<string>;
  /** Households that could have (every household in the town). */
  dwellingCount: number;
  heatPumpCount: number;
}

const EMPTY: DynamicUptake = { dwellings: new Set(), heatPumps: new Set(), dwellingCount: 0, heatPumpCount: 0 };

/** Who would sign up for a sheet's dynamic tariff in `year`, with the town as it stands at `atMs`. */
export function estimateUptake(buildings: Building[], sheet: TariffSheet, year: number, atMs: number): DynamicUptake {
  if (!offersDynamic(sheet)) return EMPTY;
  const rates = yearRates(sheet, year);
  const out: DynamicUptake = { dwellings: new Set(), heatPumps: new Set(), dwellingCount: 0, heatPumpCount: 0 };
  for (const building of buildings) {
    if (!existsAt(building, atMs)) continue;
    for (const dwelling of building.dwellings) {
      out.dwellingCount++;
      const saving = dwellingSavingChf(building.egid, dwelling.ewid, mobilitySlotCount(building.egid, dwelling), rates, atMs);
      if (saving > hassleChf("dwelling", building.egid, dwelling.ewid)) out.dwellings.add(`${building.egid}:${dwelling.ewid}`);
    }
    const system = currentHeatingSystemId(building, atMs);
    if (system === "airHeatPump" || system === "groundHeatPump") {
      out.heatPumpCount++;
      if (heatPumpSavingChf(building, rates, atMs) > hassleChf("heatPump", building.egid)) out.heatPumps.add(building.egid);
    }
  }
  return out;
}

class DynamicTariff {
  private buildingsProvider: () => Building[] = () => [];
  private uptake = new Map<number, DynamicUptake>();
  private yearStartMs = Infinity;
  private yearEndMs = -Infinity;
  private year = 0;

  init(buildingsProvider: () => Building[]): void {
    this.buildingsProvider = buildingsProvider;
    this.uptake.clear();
    troughCache.clear();
    this.yearStartMs = Infinity;
    this.yearEndMs = -Infinity;
  }

  /** The calendar year of `simMs` (cheap for runs of calls in the same year). */
  private yearOf(simMs: number): number {
    if (simMs < this.yearStartMs || simMs >= this.yearEndMs) {
      this.year = new Date(toDateMs(simMs)).getUTCFullYear();
      this.yearStartMs = toSimTimeMs(Date.UTC(this.year, 0, 1));
      this.yearEndMs = toSimTimeMs(Date.UTC(this.year + 1, 0, 1));
    }
    return this.year;
  }

  /** Who is on it in the year of `simMs`, decided on 1 January. */
  uptakeAt(simMs: number): DynamicUptake {
    const year = this.yearOf(simMs);
    let uptake = this.uptake.get(year);
    if (uptake) return uptake;
    const jan1 = toSimTimeMs(Date.UTC(year, 0, 1));
    uptake = estimateUptake(this.buildingsProvider(), tariffStore.sheetFor(year), year, jan1);
    // Settled once the year has begun (its sheet can no longer change); asked about earlier, the
    // answer may still change.
    if (simClock.getSimTimeMs() >= jan1) this.uptake.set(year, uptake);
    return uptake;
  }

  onDynamicDwelling(egid: string, ewid: string, simMs: number): boolean {
    const uptake = this.uptakeAt(simMs);
    return uptake.dwellings.size > 0 && uptake.dwellings.has(`${egid}:${ewid}`);
  }

  /** The same, for a caller that keeps the household's key (`${egid}:${ewid}`). */
  onDynamicKey(key: string, simMs: number): boolean {
    const uptake = this.uptakeAt(simMs);
    return uptake.dwellings.size > 0 && uptake.dwellings.has(key);
  }

  onDynamicHeatPump(egid: string, simMs: number): boolean {
    const uptake = this.uptakeAt(simMs);
    return uptake.heatPumps.size > 0 && uptake.heatPumps.has(egid);
  }
}

export const dynamicTariff = new DynamicTariff();
