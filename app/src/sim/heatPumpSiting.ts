/**
 * Where a heat pump may go — the two things that, in reality, decide whether a building can have
 * one at all, and at what extra cost:
 *
 *  - The ground (ground-source heat pumps). Canton Zurich's heat-use atlas (dataset.heatUse, see
 *    pipeline/sources/heat_use.py) puts every location in a zone: in a groundwater protection zone
 *    nothing may be taken from the ground; over an aquifer that can supply drinking water no
 *    boreholes may be drilled, and groundwater may be used only by large systems, by concession;
 *    elsewhere boreholes are allowed, some with conditions. Boreholes also keep clear of tunnels.
 *    So a building's ground-source option is boreholes, groundwater wells, or nothing.
 *
 *  - Noise (air heat pumps). An outdoor unit must keep under the night planning value at the
 *    neighbours' windows (LSV Annex 6, as the Cercle Bruit guidance 6.21 applies it): how loud it is
 *    against how far away the neighbours are and how sensitive the zone is (residential: ES II;
 *    mixed, centre and work zones: ES III). Whatever is over the limit has to come off with a
 *    quieter model, a sound hood or an indoor installation — each a cost — and beyond what those
 *    can do, an air heat pump isn't permitted.
 *
 * A building's ground is fixed; its noise case changes with its neighbours (densification), its
 * zone (rezoning) and quieter units over the years, so it is worked out per year.
 */

import {
  AIR_UNIT_SOUND_POWER_DB_AT_8KW,
  ATTACHED_GAP_M,
  BOREHOLE_CONDITIONS_COST_FACTOR,
  GROUND_RULES,
  GROUNDWATER_COST_FACTOR,
  GROUNDWATER_FEE_CHF_PER_KW_YEAR,
  NIGHT_PLANNING_VALUE_DB,
  NOISE_DIRECTIVITY_DB,
  NOISE_K1_NIGHT_DB,
  NOISE_K2_TONAL_DB,
  NOISE_LADDER,
  NOISE_MAX_DISTANCE_M,
  NOISE_MIN_DISTANCE_M,
  NOISE_NEIGHBOUR_RADIUS_M,
  NOISE_SENSITIVE_MIN_FOOTPRINT_M2,
  SOUND_POWER_IMPROVEMENT_DB_PER_YEAR,
  SOUND_POWER_IMPROVEMENT_MAX_DB,
  TUNNEL_CLEARANCE_M,
  type HeatUseZone,
  type NoiseStep,
} from "../config/heatPumpSiting";
import { DH_DESIGN_OUTDOOR_TEMP_C } from "../config/districtHeat";
import type { Building, MunicipalityDataset } from "../data/types";
import { toDateMs } from "./calendar";
import { existsAt } from "./lifetime";
import { LocalProjection, PointGrid, pointInPolygon, ringGap, type XY } from "./localGeo";
import { spaceHeatingThermalDemandW } from "./spaceHeating";
import { zoning } from "./zoning";

const YEAR_MS = 365.25 * 24 * 60 * 60_000;

export type GroundSource =
  | { kind: "borehole"; zone: HeatUseZone | null; conditions: boolean; costFactor: number }
  | { kind: "groundwater"; zone: HeatUseZone; costFactor: number; annualFeeRp: number }
  | { kind: "none"; zone: HeatUseZone | null; reason: string };

export interface AirNoise {
  /** How far over the night planning value a plain outdoor unit would be (dB; ≤ 0: fine). */
  excessDb: number;
  step: NoiseStep;
  /** What the noise measures add to the installation (Rp), before the size scaling. */
  extraCostRp: number;
  label: string;
  distanceM: number;
  sensitivity: "II" | "III";
}

interface ZoneShape {
  zone: HeatUseZone;
  noBoreholes: boolean;
  polygons: XY[][][];
}

