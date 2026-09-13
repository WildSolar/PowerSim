/**
 * Converts already-simulated energy into money — the tariff's time-of-use
 * electricity prices, plus three flat (non-time-of-use) prices: what exported
 * solar earns (feed-in), and what non-electric space heating costs for the
 * buildings whose real heating source is gas or district heat rather than a
 * heat pump.
 *
 * Electricity is priced per sample interval at whichever of off-peak/peak
 * applies at that interval's midpoint, not "total kWh times a blended average
 * rate" — the blended shortcut would erase exactly the savings the EV
 * responsive-charging model (ev.ts) exists to earn.
 *
 * Non-electric heating reuses heatPump.ts's own thermal-demand calculation —
 * the building's envelope-driven heat loss, before any COP/efficiency — for
 * buildings whose real heating source is gas or district heat: the same
 * physical demand, met by a different priced energy carrier instead of a heat
 * pump's electricity. Oil, wood, and other/unspecified sources get no bill
 * line here — there's no price input for them, and a guess would be worse than
 * admitting we don't model it (same reasoning as commercial.ts's unmodeled
 * building classes).
 *
 * Building-level shared systems (heat pump/AC electricity, solar credit,
 * heating fuel) have no natural per-dwelling split in the simulation itself —
 * one heat pump serves the whole building. Split by floor area among the
 * building's dwellings (dwellingAreaShareFraction), mirroring how a real
 * Swiss "Nebenkostenabrechnung" allocates shared building costs to tenants.
 * A building's own commercial device cost is never split to dwellings — it's
 * the commercial tenant's own equipment, not shared building infrastructure.
 */

import type { Building, Dwelling } from "../data/types";
import { toDateMs } from "./calendar";
import { energyKWh } from "./energy";
import type { CategorySeries } from "./history";
import { spaceHeatingThermalDemandW, hasHeatPump } from "./heatPump";
import { isOffPeakHour, type Tariff } from "./tariff";
import { dailyMeanTempC, weatherAt } from "./weather";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

const GAS_BOILER_EFFICIENCY = 0.9; // typical modern gas boiler
const DISTRICT_HEATING_EFFICIENCY = 1.0; // price is already per kWh of heat delivered

export type HeatingFuel = "gas" | "districtHeating" | null;

/** null for a heat-pump building (billed as electricity instead) or any source
 * with no price input (oil, wood, "andere", unspecified). */
export function heatingFuelType(building: Building): HeatingFuel {
  if (hasHeatPump(building)) return null;
  if (building.heatingEnergySource === "Gas") return "gas";
  if (building.heatingEnergySource?.startsWith("Fernwärme")) return "districtHeating";
  return null;
}

function heatingFuelPowerW(building: Building, fuel: HeatingFuel, dailyMeanC: number, outsideTempC: number): number {
  if (!fuel) return 0;
  const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC);
  const efficiency = fuel === "gas" ? GAS_BOILER_EFFICIENCY : DISTRICT_HEATING_EFFICIENCY;
  return thermalW / efficiency;
}

function heatingFuelSeriesW(building: Building, fuel: HeatingFuel, times: number[]): number[] {
  if (!fuel) return times.map(() => 0);
  return times.map((t) => heatingFuelPowerW(building, fuel, dailyMeanTempC(t), weatherAt(t).tempC));
}

