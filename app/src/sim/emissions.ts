/**
 * Municipality-wide operational CO2 emissions for a completed calendar year —
 * the gameplay layer's headline metric (net zero by 2050, per the design
 * discussion), built entirely from figures this simulation already tracks:
 * grid electricity (net of solar export — gridCarbon.ts), and each fossil
 * heating/mobility fuel actually burned (emissionFactors.ts), reusing
 * yearReport.ts's existing heating-technology breakdown plus two new
 * municipality-wide aggregates it now also exposes (net electricity,
 * mobility fuel). Deliberately excludes embodied/upstream emissions (a heat
 * pump's manufacturing footprint, a solar panel's supply chain) — see
 * emissionFactors.ts's own doc for why.
 *
 * A completed year's emissions never change once computed (the same
 * "immutable once finished" principle historyLong.ts's period cache and
 * every renewal chain already rely on), so results are cached by year
 * forever — without this, re-opening a later year's report would silently
 * redo the *baseline* year's full chunked computation every time.
 */

import { removals } from "./removals";
import { GREEN_POWER_MAX_EMISSION_REDUCTION } from "../config/policy";
import { RESIDENTS_PER_DWELLING } from "../config/treasury";
import { BASELINE_YEAR, toSimTimeMs } from "./calendar";
import { existsAt } from "./lifetime";
import { policyStore } from "./policy";
import type { Building, PowerPlant } from "../data/types";
import {
  HEATING_OIL_KG_CO2_PER_LITER,
  ICE_CAR_FUEL_KG_CO2_PER_LITER,
  NATURAL_GAS_KG_CO2_PER_KWH,
} from "./emissionFactors";
import { gridCarbonIntensityGPerKWh } from "./gridCarbon";
import { dhEmissionsKgCO2 } from "./districtHeatDispatch";
import { datacenter } from "./datacenter";
import { GAS_BOILER_EFFICIENCY, OIL_BOILER_EFFICIENCY, OIL_ENERGY_KWH_PER_LITER } from "./heatingSystems";
import { computeElectricityUseKWh, computeHeatingTechnologyBreakdown, computeMobilityFuelLiters } from "./yearReport";

export interface EmissionsBreakdown {
  year: number;
  electricityKgCO2: number; // net of solar export, at that year's grid intensity
  /** The part of electricityKgCO2 that charged electric vehicles (cars, vans, lorries): their share
   * of the town's electricity use. */
  evChargingKgCO2: number;
  gasKgCO2: number;
  oilKgCO2: number;
  districtHeatingKgCO2: number;
  mobilityKgCO2: number; // petrol and diesel burned on the road — the three below together
  carsKgCO2: number; // residents' petrol and diesel cars
  vansKgCO2: number; // businesses' diesel vans
  lorriesKgCO2: number; // businesses' diesel lorries
  /** Everything emitted (the five sources above). */
  totalKgCO2: number;
  /** Removals credited against it (carbon removal contracts; none in the baseline year). */
  removalsKgCO2: number;
  /** What counts: emitted less removed. */
  netKgCO2: number;
  /** Residents at the end of the year (homes standing then, at the usual household size). */
  residents: number;
}

// Validated (dataviz skill's validate_palette.js, light mode, all-PASS) —
// gas/oil/districtHeating reuse heatingSystems.ts's own colors for those same
// fuels (semantically consistent across the report's sections); electricity
// and mobility are new, distinct colors chosen so the five work together.
// The vehicles apart (cars as mobility before; vans, lorries and charging from the same categorical
// palette), validated as eight in the order the charts stack them: electricity, charging, district
// heating, gas, oil, cars, vans, lorries.
export const EMISSIONS_SOURCE_COLOR = {
  electricity: "#2a78d6",
  evCharging: "#e87ba4",
  districtHeating: "#4a3aa7",
  gas: "#eb6834",
  oil: "#b23a2e",
  cars: "#1baf7a",
  vans: "#eda100",
  lorries: "#008300",
} as const;

/** The sources a year's emissions are shown by, in the order the charts stack them: electricity
 * without what electric vehicles charged, which stands on its own, and petrol and diesel by vehicle.
 * They add up to the total. */
export const EMISSION_SOURCES: { key: keyof typeof EMISSIONS_SOURCE_COLOR; label: string; icon: string; kgCO2: (e: EmissionsBreakdown) => number }[] = [
  { key: "electricity", label: "Other electricity", icon: "⚡", kgCO2: (e) => e.electricityKgCO2 - e.evChargingKgCO2 },
  { key: "evCharging", label: "Charging electric vehicles", icon: "🔌", kgCO2: (e) => e.evChargingKgCO2 },
  { key: "districtHeating", label: "District heating", icon: "🏭", kgCO2: (e) => e.districtHeatingKgCO2 },
  { key: "gas", label: "Gas heating", icon: "🔥", kgCO2: (e) => e.gasKgCO2 },
  { key: "oil", label: "Oil heating", icon: "🛢️", kgCO2: (e) => e.oilKgCO2 },
  { key: "cars", label: "Cars, petrol and diesel", icon: "🚗", kgCO2: (e) => e.carsKgCO2 },
  { key: "vans", label: "Vans, diesel", icon: "🚐", kgCO2: (e) => e.vansKgCO2 },
  { key: "lorries", label: "Lorries, diesel", icon: "🚚", kgCO2: (e) => e.lorriesKgCO2 },
];

