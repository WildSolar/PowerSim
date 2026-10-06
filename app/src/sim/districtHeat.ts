/**
 * District heating: the pipes, the heat sources, and the networks they make. A building can switch
 * to district heating (when its heating system is next replaced, or when it is built) only if a
 * street it fronts on is piped and those pipes reach a heat source in service — heatingRenewal.ts
 * and stock.ts ask servesAt.
 *
 * A network is whatever pipes hang together: piped street segments sharing junctions, with the
 * sources fed in at their junctions. Two networks whose pipes meet become one, and pool their
 * sources. Every network also has fossil boilers for whatever its clean sources can't deliver
 * (districtHeatDispatch.ts) — so a network never runs out of heat, only out of clean heat.
 *
 * What a town starts with comes from the pipeline (pipeline/sources/district_heat.py): the
 * registered networks, each with its plant and its inferred pipes. The player extends the pipes
 * street by street (paid up front, laid over a build time that grows with length) and orders new
 * heat sources (districtHeatSources.ts), which can start a network of their own.
 *
 * Deliberately free of the heating model's own imports (heatingRenewal.ts depends on this);
 * statistics that need it — load, demand along a street — are in districtHeatStats.ts.
 */

import {
  DH_BUILD_METRES_PER_MONTH,
  DH_BUILD_MIN_MONTHS,
  DH_EXISTING_CLEAN_SHARE_SECONDARY,
  DH_EXISTING_CLEAN_SHARE_WITH_BOILER,
  DH_MAIN_ROAD_CLASSES,
  DH_MAIN_ROAD_COST_FACTOR,
  DH_PIPE_COST_CHF_PER_M,
  DH_SOURCE_SPECS,
  type DhSourceKind,
} from "../config/districtHeat";
import type { DhCandidateData, DhNetworkData, MunicipalityDataset } from "../data/types";
import { streets } from "./streets";
import { treasury } from "./treasury";
import { priceFactor } from "./costTrends";
import { spendingFrozen } from "./fiscalRules";

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
  /** The selected segments that don't. */
  unconnected: number[];
}

export type DhFuel = "oil" | "gas";

/** A heat source feeding a network at a street junction. */
export interface DhSource {
  id: string;
  /** What gives the clean heat; null: none — a network on fossil boilers only. */
  kind: DhSourceKind | null;
  /** What it runs on, for the player ("Wood chips", "Waste water heat pump"). */
  label: string;
  /** The plant or network it belongs to ("Wärmeverbund Bonstetten", "Limeco incinerator"). */
  name: string;
  lon: number;
  lat: number;
  node: number;
  feedLon: number;
  feedLat: number;
  /** The trunk line from the plant to its junction (m). */
  trunkM: number;
  /** Clean heat it can deliver (W); NaN until sized (a starting network that didn't report it). */
  cleanW: number;
  /** What its network's boilers burn. */
  fossil: DhFuel;
  /** There when the game starts (not ordered). */
  existing: boolean;
  /** Not drawn: the boilers of a piece of starting network the pipeline couldn't join to its plant. */
  hidden: boolean;
  /** A starting network's plant that isn't in the register (placed at its customers' centre). */
  unregistered?: boolean;
  /** In service from (−∞ for a starting one). */
  fromMs: number;
  orderedAtMs: number | null;
  /** The incinerator, treatment plant or factory it draws on. */
  candidateId: string | null;
  /** What it cost to build (Rp; 0 for a starting one). */
  costRp: number;
  /** Fixed payments a year: a factory's contract, a groundwater concession (Rp). */
  yearlyRp: number;
  /** A starting network that didn't report its capacity: the share of its peak, sized at the start. */
  unsizedShare: number | null;
}

/** A network at one moment: what pipes hang together, and the sources feeding them. */
export interface DhNetworkInfo {
  id: number;
  /** The sources in service, cheapest to run first. */
  sources: DhSource[];
  fossil: DhFuel;
  /** For the player: its biggest source's name. */
  name: string;
}

interface Topology {
  /** Piped segment -> its network's id. */
  segmentNetwork: Map<number, number>;
  networks: Map<number, DhNetworkInfo>;
}