class HeatPumpSiting {
  private projection = new LocalProjection(8.4, 47.4);
  private zones: ZoneShape[] = [];
  private conditions: XY[][][] = [];
  private tunnels: XY[][] = [];
  private hasAtlas = false;
  private buildingsProvider: () => Building[] = () => [];
  private groundCache = new Map<string, GroundSource | null>();
  private zoneCache = new Map<string, { zone: HeatUseZone; noBoreholes: boolean } | null>();
  private noiseCache = new Map<string, AirNoise>();
  private ringCache = new Map<string, XY[]>();
  private gridFor: Building[] | null = null;
  private grid = new PointGrid(NOISE_NEIGHBOUR_RADIUS_M);
  private byEgid = new Map<string, Building>();

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[]): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.buildingsProvider = buildingsProvider;
    const toXY = (rings: [number, number][][]) => rings.map((ring) => ring.map(([lon, lat]) => this.projection.toXY(lon, lat)));
    const heatUse = dataset.heatUse ?? null;
    this.hasAtlas = !!heatUse && heatUse.zones.length > 0;
    // A location in several zones takes the strictest (a protection zone lies inside its aquifer).
    this.zones = (heatUse?.zones ?? [])
      .map((z) => ({ zone: z.zone, noBoreholes: z.noBoreholes, polygons: z.rings.map(toXY) }))
      .sort((a, b) => a.zone.localeCompare(b.zone));
    this.conditions = (heatUse?.conditions ?? []).flatMap((c) => c.rings.map(toXY));
    this.tunnels = (heatUse?.tunnels ?? []).map((line) => line.map(([lon, lat]) => this.projection.toXY(lon, lat)));
    this.groundCache = new Map();
    this.zoneCache = new Map();
    this.noiseCache = new Map();
    this.ringCache = new Map();
    this.gridFor = null;
  }

  // --- the ground ---

  /** The atlas zone a building stands in, or null outside the atlas (or without one). */
  zoneOf(b: Building): { zone: HeatUseZone; noBoreholes: boolean } | null {
    let found = this.zoneCache.get(b.egid);
    if (found === undefined) {
      const p = this.projection.toXY(b.lon, b.lat);
      const z = this.zones.find((zone) => zone.polygons.some((rings) => pointInPolygon(p, rings)));
      found = z ? { zone: z.zone, noBoreholes: z.noBoreholes } : null;
      this.zoneCache.set(b.egid, found);
    }
    return found;
  }

  /** What a new ground-source heat pump for this building would draw on. */
  groundSource(b: Building, atMs: number): GroundSource {
    if (!this.hasAtlas) return { kind: "borehole", zone: null, conditions: false, costFactor: 1 };
    let source = this.groundCache.get(b.egid);
    if (source === undefined) {
      source = this.computeGround(b);
      this.groundCache.set(b.egid, source);
    }
    if (source && source.kind !== "groundwater") return source;
    // Groundwater depends on how big the system is, which changes with insulation work.
    const zoneInfo = this.zoneOf(b);
    const zone = zoneInfo?.zone ?? "F";
    const rule = GROUND_RULES[zone];
    const kw = designHeatLoadKw(b, atMs);
    if (rule.groundwaterFromKw !== null && kw >= rule.groundwaterFromKw) {
      return { kind: "groundwater", zone, costFactor: GROUNDWATER_COST_FACTOR, annualFeeRp: kw * GROUNDWATER_FEE_CHF_PER_KW_YEAR * 100 };
    }
    return { kind: "none", zone, reason: noGroundReason(zone, zoneInfo?.noBoreholes ?? false, rule.groundwaterFromKw, this.nearTunnel(b)) };
  }

  /** Boreholes, or null when the answer depends on the system's size (groundwater, or none). */
  private computeGround(b: Building): GroundSource | null {
    const zoneInfo = this.zoneOf(b);
    const zone = zoneInfo?.zone ?? null;
    const rule = GROUND_RULES[zone ?? "F"];
    const p = this.projection.toXY(b.lon, b.lat);
    const boreholes = rule.boreholes && !zoneInfo?.noBoreholes && !this.nearTunnel(b);
    if (!boreholes) return null;
    const conditions = rule.boreholeConditions || this.conditions.some((rings) => pointInPolygon(p, rings));
    return { kind: "borehole", zone, conditions, costFactor: conditions ? BOREHOLE_CONDITIONS_COST_FACTOR : 1 };
  }

  private nearTunnel(b: Building): boolean {
    if (this.tunnels.length === 0) return false;
    const p = this.projection.toXY(b.lon, b.lat);
    return this.tunnels.some((line) => line.some((q, i) => i > 0 && segmentDistance(p, line[i - 1], q) < TUNNEL_CLEARANCE_M));
  }

  // --- noise ---

  /** What it takes for an outdoor air heat pump on this building to meet the night limit, in the
   * year of `atMs`. `newBuild`: planned in from the start, so an indoor unit is cheap. */
  airNoise(b: Building, atMs: number, newBuild = false): AirNoise {
    const year = new Date(toDateMs(atMs)).getUTCFullYear();
    const key = `${b.egid}:${year}:${newBuild ? 1 : 0}`;
    let noise = this.noiseCache.get(key);
    if (noise) return noise;
    if (this.noiseCache.size > 20_000) this.noiseCache.clear();

    const zone = zoning.stateForBuilding(b, atMs)?.zone;
    const sensitivity: "II" | "III" = zone === "mixed" || zone === "centre" || zone === "work" ? "III" : "II";
    const distanceM = this.unitDistanceM(b, atMs);
    const years = Math.max(0, (atMs - 0) / YEAR_MS);
    const kw = Math.max(4, designHeatLoadKw(b, atMs));
    const soundPower = AIR_UNIT_SOUND_POWER_DB_AT_8KW + 10 * Math.log10(kw / 8) - Math.min(SOUND_POWER_IMPROVEMENT_MAX_DB, years * SOUND_POWER_IMPROVEMENT_DB_PER_YEAR);
    const ratingLevel = soundPower - 11 + NOISE_DIRECTIVITY_DB - 20 * Math.log10(distanceM) + NOISE_K1_NIGHT_DB + NOISE_K2_TONAL_DB;
    const excessDb = ratingLevel - NIGHT_PLANNING_VALUE_DB[sensitivity];

    // The cheapest measure that takes enough off.
    const options = NOISE_LADDER.filter((s) => s.uptoDb >= excessDb);
    const best = options.reduce<(typeof NOISE_LADDER)[number] | null>(
      (cheapest, s) => (!cheapest || (newBuild ? s.newBuildCostChf : s.costChf) < (newBuild ? cheapest.newBuildCostChf : cheapest.costChf) ? s : cheapest),
      null,
    );
    noise = best
      ? { excessDb, step: best.step, extraCostRp: (newBuild ? best.newBuildCostChf : best.costChf) * 100, label: best.label, distanceM, sensitivity }
      : { excessDb, step: "notPermitted", extraCostRp: 0, label: "too loud for its neighbours even indoors", distanceM, sensitivity };
    this.noiseCache.set(key, noise);
    return noise;
  }

  /** How far the unit is from the neighbours' windows: by the two nearest neighbours the building
   * isn't joined to (the unit goes on its quieter side), within the legal minimum and a cap.
   * Neighbours are buildings with noise-sensitive rooms — homes and anything bigger than a shed. */
  private unitDistanceM(b: Building, atMs: number): number {
    const own = this.ringOf(b);
    if (!own) return NOISE_MAX_DISTANCE_M / 2;
    const [x, y] = this.projection.toXY(b.lon, b.lat);
    const gaps: number[] = [];
    for (const id of this.neighbourGrid().query(x, y, NOISE_NEIGHBOUR_RADIUS_M)) {
      if (id === b.egid) continue;
      const other = this.byEgid.get(id);
      if (!other || !existsAt(other, atMs)) continue;
      // Sheds, garages and the like have no windows to protect.
      if (other.dwellings.length === 0 && (other.footprintAreaM2 ?? 0) < NOISE_SENSITIVE_MIN_FOOTPRINT_M2) continue;
      const ring = this.ringOf(other);
      if (!ring) continue;
      const gap = ringGap(own, ring);
      if (gap >= ATTACHED_GAP_M) gaps.push(gap);
    }
    gaps.sort((p, q) => p - q);
    const near = gaps.length === 0 ? NOISE_MAX_DISTANCE_M : gaps.length === 1 ? gaps[0] : (gaps[0] + gaps[1]) / 2;
    return Math.min(NOISE_MAX_DISTANCE_M, Math.max(NOISE_MIN_DISTANCE_M, near));
  }

  private ringOf(b: Building): XY[] | null {
    let ring = this.ringCache.get(b.egid);
    if (!ring) {
      if (!b.footprint || b.footprint.length < 3) return null;
      ring = b.footprint.map(([lon, lat]) => this.projection.toXY(lon, lat));
      this.ringCache.set(b.egid, ring);
    }
    return ring;
  }

  private neighbourGrid(): PointGrid {
    const all = this.buildingsProvider();
    if (this.gridFor !== all) {
      this.grid = new PointGrid(NOISE_NEIGHBOUR_RADIUS_M);
      this.byEgid = new Map();
      for (const o of all) {
        const [x, y] = this.projection.toXY(o.lon, o.lat);
        this.grid.insert(o.egid, x, y);
        this.byEgid.set(o.egid, o);
      }
      this.gridFor = all;
    }
    return this.grid;
  }

  // --- the map ---

  /** The Ground heat layer's colour for a building: what a new ground-source heat pump would draw on. */
  groundBucket(b: Building, atMs: number): "borehole" | "conditions" | "groundwater" | "none" {
    const source = this.groundSource(b, atMs);
    if (source.kind === "borehole") return source.conditions ? "conditions" : "borehole";
    return source.kind;
  }

  getZones(): ZoneShape[] {
    return this.zones;
  }

  getTunnels(): XY[][] {
    return this.tunnels;
  }

  hasHeatUseAtlas(): boolean {
    return this.hasAtlas;
  }

  toLonLat(p: XY): [number, number] {
    return this.projection.toLonLat(p[0], p[1]);
  }
}

/** The building's heat load on a cold winter day (kW) — what its heat pump is sized for. */
export function designHeatLoadKw(b: Building, atMs: number): number {
  return spaceHeatingThermalDemandW(b, DH_DESIGN_OUTDOOR_TEMP_C, DH_DESIGN_OUTDOOR_TEMP_C, atMs) / 1000;
}

function noGroundReason(zone: HeatUseZone, noBoreholes: boolean, groundwaterFromKw: number | null, nearTunnel: boolean): string {
  if (zone === "A") return "it stands in a groundwater protection zone around a drinking-water well, where nothing may be taken from the ground";
  const why = nearTunnel
    ? "boreholes have to keep clear of a tunnel"
    : noBoreholes || zone === "B"
      ? "no boreholes may be drilled into the drinking-water aquifer below"
      : "no boreholes may be drilled here";
  const groundwater =
    groundwaterFromKw !== null
      ? `, and groundwater may only be used by systems from about ${groundwaterFromKw} kW (a large building or several together)`
      : "";
  return `${why}${groundwater}`;
}

function segmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export const heatPumpSiting = new HeatPumpSiting();
