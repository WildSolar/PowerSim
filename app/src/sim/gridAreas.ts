/**
 * The geometry of the grid's transformer areas (grid.ts): which station each building hangs off,
 * and how the areas are drawn.
 *
 * Cables run along the streets, so a building is served by the station nearest *by road*: each
 * station sits on the street network, and a building is reached through the street(s) it fronts on
 * (Building.streetSegments). Where that fails — no street near, or a stretch of road no station
 * reaches — the station nearest as the crow flies serves it.
 *
 * For the map, each building gets a cell: the ground nearer to it than to any other building,
 * within a short reach (so open fields stay empty), cut to the municipality. A cell takes its
 * building's area, so the areas follow the buildings and streets instead of straight lines between
 * stations. The borders drawn are the cell sides between buildings of different areas.
 */

import type { Building, StreetSegment } from "../data/types";
import { clipRingToHalfPlanes, type HalfPlane, type LocalProjection, pointInPolygon, segmentInsideRings, type XY } from "./localGeo";

/** How far a building's cell reaches at most (m). */
const CELL_REACH_M = 70;
const CELL_SIDES = 16;
/** A building with no street of its own joins the nearest one this close (m). */
const STREET_REACH_M = 150;

interface Edge {
  to: number;
  w: number;
}

interface SegmentShape {
  /** The line in local metres, its cumulative length at each vertex, and its total length. */
  xy: XY[];
  cum: number[];
  length: number;
  /** The junctions along it, evenly spaced along its length. */
  nodes: number[];
}

function shapeOf(segment: StreetSegment, nodes: number[], projection: LocalProjection): SegmentShape {
  const xy = segment.line.map(([lon, lat]) => projection.toXY(lon, lat));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  return { xy, cum, length: cum[cum.length - 1], nodes };
}

/** The point on a line closest to `p`: how far along it, and how far off it. */
function project(p: XY, shape: SegmentShape): { along: number; off: number } {
  let best = { along: 0, off: Infinity };
  for (let i = 1; i < shape.xy.length; i++) {
    const [ax, ay] = shape.xy[i - 1];
    const [bx, by] = shape.xy[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    const off = Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]);
    if (off < best.off) best = { along: shape.cum[i - 1] + t * Math.sqrt(len2), off };
  }
  return best;
}

/** A small binary heap of [distance, node]. */
class Heap {
  private items: [number, number][] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: [number, number]): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent][0] <= a[i][0]) break;
      [a[parent], a[i]] = [a[i], a[parent]];
      i = parent;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop() as [number, number];
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** The road network, and every junction's nearest station by road. */
export class RoadAssignment {
  private shapes = new Map<number, SegmentShape>();
  private dist = new Map<number, number>();
  private label = new Map<number, number>();
  private stations: XY[] = [];
  private readonly projection: LocalProjection;

