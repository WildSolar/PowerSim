/**
 * Converts already-simulated energy into money — the tariff's time-of-use
 * electricity prices, plus flat (non-time-of-use) prices: what exported solar
 * earns (feed-in), and what non-electric space heating costs for the buildings
 * whose real heating source is oil, gas, or district heat rather than a heat
 * pump.
 *
 * Electricity is priced per sample interval at whichever of off-peak/peak
 * applies at that interval's midpoint, not "total kWh times a blended average
 * rate" — the blended shortcut would erase exactly the savings the EV
 * responsive-charging model (ev.ts) exists to earn.
 *
 * Non-electric heating reuses heatPump.ts's own thermal-demand calculation —
 * the building's envelope-driven heat loss, before any COP/efficiency — for
 * buildings whose real heating source is oil, gas, or district heat: the same
 * physical demand, met by a different priced energy carrier instead of a heat
 * pump's electricity. Oil is priced (and its quantity shown) per liter, the
 * unit it's actually sold in in Switzerland, rather than forcing it through
 * the same Rp/kWh shape as the other two. Wood and other/unspecified sources
 * still get no bill line — there's no price input for them, and a guess would
 * be worse than admitting we don't model it (same reasoning as commercial.ts's
 * unmodeled building classes).
 *
 * Building-level shared systems (heat pump/AC electricity, solar credit,
 * heating fuel) have no natural per-dwelling split in the simulation itself —
 * one heat pump serves the whole building. Split by floor area among the
 * building's dwellings (dwellingAreaShareFraction), mirroring how a real
 * Swiss "Nebenkostenabrechnung" allocates shared building costs to tenants.
 * A building's own commercial device cost is never split to dwellings — it's
 * the commercial tenant's own equipment, not shared building infrastructure.
 *
 * consumptionSeriesW and the two pricing helpers below are also reused
 * directly by finances.ts to total up what the municipality collects from
 * consumers municipality-wide — the DSO's own revenue side of the money
 * ledger is the exact same electricity, priced the exact same way, just
 * summed across every building instead of billed to one. hourOfDayAt is
 * reused by solarAdoption.ts for the same reason: estimating a candidate
 * installation's self-consumption-vs-export split needs the same per-interval
 * TOU rate lookup this module already does for a real bill.
 */

import type { Building, Dwelling } from "../data/types";
import { toDateMs } from "./calendar";
import { energyKWh } from "./energy";
import type { CategorySeries } from "./history";
import { currentHeatingSystemId } from "./heatingRenewal";
import { fuelEfficiency, OIL_ENERGY_KWH_PER_LITER } from "./heatingSystems";
import { spaceHeatingThermalDemandW } from "./spaceHeating";
import { isOffPeakHour, type Tariff } from "./tariff";
import { dailyMeanTempC, weatherAt } from "./weather";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type HeatingFuel = "gasBoiler" | "oilBoiler" | "districtHeating" | null;

/** null for a heat-pump building (billed as electricity instead) or any source
 * with no price input (wood, "andere", unspecified). Resolved as of the *end*
 * of `times` — a renewal mid-period would ideally split the bill in two, but
 * renewals are years apart and bill periods are day/month/year, so "whichever
 * applies by the end of the period" is a rare, small, and honest simplification
 * rather than real inaccuracy. */
export function heatingFuelType(building: Building, atSimTimeMs: number): HeatingFuel {
  const id = currentHeatingSystemId(building, atSimTimeMs);
  return id === "gasBoiler" || id === "oilBoiler" || id === "districtHeating" ? id : null;
}

/** The fuel actually burned/delivered, in kW — thermal demand divided by the
 * fuel's conversion efficiency. Still "kWh of gas" or "kWh of oil" at this
 * point, not liters — the liter conversion only matters for oil, and only at
 * the point of pricing/display (below), to keep this series usable directly
 * with energy.ts's plain kWh integration regardless of fuel. */
function heatingFuelPowerW(building: Building, fuel: HeatingFuel, dailyMeanC: number, outsideTempC: number, simTimeMs: number): number {
  if (!fuel) return 0;
  const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC, simTimeMs);
  return thermalW / fuelEfficiency(fuel);
}

function heatingFuelSeriesW(building: Building, fuel: HeatingFuel, times: number[]): number[] {
  if (!fuel) return times.map(() => 0);
  return times.map((t) => heatingFuelPowerW(building, fuel, dailyMeanTempC(t), weatherAt(t).tempC, t));
}

