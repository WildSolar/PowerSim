/**
 * New heat for district heating: where it can come from, what a plant of a given size costs, and
 * ordering it (districtHeat.ts keeps the sources).
 *
 *  - Waste heat bought from a plant within reach: an incinerator (per kWh), a factory that offers its
 *    waste heat (a fixed yearly payment; the offers arrive one by one over the years), and a waste
 *    water treatment plant, which is public — the town pays only for the heat pump on its effluent.
 *    Their size is set by what the plant can give; a plant outside the town needs a trunk line.
 *  - A heat pump drawing on groundwater, anywhere in the heat-use atlas's zones that allow
 *    groundwater use (up to a few MW per plant), or on a river or lake, within a short distance of
 *    the water.
 *  - A wood chip CHP plant anywhere in the municipality, as big as the town's own forest can feed —
 *    and the neighbours within a few hundred metres hold it against the council for as long as it
 *    runs.
 *
 * A plant feeds in at its nearest street junction: pipes still have to reach it (districtHeat.ts's
 * extensions), so a plant away from the network starts a network of its own.
 *
 * The plant being planned (the draft) lives here too, so the map can show it and take clicks.
 */

import {
  DH_CAPEX_SCALE_EXPONENT,
  DH_FULL_LOAD_HOURS,
  DH_GROUNDWATER_FEE_CHF_PER_KW_YEAR,
  DH_INCINERATOR_HEAT_RP_PER_KWH,
  DH_INCINERATOR_POWER_TO_HEAT,
  DH_INCINERATOR_TOWN_SHARE,
  DH_INDUSTRY_OFFER_YEARS,
  DH_INDUSTRY_PAYMENT_RP_PER_KWH,
  DH_INDUSTRY_SITE_NAMES,
  DH_SOURCE_SPECS,
  DH_SURFACE_WATER_MAX_DISTANCE_M,
  DH_TRUNK_COST_CHF_PER_M,
  DH_TRUNK_METRES_PER_MONTH,
  DH_WOOD_FUEL_RP_PER_KWH,
  DH_WOOD_HEAT_EFFICIENCY,
  DH_WOOD_NUISANCE_FULL_SHARE,
  DH_WOOD_NUISANCE_RADIUS_M,
  DH_WOOD_NUISANCE_STANCE,
  DH_WOOD_POWER_EFFICIENCY,
  DH_WOOD_YIELD_MWH_PER_HA_YEAR,
  type DhSourceKind,
} from "../config/districtHeat";
import { groundRule } from "../config/heatPumpSiting";
import type { Building, DhCandidateData, MunicipalityDataset } from "../data/types";
import { setLocalStances } from "./approval";
import { toSimTimeMs } from "./calendar";
import { priceFactor } from "./costTrends";
import { districtHeat, type DhSource } from "./districtHeat";
import { heatPumpSiting } from "./heatPumpSiting";
import { existsAt } from "./lifetime";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";
import { market } from "./market";
import { hashSeed, mulberry32 } from "./rng";
import { streets } from "./streets";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;

/** The kinds a player places on the map (the rest come from a plant within reach). */
export type PlacedKind = "groundwater" | "surfaceWater" | "wood";

export interface DhDraft {
  kind: DhSourceKind;
  /** The incinerator, treatment plant or factory it draws on; null for a placed plant. */
  candidateId: string | null;
  /** Where it goes (null: not placed yet). */
  lon: number | null;
  lat: number | null;
  sizeMw: number;
}

export interface DraftQuote {
  kind: DhSourceKind;
  name: string;
  /** Why it can't go there (or can't be ordered at all); null when it can. */
  problem: string | null;
  /** The sizes on offer (MW), smallest first; a single one when the plant sets it. */
  sizes: number[];
  sizeMw: number;
  capexRp: number;
  /** The trunk line's share of that, and its length. */
  trunkRp: number;
  trunkM: number;
  months: number;
  /** Fixed payments a year (a factory's contract, a groundwater concession). */
  yearlyRp: number;
  upkeepRpYear: number;
  /** What a kWh of its heat costs to make at today's prices, before fixed costs (Rp). */
  runningRpPerKWh: number;
  /** Wood: homes within reach of the plant. */
  nuisanceHomes: number | null;
  /** Where it feeds in. */
  feed: { node: number; lon: number; lat: number } | null;
}

