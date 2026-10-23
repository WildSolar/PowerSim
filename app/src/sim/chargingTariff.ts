/**
 * The charging tariff: a household's wallbox on its own meter, at the charging price on the year's
 * sheet (tariff.ts), in return for when it may charge — power only in the night rate, or whenever
 * the utility decides, which it uses to fill the night's quietest hours (ev.ts). The meter has a
 * monthly fee of its own; a utility-controlled wallbox may pay less network fee, which the rest of
 * the town makes up in the years after (the regulator's allowance stays the same).
 *
 * Who signs up is decided once a year, on 1 January, under that year's sheet — like the dynamic
 * tariff (dynamicTariff.ts), which a household then weighs without its car: each household with a
 * wallbox and an electric car compares what the car's charging would cost on the charging meter,
 * the meter fee included, with what it costs now (the night rate for those who wait for it, the
 * evening rate for those who don't), and goes for it if the saving beats its own bother — the meter
 * to put in, and, under control, giving up when the car charges. A pure function of the year's
 * sheet and the town on 1 January: nothing to save.
 */

import {
  CHARGING_ARRIVAL_HABIT_MEDIAN_CHF,
  CHARGING_CONTROL_HASSLE_MEDIAN_CHF,
  CHARGING_SIGN_UP_HASSLE_MEDIAN_CHF,
  CHARGING_SIGN_UP_HASSLE_SPREAD,
} from "../config/chargingTariff";
import { ANNUAL_CAR_KM, EV_CAR_KWH_PER_100KM } from "../config/mobility";
import type { Building, Dwelling } from "../data/types";
import { toDateMs, toSimTimeMs } from "./calendar";
import { isResponsive } from "./ev";
import { existsAt } from "./lifetime";
import { currentMobilityMode, currentVehicleType, mobilityChargingPowerW, mobilitySlotCount } from "./mobility";
import { publicCharging } from "./publicCharging";
import { hashSeed, mulberry32 } from "./rng";
import { HOME_WEEKDAY_SHARE } from "../config/townSurplus";
import { townSurplus } from "./townSurplus";
import type { Tariff, TariffSheet } from "./tariff";
import { chargingNetworkRpKWh, sheetPrices, tariffStore } from "./tariffStore";

/** What an electric car charges in a year (kWh): its 12,000 km. */
export const CAR_KWH_PER_YEAR = (ANNUAL_CAR_KM / 100) * EV_CAR_KWH_PER_100KM;

export type ChargingMeter = "night" | "controlled";

export function offersCharging(sheet: TariffSheet): boolean {
  return sheet.chargingTariffOffered;
}

/** What a kWh costs on a sheet's charging meter in `year`, energy and network fee together. */
export function chargingAllInRpKWh(sheet: TariffSheet, year: number): number {
  return sheet.chargingEnergyRpKWh + chargingNetworkRpKWh(sheet, sheetPrices(sheet, year));
}

/** ...and in the town's solar hours, on a utility-controlled meter. */
export function chargingSolarAllInRpKWh(sheet: TariffSheet, year: number): number {
  return sheet.chargingSolarEnergyRpKWh + chargingNetworkRpKWh(sheet, sheetPrices(sheet, year));
}

/** The share of a utility-controlled car's charging that falls in solar hours, as a household
 * expects it: the days it is at home (weekends, and some weekdays) that have solar hours, with the
 * town's solar as it stands at `atMs`. */
export function expectedSolarChargingShare(year: number, atMs: number): number {
  const homeDays = (2 + 5 * HOME_WEEKDAY_SHARE) / 7;
  return homeDays * townSurplus.solarDayShare(year, atMs);
}

/** What a household with a wallbox expects charging at home to cost per kWh: its electricity price,
 * or — if the charging tariff is on offer and comes out cheaper — the charging price with the
 * meter's fee and the usual bother spread over a car's year. For a car purchase (mobility.ts). */
export function expectedHomeChargingRpKWh(tariff: Tariff, householdRpKWh: number): number {
  if (!tariff.chargingTariffOffered) return householdRpKWh;
  const bother = CHARGING_SIGN_UP_HASSLE_MEDIAN_CHF + (tariff.chargingControlled ? CHARGING_CONTROL_HASSLE_MEDIAN_CHF : 0) + CHARGING_ARRIVAL_HABIT_MEDIAN_CHF * 0.7;
  const meterRp = (tariff.chargingMeterFeeChfPerMonth * 12 + bother) * 100;
  return Math.min(householdRpKWh, tariff.chargingPriceRpKWh + meterRp / CAR_KWH_PER_YEAR);
}

/** A household's bother of signing up (CHF a year): the meter and the paperwork, giving up control
 * if the utility takes it, and — for a household that charges on arrival — that habit. */
function botherChf(controlled: boolean, chargesOnArrival: boolean, egid: string, ewid: string): number {
  const rng = mulberry32(hashSeed(egid, ewid, "charging-meter-hassle"));
  const normal = Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  const median =
    CHARGING_SIGN_UP_HASSLE_MEDIAN_CHF + (controlled ? CHARGING_CONTROL_HASSLE_MEDIAN_CHF : 0) + (chargesOnArrival ? CHARGING_ARRIVAL_HABIT_MEDIAN_CHF : 0);
  return median * Math.exp(CHARGING_SIGN_UP_HASSLE_SPREAD * normal);
}

export interface ChargingUptake {
  /** Households on the charging meter, by `${egid}:${ewid}`. */
  households: Map<string, { building: Building; dwelling: Dwelling }>;
  /** Households that could have: a wallbox and an electric car. */
  eligible: number;
}

