/**
 * What the municipality adds on top of the federal/cantonal grants a decision already
 * gets, read from the player's policy at the moment a decision is made. The one place
 * heating and vehicle decisions look up municipal subsidies — so when the measure
 * framework arrives it only has to change what these return.
 */

import type { HeatingSystemId } from "./heatingSystems";
import type { FleetVehicleClass, FleetVehicleId } from "../config/fleet";
import type { VehicleTypeId } from "./mobilitySystems";
import { policyStore } from "./policy";

/** Municipal grant, Rp, for installing this heating system, by the situation: `early`, a working oil
 * or gas boiler replaced before its time; a boiler at the end of its life; anything else (`incumbent`:
 * what it replaces). Only a heat pump or a first connection to district heating gets one. */
export function municipalHeatingSubsidyRp(id: HeatingSystemId, incumbent: HeatingSystemId, early = false): number {
  const p = policyStore.get();
  const fossil = incumbent === "oilBoiler" || incumbent === "gasBoiler";
  if (id === "districtHeating") {
    if (incumbent === "districtHeating") return 0;
    return early ? p.dhGrantEarlyRp : fossil ? p.dhGrantFossilRp : p.dhGrantOtherRp;
  }
  if (id !== "airHeatPump" && id !== "groundHeatPump") return 0;
  return early ? p.heatPumpGrantEarlyRp : fossil ? p.heatPumpGrantFossilRp : p.heatPumpGrantOtherRp;
}

/** Municipal grant, Rp, for buying this car, by the situation likewise: only an electric one. */
export function municipalVehicleSubsidyRp(id: VehicleTypeId, incumbent: VehicleTypeId, early = false): number {
  const p = policyStore.get();
  if (id !== "carEV") return 0;
  return early ? p.evGrantEarlyRp : incumbent === "carICE" ? p.evGrantFossilRp : p.evGrantOtherRp;
}

/** Municipal grant, Rp, towards the charger a business puts in its yard for a van or a lorry. */
export function municipalYardChargerGrantRp(vehicleClass: FleetVehicleClass): number {
  const p = policyStore.get();
  return vehicleClass === "van" ? p.fleetVanChargerGrantRp : p.fleetTruckChargerGrantRp;
}

/** Municipal grant, Rp, for a business's electric van or lorry: when it replaces a working diesel one
 * early, or one at the end of its life. An electric one replacing an electric one gets nothing. */
export function municipalFleetSubsidyRp(id: FleetVehicleId, incumbent: FleetVehicleId, early = false): number {
  const p = policyStore.get();
  if (id === "vanEV" && incumbent === "vanDiesel") return early ? p.fleetVanGrantEarlyRp : p.fleetVanGrantEndRp;
  if (id === "truckEV" && incumbent === "truckDiesel") return early ? p.fleetTruckGrantEarlyRp : p.fleetTruckGrantEndRp;
  return 0;
}
