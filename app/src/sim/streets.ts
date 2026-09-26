/**
 * The municipality's street network (pipeline/sources/streets.py): segments from one
 * junction to the next, the unit street-bound infrastructure (district heating pipes)
 * is laid in. Static for the whole game — streets aren't built or removed.
 */

import type { MunicipalityDataset, StreetSegment } from "../data/types";
import { LocalProjection } from "./localGeo";

const NAMED_MATCH_RADIUS_M = 150; // same reach as the pipeline's own entrance-to-street matching
const ANY_MATCH_RADIUS_M = 60;

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
      for (const node of [s.a, s.b]) {
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

  /** Segment ids meeting at a junction node. */
  atNode(node: number): number[] {
    return this.byNode.get(node) ?? [];
  }

  /** The segment a new building at (lon, lat) fronts on: the nearest one carrying its address's
   * street name if one is close, else the nearest of any name — as the pipeline links the
   * buildings the game starts with. Empty when no street is near. */
  segmentsFor(lon: number, lat: number, address: string | null): number[] {
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
    if (named && named.d <= NAMED_MATCH_RADIUS_M) return [named.id];
    if (any && any.d <= ANY_MATCH_RADIUS_M) return [any.id];
    return [];
  }
}

export const streets = new StreetNetwork();
