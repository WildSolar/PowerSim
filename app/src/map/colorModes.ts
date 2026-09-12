import type { Building } from "../data/types";

export type ColorMode = "none" | "category" | "heating" | "power";

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

// Sequential blue ramp (skill default), 5 stops from near-zero to max.
export const POWER_RAMP = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"];

/** MapLibre `interpolate` expression for live power draw, scaled 0..maxW. */
export function powerColorExpression(maxW: number): MapExpr {
  const safeMax = Math.max(maxW, 1);
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

export function buildingCategoryBucket(building: Building): string {
  return categoryBucket(building.category);
}

export function buildingHeatingBucket(building: Building): string {
  return heatingBucket(building.heatingEnergySource);
}
