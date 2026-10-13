/**
 * The area within a distance of some polygons, inside others — as one clean shape, for the map. Drawn
 * straight from the source polygons, overlapping pieces and their bands pile up into blotches; here
 * the area is worked out on a fine grid (a distance field), and its outline traced (marching squares)
 * into polygons with holes, once.
 *
 * Used for where a river or lake heat pump may stand: within its distance of the water, inside the
 * municipality.
 */

import { pointInPolygon, type XY } from "./localGeo";

function segmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2)) : 0;
  return Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]);
}

interface Grid {
  x0: number;
  y0: number;
  h: number;
  nx: number;
  ny: number;
}

/** Marks the grid points inside any of the polygons (each a list of rings, even-odd within it). */
function insideMask(g: Grid, polygons: XY[][][]): Uint8Array {
  const mask = new Uint8Array(g.nx * g.ny);
  for (const rings of polygons) {
    for (let j = 0; j < g.ny; j++) {
      const y = g.y0 + j * g.h;
      const xs: number[] = [];
      for (const ring of rings) {
        for (let k = 0; k < ring.length; k++) {
          const a = ring[k];
          const b = ring[(k + 1) % ring.length];
          if (a[1] <= y !== b[1] <= y) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const from = Math.max(0, Math.ceil((xs[k] - g.x0) / g.h));
        const to = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.h));
        for (let i = from; i <= to; i++) mask[j * g.nx + i] = 1;
      }
    }
  }
  return mask;
}

/** Distance from each grid point to the polygons' outlines, where it is under `reach` (else Infinity). */
function edgeDistance(g: Grid, polygons: XY[][][], reach: number): Float64Array {
  const dist = new Float64Array(g.nx * g.ny).fill(Infinity);
  for (const rings of polygons)
    for (const ring of rings)
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        const i0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - reach - g.x0) / g.h));
        const i1 = Math.min(g.nx - 1, Math.ceil((Math.max(a[0], b[0]) + reach - g.x0) / g.h));
        const j0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - reach - g.y0) / g.h));
        const j1 = Math.min(g.ny - 1, Math.ceil((Math.max(a[1], b[1]) + reach - g.y0) / g.h));
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const d = segmentDistance([g.x0 + i * g.h, g.y0 + j * g.h], a, b);
            if (d < dist[j * g.nx + i]) dist[j * g.nx + i] = d;
          }
      }
  return dist;
}

