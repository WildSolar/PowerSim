import type { Building } from "../data/types";
import { ENERGY_CLASS_CATALOG, ENERGY_CLASS_ORDER } from "../sim/energyClass";
import { currentHeatingSystemId } from "../sim/heatingRenewal";

export type ColorMode = "none" | "category" | "heating" | "power" | "solar" | "age" | "insulation";

export interface LegendEntry {
  bucket: string;
  label: string;
  color: string;
}

// Validated 4-hue categorical set (blue/orange/aqua/violet) — passes the CVD and
// normal-vision all-pairs checks required for map/choropleth use (unlike a cycled
// or ad-hoc palette). The last entry in each legend below is the neutral fallback
// bucket and isn't part of that validated set.
const UNKNOWN_COLOR = "#b6b4ac";

export const CATEGORY_LEGEND: LegendEntry[] = [
  { bucket: "residential", label: "Residential", color: "#2a78d6" },
  { bucket: "residentialMixed", label: "Residential (mixed use)", color: "#1baf7a" },
  { bucket: "nonResidential", label: "Non-residential", color: "#eb6834" },
  { bucket: "special", label: "Special-purpose", color: "#4a3aa7" },
  { bucket: "unknown", label: "Unknown", color: UNKNOWN_COLOR },
];

export function categoryBucket(category: string | null): string {
  switch (category) {
    case "Gebäude mit ausschliesslicher Wohnnutzung":
      return "residential";
    case "Andere Wohngebäude (Wohngebäude mit Nebennutzung)":
    case "Gebäude mit teilweiser Wohnnutzung":
      return "residentialMixed";
    case "Gebäude ohne Wohnnutzung":
      return "nonResidential";
    case "Sonderbau":
      return "special";
    default:
      return "unknown";
  }
}

export const HEATING_LEGEND: LegendEntry[] = [
  { bucket: "fossil", label: "Fossil (gas / oil)", color: "#eb6834" },
  { bucket: "districtHeat", label: "District heat", color: "#4a3aa7" },
  { bucket: "heatPump", label: "Heat pump / ambient", color: "#1baf7a" },
  { bucket: "electric", label: "Direct electric", color: "#2a78d6" },
  { bucket: "other", label: "Other / unknown", color: UNKNOWN_COLOR },
];

export function heatingBucket(source: string | null): string {
  if (source === "Gas" || source === "Heizöl") return "fossil";
  if (source?.startsWith("Fernwärme")) return "districtHeat";
  if (
    source === "Luft" ||
    source === "Erdwärmesonde" ||
    source === "Erdregister" ||
    source?.startsWith("Erdwärme") ||
    source?.startsWith("Wasser")
  ) {
    return "heatPump";
  }
  if (source === "Elektrizität") return "electric";
  return "other"; // wood/biomass, "Unbestimmt", "Andere", "Keine", null — each too small to earn its own hue
}

/** MapLibre `match` expression mapping a precomputed bucket property to its legend color.
 * Typed as a plain array rather than fighting maplibre-gl's deep expression-spec
 * generics for a JSON-DSL value that's already runtime-verified against the real style. */
export type MapExpr = (string | number | null | MapExpr)[];

export function legendMatchExpression(property: string, legend: LegendEntry[]): MapExpr {
  const expr: MapExpr = ["match", ["get", property]];
  for (const entry of legend.slice(0, -1)) {
    expr.push(entry.bucket, entry.color);
  }
  expr.push(legend[legend.length - 1].color); // fallback bucket's color
  return expr;
}

// Sequential blue ramp (skill default), 5 stops from near-zero to max — importing
// (net consuming) side of the power-draw scale.
export const POWER_RAMP = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];
// A matching sequential red ramp for the exporting (net negative, PV-heavy) side —
// same light->dark construction as POWER_RAMP, hand-built to the same lightness
// steps since the skill's reference only tabulates the blue ramp. Paired with blue
// as the skill's documented diverging pair (blue<->red); the label, not the hue
// alone, carries "this is good" vs "this is bad" — red here just means "exporting".
export const EXPORT_RAMP = ["#fbdcda", "#f2a29d", "#e34948", "#b93430", "#7a201d"];
const DIVERGING_NEUTRAL_COLOR = "#f0efec";

/** MapLibre `interpolate` expression for live net power draw, scaled minW..maxW.
 * Purely sequential (0..maxW) when nothing is currently exporting (minW >= 0, e.g.
 * at night) — no point allocating half the color range to an empty domain. Once
 * something exports (minW < 0, PV outrunning demand), switches to a diverging
 * scale so an exporting building reads as visibly different from an idle one
 * instead of both clipping to the same "near zero" color. */
