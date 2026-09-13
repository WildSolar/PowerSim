/**
 * The catalog of space-heating systems a building can have — the one source of
 * truth for each system's fuel efficiency, typical service lifetime, and
 * (judgment-call, Swiss-market-ballpark) install cost/subsidy figures, shared by
 * billing.ts (pricing what's actually installed) and heatingRenewal.ts (deciding
 * what replaces it at end of life). Costs are order-of-magnitude estimates, not
 * real quotes — the point is that heat pumps cost more upfront and less to run
 * than a fossil boiler, subsidized in the heat pumps' favor, which is the actual
 * economic shape driving Swiss heating renewal today.
 */

export type HeatingSystemId = "gasBoiler" | "oilBoiler" | "districtHeating" | "airHeatPump" | "groundHeatPump";

export interface HeatingSystemSpec {
  id: HeatingSystemId;
  label: string;
  icon: string;
  lifetimeMeanYears: number;
  /** At a reference building with ~250m² of envelope area — heatingRenewal.ts
   * scales this with the actual building's size. */
  baseInstallCostRp: number;
  subsidyRp: number; // flat, not size-scaled — mirrors how real cantonal grants are usually a fixed amount
  /** Signed "renewable-ness" used only to nudge the hidden bias trait — never
   * shown to the player. */
  greenness: number;
  /** Validated (dataviz skill's validate_palette.js, all 5 together, light
   * mode) — used by ui/ReportCardModal.tsx's space-heating-by-technology pie.
   * Re-validate the same way before changing any of these. */
  color: string;
}

export const HEATING_SYSTEM_ORDER: HeatingSystemId[] = ["airHeatPump", "groundHeatPump", "districtHeating", "gasBoiler", "oilBoiler"];

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
    baseInstallCostRp: 38_000_00,
    subsidyRp: 9_000_00,
    greenness: 1,
    color: "#0f8fc0",
  },
  districtHeating: {
    id: "districtHeating",
    label: "District heating",
    icon: "🏭",
    lifetimeMeanYears: 25,
    baseInstallCostRp: 14_000_00,
    subsidyRp: 0,
    greenness: 0.4,
    color: "#4a3aa7",
  },
  gasBoiler: {
    id: "gasBoiler",
    label: "Gas boiler",
    icon: "🔥",
    lifetimeMeanYears: 18,
    baseInstallCostRp: 16_000_00,
    subsidyRp: 0,
    greenness: -1,
    color: "#eb6834",
  },
  oilBoiler: {
    id: "oilBoiler",
    label: "Oil boiler",
    icon: "🛢️",
    lifetimeMeanYears: 20,
    baseInstallCostRp: 17_000_00,
    subsidyRp: 0,
    greenness: -1.3,
    color: "#b23a2e",
  },
};

/** Validated (validate_palette.js, light mode) — ui/ReportCardModal.tsx's
 * water-heating-by-kind pie. Deliberately reuses airHeatPump's green (both
 * read as "heat pump"-driven) and a blue distinct from every space-heating
 * color for "direct electric" (a plain resistive tank). */
export const WATER_HEATING_KIND_COLOR: Record<"heatPump" | "direct", string> = {
  heatPump: "#1baf7a",
  direct: "#2a78d6",
};

export const GAS_BOILER_EFFICIENCY = 0.9; // typical modern gas boiler
export const OIL_BOILER_EFFICIENCY = 0.85; // typical oil boiler — somewhat less efficient than gas
export const DISTRICT_HEATING_EFFICIENCY = 1.0; // price is already per kWh of heat delivered
export const OIL_ENERGY_KWH_PER_LITER = 10; // "Heizöl extra leicht" — standard rule-of-thumb energy density

export function fuelEfficiency(fuel: "gasBoiler" | "oilBoiler" | "districtHeating"): number {
  if (fuel === "gasBoiler") return GAS_BOILER_EFFICIENCY;
  if (fuel === "oilBoiler") return OIL_BOILER_EFFICIENCY;
  return DISTRICT_HEATING_EFFICIENCY;
}
