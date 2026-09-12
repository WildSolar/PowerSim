/**
 * Short, human-readable labels for GWR's raw heating/hot-water energy-source
 * strings — used wherever a device row falls back to "what's actually there"
 * instead of an electric reading (e.g. BuildingPanel's Climate control/Hot water
 * rows for a building with no heat pump or electric water heater). Falls back to
 * the raw GWR string for anything not in this table rather than hiding it.
 */
const ENERGY_SOURCE_LABELS: Record<string, string> = {
  Gas: "Gas boiler",
  "Heizöl": "Oil boiler",
  "Elektrizität": "Electric heater",
  "Fernwärme (generisch)": "District heating",
  "Fernwärme (Niedertemperatur)": "District heating",
  "Holz (generisch)": "Wood heating",
  "Holz (Stückholz)": "Wood heating",
  "Holz (Pellets)": "Wood pellets",
  "Erdwärmesonde": "Geothermal",
  "Erdwärme (generisch)": "Geothermal",
  "Erdregister": "Geothermal",
  "Sonne (thermisch)": "Solar thermal",
  Wasser: "Water-source",
  Luft: "Air-source",
  Andere: "Other",
  Unbestimmt: "Unspecified",
  Keine: "None",
};

export function energySourceLabel(source: string | null): string {
  if (!source) return "Unknown";
  return ENERGY_SOURCE_LABELS[source] ?? source;
}
