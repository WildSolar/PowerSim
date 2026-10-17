/**
 * Distances along the streets (streets.ts), for how far a household has to go to a public charger
 * (publicCharging.ts): on foot ("walk": every street and footpath — from an on-street charger, where
 * the car stays overnight, back home) or by car ("drive": no footpaths — to a fast-charging hub, a
 * shop's car park, a lorry park).
 *
 * The network is a graph of its junctions. A place joins it where it meets a street: a building at
 * the streets it fronts on (Building.streetSegments, else the nearest), a charger at the nearest
 * street; from there along the street to its junctions. A shortest-path search from each charger,
 * as far as anyone would go to it, gives every junction's distance, and a building's distance is
 * the best over the streets it fronts on.
 *
 * Where the street data leaves a gap between a building and a charger (they lie on two pieces of
 * the network that never meet), or a place lies far from any street, the distance is the straight
 * line with a detour allowance instead.
 */

import type { Building } from "../data/types";
import { streets } from "./streets";

export type TravelMode = "walk" | "drive";

type XY = [number, number];

/** Where the straight line stands in for the streets: this much longer than the crow flies. */
const FALLBACK_DETOUR = 1.4;
/** A place further than this from every street of its mode doesn't join the network. */
const ATTACH_MAX_M = 250;

/** Where a place meets a street: the segment, how far along its line, and how far off it. */
interface Attachment {
  seg: number;
  t: number;
  off: number;
}

interface Graph {
  /** Per segment: the junctions along it, with their distance along its line (empty if this mode
   * doesn't use the segment). */
  segNodes: { node: number; t: number }[][];
  usable: boolean[];
  adj: Map<number, { to: number; len: number }[]>;
  /** Which connected piece of the network each junction is on. */
  piece: Map<number, number>;
}

/** The point on a polyline closest to `p`: how far along it, and how far off it. */
function projectOnto(line: XY[], p: XY): { t: number; off: number } {
  let best = { t: 0, off: Infinity };
  let run = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy);
    const u = len > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (len * len))) : 0;
    const off = Math.hypot(ax + u * dx - p[0], ay + u * dy - p[1]);
    if (off < best.off) best = { t: run + u * len, off };
    run += len;
  }
  return best.off === Infinity ? { t: 0, off: Infinity } : best;
}

