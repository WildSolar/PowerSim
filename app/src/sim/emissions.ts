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
  totalKgCO2: number;
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

const ZERO_EMISSIONS: Omit<EmissionsBreakdown, "year"> = {
  electricityKgCO2: 0,
  gasKgCO2: 0,
  oilKgCO2: 0,
  districtHeatingKgCO2: 0,
  mobilityKgCO2: 0,
  totalKgCO2: 0,
};

const emissionsCache = new Map<number, EmissionsBreakdown>();

/** Every completed calendar year's emissions, computed once and cached
 * forever after. `isCancelled` is checked between each of the three
 * underlying chunked computations — a dismissed report (or a fresh one for
 * a different year) stops the work rather than finishing a result nobody
 * will see; nothing is cached unless the whole computation actually
 * finished. */
export async function computeEmissionsForYear(
  buildings: Building[],
  plants: PowerPlant[],
  year: number,
  isCancelled: () => boolean,
): Promise<EmissionsBreakdown> {
  const cached = emissionsCache.get(year);
  if (cached) return cached;

  const heatingTechnology = await computeHeatingTechnologyBreakdown(buildings, year, isCancelled);
  if (isCancelled()) return { year, ...ZERO_EMISSIONS };
  const netElectricityKWh = await computeNetElectricityKWh(buildings, plants, year, isCancelled);
  if (isCancelled()) return { year, ...ZERO_EMISSIONS };
  const iceCarLiters = await computeMobilityFuelLiters(buildings, year, isCancelled);
  if (isCancelled()) return { year, ...ZERO_EMISSIONS };

  const electricityKgCO2 = (netElectricityKWh * gridCarbonIntensityGPerKWh(year)) / 1000;

  const gasFuelKWh = heatingTechnology.gasBoilerSpaceKWh / GAS_BOILER_EFFICIENCY;
  const gasKgCO2 = gasFuelKWh * NATURAL_GAS_KG_CO2_PER_KWH;

  const oilFuelLiters = heatingTechnology.oilBoilerSpaceKWh / OIL_BOILER_EFFICIENCY / OIL_ENERGY_KWH_PER_LITER;
  const oilKgCO2 = oilFuelLiters * HEATING_OIL_KG_CO2_PER_LITER;

  // District heating's efficiency is defined as 1.0 (billing.ts prices it as delivered), so delivered kWh = fuel kWh.
  const districtHeatingKgCO2 = heatingTechnology.districtHeatingSpaceKWh * DISTRICT_HEATING_KG_CO2_PER_KWH;

  const mobilityKgCO2 = iceCarLiters * ICE_CAR_FUEL_KG_CO2_PER_LITER;

  const totalKgCO2 = electricityKgCO2 + gasKgCO2 + oilKgCO2 + districtHeatingKgCO2 + mobilityKgCO2;
  const result: EmissionsBreakdown = { year, electricityKgCO2, gasKgCO2, oilKgCO2, districtHeatingKgCO2, mobilityKgCO2, totalKgCO2 };
  emissionsCache.set(year, result);
  return result;
}