  /** `stations` in local metres; each is moved onto the nearest street (see stationPositions). */
  constructor(segments: StreetSegment[], nodesOf: (id: number) => number[], projection: LocalProjection, stations: XY[]) {
    this.projection = projection;
    const adjacency = new Map<number, Edge[]>();
    const link = (a: number, b: number, w: number) => {
      if (a === b) return;
      (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push({ to: b, w });
      (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push({ to: a, w });
    };
    for (const s of segments) {
      if (s.highway === "path") continue; // cables follow roads, not footpaths
      const shape = shapeOf(s, nodesOf(s.id), projection);
      if (shape.nodes.length < 2 || shape.length <= 0) continue;
      this.shapes.set(s.id, shape);
      const step = shape.length / (shape.nodes.length - 1);
      for (let i = 1; i < shape.nodes.length; i++) link(shape.nodes[i - 1], shape.nodes[i], step);
    }

    // Each station onto its nearest junction, then outward along the roads from all of them at once.
    const heap = new Heap();
    this.stations = stations.map((p, index) => {
      const snapped = this.nearestJunction(p);
      if (!snapped) return p;
      if ((this.dist.get(snapped.node) ?? Infinity) > 0) {
        this.dist.set(snapped.node, 0);
        this.label.set(snapped.node, index);
        heap.push([0, snapped.node]);
      }
      return snapped.xy;
    });
    while (heap.size > 0) {
      const [d, node] = heap.pop();
      if (d > (this.dist.get(node) ?? Infinity)) continue;
      const own = this.label.get(node) as number;
      for (const e of adjacency.get(node) ?? []) {
        const nd = d + e.w;
        if (nd < (this.dist.get(e.to) ?? Infinity)) {
          this.dist.set(e.to, nd);
          this.label.set(e.to, own);
          heap.push([nd, e.to]);
        }
      }
    }
  }

  /** Where each station stands, on the street (local metres). */
  stationPositions(): XY[] {
    return this.stations;
  }

  /** The station serving a building: nearest by road through its streets, else as the crow flies. */
  stationFor(b: Building): number {
    return this.stationAt(b.lon, b.lat, b.streetSegments ?? []);
  }

  /** The station serving a point (a charger on the street): through the given street segments, or
   * the nearest street. */
  stationAt(lon: number, lat: number, streetSegments: number[] = []): number {
    const p = this.projection.toXY(lon, lat);
    let segments = streetSegments.filter((id) => this.shapes.has(id));
    if (segments.length === 0) {
      const nearest = this.nearestSegment(p);
      segments = nearest && nearest.off <= STREET_REACH_M ? [nearest.id] : [];
    }
    let best = { cost: Infinity, station: -1 };
    for (const id of segments) {
      const shape = this.shapes.get(id) as SegmentShape;
      const { along, off } = project(p, shape);
      const step = shape.length / (shape.nodes.length - 1);
      const i = Math.min(shape.nodes.length - 2, Math.floor(along / step));
      for (const [node, by] of [
        [shape.nodes[i], along - i * step],
        [shape.nodes[i + 1], (i + 1) * step - along],
      ] as [number, number][]) {
        const cost = (this.dist.get(node) ?? Infinity) + by + off;
        if (cost < best.cost) best = { cost, station: this.label.get(node) as number };
      }
    }
    if (best.station >= 0) return best.station;
    let nearest = 0;
    let nearestD = Infinity;
    this.stations.forEach((s, j) => {
      const d = (s[0] - p[0]) ** 2 + (s[1] - p[1]) ** 2;
      if (d < nearestD) {
        nearestD = d;
        nearest = j;
      }
    });
    return nearest;
  }

  private nearestSegment(p: XY): { id: number; off: number } | null {
    let best: { id: number; off: number } | null = null;
    for (const [id, shape] of this.shapes) {
      const { off } = project(p, shape);
      if (!best || off < best.off) best = { id, off };
    }
    return best;
  }

  private nearestJunction(p: XY): { node: number; xy: XY } | null {
    const nearest = this.nearestSegment(p);
    if (!nearest) return null;
    const shape = this.shapes.get(nearest.id) as SegmentShape;
    const { along } = project(p, shape);
    const step = shape.length / (shape.nodes.length - 1);
    const i = Math.max(0, Math.min(shape.nodes.length - 1, Math.round(along / step)));
    return { node: shape.nodes[i], xy: pointAlong(shape, i * step) };
  }
}

function pointAlong(shape: SegmentShape, along: number): XY {
  for (let i = 1; i < shape.xy.length; i++) {
    if (along <= shape.cum[i] || i === shape.xy.length - 1) {
      const span = shape.cum[i] - shape.cum[i - 1];
      const t = span > 0 ? Math.max(0, Math.min(1, (along - shape.cum[i - 1]) / span)) : 0;
      return [shape.xy[i - 1][0] + t * (shape.xy[i][0] - shape.xy[i - 1][0]), shape.xy[i - 1][1] + t * (shape.xy[i][1] - shape.xy[i - 1][1])];
    }
  }
  return shape.xy[0];
}

// --- the map's cells ---

/** A cell corner, and what made the side that starts at it: a neighbouring building's index, or -1
 * for the cell's reach. */
interface Corner {
  p: XY;
  side: number;
}

/** Clips a convex cell to the side of a line nearer its own building, keeping track of each side's origin. */
function clipCell(cell: Corner[], f: (p: XY) => number, side: number): Corner[] {
  const out: Corner[] = [];
  for (let k = 0; k < cell.length; k++) {
    const cur = cell[k];
    const next = cell[(k + 1) % cell.length];
    const fc = f(cur.p);
    const fn = f(next.p);
    const at = (): XY => {
      const t = fc / (fc - fn);
      return [cur.p[0] + t * (next.p[0] - cur.p[0]), cur.p[1] + t * (next.p[1] - cur.p[1])];
    };
    if (fc <= 0) {
      out.push(cur);
      if (fn > 0) out.push({ p: at(), side });
    } else if (fn <= 0) {
      out.push({ p: at(), side: cur.side });
    }
  }
  return out;
}

export interface AreaZone {
  fill: [number, number][][][];
  edges: [number, number][][];
}

/** Each area's zone for the map: its buildings' cells, cut to the municipality (`boundary`: parts,
 * then rings, in local metres, rings open), and the borders with other areas and the open land. */
export function buildingCellZones(
  points: { x: number; y: number; area: number }[],
  areaCount: number,
  boundary: XY[][][] | null,
  toLonLat: (p: XY) => [number, number],
): AreaZone[] {
  const zones: AreaZone[] = Array.from({ length: areaCount }, () => ({ fill: [], edges: [] }));
  const reach = CELL_REACH_M;
  const bucket = 2 * reach;
  const grid = new Map<string, number[]>();
  const keyOf = (x: number, y: number) => `${Math.floor(x / bucket)}:${Math.floor(y / bucket)}`;
  points.forEach((p, i) => {
    const key = keyOf(p.x, p.y);
    (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
  });
  const allRings = boundary?.flat() ?? [];
  const insideTown = (p: XY) => !boundary || boundary.some((rings) => pointInPolygon(p, rings));
  const close = (ring: XY[]) => [...ring, ring[0]].map(toLonLat);

  points.forEach((a, i) => {
    let cell: Corner[] = Array.from({ length: CELL_SIDES }, (_, k) => {
      const angle = (2 * Math.PI * k) / CELL_SIDES;
      return { p: [a.x + reach * Math.cos(angle), a.y + reach * Math.sin(angle)] as XY, side: -1 };
    });
    const planes: HalfPlane[] = [];
    const bx = Math.floor(a.x / bucket);
    const by = Math.floor(a.y / bucket);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of grid.get(`${bx + dx}:${by + dy}`) ?? []) {
          if (j === i) continue;
          const o = points[j];
          const nx = o.x - a.x;
          const ny = o.y - a.y;
          if (nx * nx + ny * ny > 4 * reach * reach || (nx === 0 && ny === 0)) continue;
          const mx = (a.x + o.x) / 2;
          const my = (a.y + o.y) / 2;
          const f: HalfPlane = (p) => (p[0] - mx) * nx + (p[1] - my) * ny;
          cell = clipCell(cell, f, j);
          planes.push(f);
          if (cell.length < 3) break;
        }
      }
    }
    if (cell.length < 3) return;
    const zone = zones[a.area];
    if (!zone) return;

    // The fill: the cell, or where it runs over the town's edge, the town cut to it.
    const ring = cell.map((c) => c.p);
    if (!boundary || ring.every(insideTown)) {
      zone.fill.push([close(ring)]);
    } else {
      // The reach as half-planes too, so the town is cut to the whole cell.
      for (let k = 0; k < CELL_SIDES; k++) {
        const angle = (2 * Math.PI * (k + 0.5)) / CELL_SIDES;
        const ux = Math.cos(angle);
        const uy = Math.sin(angle);
        const lim = reach * Math.cos(Math.PI / CELL_SIDES);
        planes.push((p) => (p[0] - a.x) * ux + (p[1] - a.y) * uy - lim);
      }
      for (const rings of boundary) {
        const outer = clipRingToHalfPlanes(rings[0], planes);
        if (outer.length < 3) continue;
        const holes = rings.slice(1).map((r) => clipRingToHalfPlanes(r, planes)).filter((r) => r.length >= 3);
        zone.fill.push([outer, ...holes].map(close));
      }
    }

    // The borders: sides shared with another area's building (drawn once, for both areas), and the
    // cell's reach (the edge of the built-up land) — inside the town only.
    for (let k = 0; k < cell.length; k++) {
      const { p, side } = cell[k];
      const q = cell[(k + 1) % cell.length].p;
      const other = side >= 0 ? points[side].area : -1;
      if (side >= 0 && (other === a.area || side < i)) continue;
      const pieces: [number, number][] = boundary ? segmentInsideRings(p, q, allRings) : [[0, 1]];
      for (const [t0, t1] of pieces) {
        const line = [
          toLonLat([p[0] + t0 * (q[0] - p[0]), p[1] + t0 * (q[1] - p[1])]),
          toLonLat([p[0] + t1 * (q[0] - p[0]), p[1] + t1 * (q[1] - p[1])]),
        ];
        zone.edges.push(line);
        if (other >= 0 && zones[other]) zones[other].edges.push(line);
      }
    }
  });
  return zones;
}