const EMPTY: ChargingUptake = { households: new Map(), eligible: 0 };

/** Who would sign up for a sheet's charging tariff in `year`, with the town as it stands at `atMs`. */
export function estimateChargingUptake(buildings: Building[], sheet: TariffSheet, year: number, atMs: number): ChargingUptake {
  if (!offersCharging(sheet)) return EMPTY;
  const prices = sheetPrices(sheet, year);
  // Under control, part of it at the solar-hours price, if that's any different.
  const solarShare = sheet.chargingControlled && sheet.chargingSolarEnergyRpKWh !== sheet.chargingEnergyRpKWh ? expectedSolarChargingShare(year, atMs) : 0;
  const meterRp = (1 - solarShare) * chargingAllInRpKWh(sheet, year) + solarShare * chargingSolarAllInRpKWh(sheet, year);
  const out: ChargingUptake = { households: new Map(), eligible: 0 };
  for (const building of buildings) {
    if (!existsAt(building, atMs)) continue;
    for (const dwelling of building.dwellings) {
      if (!publicCharging.hasWallboxAt(building, dwelling, atMs)) continue;
      let savingRp = 0;
      let cars = 0;
      let onArrival = false;
      for (let slot = 0; slot < mobilitySlotCount(building.egid, dwelling); slot++) {
        const mode = currentMobilityMode(building.egid, dwelling.ewid, slot, atMs);
        if (mode !== "car" || currentVehicleType(building.egid, dwelling.ewid, slot, mode, atMs) !== "carEV") continue;
        cars++;
        // What it pays now: the night rate if it waits for it, the evening's if it charges on arrival.
        const waits = isResponsive(building.egid, `${dwelling.ewid}:${slot}`);
        if (!waits) onArrival = true;
        const nowRpKWh = waits ? prices.offPeakRpKWh : prices.peakRpKWh;
        savingRp += CAR_KWH_PER_YEAR * (nowRpKWh - meterRp);
      }
      if (cars === 0) continue;
      out.eligible++;
      savingRp -= sheet.chargingMeterFeeChfPerMonth * 12 * 100;
      if (savingRp / 100 > botherChf(sheet.chargingControlled, onArrival, building.egid, dwelling.ewid)) {
        out.households.set(`${building.egid}:${dwelling.ewid}`, { building, dwelling });
      }
    }
  }
  return out;
}

class ChargingTariff {
  private buildingsProvider: () => Building[] = () => [];
  private uptake = new Map<number, ChargingUptake>();
  private unsubscribe: (() => void) | null = null;
  private yearStartMs = Infinity;
  private yearEndMs = -Infinity;
  private year = 0;

  init(buildingsProvider: () => Building[]): void {
    this.buildingsProvider = buildingsProvider;
    this.uptake.clear();
    this.unsubscribe?.();
    this.unsubscribe = tariffStore.onPublish((p) => this.uptake.delete(p.year));
    this.yearStartMs = Infinity;
    this.yearEndMs = -Infinity;
  }

  private yearOf(simMs: number): number {
    if (simMs < this.yearStartMs || simMs >= this.yearEndMs) {
      this.year = new Date(toDateMs(simMs)).getUTCFullYear();
      this.yearStartMs = toSimTimeMs(Date.UTC(this.year, 0, 1));
      this.yearEndMs = toSimTimeMs(Date.UTC(this.year + 1, 0, 1));
    }
    return this.year;
  }

  /** Who is on it in the year of `simMs`, decided on 1 January (a tariff republished for the year
   * starts over). */
  uptakeAt(simMs: number): ChargingUptake {
    const year = this.yearOf(simMs);
    let uptake = this.uptake.get(year);
    if (uptake) return uptake;
    uptake = estimateChargingUptake(this.buildingsProvider(), tariffStore.sheetFor(year), year, toSimTimeMs(Date.UTC(year, 0, 1)));
    this.uptake.set(year, uptake);
    return uptake;
  }

  /** The household's charging meter at `simMs`, if it has one. */
  meterAt(egid: string, ewid: string, simMs: number): ChargingMeter | null {
    const uptake = this.uptakeAt(simMs);
    if (uptake.households.size === 0 || !uptake.households.has(`${egid}:${ewid}`)) return null;
    return tariffStore.sheetFor(this.yearOf(simMs)).chargingControlled ? "controlled" : "night";
  }

  /** The same, for a caller that keeps the household's key (`${egid}:${ewid}`). */
  onMeterKey(key: string, simMs: number): boolean {
    const uptake = this.uptakeAt(simMs);
    return uptake.households.size > 0 && uptake.households.has(key);
  }

  /** What the charging meters draw at `simMs` (W): all of them, and those of households also on the
   * dynamic tariff (whose car isn't on it — the town's dynamic consumption leaves it out). */
  meterPowerW(simMs: number, tariff: Tariff, onDynamic: (key: string) => boolean): { allW: number; onDynamicW: number } {
    let allW = 0;
    let onDynamicW = 0;
    for (const [key, { building, dwelling }] of this.uptakeAt(simMs).households) {
      if (!existsAt(building, simMs)) continue;
      const w = mobilityChargingPowerW(building.egid, dwelling, simMs, tariff);
      allW += w;
      if (w > 0 && onDynamic(key)) onDynamicW += w;
    }
    return { allW, onDynamicW };
  }
}

export const chargingTariff = new ChargingTariff();
