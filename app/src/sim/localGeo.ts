/**
 * Planar geometry in local meters, for stock.ts's building placement and adjacency
 * checks. WGS84 (lon, lat) is projected with the same flat equirectangular
 * approximation geo.ts already documents, anchored at one reference point for the
 * whole municipality (so distances between any two buildings stay consistent).
 */

export type XY = [number, number];

const METERS_PER_DEG_LAT = 111_320;

export class LocalProjection {
  private readonly mPerLon: number;
  private readonly lon0: number;
  private readonly lat0: number;
  constructor(lon0: number, lat0: number) {
    this.lon0 = lon0;
    this.lat0 = lat0;
    this.mPerLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  }
  toXY(lon: number, lat: number): XY {
    return [(lon - this.lon0) * this.mPerLon, (lat - this.lat0) * METERS_PER_DEG_LAT];
  }
  toLonLat(x: number, y: number): [number, number] {
    return [this.lon0 + x / this.mPerLon, this.lat0 + y / METERS_PER_DEG_LAT];
  }
}

export function ringArea(ring: XY[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function ringCentroid(ring: XY[]): XY {
  let x = 0;
  let y = 0;
  for (const p of ring) {
    x += p[0];
    y += p[1];
  }
  return [x / ring.length, y / ring.length];
}

export function pointInRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Exterior ring first, then holes. */
export function pointInPolygon(p: XY, rings: XY[][]): boolean {
  if (!pointInRing(p, rings[0])) return false;
  for (let i = 1; i < rings.length; i++) if (pointInRing(p, rings[i])) return false;
  return true;
}

function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Minimum distance between two footprints' outlines, 0 when they touch or overlap.
 * Vertex-to-edge in both directions — exact for non-crossing polygons, which is
 * all building footprints are. */
export function ringGap(a: XY[], b: XY[]): number {
  let min = Infinity;
  for (const p of a) {
    for (let i = 0; i < b.length; i++) min = Math.min(min, pointSegmentDistance(p, b[i], b[(i + 1) % b.length]));
  }
  for (const p of b) {
    for (let i = 0; i < a.length; i++) min = Math.min(min, pointSegmentDistance(p, a[i], a[(i + 1) % a.length]));
  }
  return min;
}

export interface OrientedRect {
  cx: number;
  cy: number;
  /** Half-extent along the direction `angleRad`. */
  halfLong: number;
  halfShort: number;
  angleRad: number;
}

export function rectCorners(r: OrientedRect): XY[] {
  const ux = Math.cos(r.angleRad);
  const uy = Math.sin(r.angleRad);
  const vx = -uy;
  const vy = ux;
  return [
    [r.cx + ux * r.halfLong + vx * r.halfShort, r.cy + uy * r.halfLong + vy * r.halfShort],
    [r.cx - ux * r.halfLong + vx * r.halfShort, r.cy - uy * r.halfLong + vy * r.halfShort],
    [r.cx - ux * r.halfLong - vx * r.halfShort, r.cy - uy * r.halfLong - vy * r.halfShort],
    [r.cx + ux * r.halfLong - vx * r.halfShort, r.cy + uy * r.halfLong - vy * r.halfShort],
  ];
}

/** Separating-axis overlap test for two oriented rectangles, each grown by `margin`. */
export function rectsOverlap(a: OrientedRect, b: OrientedRect, margin: number): boolean {
  const grow = (r: OrientedRect): OrientedRect => ({ ...r, halfLong: r.halfLong + margin, halfShort: r.halfShort + margin });
  const ca = rectCorners(grow(a));
  const cb = rectCorners(grow(b));
  for (const angle of [a.angleRad, a.angleRad + Math.PI / 2, b.angleRad, b.angleRad + Math.PI / 2]) {
    const ax = Math.cos(angle);
    const ay = Math.sin(angle);
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const [x, y] of ca) {
      const d = x * ax + y * ay;
      minA = Math.min(minA, d);
      maxA = Math.max(maxA, d);
    }
    for (const [x, y] of cb) {
      const d = x * ax + y * ay;
      minB = Math.min(minB, d);
      maxB = Math.max(maxB, d);
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

/** Long and short side of the smallest-area rectangle (tried at 5-degree steps)
 * enclosing a footprint — a building's own proportions, whatever way it's turned. */
export function boundingRectSides(ring: XY[]): { long: number; short: number } {
  let best = { area: Infinity, long: 0, short: 0 };
  for (let deg = 0; deg < 90; deg += 5) {
    const c = Math.cos((deg * Math.PI) / 180);
    const s = Math.sin((deg * Math.PI) / 180);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      minX = Math.min(minX, u);
      maxX = Math.max(maxX, u);
      minY = Math.min(minY, v);
      maxY = Math.max(maxY, v);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    if (w * h < best.area) best = { area: w * h, long: Math.max(w, h), short: Math.min(w, h) };
  }
  return { long: best.long, short: best.short };
}

/** Uniform-grid spatial hash over points — radius queries without the O(n^2) scan. */
export class PointGrid {
  private readonly cells = new Map<string, string[]>();
  private readonly positions = new Map<string, XY>();
  private readonly cellSize: number;
  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  private key(x: number, y: number): string {
    return `${Math.floor(x / this.cellSize)},${Math.floor(y / this.cellSize)}`;
  }

  insert(id: string, x: number, y: number): void {
    const k = this.key(x, y);
    const cell = this.cells.get(k);
    if (cell) cell.push(id);
    else this.cells.set(k, [id]);
    this.positions.set(id, [x, y]);
  }

  /** Ids within `radius` of (x, y), nearest first. */
  query(x: number, y: number, radius: number): string[] {
    const found: { id: string; d: number }[] = [];
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    for (let i = cx - r; i <= cx + r; i++) {
      for (let j = cy - r; j <= cy + r; j++) {
        for (const id of this.cells.get(`${i},${j}`) ?? []) {
          const [px, py] = this.positions.get(id) as XY;
          const d = Math.hypot(px - x, py - y);
          if (d <= radius) found.push({ id, d });
        }
      }
    }
    return found.sort((a, b) => a.d - b.d).map((f) => f.id);
  }
}

/** Binary min-heap keyed by a number — stock.ts's event queue. */
export class MinHeap<T> {
  private readonly items: { key: number; value: T }[] = [];
  get size(): number {
    return this.items.length;
  }
  peekKey(): number {
    return this.items.length ? this.items[0].key : Infinity;
  }
  push(key: number, value: T): void {
    const items = this.items;
    items.push({ key, value });
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].key <= items[i].key) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop(): { key: number; value: T } | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as { key: number; value: T };
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < items.length && items[l].key < items[smallest].key) smallest = l;
        if (r < items.length && items[r].key < items[smallest].key) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}