function hourOfDayAt(simTimeMs: number): number {
  const dateMs = toDateMs(simTimeMs);
  return (((dateMs % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
}

/** Trapezoidal energy integration, same as energy.ts's energyKWh, but pricing
 * each interval at whichever tariff rate applies at its midpoint instead of
 * returning raw kWh — see module docs for why that distinction matters. */
export function electricityCostRp(times: number[], powerW: number[], tariff: Tariff): number {
  let costRp = 0;
  for (let i = 1; i < times.length; i++) {
    const dtHours = (times[i] - times[i - 1]) / HOUR_MS;
    const avgW = (powerW[i] + powerW[i - 1]) / 2;
    const kWh = (avgW * dtHours) / 1000;
    const midMs = (times[i] + times[i - 1]) / 2;
    const rate = isOffPeakHour(tariff, hourOfDayAt(midMs)) ? tariff.offPeakPriceRpKWh : tariff.peakPriceRpKWh;
    costRp += kWh * rate;
  }
  return costRp;
}

/** A flat (non-time-of-use) rate over a power series — solar feed-in and
 * heating fuel both use this, just with different series and prices. */
export function flatCostRp(times: number[], powerW: number[], priceRpKWh: number): number {
  return energyKWh(times, powerW) * priceRpKWh;
}

export interface BillBreakdown {
  electricityRp: number;
  solarCreditRp: number; // positive — a credit, subtracted in netRp
  heatingFuel: HeatingFuel;
  heatingFuelRp: number;
  netRp: number;
}

const ZERO_BILL: BillBreakdown = { electricityRp: 0, solarCreditRp: 0, heatingFuel: null, heatingFuelRp: 0, netRp: 0 };

function consumptionSeriesW(series: CategorySeries): number[] {
  return series.fridgeW.map(
    (_, i) =>
      series.fridgeW[i] +
      series.lightingW[i] +
      series.cookingW[i] +
      series.laundryW[i] +
      series.plugLoadW[i] +
      series.evW[i] +
      series.heatPumpW[i] +
      series.acW[i] +
      series.waterHeatingW[i] +
      series.commercialW[i],
  );
}

/** A building's or dwelling's own bill from its own CategorySeries — every
 * consumption category it directly has, priced as electricity, less its own
 * solar credit. No heating-fuel line: that's a building-wide add-on (below),
 * since a bare CategorySeries (e.g. a single dwelling's) doesn't carry enough
 * building context to know the heating fuel type. */
export function ownBillFromSeries(series: CategorySeries, times: number[], tariff: Tariff): BillBreakdown {
  const electricityRp = electricityCostRp(times, consumptionSeriesW(series), tariff);
  const solarCreditRp = flatCostRp(times, series.solarW, tariff.feedInPriceRpKWh);
  return { electricityRp, solarCreditRp, heatingFuel: null, heatingFuelRp: 0, netRp: electricityRp - solarCreditRp };
}

/** A whole building's bill — every category it has (including every dwelling's
 * own devices, summed) plus its heating-fuel cost if it isn't a heat pump. This
 * is "the one meter the grid/gas utility actually bills," before any internal
 * allocation to tenants. */
export function buildingBillRp(building: Building, series: CategorySeries, times: number[], tariff: Tariff): BillBreakdown {
  const own = ownBillFromSeries(series, times, tariff);
  const fuel = heatingFuelType(building);
  const heatingFuelRp = fuel ? flatCostRp(times, heatingFuelSeriesW(building, fuel, times), fuelPrice(fuel, tariff)) : 0;
  return { ...own, heatingFuel: fuel, heatingFuelRp, netRp: own.netRp + heatingFuelRp };
}

function fuelPrice(fuel: "gas" | "districtHeating", tariff: Tariff): number {
  return fuel === "gas" ? tariff.gasPriceRpKWh : tariff.districtHeatingPriceRpKWh;
}

/** The portion of the building's *shared* systems (heat pump/AC electricity,
 * solar credit, heating fuel — never a dwelling's own devices, never the
 * commercial tenant's own use) that one dwelling owes, by floor-area share. */
function sharedBuildingBillRp(building: Building, buildingSeries: CategorySeries, times: number[], tariff: Tariff): BillBreakdown {
  const sharedElectricW = buildingSeries.heatPumpW.map((_, i) => buildingSeries.heatPumpW[i] + buildingSeries.acW[i]);
  const electricityRp = electricityCostRp(times, sharedElectricW, tariff);
  const solarCreditRp = flatCostRp(times, buildingSeries.solarW, tariff.feedInPriceRpKWh);
  const fuel = heatingFuelType(building);
  const heatingFuelRp = fuel ? flatCostRp(times, heatingFuelSeriesW(building, fuel, times), fuelPrice(fuel, tariff)) : 0;
  return { electricityRp, solarCreditRp, heatingFuel: fuel, heatingFuelRp, netRp: electricityRp - solarCreditRp + heatingFuelRp };
}

export function addBills(a: BillBreakdown, b: BillBreakdown): BillBreakdown {
  return {
    electricityRp: a.electricityRp + b.electricityRp,
    solarCreditRp: a.solarCreditRp + b.solarCreditRp,
    heatingFuel: a.heatingFuel ?? b.heatingFuel,
    heatingFuelRp: a.heatingFuelRp + b.heatingFuelRp,
    netRp: a.netRp + b.netRp,
  };
}

function scaleBill(bill: BillBreakdown, fraction: number): BillBreakdown {
  return {
    electricityRp: bill.electricityRp * fraction,
    solarCreditRp: bill.solarCreditRp * fraction,
    heatingFuel: bill.heatingFuel,
    heatingFuelRp: bill.heatingFuelRp * fraction,
    netRp: bill.netRp * fraction,
  };
}

/** A dwelling's floor-area share of its building's shared costs — its own
 * areaM2 (falling back to the average of the building's other known dwelling
 * areas, or an equal split if none are known) over the sum of all dwellings'. */
export function dwellingAreaShareFraction(building: Building, dwelling: Dwelling): number {
  const known = building.dwellings.map((d) => d.areaM2).filter((a): a is number => a != null);
  const fallback = known.length > 0 ? known.reduce((sum, a) => sum + a, 0) / known.length : 1;
  const areas = building.dwellings.map((d) => d.areaM2 ?? fallback);
  const total = areas.reduce((sum, a) => sum + a, 0);
  if (total <= 0) return building.dwellings.length > 0 ? 1 / building.dwellings.length : 0;
  const index = building.dwellings.findIndex((d) => d.ewid === dwelling.ewid);
  return index < 0 ? 0 : areas[index] / total;
}

/** A dwelling's full bill: its own devices' cost, plus its floor-area share of
 * the building's shared heat pump/AC/solar/heating-fuel costs. */
export function dwellingBillRp(
  building: Building,
  dwelling: Dwelling,
  ownSeries: CategorySeries,
  buildingSeries: CategorySeries,
  times: number[],
  tariff: Tariff,
): BillBreakdown {
  const own = ownBillFromSeries(ownSeries, times, tariff);
  const shareFraction = dwellingAreaShareFraction(building, dwelling);
  const share = scaleBill(sharedBuildingBillRp(building, buildingSeries, times, tariff), shareFraction);
  return addBills(own, share);
}

export { ZERO_BILL };