/** What a candidate is called: a factory by its branch, the rest by their plant's name. */
export function candidateName(c: DhCandidateData): string {
  return c.kind === "industry" ? ((c.noga !== undefined && c.noga !== null ? DH_INDUSTRY_SITE_NAMES[c.noga] : undefined) ?? "Factory") : c.name;
}

/** Sizes a slider offers between two limits: fine steps for small plants, coarser for big ones. */
const SIZE_LADDER: number[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => i / 10),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => 1 + i / 4),
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) => 3 + i / 2),
  ...Array.from({ length: 20 }, (_, i) => 10 + i),
  ...Array.from({ length: 7 }, (_, i) => 30 + 5 * i),
];

function sizeSteps(minMw: number, maxMw: number): number[] {
  const steps = SIZE_LADDER.filter((mw) => mw >= minMw - 1e-9 && mw <= maxMw + 1e-9);
  const top = Math.floor(maxMw * 10) / 10;
  if (top >= minMw && (steps.length === 0 || top > steps[steps.length - 1] + 1e-9)) steps.push(top);
  return steps;
}

/** What building a plant of `mw` costs (Rp), before any trunk line. */
export function plantCapexRp(kind: DhSourceKind, mw: number, atMs: number): number {
  const spec = DH_SOURCE_SPECS[kind];
  return Math.round((spec.capexFixedChf + spec.capexChfAt1Mw * Math.pow(Math.max(mw, 0.01), DH_CAPEX_SCALE_EXPONENT)) * priceFactor("districtHeatPipes", atMs) * 100);
}

/** What a kWh of heat from `kind` costs to make at `atMs`'s prices, before fixed costs (Rp). */
export function runningRpPerKWh(kind: DhSourceKind, atMs: number): number {
  const power = market.price("wholesale", atMs);
  const cop = DH_SOURCE_SPECS[kind].cop;
  if (cop) return power / cop;
  if (kind === "wood") return (DH_WOOD_FUEL_RP_PER_KWH - DH_WOOD_POWER_EFFICIENCY * power) / DH_WOOD_HEAT_EFFICIENCY;
  if (kind === "incinerator") return DH_INCINERATOR_HEAT_RP_PER_KWH;
  return 0;
}

