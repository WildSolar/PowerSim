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
import { gridCarbonIntensityGPerKWhAt } from "./gridCarbon";
import { consumptionSeriesW } from "./billing";
import { energyKWh } from "./energy";
import { dhEmissionsKgCO2 } from "./districtHeatDispatch";
import { datacenter } from "./datacenter";
import { GAS_BOILER_EFFICIENCY, OIL_BOILER_EFFICIENCY, OIL_ENERGY_KWH_PER_LITER } from "./heatingSystems";
import { computeHeatingTechnologyBreakdown, computeMobilityFuelLiters, yearElectricity } from "./yearReport";

export interface EmissionsBreakdown {
  year: number;
  electricityKgCO2: number; // what the town drew from the grid less what its solar fed in, each at the moment's grid intensity
  /** The part of electricityKgCO2 that charged electric vehicles: their share of the town's
   * electricity use — cars', vans' and lorries' (the three below together). */
  evChargingKgCO2: number;
  evCarsKgCO2: number;
  evVansKgCO2: number;
  evLorriesKgCO2: number;
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
// Ten sources, more than a palette has distinct hues: each kind of vehicle has one hue — its petrol
// or diesel a darker shade, its charging a lighter one. Validated (dataviz validate_palette.js, light)
// in the order the charts stack them: electricity; cars, vans, lorries, fuel then charging; district
// heating, gas, oil.
export const EMISSIONS_SOURCE_COLOR = {
  electricity: "#2a78d6",
  cars: "#0e7a52",
  evCars: "#1fbf86",
  vans: "#a86f00",
  evVans: "#eda100",
  lorries: "#0b6b0b",
  evLorries: "#3aa63a",
  districtHeating: "#4a3aa7",
  gas: "#eb6834",
  oil: "#b23a2e",
} as const;

/** The sources a year's emissions are shown by, in the order the charts stack them: electricity
 * without what electric vehicles charged, which stands on its own, and petrol and diesel by vehicle.
 * They add up to the total. */
export const EMISSION_SOURCES: { key: keyof typeof EMISSIONS_SOURCE_COLOR; label: string; icon: string; kgCO2: (e: EmissionsBreakdown) => number }[] = [
  { key: "electricity", label: "Other electricity", icon: "⚡", kgCO2: (e) => e.electricityKgCO2 - e.evChargingKgCO2 },
  { key: "cars", label: "Cars, petrol and diesel", icon: "🚗", kgCO2: (e) => e.carsKgCO2 },
  { key: "evCars", label: "Cars, charging", icon: "🔌", kgCO2: (e) => e.evCarsKgCO2 ?? e.evChargingKgCO2 },
  { key: "vans", label: "Vans, diesel", icon: "🚐", kgCO2: (e) => e.vansKgCO2 },
  { key: "evVans", label: "Vans, charging", icon: "🔌", kgCO2: (e) => e.evVansKgCO2 ?? 0 },
  { key: "lorries", label: "Lorries, diesel", icon: "🚚", kgCO2: (e) => e.lorriesKgCO2 },
  { key: "evLorries", label: "Lorries, charging", icon: "🔌", kgCO2: (e) => e.evLorriesKgCO2 ?? 0 },
  { key: "districtHeating", label: "District heating", icon: "🏭", kgCO2: (e) => e.districtHeatingKgCO2 },
  { key: "gas", label: "Gas heating", icon: "🔥", kgCO2: (e) => e.gasKgCO2 },
  { key: "oil", label: "Oil heating", icon: "🛢️", kgCO2: (e) => e.oilKgCO2 },
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

  const [heatingTechnology, months, fuelLiters] = await Promise.all([
    computeHeatingTechnologyBreakdown(buildings, year),
    yearElectricity(buildings, plants, year),
    computeMobilityFuelLiters(buildings, year),
  ]);

  // Electricity, sample by sample: what the town drew (its district heating heat pumps included, a
  // data centre's certified renewable power left out) less what its solar and wind fed back, each at
  // the grid's intensity of the moment — a winter night's kWh weighs more than a sunny noon's.
  // Electric vehicles' part: their share of what the town used, weighed the same way.
  const kg = { net: 0, used: 0, ev: 0, evVan: 0, evTruck: 0 };
  for (const m of months) {
    const consumptionW = consumptionSeriesW(m.series);
    const gKgPerWh = m.times.map((t) => gridCarbonIntensityGPerKWhAt(t) / 1e6); // kg per kWh, per W over an hour
    const datacenterW = m.times.map((t) => datacenter.powerW(t));
    const weigh = (w: (i: number) => number) => energyKWh(m.times, m.times.map((_, i) => w(i) * gKgPerWh[i] * 1000));
    kg.net += weigh((i) => consumptionW[i] + m.dhHeatPumpW[i] - datacenterW[i] - m.series.solarW[i]);
    kg.used += weigh((i) => consumptionW[i] + m.dhHeatPumpW[i] - datacenterW[i]);
    kg.ev += weigh((i) => m.series.evW[i]);
    kg.evVan += weigh((i) => m.evVanW?.[i] ?? 0);
    kg.evTruck += weigh((i) => m.evTruckW?.[i] ?? 0);
  }
  const greenShare = policyStore.get().greenPowerShare / 100;
  const electricityKgCO2 = Math.max(0, kg.net) * (1 - GREEN_POWER_MAX_EMISSION_REDUCTION * greenShare);
  const evChargingKgCO2 = kg.used > 0 ? electricityKgCO2 * Math.min(1, kg.ev / kg.used) : 0;
  // ...vans' and lorries' share of that by what they charged, when; cars the rest.
  const evShareOf = (part: number) => (kg.ev > 0 ? Math.min(1, part / kg.ev) : 0);
  const evVansKgCO2 = evChargingKgCO2 * evShareOf(kg.evVan);
  const evLorriesKgCO2 = evChargingKgCO2 * evShareOf(kg.evTruck);
  const evCarsKgCO2 = Math.max(0, evChargingKgCO2 - evVansKgCO2 - evLorriesKgCO2);

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
    evCarsKgCO2,
    evVansKgCO2,
    evLorriesKgCO2,
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
