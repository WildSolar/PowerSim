/**
 * What the municipality adds on top of the federal/cantonal grants a decision already
 * gets, read from the player's policy at the moment a decision is made. The one place
 * heating and vehicle decisions look up municipal subsidies — so when the measure
 * framework arrives it only has to change what these return.
 */

import type { HeatingSystemId } from "./heatingSystems";
import type { VehicleTypeId } from "./mobilitySystems";
import { policyStore } from "./policy";

/** Flat municipal grant, Rp, for installing this heating system (heat pumps only). */
export function municipalHeatingSubsidyRp(id: HeatingSystemId): number {
  return id === "airHeatPump" || id === "groundHeatPump" ? policyStore.get().heatPumpSubsidyRp : 0;
}

/** Flat municipal grant, Rp, for buying this vehicle (electric cars only for now). */
export function municipalVehicleSubsidyRp(id: VehicleTypeId): number {
  return id === "carEV" ? policyStore.get().evSubsidyRp : 0;
}
