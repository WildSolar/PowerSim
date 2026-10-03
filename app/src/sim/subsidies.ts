/**
 * What the municipality adds on top of the federal/cantonal grants a decision already
 * gets, read from the player's policy at the moment a decision is made. The one place
 * heating and vehicle decisions look up municipal subsidies — so when the measure
 * framework arrives it only has to change what these return.
 */

import type { HeatingSystemId } from "./heatingSystems";
import type { VehicleTypeId } from "./mobilitySystems";
import { policyStore } from "./policy";

/** Flat municipal grant, Rp, for installing this heating system (heat pumps only). A grant targeted
 * at early replacements is paid only when `early` (a working boiler replaced before its time). */
export function municipalHeatingSubsidyRp(id: HeatingSystemId, early = false): number {
  const p = policyStore.get();
  if (id !== "airHeatPump" && id !== "groundHeatPump") return 0;
  return p.heatPumpGrantEarlyOnly && !early ? 0 : p.heatPumpSubsidyRp;
}

/** Flat municipal grant, Rp, for buying this vehicle (electric cars only for now) — likewise only
 * for an early switch when targeted. */
export function municipalVehicleSubsidyRp(id: VehicleTypeId, early = false): number {
  const p = policyStore.get();
  if (id !== "carEV") return 0;
  return p.evGrantEarlyOnly && !early ? 0 : p.evSubsidyRp;
}
