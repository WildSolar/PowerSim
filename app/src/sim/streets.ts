/**
 * The municipality's street network (pipeline/sources/streets.py): segments from one
 * junction to the next, the unit street-bound infrastructure (district heating pipes)
 * is laid in. Static for the whole game — streets aren't built or removed.
 */

import type { MunicipalityDataset, StreetSegment } from "../data/types";
import { LocalProjection } from "./localGeo";

const NAMED_MATCH_RADIUS_M = 150; // same reach as the pipeline's own entrance-to-street matching
const ANY_MATCH_RADIUS_M = 60;
const BORDER_SETBACK_M = 12; // as the pipeline: a building borders every street this close to its footprint

type XY = [number, number];

function distanceToPolylineM(p: XY, line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    const cx = ax + t * dx - p[0];
    const cy = ay + t * dy - p[1];
    best = Math.min(best, Math.hypot(cx, cy));
  }
  return best;
}

/** Distance between two line pieces (0 if they cross). */
function pieceDistanceM(a0: XY, a1: XY, b0: XY, b1: XY): number {
  const cross = (o: XY, p: XY, q: XY) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(a0, a1, b0);
  const d2 = cross(a0, a1, b1);
  const d3 = cross(b0, b1, a0);
  const d4 = cross(b0, b1, a1);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    distanceToPolylineM(a0, [b0, b1]),
    distanceToPolylineM(a1, [b0, b1]),
    distanceToPolylineM(b0, [a0, a1]),
    distanceToPolylineM(b1, [a0, a1]),
  );
}

/** Distance from a footprint's outline to a street's line. */
function outlineToPolylineM(ring: XY[], line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < ring.length; i++) {
    for (let j = 1; j < line.length; j++) best = Math.min(best, pieceDistanceM(ring[i - 1], ring[i], line[j - 1], line[j]));
  }
  return best;
}

function normalizeName(name: string | null): string {
  return (name ?? "").normalize("NFC").toLowerCase().replace("str.", "strasse").trim();
}

class StreetNetwork {
  private segments: StreetSegment[] = [];
  private byNode = new Map<number, number[]>();
  private projection = new LocalProjection(8.4, 47.4);
  private linesXY: XY[][] = [];

  init(dataset: MunicipalityDataset): void {
    this.segments = dataset.streets ?? [];
    this.byNode = new Map();
    for (const s of this.segments) {
      for (const node of this.nodesOf(s.id)) {
        const list = this.byNode.get(node) ?? [];
        list.push(s.id);
        this.byNode.set(node, list);
      }
    }
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.linesXY = this.segments.map((s) => s.line.map(([lon, lat]) => this.projection.toXY(lon, lat)));
  }

  all(): StreetSegment[] {
    return this.segments;
  }

  get(id: number): StreetSegment | undefined {
    return this.segments[id];
  }

  /** Every junction along a segment, ends included. */
  nodesOf(id: number): number[] {
    const s = this.segments[id];
    return s ? (s.nodes ?? [s.a, s.b]) : [];
  }

  /** Segment ids meeting at a junction node (ending there or passing through it). */
  atNode(node: number): number[] {
    return this.byNode.get(node) ?? [];
  }

  /** The closest point on any street to (lon, lat), and how far away it is — where something
   * placed on the map (a charger) actually goes. Null without streets. */
  snapToStreet(lon: number, lat: number): { lon: number; lat: number; distanceM: number } | null {
    const p = this.projection.toXY(lon, lat);
    let best: { x: number; y: number; d: number } | null = null;
    for (const line of this.linesXY) {
      for (let i = 1; i < line.length; i++) {
        const [ax, ay] = line[i - 1];
        const [bx, by] = line[i];
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
        const x = ax + t * dx;
        const y = ay + t * dy;
        const d = Math.hypot(x - p[0], y - p[1]);
        if (!best || d < best.d) best = { x, y, d };
      }
    }
    if (!best) return null;
    const [snappedLon, snappedLat] = this.projection.toLonLat(best.x, best.y);
    return { lon: snappedLon, lat: snappedLat, distanceM: best.d };
  }

  /** The segments a new building at (lon, lat) can be reached from, as the pipeline links the
   * buildings the game starts with: the one it is addressed from (the nearest carrying its
   * address's street name if one is close, else the nearest of any name), plus every other
   * segment its footprint borders. Empty when no street is near. */
  segmentsFor(lon: number, lat: number, address: string | null, footprint: [number, number][] | null): number[] {
    if (this.segments.length === 0) return [];
    const p = this.projection.toXY(lon, lat);
    const street = address ? normalizeName(address.replace(/\s+\S+$/, "")) : "";
    let named: { id: number; d: number } | null = null;
    let any: { id: number; d: number } | null = null;
    for (const s of this.segments) {
      const d = distanceToPolylineM(p, this.linesXY[s.id]);
      if (!any || d < any.d) any = { id: s.id, d };
      if (street && normalizeName(s.name) === street && (!named || d < named.d)) named = { id: s.id, d };
    }
    const found: number[] = [];
    if (named && named.d <= NAMED_MATCH_RADIUS_M) found.push(named.id);
    else if (any && any.d <= ANY_MATCH_RADIUS_M) found.push(any.id);
    if (footprint && footprint.length >= 3) {
      const ring = footprint.map(([x, y]) => this.projection.toXY(x, y));
      for (const s of this.segments) {
        if (found.includes(s.id)) continue;
        const reach = BORDER_SETBACK_M + (s.widthM ?? 6) / 2;
        if (distanceToPolylineM(p, this.linesXY[s.id]) > reach + 200) continue; // far away: skip the exact test
        if (outlineToPolylineM(ring, this.linesXY[s.id]) <= reach) found.push(s.id);
      }
    }
    return found;
  }
}

export const streets = new StreetNetwork();
