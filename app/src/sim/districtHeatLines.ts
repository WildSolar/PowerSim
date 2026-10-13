/**
 * Planning a direct line: a district heating pipe laid straight from one street junction to another,
 * off the streets — to bring a plant's heat across town the short way, or to join two networks
 * without going round by the streets. It carries heat; nobody connects along it (districtHeat.ts
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
  a: LineEnd | null;
  b: LineEnd | null;
  /** Why the last click didn't take (no junction near it). */
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
    this.draft = { a: null, b: null, missed: false };
    districtHeat.clearSelection();
    districtHeatSources.cancelDraft();
    this.notify();
  }

  cancel(): void {
    if (!this.draft) return;
    this.draft = null;
    this.notify();
  }

  /** A click on the map while drawing: the first sets where the line starts, the next where it
   * ends (and later ones move the end) — each at the street junction nearest the click. */
  click(lon: number, lat: number): void {
    if (!this.draft) return;
    const junction = streets.nearestJunction(lon, lat);
    if (!junction || junction.distanceM > DH_LINE_SNAP_M) {
      this.draft = { ...this.draft, missed: true };
    } else {
      const end = { node: junction.node, lon: junction.lon, lat: junction.lat };
      this.draft = this.draft.a ? { ...this.draft, b: end, missed: false } : { a: end, b: null, missed: false };
    }
    this.notify();
  }

  /** The line as drawn, priced at `atMs`. Null until both ends are set. */
  quote(atMs: number): LineQuote | null {
    const d = this.draft;
    if (!d?.a || !d.b) return null;
    const pa = this.projection.toXY(d.a.lon, d.a.lat);
    const pb = this.projection.toXY(d.b.lon, d.b.lat);
    const lengthM = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const byTerrain = this.terrain(pa, pb, atMs);
    const chfPerM = DH_PIPE_COST_CHF_PER_M * priceFactor("districtHeatPipes", atMs);
    const costRp = Math.round((Object.keys(byTerrain) as DhLineTerrain[]).reduce((sum, t) => sum + byTerrain[t] * DH_LINE_COST_FACTOR[t], 0) * chfPerM) * 100;
    const connected = districtHeat.reachesNode(d.a.node) || districtHeat.reachesNode(d.b.node);
    const duplicate = districtHeat.getLines().some((l) => (l.a === d.a!.node && l.b === d.b!.node) || (l.a === d.b!.node && l.b === d.a!.node));
    const problem =
      d.a.node === d.b.node
        ? "Both ends are at the same junction: click further away."
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
        coords: [
          [d.a.lon, d.a.lat],
          [d.b.lon, d.b.lat],
        ],
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

  /** Metres of each kind of ground between two points, at `atMs` (the buildings standing then). */
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