const emissionsCache = new Map<number, EmissionsBreakdown>();
// A year being counted: a second caller waits for the same count (and the removals are paid once).
const inFlight = new Map<number, Promise<EmissionsBreakdown>>();

/** Every completed calendar year's emissions, computed once and cached
 * forever after. The expensive inputs (heating technology, net electricity)
 * are yearReport.ts's shared per-year passes, so asking for emissions while
 * the report's other sections are computing the same year costs nothing extra. */
/** A year's emissions if they have been computed already (by the Year in Review), else null —
 * for always-on readouts that must never trigger the computation themselves. */
export function cachedEmissionsForYear(year: number): EmissionsBreakdown | null {
  return emissionsCache.get(year) ?? null;
}

export function computeEmissionsForYear(buildings: Building[], plants: PowerPlant[], year: number): Promise<EmissionsBreakdown> {
  const cached = emissionsCache.get(year);
  if (cached) return Promise.resolve(cached);
  let pending = inFlight.get(year);
  if (!pending) {
    pending = countYear(buildings, plants, year).finally(() => inFlight.delete(year));
    inFlight.set(year, pending);
  }
  return pending;
}

export { removalPriceChfPerT } from "./removals";

async function countYear(buildings: Building[], plants: PowerPlant[], year: number): Promise<EmissionsBreakdown> {
  // The baseline first: the removals bought are capped against it.
  if (year > BASELINE_YEAR) await computeEmissionsForYear(buildings, plants, BASELINE_YEAR);

  const [heatingTechnology, electricityUse, fuelLiters] = await Promise.all([
    computeHeatingTechnologyBreakdown(buildings, year),
    computeElectricityUseKWh(buildings, plants, year),
    computeMobilityFuelLiters(buildings, year),
  ]);
  const netElectricityKWh = electricityUse.netKWh;

  const greenShare = policyStore.get().greenPowerShare / 100;
  // A data centre buys certified renewable power (datacenter.ts): its electricity carries nothing.
  const datacenterKWh = datacenter.kWhBetween(toSimTimeMs(Date.UTC(year, 0, 1)), toSimTimeMs(Date.UTC(year + 1, 0, 1)));
  const electricityKgCO2 = (Math.max(0, netElectricityKWh - datacenterKWh) * gridCarbonIntensityGPerKWh(year) * (1 - GREEN_POWER_MAX_EMISSION_REDUCTION * greenShare)) / 1000;
  // Electric vehicles' part of it: their share of what the town used (the data centre's aside).
  const usedKWh = electricityUse.consumptionKWh - datacenterKWh;
  const evChargingKgCO2 = usedKWh > 0 ? electricityKgCO2 * Math.min(1, electricityUse.evKWh / usedKWh) : 0;

  const gasFuelKWh = heatingTechnology.gasBoilerSpaceKWh / GAS_BOILER_EFFICIENCY;
  const gasKgCO2 = gasFuelKWh * NATURAL_GAS_KG_CO2_PER_KWH;

  const oilFuelLiters = heatingTechnology.oilBoilerSpaceKWh / OIL_BOILER_EFFICIENCY / OIL_ENERGY_KWH_PER_LITER;
  const oilKgCO2 = oilFuelLiters * HEATING_OIL_KG_CO2_PER_LITER;

  // District heating: what its boilers burned, and its heat pumps' power (districtHeatDispatch.ts).
  const districtHeatingKgCO2 = dhEmissionsKgCO2(heatingTechnology.districtHeat, year);

  const carsKgCO2 = fuelLiters.cars * ICE_CAR_FUEL_KG_CO2_PER_LITER;
  const vansKgCO2 = fuelLiters.vans * ICE_CAR_FUEL_KG_CO2_PER_LITER;
  const lorriesKgCO2 = fuelLiters.lorries * ICE_CAR_FUEL_KG_CO2_PER_LITER;
  const mobilityKgCO2 = carsKgCO2 + vansKgCO2 + lorriesKgCO2;

  const totalKgCO2 = electricityKgCO2 + gasKgCO2 + oilKgCO2 + districtHeatingKgCO2 + mobilityKgCO2;

  // What the removal contracts bought through the year, month by month (removals.ts) — never more
  // than the town emitted.
  const removalsKgCO2 = year > BASELINE_YEAR ? Math.min(removals.boughtInYear(year), totalKgCO2) : 0;

  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1)) - 1;
  const dwellings = buildings.reduce((sum, b) => sum + (existsAt(b, yearEndMs) ? b.dwellings.length : 0), 0);
  const result: EmissionsBreakdown = {
    year,
    electricityKgCO2,
    evChargingKgCO2,
    gasKgCO2,
    oilKgCO2,
    districtHeatingKgCO2,
    mobilityKgCO2,
    carsKgCO2,
    vansKgCO2,
    lorriesKgCO2,
    totalKgCO2,
    removalsKgCO2,
    netKgCO2: totalKgCO2 - removalsKgCO2,
    residents: dwellings * RESIDENTS_PER_DWELLING,
  };
  emissionsCache.set(year, result);
  return result;
}

// --- saving (saveGame.ts) ---

/** Counted years: fixed once counted (under the green-power share of the day), so they are kept. */
export function snapshotEmissions(): Map<number, EmissionsBreakdown> {
  return emissionsCache;
}

export function restoreEmissions(saved: Map<number, EmissionsBreakdown>): void {
  emissionsCache.clear();
  for (const [year, e] of saved) emissionsCache.set(year, e);
}