export function powerColorExpression(minW: number, maxW: number): MapExpr {
  const safeMax = Math.max(maxW, 1);
  if (minW >= 0) {
    return [
      "interpolate",
      ["linear"],
      ["get", "powerW"],
      0,
      POWER_RAMP[0],
      safeMax * 0.25,
      POWER_RAMP[1],
      safeMax * 0.5,
      POWER_RAMP[2],
      safeMax * 0.75,
      POWER_RAMP[3],
      safeMax,
      POWER_RAMP[4],
    ];
  }
  const safeMin = Math.min(minW, -1);
  return [
    "interpolate",
    ["linear"],
    ["get", "powerW"],
    safeMin,
    EXPORT_RAMP[4],
    safeMin * 0.5,
    EXPORT_RAMP[2],
    0,
    DIVERGING_NEUTRAL_COLOR,
    safeMax * 0.5,
    POWER_RAMP[2],
    safeMax,
    POWER_RAMP[4],
  ];
}

// Sequential yellow ramp for installed solar capacity — matches the sun/solar color
// already used for the PV line in HistoryChart, and stays distinct from the blue
// used for power draw so the two modes are never confused.
export const SOLAR_RAMP = ["#fdf0cc", "#f7d374", "#eda100", "#b87c00", "#7a5200"];
const NO_SOLAR_COLOR = "#b6b4ac";

/** MapLibre `interpolate` expression for installed solar capacity (kWp), scaled
 * 0..maxCapacityKw. Buildings with no solar (property value 0) fall through to a
 * flat neutral grey via the leading `step`, rather than the palest yellow — "no
 * panels" shouldn't look like "a tiny panel". */
export function solarColorExpression(maxCapacityKw: number): MapExpr {
  const safeMax = Math.max(maxCapacityKw, 1);
  return [
    "case",
    ["==", ["get", "solarCapacityKw"], 0],
    NO_SOLAR_COLOR,
    [
      "interpolate",
      ["linear"],
      ["get", "solarCapacityKw"],
      0,
      SOLAR_RAMP[0],
      safeMax * 0.25,
      SOLAR_RAMP[1],
      safeMax * 0.5,
      SOLAR_RAMP[2],
      safeMax * 0.75,
      SOLAR_RAMP[3],
      safeMax,
      SOLAR_RAMP[4],
    ],
  ];
}

// Sequential light->dark blue by construction era, with buildings that appeared during
// the game in a hue of their own (they are the point of the layer). Construction
// sites use the amber below in every layer, not just this one.
export const AGE_LEGEND: LegendEntry[] = [
  { bucket: "age1", label: "Before 1946", color: "#d9e6f2" },
  { bucket: "age2", label: "1946-1975", color: "#a9c6e4" },
  { bucket: "age3", label: "1976-2000", color: "#6fa3d6" },
  { bucket: "age4", label: "2001 to game start", color: "#2a78d6" },
  { bucket: "new", label: "Built during the game", color: "#1baf7a" },
  { bucket: "unknown", label: "Unknown", color: UNKNOWN_COLOR },
];

export const INSULATION_LEGEND: LegendEntry[] = ENERGY_CLASS_ORDER.map((id) => ({
  bucket: id,
  label: ENERGY_CLASS_CATALOG[id].label,
  color: ENERGY_CLASS_CATALOG[id].color,
}));

export const CONSTRUCTION_COLOR = "#f2b01e";

export function buildingAgeBucket(building: Building): string {
  if (building.origin !== undefined) return "new";
  const year = building.constructionYear;
  if (year == null) return "unknown";
  if (year < 1946) return "age1";
  if (year < 1976) return "age2";
  if (year < 2001) return "age3";
  return "age4";
}

export function buildingCategoryBucket(building: Building): string {
  return categoryBucket(building.category);
}

/** The "Heating" legend bucket for whatever stock renewal (heatingRenewal.ts) has
 * actually installed by `simTimeMs` rather than only GWR's original snapshot, so a
 * renewal shows up on the map, not just in a building's own panel. Falls back to
 * GWR's own source for one we don't model/renew at all (wood, unspecified, ...),
 * which never changes anyway. */
export function buildingHeatingBucketAt(building: Building, simTimeMs: number): string {
  const id = currentHeatingSystemId(building, simTimeMs);
  if (id === "airHeatPump" || id === "groundHeatPump") return "heatPump";
  if (id === "gasBoiler" || id === "oilBoiler") return "fossil";
  if (id === "districtHeating") return "districtHeat";
  return heatingBucket(building.heatingEnergySource);
}