function signedArea(ring: XY[]): number {
  let s = 0;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k];
    const b = ring[(k + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Traces where `field` < 0 into polygons (outer ring counter-clockwise, holes clockwise). The
 * grid's border must be outside (positive). */
function trace(g: Grid, field: Float64Array): XY[][][] {
  const v = (i: number, j: number) => field[j * g.nx + i];
  const at = (i: number, j: number): XY => [g.x0 + i * g.h, g.y0 + j * g.h];
  const cross = (pa: XY, va: number, pb: XY, vb: number): XY => {
    const t = va / (va - vb);
    return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])];
  };
  // Each piece of outline runs with the inside on its left, from one cell edge to another; the
  // edges are named so neighbouring cells share them.
  const next = new Map<string, { to: string; from: XY }>();
  for (let j = 0; j < g.ny - 1; j++)
    for (let i = 0; i < g.nx - 1; i++) {
      // The cell's corners counter-clockwise from bottom left, and its sides between them.
      const corners: [number, number][] = [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ];
      const values = corners.map(([a, b]) => v(a, b));
      const inside = values.map((x) => x < 0);
      if (inside.every((x) => x) || inside.every((x) => !x)) continue;
      const sideKey = [`h${i},${j}`, `v${i + 1},${j}`, `h${i},${j + 1}`, `v${i},${j}`];
      // Crossings going round the cell: leaving the inside (a start) or entering it (an end).
      const crossings: { side: number; leaving: boolean }[] = [];
      for (let s = 0; s < 4; s++) {
        const a = s;
        const b = (s + 1) % 4;
        if (inside[a] !== inside[b]) crossings.push({ side: s, leaving: inside[a] });
      }
      const centreInside = (values[0] + values[1] + values[2] + values[3]) / 4 < 0;
      const point = (s: number): XY => {
        const a = s;
        const b = (s + 1) % 4;
        return cross(at(...corners[a]), values[a], at(...corners[b]), values[b]);
      };
      for (let k = 0; k < crossings.length; k++) {
        if (!crossings[k].leaving) continue;
        // A saddle joins the insides through the middle, or keeps them apart.
        const step = centreInside ? 1 : -1;
        let m = k;
        do m = (m + step + crossings.length) % crossings.length;
        while (crossings[m].leaving);
        next.set(sideKey[crossings[k].side], { to: sideKey[crossings[m].side], from: point(crossings[k].side) });
      }
    }
  // Chain the pieces into rings.
  const rings: XY[][] = [];
  const done = new Set<string>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const ring: XY[] = [];
    let key = start;
    while (!done.has(key)) {
      done.add(key);
      const piece = next.get(key);
      if (!piece) break;
      ring.push(piece.from);
      key = piece.to;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  // Outer rings run counter-clockwise; each hole goes into the smallest outer ring around it. Specks
  // of a cell or two (where an outline grazes the grid) are dropped.
  const speck = 3 * g.h * g.h;
  const outers = rings.filter((r) => signedArea(r) > speck).map((r) => ({ ring: r, area: signedArea(r), holes: [] as XY[][] }));
  for (const hole of rings.filter((r) => signedArea(r) < -speck)) {
    const host = outers.filter((o) => pointInPolygon(hole[0], [o.ring])).sort((a, b) => a.area - b.area)[0];
    host?.holes.push(hole);
  }
  return outers.map((o) => [o.ring, ...o.holes]);
}

/** The area within `reachM` of `polygons` (or in them), and inside `within` if given: polygons of
 * rings (outer first), closed. */
export function areaWithin(polygons: XY[][][], reachM: number, within: XY[][][] | null, cellM = 8): XY[][][] {
  const points = polygons.flat(2);
  if (points.length === 0) return [];
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  // A big lake gets coarser cells: about 200,000 at most.
  cellM = Math.max(cellM, Math.sqrt(((Math.max(...xs) - Math.min(...xs) + 2 * reachM) * (Math.max(...ys) - Math.min(...ys) + 2 * reachM)) / 200_000));
  const pad = reachM + 3 * cellM;
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const x1 = Math.max(...xs) + pad;
  const y1 = Math.max(...ys) + pad;
  const g: Grid = { x0, y0, h: cellM, nx: Math.ceil((x1 - x0) / cellM) + 1, ny: Math.ceil((y1 - y0) / cellM) + 1 };

  // Distance to the polygons (zero inside them), less the reach: below zero within reach.
  const inPolygons = insideMask(g, polygons);
  const toPolygons = edgeDistance(g, polygons, reachM + 2 * cellM);
  const field = new Float64Array(g.nx * g.ny);
  for (let k = 0; k < field.length; k++) field[k] = (inPolygons[k] ? 0 : Math.min(toPolygons[k], reachM + 2 * cellM)) - reachM;

  // ...and inside `within`: the larger of the two, with the distance to its outline signed.
  if (within && within.length > 0) {
    const inWithin = insideMask(g, within);
    const toWithin = edgeDistance(g, within, 3 * cellM);
    for (let k = 0; k < field.length; k++) {
      const d = Math.min(toWithin[k], 3 * cellM);
      field[k] = Math.max(field[k], inWithin[k] ? -d : d);
    }
  }
  // The grid's border is outside, so every outline closes.
  for (let i = 0; i < g.nx; i++) {
    field[i] = Math.max(field[i], 1);
    field[(g.ny - 1) * g.nx + i] = Math.max(field[(g.ny - 1) * g.nx + i], 1);
  }
  for (let j = 0; j < g.ny; j++) {
    field[j * g.nx] = Math.max(field[j * g.nx], 1);
    field[j * g.nx + g.nx - 1] = Math.max(field[j * g.nx + g.nx - 1], 1);
  }
  return trace(g, field);
}
