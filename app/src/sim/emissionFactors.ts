/**
 * Operational (combustion-only) CO2 emission factors for the fuels this
 * simulation already tracks — deliberately *not* full lifecycle/embodied
 * figures (no manufacturing footprint for a heat pump, an EV's battery, a
 * PV panel): burn a liter, draw a kWh from the grid, that's what counts. A
 * real, meaningful simplification (upstream/Scope-3 emissions are often the
 * *majority* of a technology's real footprint), but tractable with the data
 * this project already has, and consistent with "install cost" already
 * ignoring embodied cost the same way. Values (and their sources) live in
 * config/emissions.ts — edit that file to recalibrate.
 */

export {
  NATURAL_GAS_KG_CO2_PER_KWH,
  HEATING_OIL_KG_CO2_PER_LITER,
  ICE_CAR_FUEL_KG_CO2_PER_LITER,
  DISTRICT_HEATING_KG_CO2_PER_KWH,
} from "../config/emissions";
