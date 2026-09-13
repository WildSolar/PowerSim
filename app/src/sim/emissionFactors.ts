/**
 * Operational (combustion-only) CO2 emission factors for the fuels this
 * simulation already tracks — deliberately *not* full lifecycle/embodied
 * figures (no manufacturing footprint for a heat pump, an EV's battery, a
 * PV panel): burn a liter, draw a kWh from the grid, that's what counts. A
 * real, meaningful simplification (upstream/Scope-3 emissions are often the
 * *majority* of a technology's real footprint — see gridCarbon.ts's own
 * module doc on the grid factor's 2050 projection), but tractable with the
 * data this project already has, and consistent with "install cost" already
 * ignoring embodied cost the same way.
 *
 * Sources: BAFU (Bundesamt für Umwelt), "Faktenblatt CO2-Emissionsfaktoren
 * des Treibhausgasinventars der Schweiz" — petrol 2.32 kgCO2/L, diesel 2.62
 * kgCO2/L, heating oil (Heizöl extraleicht) 2.65 kgCO2/L. Natural gas
 * (0.198 kgCO2/kWh) is a standard, widely-cited combustion factor
 * (IPCC/GHG-Protocol range ~0.18-0.20), cross-checked against Switzerland's
 * own 2026 CO2 levy rate (2.158 Rp/kWh at CHF 120/tCO2 implies ~0.18
 * kgCO2/kWh) — consistent within normal rounding.
 */

export const NATURAL_GAS_KG_CO2_PER_KWH = 0.198;
export const HEATING_OIL_KG_CO2_PER_LITER = 2.65;

// mobility.ts blends petrol and diesel into one "ICE car" figure (a single
// L/100km consumption rate), so the emission factor blends the same way —
// petrol 2.32 and diesel 2.62 kgCO2/L, averaged toward roughly Switzerland's
// actual petrol-leaning car fleet split.
export const ICE_CAR_FUEL_KG_CO2_PER_LITER = 2.45;

// No official BAFU figure for Schweizer Fernwärme generally — real networks
// vary hugely by heat source (waste incineration with a large biogenic
// share, gas peaking plants, heat pumps, ...). A judgment call in the same
// spirit as heatingSystems.ts's own install-cost figures: well below gas,
// reflecting how much of the Swiss district-heat stock leans on waste heat.
export const DISTRICT_HEATING_KG_CO2_PER_KWH = 0.12;
