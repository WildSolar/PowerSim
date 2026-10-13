/**
 * Planning a direct line: a district heating pipe laid from one street junction to another, off the
 * streets — to bring a plant's heat across town the short way, or to join two networks without going
 * round by the streets. The player draws its course: it starts at the junction nearest the first
 * click, bends at every click after, and ends at the junction nearest the last one — so it can skirt
 * the built-up areas through cheaper ground. It carries heat; nobody connects along it (districtHeat.ts
 * keeps the lines and joins the networks at their ends).
 *
 * Its price depends on what it crosses (config/districtHeat.ts): cheap through fields, about a
 * street's price through gardens and yards in the building zone, dear across a road, under a house or
 * across a river or lake. The course is read off the map every couple of metres: the water, the
 * buildings standing then, the streets with their widths, and the building zones.
 */

import { DH_LINE_COST_FACTOR, DH_LINE_SNAP_M, DH_PIPE_COST_CHF_PER_M, type DhLineTerrain } from "../config/districtHeat";
import type { Building, MunicipalityDataset } from "../data/types";
import { priceFactor } from "./costTrends";
import { buildMonths, districtHeat } from "./districtHeat";
import { districtHeatSources } from "./districtHeatSources";
import { existsAt } from "./lifetime";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";
import { streets } from "./streets";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const SAMPLE_M = 2;

export interface LineEnd {
  node: number;
  lon: number;
  lat: number;
}

export interface LineDraft {
  /** Every click so far, [lon, lat]: the first and the last are the ends (taken to their junctions),
   * the ones between are bends. */
  points: [number, number][];
  /** The start: the junction nearest the first click. */
  a: LineEnd | null;
  /** The end: the junction nearest the last click, if there is one near enough (null while the
   * line has only its start, or the last click isn't near a junction). */
  b: LineEnd | null;
  /** The first click wasn't near a junction (so the line hasn't started). */
  missed: boolean;
}

export interface LineQuote {
  lengthM: number;
  /** Metres through each kind of ground. */
  byTerrain: Record<DhLineTerrain, number>;
  costRp: number;
  months: number;
  /** One of its ends is on the network (or on its way to it). */
  connected: boolean;
  /** What stops it being ordered, for the player. */
  problem: string | null;
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function boxOf(points: XY[]): Box {
  return {
    x0: Math.min(...points.map((p) => p[0])),
    y0: Math.min(...points.map((p) => p[1])),
    x1: Math.max(...points.map((p) => p[0])),
    y1: Math.max(...points.map((p) => p[1])),
  };
}

function overlaps(a: Box, b: Box, margin = 0): boolean {
  return a.x0 - margin <= b.x1 && b.x0 - margin <= a.x1 && a.y0 - margin <= b.y1 && b.y0 - margin <= a.y1;
}

function distanceToPolyline(p: XY, line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const dx = line[i][0] - ax;
    const dy = line[i][1] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]));
  }
  return best;
}

