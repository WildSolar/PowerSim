/**
 * Building energy classes (envelope quality): a ladder from unrenovated to Minergie-P.
 * A building's class is never stored — it is read off its actual U-value, so the class
 * and the heat-loss physics can never disagree. Existing buildings get their class from
 * their era-and-quality U-value (spaceHeating.ts); a retrofit moves a building to a new
 * class by setting a U-value near that class's target (retrofit.ts).
 */

import { ENERGY_CLASS_CATALOG, ENERGY_CLASS_ORDER, type EnergyClassId } from "../config/retrofit";

export type { EnergyClassId };
export { ENERGY_CLASS_CATALOG, ENERGY_CLASS_ORDER };

/** Position in the ladder, 0 = worst. */
export function energyClassRank(id: EnergyClassId): number {
  return ENERGY_CLASS_ORDER.indexOf(id);
}

/** The class whose target U-value is nearest in log terms — i.e. boundaries at the
 * geometric mean of neighbouring targets. */
export function classForUValue(uValueWPerM2K: number): EnergyClassId {
  let best = ENERGY_CLASS_ORDER[0];
  let bestDistance = Infinity;
  for (const id of ENERGY_CLASS_ORDER) {
    const distance = Math.abs(Math.log(uValueWPerM2K / ENERGY_CLASS_CATALOG[id].targetUValue));
    if (distance < bestDistance) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}