/** Piping a street segment at `atMs` (civil works get dearer over time — costTrends.ts). */
export function segmentCostRp(segmentId: number, atMs: number): number {
  const s = streets.get(segmentId);
  if (!s) return 0;
  const factor = DH_MAIN_ROAD_CLASSES.has(s.highway) ? DH_MAIN_ROAD_COST_FACTOR : 1;
  return Math.round(s.lengthM * DH_PIPE_COST_CHF_PER_M * factor * priceFactor("districtHeatPipes", atMs) * 100);
}

export function buildMonths(lengthM: number): number {
  return DH_BUILD_MIN_MONTHS + Math.ceil(lengthM / DH_BUILD_METRES_PER_MONTH);
}

/** A starting network's source, read from the register: the main clean source if any, the share of
 * the reported capacity it covers, and the fuel its boilers burn. */
function startingSource(n: DhNetworkData, index: number): DhSource {
  const clean = n.sources.filter((s) => s.kind !== "oil" && s.kind !== "gas");
  const fossilSource = n.sources.find((s) => s.kind === "oil" || s.kind === "gas");
  const main = clean[0] ?? null;
  const share = !main ? 0 : n.sources[0] === main ? (fossilSource ? DH_EXISTING_CLEAN_SHARE_WITH_BOILER : 1) : DH_EXISTING_CLEAN_SHARE_SECONDARY;
  const fossil: DhFuel = fossilSource?.kind === "gas" ? "gas" : "oil";
  const kind = main ? (main.kind as DhSourceKind) : null;
  return {
    id: `net${index}`,
    kind,
    // Wood says what kind (chips, pellets, logs); the rest read as the game's own kinds.
    label: kind && kind !== "wood" && kind !== "other" ? DH_SOURCE_SPECS[kind].label : main?.label || fossilSource?.label || (n.known ? "Boilers" : "Boilers (fuel unknown)"),
    name: n.name,
    lon: n.lon,
    lat: n.lat,
    node: n.node,
    feedLon: n.feedLon,
    feedLat: n.feedLat,
    trunkM: n.trunkM,
    cleanW: n.powerMw !== null ? n.powerMw * 1e6 * share : share === 0 ? 0 : Number.NaN,
    fossil,
    existing: true,
    hidden: false,
    unregistered: !n.known,
    fromMs: Number.NEGATIVE_INFINITY,
    orderedAtMs: null,
    candidateId: null,
    costRp: 0,
    yearlyRp: 0,
    unsizedShare: n.powerMw === null && share > 0 ? share : null,
  };
}

class DistrictHeatNetwork {
  private sources: DhSource[] = [];
  // When each segment's pipes are in: -Infinity for the starting network, a completion date for
  // an ordered extension (in the future while it is being built).
  private builtAtMs = new Map<number, number>();
  private orders: NetworkOrder[] = [];
  private selection = new Set<number>();
  private candidates: DhCandidateData[] = [];
  private water: [number, number][][][] = [];
  private forestHa = 0;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private topologies = new Map<string, Topology>();
  private lastTopology: { atMs: number; version: number; topology: Topology } | null = null;

  init(dataset: MunicipalityDataset): void {
    const dh = dataset.districtHeat ?? null;
    let networks: DhNetworkData[] = dh?.networks ?? [];
    if (!dh?.networks && dh?.source) {
      // An older dataset: one network of unknown origin.
      networks = [{ ...dh.source, trunkM: 0, outside: false, name: dh.source.name, operator: null, since: null, known: false, powerMw: null, sources: [], segments: dh.initialSegments ?? [] }];
    }
    this.sources = networks.map(startingSource);
    this.builtAtMs = new Map(networks.flatMap((n) => n.segments.map((id) => [id, Number.NEGATIVE_INFINITY] as [number, number])));
    this.candidates = dh?.candidates ?? [];
    this.water = dh?.water ?? [];
    this.forestHa = dh?.forestHa ?? 0;
    this.orders = [];
    this.selection = new Set();
    this.version++;
    this.topologies.clear();
    // Pieces of starting network the pipeline couldn't join to their plant still have heat: boilers of their own.
    const start = this.topologyAt(Number.NEGATIVE_INFINITY);
    const fed = new Set([...start.networks.keys()]);
    const orphans = new Map<number, number>(); // network root -> a segment in it
    for (const [segment, root] of start.segmentNetwork) if (!fed.has(root) && !orphans.has(root)) orphans.set(root, segment);
    for (const [, segment] of orphans) {
      const s = streets.get(segment);
      if (!s) continue;
      const [lon, lat] = s.line[0];
      this.sources.push({
        id: `island${segment}`,
        kind: null,
        label: "Boilers",
        name: "District heating",
        lon,
        lat,
        node: s.a,
        feedLon: lon,
        feedLat: lat,
        trunkM: 0,
        cleanW: 0,
        fossil: "oil",
        existing: true,
        hidden: true,
        fromMs: Number.NEGATIVE_INFINITY,
        orderedAtMs: null,
        candidateId: null,
        costRp: 0,
        yearlyRp: 0,
        unsizedShare: null,
      });
    }
    this.notify();
  }

