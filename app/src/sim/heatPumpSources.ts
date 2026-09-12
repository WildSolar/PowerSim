/**
 * GWR energy-source values that are only ever usable via a heat pump — ground,
 * groundwater/surface-water, and ambient-air reservoirs are all too cold to heat a
 * building or its hot water directly, so recording one of these as the energy
 * source implies a heat pump regardless of what the (separately recorded, and
 * sometimes inconsistent — e.g. a "Wärmekraftkopplungsanlage" generator paired
 * with an "Erdwärmesonde" source in Schlieren's own data) generator field says.
 * Shared between heatPump.ts (space heating) and waterHeating.ts (hot water),
 * since GWR uses the same source vocabulary — and the same physical reasoning —
 * for both fields.
 */
const HEAT_PUMP_RESERVOIR_SOURCES = new Set([
  "Erdwärmesonde",
  "Erdwärme (generisch)",
  "Erdregister",
  "Wasser (Grundwasser, Oberflächenwasser, Abwasser)",
  "Luft",
]);

export function impliesHeatPump(energySource: string | null): boolean {
  return energySource !== null && HEAT_PUMP_RESERVOIR_SOURCES.has(energySource);
}
