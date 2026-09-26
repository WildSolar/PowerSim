/**
 * What the district heating network means for the buildings around it: who is connected,
 * who could be, the network's peak load against its source's capacity, and how much heat
 * the buildings along a planned extension use — the figure an extension's worth is judged
 * by (heat per metre of pipe). Kept apart from districtHeat.ts because it needs the heating
 * model, which itself depends on districtHeat.ts.
 */

import { DH_DESIGN_OUTDOOR_TEMP_C, DH_SOURCE_CAPACITY_HEADROOM } from "../config/districtHeat";
import type { Building } from "../data/types";
import { toDateMs } from "./calendar";
import { districtHeat } from "./districtHeat";
import { annualHeatDemandKWh, currentHeatingSystemId, initialHeatingSystemId } from "./heatingRenewal";
import { existsAt } from "./lifetime";
import { spaceHeatingThermalDemandW } from "./spaceHeating";

export type NetworkStatus = "connected" | "connectable" | "outOfReach";

export function networkStatusAt(building: Building, atMs: number): NetworkStatus {
  if (currentHeatingSystemId(building, atMs) === "districtHeating") return "connected";
  return districtHeat.servesAt(building.streetSegments, atMs) ? "connectable" : "outOfReach";
}

/** networkStatusAt for the map: a building out of reach that the extension being planned would
 * reach (it fronts on a picked street, and has a heating system that gets replaced) shows as
 * "planned". */
export function mapNetworkBucketAt(building: Building, atMs: number): NetworkStatus | "planned" {
  const status = networkStatusAt(building, atMs);
  if (status !== "outOfReach") return status;
  const selection = districtHeat.getSelection();
  if (selection.size === 0 || !building.streetSegments?.some((id) => selection.has(id))) return status;
  return currentHeatingSystemId(building, atMs) === null ? status : "planned";
}

/** A building's heat load on a cold winter day — what the network has to be able to deliver. */
function designLoadW(building: Building, atMs: number): number {
  return spaceHeatingThermalDemandW(building, DH_DESIGN_OUTDOOR_TEMP_C, DH_DESIGN_OUTDOOR_TEMP_C, atMs);
}

/** The connected buildings' combined heat load on a cold winter day. */
export function networkPeakLoadW(buildings: Building[], atMs: number): number {
  let total = 0;
  for (const b of buildings) {
    if (existsAt(b, atMs) && currentHeatingSystemId(b, atMs) === "districtHeating") total += designLoadW(b, atMs);
  }
  return total;
}

let capacityW: number | null = null;

/** The source's capacity. No open data says what it is, so for now it is set a margin above
 * the load of the buildings connected when the game starts — see DH_SOURCE_CAPACITY_HEADROOM. */
export function sourceCapacityW(buildings: Building[], startMs: number): number {
  if (capacityW === null) {
    let initial = 0;
    for (const b of buildings) {
      if (b.origin === undefined && initialHeatingSystemId(b) === "districtHeating") initial += designLoadW(b, startMs);
    }
    capacityW = initial * DH_SOURCE_CAPACITY_HEADROOM;
  }
  return capacityW;
}

const demandCache = new Map<string, number>(); // `${egid}:${year}` -> kWh

function cachedAnnualDemandKWh(building: Building, atMs: number): number {
  const key = `${building.egid}:${new Date(toDateMs(atMs)).getUTCFullYear()}`;
  let kWh = demandCache.get(key);
  if (kWh === undefined) {
    kWh = annualHeatDemandKWh(building, atMs);
    demandCache.set(key, kWh);
  }
  return kWh;
}

export interface StreetDemand {
  /** Buildings along the streets that could newly connect (not connected, not already reachable). */
  buildings: number;
  annualHeatKWh: number;
}

/** The buildings fronting on the given segments that an extension there would newly reach, and
 * the heat they use in a year. */
export function streetDemand(buildings: Building[], segmentIds: Iterable<number>, atMs: number): StreetDemand {
  const segments = new Set(segmentIds);
  let count = 0;
  let annualHeatKWh = 0;
  if (segments.size === 0) return { buildings: 0, annualHeatKWh: 0 };
  for (const b of buildings) {
    if (!b.streetSegments?.some((id) => segments.has(id)) || !existsAt(b, atMs)) continue;
    if (networkStatusAt(b, atMs) !== "outOfReach") continue;
    if (currentHeatingSystemId(b, atMs) === null) continue; // wood, unspecified...: not a system we renew
    count++;
    annualHeatKWh += cachedAnnualDemandKWh(b, atMs);
  }
  return { buildings: count, annualHeatKWh };
}