  // --- what the town has ---

  /** Whether there is district heating, or anything to start it from. */
  hasAnything(): boolean {
    return this.sources.length > 0 || this.candidates.length > 0 || this.water.length > 0 || this.forestHa > 0;
  }

  getSources(): DhSource[] {
    return this.sources;
  }

  getCandidates(): DhCandidateData[] {
    return this.candidates;
  }

  getWater(): [number, number][][][] {
    return this.water;
  }

  getForestHa(): number {
    return this.forestHa;
  }

  /** Sizes a starting source whose capacity wasn't reported (districtHeatStats.ts). */
  setCleanW(id: string, w: number): void {
    const source = this.sources.find((s) => s.id === id);
    if (!source) return;
    source.cleanW = w;
    this.notify();
  }

  /** Orders a new heat source (districtHeatSources.ts): paid now, in service once built. */
  addSource(source: DhSource, atMs: number): boolean {
    if (spendingFrozen(atMs)) return false;
    this.sources.push(source);
    if (source.costRp > 0) treasury.recordPayout("districtHeat", atMs, source.costRp, `district-heat-source:${source.id}`);
    this.notify();
    return true;
  }

  // --- the pipes ---

  stateAt(segmentId: number, atMs: number): SegmentState {
    const built = this.builtAtMs.get(segmentId);
    if (built === undefined) return "none";
    return built <= atMs ? "piped" : "construction";
  }

  /** Whether a building fronting on the given segments can connect at `atMs`: one of them is piped,
   * and its pipes reach a heat source in service. */
  servesAt(segmentIds: number[] | undefined, atMs: number): boolean {
    return this.networkOf(segmentIds, atMs) !== null;
  }

  /** The network a building fronting on the given segments is (or would be) connected to at `atMs`,
   * or null if none reaches it. */
  networkOf(segmentIds: number[] | undefined, atMs: number): DhNetworkInfo | null {
    if (!segmentIds || segmentIds.length === 0) return null;
    const topology = this.topologyAt(atMs);
    for (const id of segmentIds) {
      const root = topology.segmentNetwork.get(id);
      if (root === undefined) continue;
      const network = topology.networks.get(root);
      if (network) return network;
    }
    return null;
  }