function lineLength(line: XY[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  return total;
}

/** A binary min-heap of [distance, node]. */
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
    const last = a.pop()!;
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

class StreetDistance {
  private builtFor: unknown = null;
  private graphs = new Map<TravelMode, Graph>();
  private buildingAttachments = new Map<TravelMode, WeakMap<Building, Attachment[]>>();

  /** The graph for a mode, (re)built whenever streets.ts has loaded another network. */
  private graph(mode: TravelMode): Graph {
    const segments = streets.all();
    if (this.builtFor !== segments) {
      this.builtFor = segments;
      this.graphs = new Map();
      this.buildingAttachments = new Map();
    }
    let g = this.graphs.get(mode);
    if (!g) {
      g = this.build(mode);
      this.graphs.set(mode, g);
    }
    return g;
  }

  private build(mode: TravelMode): Graph {
    const segments = streets.all();
    const nodeXY = new Map<number, XY>();
    for (const s of segments) {
      const line = streets.lineXY(s.id);
      if (line.length === 0) continue;
      nodeXY.set(s.a, line[0]);
      nodeXY.set(s.b, line[line.length - 1]);
    }
    const segNodes: Graph["segNodes"] = [];
    const usable: boolean[] = [];
    const adj: Graph["adj"] = new Map();
    const link = (from: number, to: number, len: number) => {
      const list = adj.get(from) ?? [];
      list.push({ to, len });
      adj.set(from, list);
    };
    for (const s of segments) {
      const ok = mode === "walk" || s.highway !== "path";
      usable[s.id] = ok;
      const line = streets.lineXY(s.id);
      if (!ok || line.length < 2) {
        segNodes[s.id] = [];
        continue;
      }
      const total = lineLength(line);
      const ids = streets.nodesOf(s.id);
      const along: { node: number; t: number }[] = [];
      ids.forEach((node, i) => {
        if (i === 0) along.push({ node, t: 0 });
        else if (i === ids.length - 1) along.push({ node, t: total });
        else {
          // A junction inside a merged stretch: where another street meets it.
          const xy = nodeXY.get(node);
          if (xy) along.push({ node, t: projectOnto(line, xy).t });
        }
      });
      along.sort((p, q) => p.t - q.t);
      segNodes[s.id] = along;
      for (let i = 1; i < along.length; i++) {
        const len = along[i].t - along[i - 1].t;
        link(along[i - 1].node, along[i].node, len);
        link(along[i].node, along[i - 1].node, len);
      }
    }
    // The connected pieces, by a flood over the links.
    const piece = new Map<number, number>();
    let next = 0;
    for (const start of adj.keys()) {
      if (piece.has(start)) continue;
      const id = next++;
      const stack = [start];
      piece.set(start, id);
      while (stack.length > 0) {
        const n = stack.pop()!;
        for (const e of adj.get(n) ?? []) {
          if (piece.has(e.to)) continue;
          piece.set(e.to, id);
          stack.push(e.to);
        }
      }
    }
    return { segNodes, usable, adj, piece };
  }

  /** The nearest street of this mode to a point, within ATTACH_MAX_M. */
  private nearest(g: Graph, p: XY): Attachment | null {
    let best: Attachment | null = null;
    for (const s of streets.all()) {
      if (!g.usable[s.id]) continue;
      const { t, off } = projectOnto(streets.lineXY(s.id), p);
      if (off <= ATTACH_MAX_M && (!best || off < best.off)) best = { seg: s.id, t, off };
    }
    return best;
  }

  /** Where a point (a charger) joins the network: the nearest street of the mode. */
  attachPoint(lon: number, lat: number, mode: TravelMode): Attachment | null {
    return this.nearest(this.graph(mode), streets.toXY(lon, lat));
  }

  /** Where a building joins the network: every street of the mode it fronts on, else the nearest. */
  private attachBuilding(b: Building, mode: TravelMode): Attachment[] {
    const g = this.graph(mode);
    let cache = this.buildingAttachments.get(mode);
    if (!cache) {
      cache = new WeakMap();
      this.buildingAttachments.set(mode, cache);
    }
    let list = cache.get(b);
    if (list) return list;
    const p = streets.toXY(b.lon, b.lat);
    list = (b.streetSegments ?? []).filter((id) => g.usable[id]).map((seg) => ({ seg, ...projectOnto(streets.lineXY(seg), p) }));
    if (list.length === 0) {
      const near = this.nearest(g, p);
      if (near) list = [near];
    }
    cache.set(b, list);
    return list;
  }

  /** Every junction within `cutoffM` of a set of places along the streets, by its distance to the
   * nearest of them. */
  field(from: Attachment[], mode: TravelMode, cutoffM: number): Map<number, number> {
    const g = this.graph(mode);
    const dist = new Map<number, number>();
    const heap = new Heap();
    for (const a of from) {
      for (const { node, t } of g.segNodes[a.seg] ?? []) {
        const d = a.off + Math.abs(a.t - t);
        if (d <= cutoffM && d < (dist.get(node) ?? Infinity)) {
          dist.set(node, d);
          heap.push([d, node]);
        }
      }
    }
    while (heap.size > 0) {
      const [d, n] = heap.pop();
      if (d > (dist.get(n) ?? Infinity)) continue;
      for (const e of g.adj.get(n) ?? []) {
        const nd = d + e.len;
        if (nd > cutoffM || nd >= (dist.get(e.to) ?? Infinity)) continue;
        dist.set(e.to, nd);
        heap.push([nd, e.to]);
      }
    }
    return dist;
  }

  /** How far a building is from a place along the streets (m): `place` and `field` are the place's
   * attachment and its field (field()); Infinity when it's further than the field reaches. Falls
   * back to the straight line (with a detour allowance) where either isn't on the network or the
   * two lie on pieces of it that never meet. */
  buildingDistance(b: Building, mode: TravelMode, place: Attachment | null, field: Map<number, number>, placeLonLat: [number, number]): number {
    const crow = () => {
      const [x1, y1] = streets.toXY(b.lon, b.lat);
      const [x2, y2] = streets.toXY(placeLonLat[0], placeLonLat[1]);
      return Math.hypot(x1 - x2, y1 - y2) * FALLBACK_DETOUR;
    };
    const own = this.attachBuilding(b, mode);
    if (!place || own.length === 0) return crow();
    const g = this.graph(mode);
    let best = Infinity;
    for (const a of own) {
      if (a.seg === place.seg) best = Math.min(best, a.off + Math.abs(a.t - place.t) + place.off);
      for (const { node, t } of g.segNodes[a.seg] ?? []) {
        const d = field.get(node);
        if (d !== undefined) best = Math.min(best, a.off + Math.abs(a.t - t) + d);
      }
    }
    if (best < Infinity) return best;
    // Out of the field's reach: far along the streets — unless the network has a gap between them.
    const pieceOf = (seg: number) => g.piece.get(g.segNodes[seg]?.[0]?.node ?? -1);
    const placePiece = pieceOf(place.seg);
    return own.some((a) => pieceOf(a.seg) === placePiece) ? Infinity : crow();
  }

  /** Street pieces of at most `stepM`, each with its distance from a field's places (the nearest
   * along the streets): for drawing how far something reaches. Only pieces within `cutoffM`. */
  pieces(field: Map<number, number>, from: Attachment[], mode: TravelMode, cutoffM: number, stepM = 40): { line: [number, number][]; distanceM: number }[] {
    const g = this.graph(mode);
    const out: { line: [number, number][]; distanceM: number }[] = [];
    const touched = new Set<number>();
    for (const s of streets.all()) {
      const nodes = g.segNodes[s.id];
      if (!nodes || nodes.length === 0) continue;
      if (nodes.some((n) => field.has(n.node)) || from.some((a) => a.seg === s.id)) touched.add(s.id);
    }
    for (const id of touched) {
      const line = streets.lineXY(id);
      const nodes = g.segNodes[id];
      const own = from.filter((a) => a.seg === id);
      const at = (t: number) => {
        let d = Infinity;
        for (const n of nodes) {
          const nd = field.get(n.node);
          if (nd !== undefined) d = Math.min(d, nd + Math.abs(n.t - t));
        }
        for (const a of own) d = Math.min(d, a.off + Math.abs(a.t - t));
        return d;
      };
      // Walk the line, cutting it every stepM.
      let run = 0;
      let piece: XY[] = [line[0]];
      let pieceStart = 0;
      const flush = (end: number) => {
        const d = at((pieceStart + end) / 2);
        if (d <= cutoffM && piece.length >= 2) out.push({ line: piece.map(([x, y]) => streets.toLonLat(x, y)), distanceM: d });
      };
      for (let i = 1; i < line.length; i++) {
        let [ax, ay] = line[i - 1];
        const [bx, by] = line[i];
        let len = Math.hypot(bx - ax, by - ay);
        while (run + len - pieceStart > stepM) {
          const cut = pieceStart + stepM - run; // along this piece of line
          const u = cut / len;
          const cx = ax + (bx - ax) * u;
          const cy = ay + (by - ay) * u;
          piece.push([cx, cy]);
          flush(pieceStart + stepM);
          pieceStart += stepM;
          piece = [[cx, cy]];
          run += cut;
          len -= cut;
          ax = cx;
          ay = cy;
        }
        piece.push([bx, by]);
        run += len;
      }
      flush(run);
    }
    return out;
  }
}

export const streetDistance = new StreetDistance();
export type { Attachment as StreetAttachment };
