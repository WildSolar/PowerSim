import type { Building } from "../data/types";
import { polygonAreaM2, polygonPerimeterM } from "./geo";

const FLOOR_HEIGHT_M = 3;
const DEFAULT_HEIGHT_M = 6; // ~2 floors, used when floorCount is unknown

/** Also drives the 3D extrusion height in MapView — kept here as the single source of truth. */
export function buildingHeightM(building: Building): number {
  return building.floorCount && building.floorCount > 0 ? building.floorCount * FLOOR_HEIGHT_M : DEFAULT_HEIGHT_M;
}

const envelopeAreaCache = new Map<string, number | null>();

/** Roof + wall area of the extruded volume shown on the map (flat roof approximation,
 * ground contact ignored) — null for buildings with no footprint polygon, the same
 * ~15% that fall back to a point marker instead of a 3D volume. Cached per building:
 * it's static geometry, and the shoelace/perimeter math isn't worth repeating on
 * every heat-pump evaluation at municipality scale. */
export function buildingEnvelopeAreaM2(building: Building): number | null {
  const cached = envelopeAreaCache.get(building.egid);
  if (cached !== undefined) return cached;

  let area: number | null = null;
  if (building.footprint && building.footprint.length >= 3) {
    const ring = building.footprint as [number, number][];
    area = polygonAreaM2(ring) + polygonPerimeterM(ring) * buildingHeightM(building);
  }
  envelopeAreaCache.set(building.egid, area);
  return area;
}