  /** Every network with a source in service at `atMs`. */
  networksAt(atMs: number): DhNetworkInfo[] {
    return [...this.topologyAt(atMs).networks.values()];
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

  /** Trunk lines to sources in service (m). */
  trunkLengthM(atMs: number): number {
    return this.sources.reduce((sum, s) => sum + (s.fromMs <= atMs ? s.trunkM : 0), 0);
  }

  getOrders(): NetworkOrder[] {
    return this.orders;
  }

  /** The networks at `atMs`: union-find over the junctions of every piped segment, with each
   * source in service joining the network at its junction (or standing alone, its pipes not yet
   * laid). Computed once per state of the pipes and sources. */
  private topologyAt(atMs: number): Topology {
    const last = this.lastTopology;
    if (last && last.atMs === atMs && last.version === this.version) return last.topology;
    let key = "";
    for (const o of this.orders) if (o.completesAtMs <= atMs) key += `${o.id},`;
    key += "|";
    for (const s of this.sources) if (s.fromMs <= atMs) key += `${s.id},`;
    let topology = this.topologies.get(key);
    if (!topology) {
      topology = this.computeTopology(atMs);
      this.topologies.set(key, topology);
    }
    this.lastTopology = { atMs, version: this.version, topology };
    return topology;
  }

  private computeTopology(atMs: number): Topology {
    const parent = new Map<number, number>();
    const find = (n: number): number => {
      let root = n;
      while (parent.get(root) !== undefined && parent.get(root) !== root) root = parent.get(root) as number;
      let cur = n;
      while (cur !== root) {
        const next = parent.get(cur) as number;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(rb, ra);
    };
    const piped: number[] = [];
    for (const [id, built] of this.builtAtMs) {
      if (built > atMs) continue;
      piped.push(id);
      const nodes = streets.nodesOf(id);
      for (const n of nodes) if (!parent.has(n)) parent.set(n, n);
      for (let i = 1; i < nodes.length; i++) union(nodes[0], nodes[i]);
    }
    const segmentNetwork = new Map<number, number>();
    for (const id of piped) {
      const nodes = streets.nodesOf(id);
      if (nodes.length > 0) segmentNetwork.set(id, find(nodes[0]));
    }
    const networks = new Map<number, DhNetworkInfo>();
    for (const s of this.sources) {
      if (s.fromMs > atMs) continue;
      // A source whose junction no pipe reaches yet stands alone, under its own (negative) id.
      const root = parent.has(s.node) ? find(s.node) : -1 - s.node;
      let network = networks.get(root);
      if (!network) {
        network = { id: root, sources: [], fossil: s.fossil, name: s.name };
        networks.set(root, network);
      }
      network.sources.push(s);
    }
    for (const network of networks.values()) {
      network.sources.sort((a, b) => (a.kind ? DH_SOURCE_SPECS[a.kind].merit : 99) - (b.kind ? DH_SOURCE_SPECS[b.kind].merit : 99));
      const existing = network.sources.find((s) => s.existing && !s.hidden);
      network.fossil = existing?.fossil ?? network.sources[0].fossil;
      const named = [...network.sources].filter((s) => !s.hidden).sort((a, b) => (b.cleanW || 0) - (a.cleanW || 0))[0];
      network.name = (existing ?? named ?? network.sources[0]).name;
    }
    return { segmentNetwork, networks };
  }

  // --- planning a buildout ---

  getSelection(): ReadonlySet<number> {
    return this.selection;
  }

  /** Adds a segment to (or takes it out of) the extension being planned. Segments already piped
   * or being built can't be picked. */
  toggle(segmentId: number): void {
    if (this.sources.length === 0 || this.builtAtMs.has(segmentId) || !streets.get(segmentId)) return;
    if (this.selection.has(segmentId)) this.selection.delete(segmentId);
    else this.selection.add(segmentId);
    this.notify();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.notify();
  }

  /** The picked extension as it would be ordered at `atMs`. */
  quote(atMs: number): SelectionQuote {
    const segments = [...this.selection];
    const unconnected = this.unconnectedOf(segments);
    const lengthM = segments.reduce((sum, id) => sum + (streets.get(id)?.lengthM ?? 0), 0);
    return {
      segments,
      lengthM,
      costRp: segments.reduce((sum, id) => sum + segmentCostRp(id, atMs), 0),
      months: buildMonths(lengthM),
      connected: segments.length > 0 && unconnected.length === 0,
      unconnected,
    };
  }

  /** Orders the planned extension: paid now, piped once built. Null if it doesn't connect. */
  order(atMs: number): NetworkOrder | null {
    const q = this.quote(atMs);
    if (!q.connected || spendingFrozen(atMs)) return null;
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

  /** The selected segments that don't touch the network (piped or being built, or a source's
   * junction, ordered ones included) — directly, or through other segments of the same selection. */
  private unconnectedOf(selected: number[]): number[] {
    const reached = new Set<number>();
    for (const s of this.sources) reached.add(s.node);
    for (const id of this.builtAtMs.keys()) for (const n of streets.nodesOf(id)) reached.add(n);
    const pending = new Set(selected);
    let progress = true;
    while (pending.size > 0 && progress) {
      progress = false;
      for (const id of pending) {
        const nodes = streets.nodesOf(id);
        if (nodes.some((n) => reached.has(n))) {
          for (const n of nodes) reached.add(n);
          pending.delete(id);
          progress = true;
        }
      }
    }
    return [...pending];
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
    this.topologies.clear();
    this.listeners.forEach((l) => l());
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { builtAtMs: this.builtAtMs, orders: this.orders, sources: this.sources };
  }

  restore(s: ReturnType<DistrictHeatNetwork["snapshot"]>): void {
    this.builtAtMs = s.builtAtMs;
    this.orders = s.orders;
    this.sources = s.sources;
    this.selection = new Set();
    this.notify();
  }
}

export const districtHeat = new DistrictHeatNetwork();
