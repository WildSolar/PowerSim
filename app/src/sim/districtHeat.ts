/**
 * The district heating network: which street segments have pipes, since when, and the
 * extensions the player orders. A building can switch to district heating (when its
 * heating system is next replaced, or when it is built) only if a street it fronts on is
 * piped — heatingRenewal.ts and stock.ts ask servesAt.
 *
 * The network the game starts with is the pipeline's inference (pipeline/sources/
 * district_heat.py): every street a district-heated building fronts on, joined to the heat
 * source along the shortest streets. Extensions grow it street by street: the player picks
 * segments that connect to the network (through each other if need be), and ordering them
 * charges the treasury up front and lays the pipes over a build time that grows with length.
 *
 * Deliberately free of the heating model's own imports (heatingRenewal.ts depends on this);
 * statistics that need it — load, demand along a street — are in districtHeatStats.ts.
 */

import {
  DH_BUILD_METRES_PER_MONTH,
  DH_BUILD_MIN_MONTHS,
  DH_MAIN_ROAD_CLASSES,
  DH_MAIN_ROAD_COST_FACTOR,
  DH_PIPE_COST_CHF_PER_M,
} from "../config/districtHeat";
import type { DistrictHeatSourceData, MunicipalityDataset } from "../data/types";
import { streets } from "./streets";
import { treasury } from "./treasury";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;

export type SegmentState = "piped" | "construction" | "none";

export interface NetworkOrder {
  id: number;
  segments: number[];
  lengthM: number;
  costRp: number;
  orderedAtMs: number;
  completesAtMs: number;
}

export interface SelectionQuote {
  segments: number[];
  lengthM: number;
  costRp: number;
  months: number;
  /** Every selected segment reaches the network (directly or through other selected ones). */
  connected: boolean;
}

export function segmentCostRp(segmentId: number): number {
  const s = streets.get(segmentId);
  if (!s) return 0;
  const factor = DH_MAIN_ROAD_CLASSES.has(s.highway) ? DH_MAIN_ROAD_COST_FACTOR : 1;
  return Math.round(s.lengthM * DH_PIPE_COST_CHF_PER_M * factor * 100);
}

export function buildMonths(lengthM: number): number {
  return DH_BUILD_MIN_MONTHS + Math.ceil(lengthM / DH_BUILD_METRES_PER_MONTH);
}

class DistrictHeatNetwork {
  private source: DistrictHeatSourceData | null = null;
  // When each segment's pipes are in: -Infinity for the starting network, a completion date for
  // an ordered extension (in the future while it is being built).
  private builtAtMs = new Map<number, number>();
  private orders: NetworkOrder[] = [];
  private selection = new Set<number>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset): void {
    this.source = dataset.districtHeat?.source ?? null;
    this.builtAtMs = new Map((dataset.districtHeat?.initialSegments ?? []).map((id) => [id, Number.NEGATIVE_INFINITY]));
    this.orders = [];
    this.selection = new Set();
    this.notify();
  }

  getSource(): DistrictHeatSourceData | null {
    return this.source;
  }

  /** Whether there is a heat source to build a network from at all. */
  hasSource(): boolean {
    return this.source !== null;
  }

  stateAt(segmentId: number, atMs: number): SegmentState {
    const built = this.builtAtMs.get(segmentId);
    if (built === undefined) return "none";
    return built <= atMs ? "piped" : "construction";
  }

  /** Whether any of the given segments is piped at `atMs` — i.e. a building fronting on them can connect. */
  servesAt(segmentIds: number[] | undefined, atMs: number): boolean {
    if (!segmentIds) return false;
    for (const id of segmentIds) {
      const built = this.builtAtMs.get(id);
      if (built !== undefined && built <= atMs) return true;
    }
    return false;
  }

  /** Whether any of the given segments has pipes being laid at `atMs` (ordered, not finished). */
  buildingAt(segmentIds: number[] | undefined, atMs: number): boolean {
    if (!segmentIds) return false;
    for (const id of segmentIds) {
      const built = this.builtAtMs.get(id);
      if (built !== undefined && built > atMs) return true;
    }
    return false;
  }

  pipedLengthM(atMs: number): number {
    let total = 0;
    for (const [id, built] of this.builtAtMs) if (built <= atMs) total += streets.get(id)?.lengthM ?? 0;
    return total;
  }

  getOrders(): NetworkOrder[] {
    return this.orders;
  }

  // --- planning a buildout ---

  getSelection(): ReadonlySet<number> {
    return this.selection;
  }

  /** Adds a segment to (or takes it out of) the extension being planned. Segments already piped
   * or being built can't be picked. */
  toggle(segmentId: number): void {
    if (!this.source || this.builtAtMs.has(segmentId) || !streets.get(segmentId)) return;
    if (this.selection.has(segmentId)) this.selection.delete(segmentId);
    else this.selection.add(segmentId);
    this.notify();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.notify();
  }

  quote(): SelectionQuote {
    const segments = [...this.selection];
    const lengthM = segments.reduce((sum, id) => sum + (streets.get(id)?.lengthM ?? 0), 0);
    return {
      segments,
      lengthM,
      costRp: segments.reduce((sum, id) => sum + segmentCostRp(id), 0),
      months: buildMonths(lengthM),
      connected: segments.length > 0 && this.reachesNetwork(segments),
    };
  }

  /** Orders the planned extension: paid now, piped once built. Null if it doesn't connect. */
  order(atMs: number): NetworkOrder | null {
    const q = this.quote();
    if (!q.connected) return null;
    const order: NetworkOrder = {
      id: this.orders.length,
      segments: q.segments,
      lengthM: q.lengthM,
      costRp: q.costRp,
      orderedAtMs: atMs,
      completesAtMs: atMs + q.months * MONTH_MS,
    };
    for (const id of q.segments) this.builtAtMs.set(id, order.completesAtMs);
    this.orders.push(order);
    treasury.recordPayout("districtHeat", atMs, q.costRp, "district-heat-network");
    this.selection.clear();
    this.notify();
    return order;
  }

  /** Every segment must touch the network (piped or being built, or the source's feed point),
   * directly or through other segments of the same selection. */
  private reachesNetwork(selected: number[]): boolean {
    const reached = new Set<number>();
    if (this.source) reached.add(this.source.node);
    for (const id of this.builtAtMs.keys()) {
      const s = streets.get(id);
      if (s) reached.add(s.a).add(s.b);
    }
    const pending = new Set(selected);
    let progress = true;
    while (pending.size > 0 && progress) {
      progress = false;
      for (const id of pending) {
        const s = streets.get(id);
        if (s && (reached.has(s.a) || reached.has(s.b))) {
          reached.add(s.a).add(s.b);
          pending.delete(id);
          progress = true;
        }
      }
    }
    return pending.size === 0;
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

export const districtHeat = new DistrictHeatNetwork();
