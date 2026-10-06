/**
 * What the district heating networks mean for the buildings around them: who is connected,
 * who could be, each network's winter peak against its clean sources, and how much heat the
 * buildings along a planned extension use — the figure an extension's worth is judged by (heat
 * per metre of pipe). Kept apart from districtHeat.ts because it needs the heating model, which
 * itself depends on districtHeat.ts.
 */

import { DH_DESIGN_OUTDOOR_TEMP_C, DH_NETWORK_LOSS_SHARE, DH_UNKNOWN_CAPACITY_HEADROOM } from "../config/districtHeat";
import type { Building } from "../data/types";
import { toDateMs } from "./calendar";
import { districtHeat } from "./districtHeat";
import { annualHeatDemandKWh, currentHeatingSystemId, initialHeatingSystemId } from "./heatingRenewal";
import { existsAt } from "./lifetime";
import { gfaOf } from "./newBuild";
import { spaceHeatingThermalDemandW } from "./spaceHeating";

/** "noHeating": no heating system the game replaces — mostly garages, sheds and storage (the
 * building register's annexes, numbered like "Schulstrasse 7.1"), also wood or unrecorded
 * heating — so nothing that could ever switch to district heat. */
export type NetworkStatus = "connected" | "connectable" | "outOfReach" | "noHeating";

export function networkStatusAt(building: Building, atMs: number): NetworkStatus {
  const system = currentHeatingSystemId(building, atMs);
  if (system === "districtHeating") return "connected";
  if (system === null) return "noHeating";
  return districtHeat.servesAt(building.streetSegments, atMs) ? "connectable" : "outOfReach";
}

/** networkStatusAt for the map, which also shows what is coming: a building out of reach that an
 * ordered extension will reach once its pipes are in ("awaitingPipes"), or that the extension
 * being planned would reach ("planned"). */
export function mapNetworkBucketAt(building: Building, atMs: number): NetworkStatus | "awaitingPipes" | "planned" {
  const status = networkStatusAt(building, atMs);
  if (status !== "outOfReach") return status;
  if (districtHeat.buildingAt(building.streetSegments, atMs)) return "awaitingPipes";
  const selection = districtHeat.getSelection();
  return building.streetSegments?.some((id) => selection.has(id)) ? "planned" : status;
}

/** A building's heat load on a cold winter day — what the network has to be able to deliver. */
function designLoadW(building: Building, atMs: number): number {
  return spaceHeatingThermalDemandW(building, DH_DESIGN_OUTDOOR_TEMP_C, DH_DESIGN_OUTDOOR_TEMP_C, atMs);
}

/** Each network's heat load on a cold winter day (W, by network id), pipe losses included: the
 * connected buildings, and any that no network reaches any more under -1. */
export function networkPeaksW(buildings: Building[], atMs: number): Map<number, number> {
  const peaks = new Map<number, number>();
  for (const b of buildings) {
    if (!existsAt(b, atMs) || currentHeatingSystemId(b, atMs) !== "districtHeating") continue;
    const id = districtHeat.networkOf(b.streetSegments, atMs)?.id ?? -1;
    peaks.set(id, (peaks.get(id) ?? 0) + designLoadW(b, atMs) * (1 + DH_NETWORK_LOSS_SHARE));
  }
  return peaks;
}

/** Sizes the starting networks that didn't report their capacity: a margin above the winter peak
 * of the buildings connected when the game starts. Once, at the start (before any save is loaded). */
export function sizeUnreportedSources(buildings: Building[], startMs: number): void {
  const unsized = districtHeat.getSources().filter((s) => s.unsizedShare !== null && !Number.isFinite(s.cleanW));
  if (unsized.length === 0) return;
  const initial = buildings.filter((b) => b.origin === undefined && initialHeatingSystemId(b) === "districtHeating");
  const peaks = networkPeaksW(initial, startMs);
  for (const s of unsized) {
    const network = districtHeat.networksAt(startMs).find((n) => n.sources.includes(s));
    const peakW = network ? (peaks.get(network.id) ?? 0) : 0;
    districtHeat.setCleanW(s.id, peakW * DH_UNKNOWN_CAPACITY_HEADROOM * (s.unsizedShare ?? 1));
  }
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

export interface CoverageShare {
  total: number;
  connected: number;
  /** Connected, or on a piped street and so free to connect. */
  withinReach: number;
}

export interface NetworkCoverage {
  buildings: CoverageShare;
  floorAreaM2: CoverageShare;
  heatDemandKWh: CoverageShare;
}

/** How much of the town's heated building stock the network serves and could serve — by
 * building count, floor area and yearly heat demand. Buildings with no heating to connect
 * (garages, sheds, wood heating: "noHeating") are left out of every total. */
export function networkCoverage(buildings: Building[], atMs: number): NetworkCoverage {
  const zero = (): CoverageShare => ({ total: 0, connected: 0, withinReach: 0 });
  const result: NetworkCoverage = { buildings: zero(), floorAreaM2: zero(), heatDemandKWh: zero() };
  for (const b of buildings) {
    if (!existsAt(b, atMs)) continue;
    const status = networkStatusAt(b, atMs);
    if (status === "noHeating") continue;
    const amounts: [CoverageShare, number][] = [
      [result.buildings, 1],
      [result.floorAreaM2, gfaOf(b)],
      [result.heatDemandKWh, cachedAnnualDemandKWh(b, atMs)],
    ];
    for (const [share, amount] of amounts) {
      share.total += amount;
      if (status === "connected") share.connected += amount;
      if (status !== "outOfReach") share.withinReach += amount;
    }
  }
  return result;
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
    if (networkStatusAt(b, atMs) !== "outOfReach") continue; // connected, reachable already, or nothing to connect
    if (districtHeat.buildingAt(b.streetSegments, atMs)) continue; // an ordered extension reaches it anyway
    count++;
    annualHeatKWh += cachedAnnualDemandKWh(b, atMs);
  }
  return { buildings: count, annualHeatKWh };
}
