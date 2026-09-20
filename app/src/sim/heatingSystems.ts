/**
 * The catalog of space-heating systems a building can have — shared by
 * billing.ts (pricing what's actually installed) and heatingRenewal.ts
 * (deciding what replaces it at end of life). The catalog itself, and every
 * other tunable number behind it, lives in config/heating.ts — edit that
 * file to recalibrate; this one just re-exports it plus the structural bits
 * (display order, the water-heating color pair, the fuel-efficiency lookup)
 * that aren't calibration knobs.
 */

export {
  HEATING_SYSTEM_CATALOG,
  GAS_BOILER_EFFICIENCY,
  OIL_BOILER_EFFICIENCY,
  DISTRICT_HEATING_EFFICIENCY,
  OIL_ENERGY_KWH_PER_LITER,
  type HeatingSystemId,
  type HeatingSystemSpec,
} from "../config/heating";
import { GAS_BOILER_EFFICIENCY, OIL_BOILER_EFFICIENCY, DISTRICT_HEATING_EFFICIENCY, type HeatingSystemId } from "../config/heating";

export const HEATING_SYSTEM_ORDER: HeatingSystemId[] = ["airHeatPump", "groundHeatPump", "districtHeating", "gasBoiler", "oilBoiler"];

/** Validated (validate_palette.js, light mode) — ui/ReportCardModal.tsx's
 * water-heating-by-kind pie. Deliberately reuses airHeatPump's green (both
 * read as "heat pump"-driven) and a blue distinct from every space-heating
 * color for "direct electric" (a plain resistive tank). */
export const WATER_HEATING_KIND_COLOR: Record<"heatPump" | "direct", string> = {
  heatPump: "#1baf7a",
  direct: "#2a78d6",
};

export function fuelEfficiency(fuel: "gasBoiler" | "oilBoiler" | "districtHeating"): number {
  if (fuel === "gasBoiler") return GAS_BOILER_EFFICIENCY;
  if (fuel === "oilBoiler") return OIL_BOILER_EFFICIENCY;
  return DISTRICT_HEATING_EFFICIENCY;
}