class DistrictHeatLines {
  private projection = new LocalProjection(8.4, 47.4);
  private buildingsProvider: () => Building[] = () => [];
  private water: { rings: XY[][]; box: Box }[] = [];
  private zones: { rings: XY[][]; box: Box }[] = [];
  private roads: { line: XY[]; halfWidth: number; box: Box }[] = [];
  private draft: LineDraft | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[]): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    const xy = (ring: [number, number][]): XY[] => ring.map(([lon, lat]) => this.projection.toXY(lon, lat));
    this.buildingsProvider = buildingsProvider;
    this.water = districtHeat.getWater().map((rings) => {
      const r = rings.map(xy);
      return { rings: r, box: boxOf(r[0]) };
    });
    this.zones = (dataset.zoneParcels ?? []).flatMap((p) =>
      p.rings.map((rings) => {
        const r = rings.map(xy);
        return { rings: r, box: boxOf(r[0]) };
      }),
    );
    this.roads = streets.all().map((s) => {
      const line = xy(s.line);
      return { line, halfWidth: Math.max(2, s.widthM / 2), box: boxOf(line) };
    });
    this.draft = null;
    this.notify();
  }

  // --- the draft ---

  getDraft(): LineDraft | null {
    return this.draft;
  }

  start(): void {
    this.draft = { points: [], a: null, b: null, missed: false };
    districtHeat.clearSelection();
    districtHeatSources.cancelDraft();
    this.notify();
  }

  cancel(): void {
    if (!this.draft) return;
    this.draft = null;
    this.notify();
  }

  /** A click on the map while drawing: the first starts the line (at the junction nearest it),
   * every later one adds a point to its course — the last of them is where it ends, at the junction
   * nearest it. */
  click(lon: number, lat: number): void {
    if (!this.draft) return;
    const points = [...this.draft.points, [lon, lat] as [number, number]];
    if (points.length === 1 && !this.junctionNear(lon, lat)) this.draft = { ...this.draft, missed: true };
    else this.draft = this.withPoints(points);
    this.notify();
  }

  /** Takes back the last click. */
  undo(): void {
    if (!this.draft || this.draft.points.length === 0) return;
    this.draft = this.withPoints(this.draft.points.slice(0, -1));
    this.notify();
  }

  private junctionNear(lon: number, lat: number): LineEnd | null {
    const j = streets.nearestJunction(lon, lat);
    return j && j.distanceM <= DH_LINE_SNAP_M ? { node: j.node, lon: j.lon, lat: j.lat } : null;
  }

  private withPoints(points: [number, number][]): LineDraft {
    const first = points[0];
    const last = points[points.length - 1];
    return {
      points,
      a: first ? this.junctionNear(first[0], first[1]) : null,
      b: points.length >= 2 ? this.junctionNear(last[0], last[1]) : null,
      missed: false,
    };
  }

  /** The line's course as drawn, [lon, lat]: from its start junction through the bends to its end
   * (the end junction, or the last click while it isn't near one). */
  course(): [number, number][] {
    const d = this.draft;
    if (!d?.a || d.points.length === 0) return [];
    const bends = d.points.slice(1, -1);
    const last = d.points[d.points.length - 1];
    const end: [number, number] = d.b ? [d.b.lon, d.b.lat] : last;
    return d.points.length === 1 ? [[d.a.lon, d.a.lat]] : [[d.a.lon, d.a.lat], ...bends, end];
  }

  /** The line as drawn, priced at `atMs`. Null until it has a second point. */
  quote(atMs: number): LineQuote | null {
    const d = this.draft;
    const course = this.course().map(([lon, lat]) => this.projection.toXY(lon, lat));
    if (!d?.a || course.length < 2) return null;
    const byTerrain: Record<DhLineTerrain, number> = { open: 0, plot: 0, road: 0, building: 0, water: 0 };
    let lengthM = 0;
    for (let i = 1; i < course.length; i++) {
      lengthM += Math.hypot(course[i][0] - course[i - 1][0], course[i][1] - course[i - 1][1]);
      const leg = this.terrain(course[i - 1], course[i], atMs);
      for (const t of Object.keys(leg) as DhLineTerrain[]) byTerrain[t] += leg[t];
    }
    const chfPerM = DH_PIPE_COST_CHF_PER_M * priceFactor("districtHeatPipes", atMs);
    const costRp = Math.round((Object.keys(byTerrain) as DhLineTerrain[]).reduce((sum, t) => sum + byTerrain[t] * DH_LINE_COST_FACTOR[t], 0) * chfPerM) * 100;
    const b = d.b;
    const connected = districtHeat.reachesNode(d.a.node) || (b !== null && districtHeat.reachesNode(b.node));
    const duplicate = b !== null && districtHeat.getLines().some((l) => (l.a === d.a!.node && l.b === b.node) || (l.a === b.node && l.b === d.a!.node));
    const problem = !b
      ? "The line has to end at a street junction: click near one to finish it there (or keep clicking to lay its course)."
      : d.a.node === b.node
        ? "Both ends are at the same junction."
        : duplicate
          ? "There is a line between these two junctions already."
          : !connected
            ? "Neither end is on the network: start or end the line at a piped street, a line or a plant's junction."
            : null;
    return { lengthM, byTerrain, costRp, months: buildMonths(lengthM), connected, problem };
  }

  /** Orders the line drawn: paid now, laid over its build time. */
  order(atMs: number): boolean {
    const d = this.draft;
    const q = this.quote(atMs);
    if (!d?.a || !d.b || !q || q.problem) return false;
    const ok = districtHeat.addLine(
      {
        a: d.a.node,
        b: d.b.node,
        coords: this.course(),
        lengthM: q.lengthM,
        costRp: q.costRp,
        orderedAtMs: atMs,
        completesAtMs: atMs + q.months * MONTH_MS,
      },
      atMs,
    );
    if (ok) this.draft = null;
    this.notify();
    return ok;
  }

  // --- what the line crosses ---

  /** Metres of each kind of ground on a straight leg between two points, at `atMs` (the buildings
   * standing then). */
  private terrain(pa: XY, pb: XY, atMs: number): Record<DhLineTerrain, number> {
    const result: Record<DhLineTerrain, number> = { open: 0, plot: 0, road: 0, building: 0, water: 0 };
    const length = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    if (length === 0) return result;
    const box = boxOf([pa, pb]);
    const water = this.water.filter((w) => overlaps(w.box, box));
    const zones = this.zones.filter((z) => overlaps(z.box, box));
    const roads = this.roads.filter((r) => overlaps(r.box, box, r.halfWidth));
    const houses: XY[][] = [];
    for (const b of this.buildingsProvider()) {
      if (!b.footprint || b.footprint.length < 3 || !existsAt(b, atMs)) continue;
      const ring = b.footprint.map(([lon, lat]) => this.projection.toXY(lon, lat));
      if (overlaps(boxOf(ring), box)) houses.push(ring);
    }
    const steps = Math.max(1, Math.ceil(length / SAMPLE_M));
    const piece = length / steps;
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const p: XY = [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])];
      const kind: DhLineTerrain = water.some((w) => pointInPolygon(p, w.rings))
        ? "water"
        : houses.some((h) => pointInPolygon(p, [h]))
          ? "building"
          : roads.some((r) => distanceToPolyline(p, r.line) <= r.halfWidth)
            ? "road"
            : zones.some((z) => pointInPolygon(p, z.rings))
              ? "plot"
              : "open";
      result[kind] += piece;
    }
    return result;
  }

  // --- subscription ---

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getVersion(): number {
    return this.version;
  }

  private notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export const districtHeatLines = new DistrictHeatLines();