/** Cost and physical quantity consumed (liters for oil, kWh for gas/district
 * heat — whichever unit the corresponding tariff price is actually in) over a
 * period. */
function heatingFuelCostAndQuantity(
  building: Building,
  fuel: HeatingFuel,
  times: number[],
  tariff: Tariff,
): { costRp: number; quantity: number } {
  if (!fuel) return { costRp: 0, quantity: 0 };
  const fuelKWh = energyKWh(times, heatingFuelSeriesW(building, fuel, times));
  if (fuel === "oilBoiler") {
    const liters = fuelKWh / OIL_ENERGY_KWH_PER_LITER;
    return { costRp: liters * tariff.oilPriceRpPerLiter, quantity: liters };
  }
  const priceRpKWh = fuel === "gasBoiler" ? tariff.gasPriceRpKWh : tariff.districtHeatingPriceRpKWh;
  return { costRp: fuelKWh * priceRpKWh, quantity: fuelKWh };
}

export function hourOfDayAt(simTimeMs: number): number {
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
  heatingFuelQuantity: number; // liters (oil) or kWh (gas/district heat) — 0 if heatingFuel is null
  netRp: number;
}

const ZERO_BILL: BillBreakdown = {
  electricityRp: 0,
  solarCreditRp: 0,
  heatingFuel: null,
  heatingFuelRp: 0,
  heatingFuelQuantity: 0,
  netRp: 0,
};

export function consumptionSeriesW(series: CategorySeries): number[] {
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
  return {
    electricityRp,
    solarCreditRp,
    heatingFuel: null,
    heatingFuelRp: 0,
    heatingFuelQuantity: 0,
    netRp: electricityRp - solarCreditRp,
  };
}

/** A whole building's bill — every category it has (including every dwelling's
 * own devices, summed) plus its heating-fuel cost if it isn't a heat pump. This
 * is "the one meter the grid/gas utility actually bills," before any internal
 * allocation to tenants. */
export function buildingBillRp(building: Building, series: CategorySeries, times: number[], tariff: Tariff): BillBreakdown {
  const own = ownBillFromSeries(series, times, tariff);
  const fuel = heatingFuelType(building, times[times.length - 1]);
  const { costRp: heatingFuelRp, quantity: heatingFuelQuantity } = heatingFuelCostAndQuantity(building, fuel, times, tariff);
  return { ...own, heatingFuel: fuel, heatingFuelRp, heatingFuelQuantity, netRp: own.netRp + heatingFuelRp };
}

/** The portion of the building's *shared* systems (heat pump/AC electricity,
 * solar credit, heating fuel — never a dwelling's own devices, never the
 * commercial tenant's own use) that one dwelling owes, by floor-area share. */
function sharedBuildingBillRp(building: Building, buildingSeries: CategorySeries, times: number[], tariff: Tariff): BillBreakdown {
  const sharedElectricW = buildingSeries.heatPumpW.map((_, i) => buildingSeries.heatPumpW[i] + buildingSeries.acW[i]);
  const electricityRp = electricityCostRp(times, sharedElectricW, tariff);
  const solarCreditRp = flatCostRp(times, buildingSeries.solarW, tariff.feedInPriceRpKWh);
  const fuel = heatingFuelType(building, times[times.length - 1]);
  const { costRp: heatingFuelRp, quantity: heatingFuelQuantity } = heatingFuelCostAndQuantity(building, fuel, times, tariff);
  return {
    electricityRp,
    solarCreditRp,
    heatingFuel: fuel,
    heatingFuelRp,
    heatingFuelQuantity,
    netRp: electricityRp - solarCreditRp + heatingFuelRp,
  };
}

export function addBills(a: BillBreakdown, b: BillBreakdown): BillBreakdown {
  return {
    electricityRp: a.electricityRp + b.electricityRp,
    solarCreditRp: a.solarCreditRp + b.solarCreditRp,
    heatingFuel: a.heatingFuel ?? b.heatingFuel,
    heatingFuelRp: a.heatingFuelRp + b.heatingFuelRp,
    heatingFuelQuantity: a.heatingFuelQuantity + b.heatingFuelQuantity,
    netRp: a.netRp + b.netRp,
  };
}

function scaleBill(bill: BillBreakdown, fraction: number): BillBreakdown {
  return {
    electricityRp: bill.electricityRp * fraction,
    solarCreditRp: bill.solarCreditRp * fraction,
    heatingFuel: bill.heatingFuel,
    heatingFuelRp: bill.heatingFuelRp * fraction,
    heatingFuelQuantity: bill.heatingFuelQuantity * fraction,
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
