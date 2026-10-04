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

import { GREEN_POWER_MAX_EMISSION_REDUCTION } from "../config/policy";
import { REMOVAL_CAP_SHARE, REMOVAL_PRICE_CHF_PER_T } from "../config/removals";
import { RESIDENTS_PER_DWELLING } from "../config/treasury";
import { interpolateCurve } from "../config/curve";
import { BASELINE_YEAR, toSimTimeMs } from "./calendar";
import { existsAt } from "./lifetime";
import { treasury } from "./treasury";
import { policyStore } from "./policy";
import type { Building, PowerPlant } from "../data/types";
import {
  DISTRICT_HEATING_KG_CO2_PER_KWH,
  HEATING_OIL_KG_CO2_PER_LITER,
  ICE_CAR_FUEL_KG_CO2_PER_LITER,
  NATURAL_GAS_KG_CO2_PER_KWH,
} from "./emissionFactors";
import { gridCarbonIntensityGPerKWh } from "./gridCarbon";
import { GAS_BOILER_EFFICIENCY, OIL_BOILER_EFFICIENCY, OIL_ENERGY_KWH_PER_LITER } from "./heatingSystems";
import { computeHeatingTechnologyBreakdown, computeMobilityFuelLiters, computeNetElectricityKWh } from "./yearReport";

export interface EmissionsBreakdown {
  year: number;
  electricityKgCO2: number; // net of solar export, at that year's grid intensity
  gasKgCO2: number;
  oilKgCO2: number;
  districtHeatingKgCO2: number;
  mobilityKgCO2: number; // ICE car petrol/diesel — e-bikes and non-electric water heating aren't priced/modeled at all, same boundary billing.ts already draws
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
export const EMISSIONS_SOURCE_COLOR = {
  electricity: "#2a78d6",
  mobility: "#1baf7a",
  districtHeating: "#4a3aa7",
  gas: "#eb6834",
  oil: "#b23a2e",
} as const;

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

/** What a tonne removed costs in a year (CHF). */
export function removalPriceChfPerT(year: number): number {
  return interpolateCurve(REMOVAL_PRICE_CHF_PER_T, year);
}

async function countYear(buildings: Building[], plants: PowerPlant[], year: number): Promise<EmissionsBreakdown> {
  // The baseline first: removals are capped against it.
  const baseline = year > BASELINE_YEAR ? await computeEmissionsForYear(buildings, plants, BASELINE_YEAR) : null;

  const [heatingTechnology, netElectricityKWh, iceCarLiters] = await Promise.all([
    computeHeatingTechnologyBreakdown(buildings, year),
    computeNetElectricityKWh(buildings, plants, year),
    computeMobilityFuelLiters(buildings, year),
  ]);

  const greenShare = policyStore.get().greenPowerShare / 100;
  const electricityKgCO2 = (netElectricityKWh * gridCarbonIntensityGPerKWh(year) * (1 - GREEN_POWER_MAX_EMISSION_REDUCTION * greenShare)) / 1000;

  const gasFuelKWh = heatingTechnology.gasBoilerSpaceKWh / GAS_BOILER_EFFICIENCY;
  const gasKgCO2 = gasFuelKWh * NATURAL_GAS_KG_CO2_PER_KWH;

  const oilFuelLiters = heatingTechnology.oilBoilerSpaceKWh / OIL_BOILER_EFFICIENCY / OIL_ENERGY_KWH_PER_LITER;
  const oilKgCO2 = oilFuelLiters * HEATING_OIL_KG_CO2_PER_LITER;

  // District heating's efficiency is defined as 1.0 (billing.ts prices it as delivered), so delivered kWh = fuel kWh.
  const districtHeatingKgCO2 = heatingTechnology.districtHeatingSpaceKWh * DISTRICT_HEATING_KG_CO2_PER_KWH * (1 - policyStore.get().districtHeatCleanShare / 100);

  const mobilityKgCO2 = iceCarLiters * ICE_CAR_FUEL_KG_CO2_PER_LITER;

  const totalKgCO2 = electricityKgCO2 + gasKgCO2 + oilKgCO2 + districtHeatingKgCO2 + mobilityKgCO2;

  // Removal contracts in force at the year's end count only once the town's own emissions are down
  // to a tenth of the baseline — they are for the hard-to-avoid rest. Then they buy for what is
  // left, up to their share of the baseline, and are paid in January; until then, nothing is bought.
  const residualLine = baseline ? REMOVAL_CAP_SHARE * baseline.totalKgCO2 : 0;
  const contracted = baseline ? (Math.min(policyStore.get().removalShareOfBaseline / 100, REMOVAL_CAP_SHARE) * baseline.totalKgCO2) : 0;
  const removalsKgCO2 = baseline && totalKgCO2 <= residualLine ? Math.max(0, Math.min(contracted, totalKgCO2)) : 0;
  if (removalsKgCO2 > 0) {
    treasury.recordPayout("removals", toSimTimeMs(Date.UTC(year + 1, 0, 1)), (removalsKgCO2 / 1000) * removalPriceChfPerT(year) * 100, `removals-${year}`);
  }

  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1)) - 1;
  const dwellings = buildings.reduce((sum, b) => sum + (existsAt(b, yearEndMs) ? b.dwellings.length : 0), 0);
  const result: EmissionsBreakdown = {
    year,
    electricityKgCO2,
    gasKgCO2,
    oilKgCO2,
    districtHeatingKgCO2,
    mobilityKgCO2,
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
