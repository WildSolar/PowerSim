/**
 * The municipality's own buildings. The register doesn't say who owns a building, so every
 * public-use one — schools, sports halls, churches, hospitals, museums and cultural buildings — is
 * treated as the municipality's: where it can put solar panels and chargers of its own, by measure
 * (solarAdoption.ts, publicCharging.ts) or one at a time (the Public buildings layer).
 */

import type { Building, PowerPlant } from "../data/types";
import { buildingGroup } from "./buildingGroup";
import { publicCharging, type ChargingSite } from "./publicCharging";
import { solarStatusOf } from "./solarAdoption";

export function isPublicBuilding(b: Building): boolean {
  return buildingGroup(b) === "public";
}

export function publicBuildingKind(b: Building): string {
  const c = b.buildingClass ?? "";
  if (/Schul/.test(c)) return "School";
  if (/Sport/.test(c)) return "Sports hall";
  if (/Kirchen/.test(c)) return "Church";
  if (/Kranken/.test(c)) return "Hospital";
  if (/Museen/.test(c)) return "Museum or library";
  if (/Kultur/.test(c)) return "Culture and leisure";
  return "Public building";
}

export interface PublicBuildingStatus {
  solar: { capacityKw: number; installedAtMs: number } | null;
  chargers: ChargingSite[];
}

export function publicBuildingStatus(b: Building, realPlants: PowerPlant[]): PublicBuildingStatus {
  return { solar: solarStatusOf(b, realPlants), chargers: publicCharging.sitesAtBuilding(b.egid) };
}

/** A building's bucket on the Public buildings layer (ordered or built counts). */
export function publicBuildingBucket(b: Building, realPlants: PowerPlant[]): string {
  if (!isPublicBuilding(b)) return "other";
  const { solar, chargers } = publicBuildingStatus(b, realPlants);
  if (solar && chargers.length > 0) return "both";
  if (solar) return "solar";
  if (chargers.length > 0) return "chargers";
  return "none";
}
