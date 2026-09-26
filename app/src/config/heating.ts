/**
 * Every tunable number behind space heating: the system catalog (install
 * cost, subsidy, lifetime, fuel efficiency — sim/heatingSystems.ts re-exports
 * these), the renewal-decision engine's own parameters (sim/heatingRenewal.ts),
 * and the building heat-loss model's calibration (sim/spaceHeating.ts) — the
 * construction-era U-value curve plus the constants around it. Costs are
 * order-of-magnitude Swiss-market-ballpark estimates, not real quotes — the
 * point is that heat pumps cost more upfront and less to run than a fossil
 * boiler, subsidized in the heat pumps' favor, which is the actual economic
 * shape driving Swiss heating renewal today.
 */

import type { CurvePoint } from "./curve";

export type HeatingSystemId = "gasBoiler" | "oilBoiler" | "districtHeating" | "airHeatPump" | "groundHeatPump";

export interface HeatingSystemSpec {
  id: HeatingSystemId;
  label: string;
  icon: string;
  lifetimeMeanYears: number;
  /** Installing this system in a building that doesn't have it yet, at a reference building
   * with HEATING_REFERENCE_ENVELOPE_AREA_M2 of envelope area — heatingRenewal.ts scales this
   * with the actual building's size. */
  baseInstallCostRp: number;
  /** Replacing the system with another of the same kind, where that costs less than a first
   * installation (same size scaling). District heating: the building's connection to the
   * network is already there, only the substation (heat exchanger) is replaced. */
  replacementInstallCostRp?: number;
  subsidyRp: number; // flat, not size-scaled — mirrors how real cantonal grants are usually a fixed amount
  /** Signed "renewable-ness" used only to nudge the hidden bias trait — never
   * shown to the player. */
  greenness: number;
  /** Validated (dataviz skill's validate_palette.js, all 5 together, light
   * mode) — used by ui/ReportCardModal.tsx's space-heating-by-technology pie.
   * Re-validate the same way before changing any of these. */
  color: string;
}

export const HEATING_SYSTEM_CATALOG: Record<HeatingSystemId, HeatingSystemSpec> = {
  airHeatPump: {
    id: "airHeatPump",
    label: "Air heat pump",
    icon: "🌬️",
    lifetimeMeanYears: 18,
    baseInstallCostRp: 30_000_00,
    subsidyRp: 7_000_00,
    greenness: 1,
    color: "#1baf7a",
  },
  groundHeatPump: {
    id: "groundHeatPump",
    label: "Ground heat pump",
    icon: "🌍",
    lifetimeMeanYears: 22,
    baseInstallCostRp: 38_000_00, // mostly the boreholes
    replacementInstallCostRp: 22_000_00, // a new heat pump on the existing boreholes
    subsidyRp: 9_000_00,
    greenness: 1,
    color: "#0f8fc0",
  },
  districtHeating: {
    id: "districtHeating",
    label: "District heating",
    icon: "🏭",
    lifetimeMeanYears: 25,
    baseInstallCostRp: 22_000_00, // a first connection: the house connection pipe and a substation
    replacementInstallCostRp: 9_000_00, // like for like: just a new substation
    subsidyRp: 0,
    greenness: 0.4,
    color: "#4a3aa7",
  },
  gasBoiler: {
    id: "gasBoiler",
    label: "Gas boiler",
    icon: "🔥",
    lifetimeMeanYears: 18,
    baseInstallCostRp: 22_000_00, // a first gas heating: the gas connection and a flue as well
    replacementInstallCostRp: 16_000_00, // a new boiler in place
    subsidyRp: 0,
    greenness: -1,
    color: "#eb6834",
  },
  oilBoiler: {
    id: "oilBoiler",
    label: "Oil boiler",
    icon: "🛢️",
    lifetimeMeanYears: 20,
    baseInstallCostRp: 28_000_00, // a first oil heating: tank room and chimney as well
    replacementInstallCostRp: 17_000_00, // a new boiler in place
    subsidyRp: 0,
    greenness: -1.3,
    color: "#b23a2e",
  },
};

export const GAS_BOILER_EFFICIENCY = 0.9; // typical modern gas boiler
export const OIL_BOILER_EFFICIENCY = 0.85; // typical oil boiler — somewhat less efficient than gas
export const DISTRICT_HEATING_EFFICIENCY = 1.0; // price is already per kWh of heat delivered
export const OIL_ENERGY_KWH_PER_LITER = 10; // "Heizöl extra leicht" — standard rule-of-thumb energy density

// --- heatingRenewal.ts: the renewal-decision engine's own parameters ---

export const HEATING_WEIBULL_SHAPE = 2.5; // moderate wear-out hazard — most units fail somewhere near their mean lifetime, not uniformly spread
export const HEATING_REFERENCE_ENVELOPE_AREA_M2 = 250; // roughly a mid-size single-family house — install cost scales with a building's own envelope area relative to this
export const HEATING_BASE_UNCERTAINTY_FRACTION = 0.04; // floor — even a large, professionally-managed building won't chase every last Rappen
export const HEATING_EXTRA_UNCERTAINTY_FRACTION = 0.21; // -> 25% band for a single dwelling
export const HEATING_UNCERTAINTY_DECAY_DWELLINGS = 6; // e-folding scale: uncertainty band shrinks toward the floor as dwelling count grows past this
export const HEATING_BIAS_MAGNITUDE_RP_PER_YEAR = 80_000; // CHF 800/yr at full lean — real but not overwhelming next to a typical annualized heating cost

// --- spaceHeating.ts: the building heat-loss model ---

export const HEATING_THRESHOLD_C = 12; // day's characteristic temp above this -> heating off for the day
export const COMFORT_TEMP_C = 20; // baseline setpoint before a building's own internal-gains offset

// Construction-era -> typical blended U-value (W/m²K) — judgment-call
// figures, but shaped on real Swiss building-stock history: solid,
// uninsulated masonry before WWII; a slow improvement through the postwar
// decades; the first real jump after the 1970s oil-crisis-driven cantonal
// insulation standards; another step down through the 1990s-2000s as SIA
// 380/1 and Minergie took hold; today's new-build code sits close to the
// curve's own low end. GWR's construction year is real data — only the
// U-value each era implies is a guess. Interpolated via config/curve.ts;
// add/move/extend points here to recalibrate.
export const U_VALUE_ERA_CURVE: CurvePoint[] = [
  { x: 1919, y: 1.6 },
  { x: 1945, y: 1.5 },
  { x: 1960, y: 1.4 },
  { x: 1975, y: 1.2 },
  { x: 1985, y: 0.9 },
  { x: 1995, y: 0.7 },
  { x: 2005, y: 0.5 },
  { x: 2015, y: 0.3 },
  { x: 2025, y: 0.22 },
];
export const FALLBACK_U_VALUE = 1.0; // no construction year on record — roughly the stock-wide average era

// Seeded per-building random multiplier on the age-implied U-value, standing
// in for everything age alone doesn't explain (workmanship, an unlisted
// renovation, general draftiness) — [min, max], applied as base * uniform(min, max).
export const U_VALUE_QUALITY_FACTOR_MIN = 0.75;
export const U_VALUE_QUALITY_FACTOR_MAX = 1.25;