class DistrictHeatSources {
  private projection = new LocalProjection(8.4, 47.4);
  private boundary: XY[][][] = [];
  private water: XY[][][] = [];
  private buildingsProvider: () => Building[] = () => [];
  private seed = "";
  private draft: DhDraft | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private nuisanceCache: { key: string; share: number } | null = null;
  private hints = new Map<PlacedKind, { lon: number; lat: number } | null>();

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[]): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    const toXY = (rings: number[][][]) => rings.map((ring) => ring.map(([lon, lat]) => this.projection.toXY(lon, lat)));
    this.boundary = (dataset.boundary ?? []).map(toXY);
    this.water = districtHeat.getWater().map(toXY);
    this.buildingsProvider = buildingsProvider;
    this.seed = `dh-offers:${dataset.bfsNumber}`;
    this.draft = null;
    this.nuisanceCache = null;
    this.hints = new Map();
    setLocalStances((atMs) => this.nuisanceStances(atMs));
    this.notify();
  }

  // --- what is within reach ---

  /** When a candidate becomes available: incinerators and treatment plants from the start, a
   * factory once its offer arrives. */
  offerAtMs(c: DhCandidateData): number {
    if (c.kind !== "industry") return Number.NEGATIVE_INFINITY;
    const rng = mulberry32(hashSeed(this.seed, c.id));
    const [from, to] = DH_INDUSTRY_OFFER_YEARS;
    const year = from + Math.floor(rng() * (to - from + 1));
    return toSimTimeMs(Date.UTC(year, Math.floor(rng() * 12), 1 + Math.floor(rng() * 27)));
  }

  /** The candidates on offer at `atMs` and not yet drawn on. */
  availableCandidates(atMs: number): DhCandidateData[] {
    const used = new Set(districtHeat.getSources().map((s) => s.candidateId));
    return districtHeat.getCandidates().filter((c) => !used.has(c.id) && this.offerAtMs(c) <= atMs);
  }

  /** The heat a candidate can give (MW), less what a starting network already draws there — and no
   * more than one plant of its kind can take. */
  candidateMaxMw(c: DhCandidateData): number {
    return Math.min(DH_SOURCE_SPECS[c.kind].maxMw, this.candidatePotentialMw(c));
  }

  private candidatePotentialMw(c: DhCandidateData): number {
    switch (c.kind) {
      case "incinerator":
        return (((c.heatMwh ?? 0) + DH_INCINERATOR_POWER_TO_HEAT * (c.electricityMwh ?? 0)) * DH_INCINERATOR_TOWN_SHARE) / DH_FULL_LOAD_HOURS.incinerator;
      case "industry":
        return (c.potentialMwh ?? 0) / DH_FULL_LOAD_HOURS.industry;
      case "wastewater": {
        const site = this.projection.toXY(c.lon, c.lat);
        const used = districtHeat
          .getSources()
          .filter((s) => s.existing && s.kind === "wastewater" && Math.hypot(...minus(this.projection.toXY(s.lon, s.lat), site)) < 1_000)
          .reduce((sum, s) => sum + (Number.isFinite(s.cleanW) ? s.cleanW : 0), 0);
        return Math.max(0, (c.potentialMwh ?? 0) / DH_FULL_LOAD_HOURS.wastewater - used / 1e6);
      }
    }
  }

  /** What the town's forest can still feed: its sustainable yield, less what new wood plants burn
   * at full load (MW of heat). */
  woodRemainingMw(): number {
    const potentialMw = (districtHeat.getForestHa() * DH_WOOD_YIELD_MWH_PER_HA_YEAR * DH_WOOD_HEAT_EFFICIENCY) / DH_FULL_LOAD_HOURS.wood;
    const used = districtHeat
      .getSources()
      .filter((s) => !s.existing && s.kind === "wood")
      .reduce((sum, s) => sum + s.cleanW / 1e6, 0);
    return Math.max(0, potentialMw - used);
  }

  // --- the draft ---

  getDraft(): DhDraft | null {
    return this.draft;
  }

  /** Starts planning a plant: on a candidate, or one to place on the map. */
  startDraft(kind: DhSourceKind, candidateId: string | null = null): void {
    const c = candidateId ? districtHeat.getCandidates().find((x) => x.id === candidateId) : null;
    this.draft = { kind, candidateId, lon: c?.lon ?? null, lat: c?.lat ?? null, sizeMw: 0 };
    const sizes = this.quote(0).sizes;
    this.draft.sizeMw = c?.kind === "industry" ? (sizes[sizes.length - 1] ?? 0) : (sizes[Math.min(sizes.length - 1, Math.floor(sizes.length / 3))] ?? 0);
    this.notify();
  }

  /** Puts the plant being planned at a point (a placed kind only). */
  placeDraft(lon: number, lat: number): void {
    if (!this.draft || this.draft.candidateId) return;
    this.draft = { ...this.draft, lon, lat };
    this.notify();
  }

  setDraftSize(mw: number): void {
    if (!this.draft) return;
    this.draft = { ...this.draft, sizeMw: mw };
    this.notify();
  }

  cancelDraft(): void {
    if (!this.draft) return;
    this.draft = null;
    this.notify();
  }

  /** What drawing on a candidate would take at `atMs`, at its full size (for an offer's letter). */
  candidateQuote(c: DhCandidateData, atMs: number): DraftQuote {
    const saved = this.draft;
    this.draft = { kind: c.kind, candidateId: c.id, lon: c.lon, lat: c.lat, sizeMw: Number.POSITIVE_INFINITY };
    try {
      return this.quote(atMs);
    } finally {
      this.draft = saved;
    }
  }

  /** The draft as it would be ordered at `atMs`. */
  quote(atMs: number): DraftQuote {
    const d = this.draft as DhDraft;
    const spec = DH_SOURCE_SPECS[d.kind];
    const candidate = d.candidateId ? (districtHeat.getCandidates().find((c) => c.id === d.candidateId) ?? null) : null;
    let problem: string | null = null;
    let maxMw = spec.maxMw;
    let trunkM = 0;
    let name = spec.label;
    let feed: DraftQuote["feed"] = null;
    if (candidate) {
      name = candidate.kind === "industry" ? `${candidateName(candidate)} waste heat` : candidate.name;
      maxMw = Math.min(maxMw, this.candidateMaxMw(candidate));
      trunkM = candidate.trunkM;
      feed = { node: candidate.node, lon: candidate.feedLon, lat: candidate.feedLat };
    } else if (d.lon === null || d.lat === null) {
      problem = "Click on the map to place it.";
    } else {
      const junction = streets.nearestJunction(d.lon, d.lat);
      if (junction) {
        feed = { node: junction.node, lon: junction.lon, lat: junction.lat };
        trunkM = junction.distanceM > 30 ? Math.round(junction.distanceM * 1.2) : 0;
        const street = streets.snapToStreet(d.lon, d.lat)?.street;
        if (street) name = `${spec.label}, ${street}`;
      }
      problem = this.siteProblem(d.kind as PlacedKind, d.lon, d.lat);
    }
    if (d.kind === "wood") maxMw = Math.min(maxMw, this.woodRemainingMw());
    if (!problem && maxMw < spec.minMw) {
      problem =
        d.kind === "wood"
          ? "The town's forest can't feed another wood plant: its sustainable yield is spoken for."
          : "There is no heat left to take here.";
    }
    const sizes = candidate?.kind === "industry" ? [Math.round(maxMw * 100) / 100] : sizeSteps(spec.minMw, maxMw);
    const sizeMw = sizes.length > 0 ? sizes.reduce((best, s) => (Math.abs(s - d.sizeMw) < Math.abs(best - d.sizeMw) ? s : best), sizes[0]) : 0;
    const trunkRp = Math.round(trunkM * DH_TRUNK_COST_CHF_PER_M * priceFactor("districtHeatPipes", atMs) * 100);
    const kw = sizeMw * 1000;
    const yearlyRp =
      candidate?.kind === "industry" ? (candidate.potentialMwh ?? 0) * 1000 * DH_INDUSTRY_PAYMENT_RP_PER_KWH : d.kind === "groundwater" ? kw * DH_GROUNDWATER_FEE_CHF_PER_KW_YEAR * 100 : 0;
    return {
      kind: d.kind,
      name,
      problem,
      sizes,
      sizeMw,
      capexRp: plantCapexRp(d.kind, sizeMw, atMs) + trunkRp,
      trunkRp,
      trunkM,
      months: spec.buildMonths + Math.ceil(trunkM / DH_TRUNK_METRES_PER_MONTH),
      yearlyRp,
      upkeepRpYear: kw * spec.upkeepChfPerKwYear * 100,
      runningRpPerKWh: runningRpPerKWh(d.kind, atMs),
      nuisanceHomes: d.kind === "wood" && d.lon !== null && d.lat !== null ? this.homesNear(d.lon, d.lat, atMs) : null,
      feed,
    };
  }

  /** Orders the draft: paid now, in service once built. False if it can't be. */
  orderDraft(atMs: number): boolean {
    const d = this.draft;
    if (!d) return false;
    const q = this.quote(atMs);
    if (q.problem || !q.feed || q.sizeMw <= 0) return false;
    const candidate = d.candidateId ? districtHeat.getCandidates().find((c) => c.id === d.candidateId) : null;
    const source: DhSource = {
      id: `src${districtHeat.getSources().length}-${Math.round(atMs)}`,
      kind: d.kind,
      label: DH_SOURCE_SPECS[d.kind].label,
      name: q.name,
      lon: candidate?.lon ?? (d.lon as number),
      lat: candidate?.lat ?? (d.lat as number),
      node: q.feed.node,
      feedLon: q.feed.lon,
      feedLat: q.feed.lat,
      trunkM: q.trunkM,
      cleanW: q.sizeMw * 1e6,
      fossil: "oil",
      existing: false,
      hidden: false,
      fromMs: atMs + q.months * MONTH_MS,
      orderedAtMs: atMs,
      candidateId: d.candidateId,
      costRp: q.capexRp,
      yearlyRp: q.yearlyRp,
      unsizedShare: null,
    };
    if (!districtHeat.addSource(source, atMs)) return false;
    this.draft = null;
    this.nuisanceCache = null;
    this.notify();
    return true;
  }

  // --- where a plant may go ---

  private inTown(p: XY): boolean {
    return this.boundary.length === 0 || this.boundary.some((rings) => pointInPolygon(p, rings));
  }

  /** Why a placed plant can't go at (lon, lat), or null if it can. */
  siteProblem(kind: PlacedKind, lon: number, lat: number): string | null {
    const p = this.projection.toXY(lon, lat);
    if (!this.inTown(p)) return "That's outside the municipality.";
    if (kind === "groundwater") {
      if (!heatPumpSiting.hasHeatUseAtlas()) return "There's no map of the groundwater here to say where it may be used.";
      const zone = heatPumpSiting.zoneAt(lon, lat);
      if (!zone || groundRule(zone).groundwaterFromKw === null) return "Groundwater may not be used here: pick a spot over a usable aquifer (the shaded zones).";
    }
    if (kind === "surfaceWater") {
      const d = this.waterDistanceM(p);
      if (d === null) return "There's no river or lake big enough here.";
      if (d > DH_SURFACE_WATER_MAX_DISTANCE_M) return `That's ${Math.round(d)} m from the water: a plant has to stand within ${DH_SURFACE_WATER_MAX_DISTANCE_M} m of a river or lake.`;
    }
    return null;
  }

  /** Distance to the nearest river or lake (0 on the water), null without any. */
  private waterDistanceM(p: XY): number | null {
    if (this.water.length === 0) return null;
    let best = Number.POSITIVE_INFINITY;
    for (const rings of this.water) {
      if (pointInPolygon(p, rings)) return 0;
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i++) best = Math.min(best, segmentDistance(p, ring[i - 1], ring[i]));
      }
    }
    return best;
  }

  /** A spot where a plant of this kind may go, near the middle of town — for "show me where".
   * Null if there is none (or, for wood, anywhere will do). */
  placeHint(kind: PlacedKind): { lon: number; lat: number } | null {
    if (kind === "wood") return null;
    if (this.hints.has(kind)) return this.hints.get(kind) ?? null;
    const buildings = this.buildingsProvider();
    const centre = this.projection.toXY(
      buildings.reduce((sum, b) => sum + b.lon, 0) / Math.max(1, buildings.length),
      buildings.reduce((sum, b) => sum + b.lat, 0) / Math.max(1, buildings.length),
    );
    const xs = this.boundary.flatMap((rings) => rings[0].map((p) => p[0]));
    const ys = this.boundary.flatMap((rings) => rings[0].map((p) => p[1]));
    let best: { d: number; lon: number; lat: number } | null = null;
    const step = 40;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
        const d = Math.hypot(x - centre[0], y - centre[1]);
        if (best && d >= best.d) continue;
        const [lon, lat] = this.projection.toLonLat(x, y);
        if (this.siteProblem(kind, lon, lat) === null) best = { d, lon, lat };
      }
    }
    const hint = best ? { lon: best.lon, lat: best.lat } : null;
    this.hints.set(kind, hint);
    return hint;
  }

  // --- wood plants and their neighbours ---

  /** Homes within reach of a wood plant at (lon, lat). */
  homesNear(lon: number, lat: number, atMs: number): number {
    const p = this.projection.toXY(lon, lat);
    let homes = 0;
    for (const b of this.buildingsProvider()) {
      if (b.dwellings.length === 0 || !existsAt(b, atMs)) continue;
      const q = this.projection.toXY(b.lon, b.lat);
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) <= DH_WOOD_NUISANCE_RADIUS_M) homes += b.dwellings.length;
    }
    return homes;
  }

  /** The share of the town's homes within reach of a new wood plant in service at `atMs`. */
  private nuisanceShare(atMs: number): number {
    const plants = districtHeat.getSources().filter((s) => !s.existing && s.kind === "wood" && s.fromMs <= atMs);
    if (plants.length === 0) return 0;
    const key = `${plants.map((s) => s.id).join(",")}:${Math.floor(atMs / (12 * MONTH_MS))}`;
    if (this.nuisanceCache?.key === key) return this.nuisanceCache.share;
    const sites = plants.map((s) => this.projection.toXY(s.lon, s.lat));
    let near = 0;
    let all = 0;
    for (const b of this.buildingsProvider()) {
      if (b.dwellings.length === 0 || !existsAt(b, atMs)) continue;
      all += b.dwellings.length;
      const q = this.projection.toXY(b.lon, b.lat);
      if (sites.some((p) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= DH_WOOD_NUISANCE_RADIUS_M)) near += b.dwellings.length;
    }
    const share = all > 0 ? near / all : 0;
    this.nuisanceCache = { key, share };
    return share;
  }

  private nuisanceStances(atMs: number): { homeowners?: number; tenants?: number } {
    const share = this.nuisanceShare(atMs);
    if (share <= 0) return {};
    const stance = DH_WOOD_NUISANCE_STANCE * Math.min(1, share / DH_WOOD_NUISANCE_FULL_SHARE);
    return { homeowners: stance, tenants: stance };
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

function minus(a: XY, b: XY): [number, number] {
  return [a[0] - b[0], a[1] - b[1]];
}

function segmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const districtHeatSources = new DistrictHeatSources();
