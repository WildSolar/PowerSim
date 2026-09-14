/**
 * Small planar-geometry helpers for building footprints. Footprints are stored as
 * WGS84 (lon, lat) — convenient for MapLibre, useless for area/perimeter math — so
 * these reproject to local meters via a flat equirectangular approximation anchored
 * at the ring's own latitude. That's accurate enough for a single municipality a few
 * kilometers across at a roughly constant latitude; it would not be for anything
 * spanning a meaningfully different latitude range.
 */

const METERS_PER_DEG_LAT = 111_320;

function metersPerDegLon(latDeg: number): number {
  return 111_320 * Math.cos((latDeg * Math.PI) / 180);
}

function ringToLocalMeters(ring: [number, number][]): [number, number][] {
  const refLat = ring[0][1];
  const mPerLon = metersPerDegLon(refLat);
  return ring.map(([lon, lat]) => [lon * mPerLon, lat * METERS_PER_DEG_LAT]);
}

/** Shoelace formula. Works whether or not the ring is explicitly closed (first === last). */
export function polygonAreaM2(ring: [number, number][]): number {
  const pts = ringToLocalMeters(ring);
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeterM(ring: [number, number][]): number {
  const pts = ringToLocalMeters(ring);
  let perimeter = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    perimeter += Math.hypot(x2 - x1, y2 - y1);
  }
  return perimeter;
}

/** Straight-line distance between two WGS84 points, in meters — same flat
 * equirectangular approximation as the footprint helpers above, accurate
 * enough for the few-hundred-meter neighbor radius solarAdoption.ts uses it
 * for (see this module's own doc). */
export function distanceM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const mPerLon = metersPerDegLon((lat1 + lat2) / 2);
  const dx = (lon2 - lon1) * mPerLon;
  const dy = (lat2 - lat1) * METERS_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}
