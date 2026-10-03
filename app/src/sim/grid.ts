/**
 * The local electricity grid: transformer areas, each fed by a station of limited capacity. Where
 * the real stations are isn't public, so the areas are drawn from the buildings: grouped by
 * location, weighted by their winter evening load, so each serves about one station's worth
 * (config/grid.ts). Each station was sized with some headroom over the peak it served when the game
 * starts.
 *
 * Twice a year the utility reads its meters: after the winter (the coldest January and February
 * evenings — heat pumps, cooking, cars plugging in) and after the summer (the sunniest middays, when
 * rooftop solar pushes power back up the line). An area whose peak — either way — exceeds its
 * station's capacity is overloaded: until it is reinforced (a bigger transformer, and the cables with
 * it) or a neighbourhood battery takes the edge off, it can't take new heat pumps, wallboxes or large
 * solar arrays (heatingRenewal.ts, mobility.ts, fleet.ts, solarAdoption.ts ask). The status holds
 * until the next reading.
 */

import {
  BATTERY_MONTHS,
  GRID_BATTERY_SIZES,
  GRID_FULL_SHARE,
  LOAD_CONTROL_OFF_SHARE_AT_PEAK,
  GRID_TIGHT_SHARE,
  MULTI_TRANSFORMER_STEP_KVA,
  REINFORCE_BASE_CHF,
  REINFORCE_CHF_PER_KVA,
  REINFORCE_MONTHS,
  ROUTINE_REINFORCEMENTS_PER_READING,
  START_HEADROOM_RANGE,
  SUMMER_MEASURED_MONTH,
  SUMMER_PEAK_DAYS,
  SUMMER_PEAK_HOUR,
  TARGET_AREA_PEAK_KW,
  TRANSFORMER_SIZES_KVA,
  WINTER_MEASURED_MONTH,
  WINTER_PEAK_DAYS,
  WINTER_PEAK_HOURS,
} from "../config/grid";
import type { Building, MunicipalityDataset, PowerPlant } from "../data/types";
import { buildingPowerW } from "./buildingPower";
import { toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { existsAt } from "./lifetime";
import {
  clipRingToHalfPlanes,
  clipSegmentToHalfPlanes,
  type HalfPlane,
  LocalProjection,
  segmentInsideRings,
  type XY,
} from "./localGeo";
import { ghiWm2 } from "./pv";
import { publicCharging } from "./publicCharging";
import { hashSeed, mulberry32 } from "./rng";
import { snowDepthCm } from "./snow";
import { effectivePowerPlantsAt } from "./solarAdoption";
import { streets } from "./streets";
import { treasury } from "./treasury";
import { priceFactor } from "./costTrends";
import { dailyMeanTempC } from "./weather";
import { setGridLimits } from "./gridLimits";
import { heatPumpPowerW } from "./heatPump";
import { policyStore } from "./policy";
import { spendingFrozen } from "./fiscalRules";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = (365.25 * DAY_MS) / 12;

export type GridBucket = "ok" | "tight" | "full" | "over";

export interface GridArea {
  id: number;
  name: string;
  lon: number;
  lat: number;
  x: number;
  y: number;
  startCapacityKw: number;
  /** Reinforcements: the capacity from `atMs` on. */
  upgrades: { atMs: number; capacityKw: number; byUtility?: boolean }[];
  batteries: { atMs: number; kw: number }[];
  /** The last readings: winter peak draw, summer peak feed-in (kW), and which year they're from. */
  winter: { year: number; peakKw: number } | null;
  summer: { year: number; exportKw: number } | null;
}

function yearOf(simTimeMs: number): number {
  return new Date(toDateMs(simTimeMs)).getUTCFullYear();
}

/** The smallest standard station at least this big (kVA ~ kW). */
function stationSizeFor(kw: number): number {
  for (const size of TRANSFORMER_SIZES_KVA) if (size >= kw) return size;
  return Math.ceil(kw / MULTI_TRANSFORMER_STEP_KVA) * MULTI_TRANSFORMER_STEP_KVA;
}

/** The next station size up from `kw`. */
function nextStationSize(kw: number): number {
  for (const size of TRANSFORMER_SIZES_KVA) if (size > kw) return size;
  return (Math.floor(kw / MULTI_TRANSFORMER_STEP_KVA) + 1) * MULTI_TRANSFORMER_STEP_KVA;
}

export function reinforceCostRp(fromKw: number): number {
  const toKw = nextStationSize(fromKw);
  return (REINFORCE_BASE_CHF + REINFORCE_CHF_PER_KVA * toKw) * 100;
}

/** A station's zone for the map, in [lon, lat]: its area as polygons, and its outline as lines. */
export interface GridZone {
  fill: [number, number][][][];
  edges: [number, number][][];
}

/** What a neighbourhood battery of GRID_BATTERY_SIZES[sizeIndex] costs if ordered at `atMs`. */
export function gridBatteryCostRp(sizeIndex: number, atMs: number): number {
  return Math.round((GRID_BATTERY_SIZES[sizeIndex].costChf * priceFactor("gridBattery", atMs)) / 1000) * 1000 * 100;
}

class Grid {
  private areas: GridArea[] = [];
  private zones: GridZone[] | null = null;
  private boundary: XY[][][] | null = null; // the municipality, in local metres: parts, then rings
  private areaOfEgid = new Map<string, number>();
  private projection = new LocalProjection(8.4, 47.4);
  private realPlants: PowerPlant[] = [];
  private buildingsProvider: () => Building[] = () => [];
  private measuredWinter = -Infinity;
  private measuredSummer = -Infinity;
  private selectedId: number | null = null;
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  /** Draws the areas and sizes their stations from the winter and summer before the game. After the
   * stock and everything that draws power is set up. */
  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[]): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.realPlants = dataset.powerPlants;
    this.buildingsProvider = buildingsProvider;
    this.areaOfEgid = new Map();
    this.zones = null;
    // Each ring without its closing point (the clipping treats rings as closed).
    this.boundary =
      dataset.boundary?.map((rings) =>
        rings.map((ring) => {
          const xy = ring.map(([lon, lat]) => this.projection.toXY(lon, lat));
          const [f, l] = [xy[0], xy[xy.length - 1]];
          return xy.length > 1 && f[0] === l[0] && f[1] === l[1] ? xy.slice(0, -1) : xy;
        }),
      ) ?? null;
    this.selectedId = null;
    const startYear = yearOf(0);

    // Each building's typical winter evening draw, to weight the grouping.
    const buildings = buildingsProvider().filter((b) => existsAt(b, 0));
    const winterTimes = this.winterTimes(startYear);
    const load = new Map<string, number>();
    for (const t of winterTimes) {
      const plants = effectivePowerPlantsAt(buildings, this.realPlants, t);
      const snow = snowDepthCm(t);
      for (const b of buildings) load.set(b.egid, (load.get(b.egid) ?? 0) + Math.max(0, buildingPowerW(b, t, plants, snow)) / 1000 / winterTimes.length);
    }
    this.areas = this.cluster(buildings, load);

    // The readings of the year before the game, and stations sized with headroom over them.
    this.measure("winter", startYear);
    this.measure("summer", startYear);
    for (const area of this.areas) {
      const peak = Math.max(area.winter?.peakKw ?? 0, area.summer?.exportKw ?? 0);
      const [lo, hi] = START_HEADROOM_RANGE;
      const headroom = lo + mulberry32(hashSeed("grid-headroom", String(area.id)))() * (hi - lo);
      area.startCapacityKw = stationSizeFor(Math.max(1, peak * headroom));
    }
    this.measuredWinter = startYear;
    this.measuredSummer = startYear;

    this.unsubscribeClock?.();
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    setGridLimits(
      (b, atMs) => this.drawBlockedAt(b, atMs),
      (b, atMs) => this.feedInBlockedAt(b, atMs),
    );
    this.notify();
  }

  // --- the areas ---

  /** Groups buildings into areas of about one station's winter load each: k-means on location,
   * weighted by load, from a seeded start. */
  private cluster(buildings: Building[], load: Map<string, number>): GridArea[] {
    const points = buildings.map((b) => {
      const [x, y] = this.projection.toXY(b.lon, b.lat);
      return { b, x, y, w: Math.max(0.5, load.get(b.egid) ?? 0) };
    });
    const total = points.reduce((sum, p) => sum + p.w, 0);
    const k = Math.max(1, Math.round(total / TARGET_AREA_PEAK_KW));
    const seeded = [...points].sort((a, c) => hashSeed(a.b.egid, "grid-seed") - hashSeed(c.b.egid, "grid-seed"));
    let centres = seeded.slice(0, k).map((p) => ({ x: p.x, y: p.y }));
    const assignment = new Array<number>(points.length).fill(0);
    for (let iteration = 0; iteration < 25; iteration++) {
      points.forEach((p, i) => {
        let best = 0;
        let bestD = Infinity;
        centres.forEach((c, j) => {
          const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
          if (d < bestD) {
            bestD = d;
            best = j;
          }
        });
        assignment[i] = best;
      });
      centres = centres.map((c, j) => {
        let sw = 0;
        let sx = 0;
        let sy = 0;
        points.forEach((p, i) => {
          if (assignment[i] !== j) return;
          sw += p.w;
          sx += p.x * p.w;
          sy += p.y * p.w;
        });
        return sw > 0 ? { x: sx / sw, y: sy / sw } : c;
      });
    }
    // A last pass against the final stations, so every building is in its nearest station's area —
    // the areas are then exactly the zones drawn on the map (zonePolygons).
    points.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centres.forEach((c, j) => {
        const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      assignment[i] = best;
    });
    const used = [...new Set(assignment)].sort((a, c) => a - c);
    const names = new Map<string, number>();
    return used.map((j, id) => {
      const [lon, lat] = this.projection.toLonLat(centres[j].x, centres[j].y);
      points.forEach((p, i) => {
        if (assignment[i] === j) this.areaOfEgid.set(p.b.egid, id);
      });
      const street = streets.snapToStreet(lon, lat)?.street ?? "Area";
      const n = (names.get(street) ?? 0) + 1;
      names.set(street, n);
      return {
        id,
        name: n === 1 ? street : `${street} ${n}`,
        lon,
        lat,
        x: centres[j].x,
        y: centres[j].y,
        startCapacityKw: 0,
        upgrades: [],
        batteries: [],
        winter: null,
        summer: null,
      };
    });
  }

  private nearestAreaId(lon: number, lat: number): number {
    const [x, y] = this.projection.toXY(lon, lat);
    let best = 0;
    let bestD = Infinity;
    for (const a of this.areas) {
      const d = (a.x - x) ** 2 + (a.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = a.id;
      }
    }
    return best;
  }

  /** The area a building is in (a new one joins its nearest station). */
  areaIdOf(b: Building): number {
    let id = this.areaOfEgid.get(b.egid);
    if (id === undefined) {
      id = this.nearestAreaId(b.lon, b.lat);
      this.areaOfEgid.set(b.egid, id);
    }
    return id;
  }

  /** The zone each station serves: the part of the town closer to it than to any other station —
   * which is exactly where its buildings are (each joins its nearest station) — cut to the municipal
   * boundary. `fill` is a multipolygon; `edges` are its outlines as lines, drawn only inside the town
   * (a cut along the boundary would otherwise leave seams outside it). [lon, lat], by area id;
   * computed once. */
  zonePolygons(): GridZone[] {
    if (this.zones) return this.zones;
    const boundary = this.boundary;
    // The extent the cells are cut from: the municipality, or without one the buildings, plus a margin.
    const extent = boundary ? boundary.flat(2) : this.buildingsProvider().map((b) => this.projection.toXY(b.lon, b.lat));
    const margin = 300;
    const minX = Math.min(...extent.map((p) => p[0])) - margin;
    const maxX = Math.max(...extent.map((p) => p[0])) + margin;
    const minY = Math.min(...extent.map((p) => p[1])) - margin;
    const maxY = Math.max(...extent.map((p) => p[1])) + margin;
    const box: XY[] = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    const allRings = boundary?.flat() ?? [];
    const toLonLat = (p: XY) => this.projection.toLonLat(p[0], p[1]);
    const lerp = (p: XY, q: XY, t: number): XY => [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    const close = (ring: XY[]) => [...ring, ring[0]].map(toLonLat);

    this.zones = this.areas.map((a) => {
      // Keep the side of each midline between this station and another that is closer to this one.
      const planes: HalfPlane[] = this.areas
        .filter((o) => o.id !== a.id)
        .map((o) => {
          const mx = (a.x + o.x) / 2;
          const my = (a.y + o.y) / 2;
          const nx = o.x - a.x;
          const ny = o.y - a.y;
          return (p: XY) => (p[0] - mx) * nx + (p[1] - my) * ny;
        });
      const cell = clipRingToHalfPlanes(box, planes);
      if (!boundary) {
        return cell.length >= 3 ? { fill: [[close(cell)]], edges: [close(cell)] } : { fill: [], edges: [] };
      }

      // The fill: each part of the municipality (with any enclaves as holes), cut to the cell.
      const fill: [number, number][][][] = [];
      for (const rings of boundary) {
        const outer = clipRingToHalfPlanes(rings[0], planes);
        if (outer.length < 3) continue;
        const holes = rings.slice(1).map((r) => clipRingToHalfPlanes(r, planes)).filter((r) => r.length >= 3);
        fill.push([outer, ...holes].map(close));
      }

      // The outline: the cell's sides where they run inside the town, and the town's border where it
      // runs through the cell. Consecutive pieces are joined into one line.
      const lines: XY[][] = [];
      let line: XY[] | null = null;
      const add = (p: XY, q: XY) => {
        const end = line?.[line.length - 1];
        if (line && end && end[0] === p[0] && end[1] === p[1]) line.push(q);
        else {
          line = [p, q];
          lines.push(line);
        }
      };
      for (let i = 0; i < cell.length; i++) {
        const p = cell[i];
        const q = cell[(i + 1) % cell.length];
        for (const [t0, t1] of segmentInsideRings(p, q, allRings)) add(lerp(p, q, t0), lerp(p, q, t1));
      }
      for (const ring of allRings) {
        line = null;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i];
          const q = ring[(i + 1) % ring.length];
          const kept = clipSegmentToHalfPlanes(p, q, planes);
          if (kept) add(lerp(p, q, kept[0]), lerp(p, q, kept[1]));
        }
      }
      return { fill, edges: lines.map((l) => l.map(toLonLat)) };
    });
    return this.zones;
  }

  getAreas(): GridArea[] {
    return this.areas;
  }

  getArea(id: number): GridArea | undefined {
    return this.areas[id];
  }

  // --- capacity and load ---

  capacityAt(area: GridArea, atMs: number): number {
    let kw = area.startCapacityKw;
    for (const u of area.upgrades) if (u.atMs <= atMs) kw = u.capacityKw;
    return kw;
  }

  /** The capacity once every ordered reinforcement is built. */
  plannedCapacity(area: GridArea): number {
    return area.upgrades.length > 0 ? area.upgrades[area.upgrades.length - 1].capacityKw : area.startCapacityKw;
  }

  batteryKwAt(area: GridArea, atMs: number): number {
    return area.batteries.reduce((sum, b) => sum + (b.atMs <= atMs ? b.kw : 0), 0);
  }

  /** The last readings, less what the area's batteries cover. */
  effectivePeaks(area: GridArea, atMs: number): { drawKw: number; feedInKw: number } {
    const battery = this.batteryKwAt(area, atMs);
    return { drawKw: Math.max(0, (area.winter?.peakKw ?? 0) - battery), feedInKw: Math.max(0, (area.summer?.exportKw ?? 0) - battery) };
  }

  /** Peak use as a share of capacity, the larger of the two directions. */
  loadShare(area: GridArea, atMs: number): number {
    const { drawKw, feedInKw } = this.effectivePeaks(area, atMs);
    return Math.max(drawKw, feedInKw) / this.capacityAt(area, atMs);
  }

  bucket(area: GridArea, atMs: number): GridBucket {
    const share = this.loadShare(area, atMs);
    if (share > 1) return "over";
    if (share >= GRID_FULL_SHARE) return "full";
    if (share >= GRID_TIGHT_SHARE) return "tight";
    return "ok";
  }

  /** Whether a building's area can't take more draw (heat pumps, wallboxes) at `atMs`. */
  drawBlockedAt(b: Building, atMs: number): boolean {
    const area = this.areas[this.areaIdOf(b)];
    return !!area && this.effectivePeaks(area, atMs).drawKw > this.capacityAt(area, atMs);
  }

  /** Whether a building's area can't take more feed-in (large solar arrays) at `atMs`. */
  feedInBlockedAt(b: Building, atMs: number): boolean {
    const area = this.areas[this.areaIdOf(b)];
    return !!area && this.effectivePeaks(area, atMs).feedInKw > this.capacityAt(area, atMs);
  }

  // --- readings ---

  /** The coldest evenings of January and February of `year`. */
  private winterTimes(year: number): number[] {
    const days: { t: number; temp: number }[] = [];
    for (let d = 0; d < 59; d++) {
      const t = toSimTimeMs(Date.UTC(year, 0, 1 + d));
      days.push({ t, temp: dailyMeanTempC(t + 12 * HOUR_MS) });
    }
    days.sort((a, c) => a.temp - c.temp);
    return days.slice(0, WINTER_PEAK_DAYS).flatMap((d) => WINTER_PEAK_HOURS.map((h) => d.t + h * HOUR_MS));
  }

  /** The sunniest middays of May to August of `year`. */
  private summerTimes(year: number): number[] {
    const days: { t: number; sun: number }[] = [];
    const from = toSimTimeMs(Date.UTC(year, 4, 1));
    const to = toSimTimeMs(Date.UTC(year, 8, 1));
    for (let t = from; t < to; t += DAY_MS) days.push({ t: t + SUMMER_PEAK_HOUR * HOUR_MS, sun: ghiWm2(t + SUMMER_PEAK_HOUR * HOUR_MS) });
    days.sort((a, c) => c.sun - a.sun);
    return days.slice(0, SUMMER_PEAK_DAYS).map((d) => d.t);
  }

  /** Reads every area's meters for a season: the highest total draw (winter) or feed-in (summer). */
  private measure(season: "winter" | "summer", year: number): void {
    const times = season === "winter" ? this.winterTimes(year) : this.summerTimes(year);
    const all = this.buildingsProvider();
    const peaks = new Array<number>(this.areas.length).fill(0);
    for (const t of times) {
      const sums = new Array<number>(this.areas.length).fill(0);
      const plants = effectivePowerPlantsAt(all, this.realPlants, t);
      const snow = snowDepthCm(t);
      // Heat pumps under load control: at a winter peak, part of them are switched off in turns.
      const controlled = season === "winter" ? policyStore.get().heatPumpLoadControlShare * LOAD_CONTROL_OFF_SHARE_AT_PEAK : 0;
      for (const b of all) {
        if (!existsAt(b, t)) continue;
        sums[this.areaIdOf(b)] += buildingPowerW(b, t, plants, snow) - (controlled > 0 ? controlled * heatPumpPowerW(b, t) : 0);
      }
      for (const site of publicCharging.getSites()) sums[this.nearestAreaId(site.lon, site.lat)] += publicCharging.siteLoadW(site, t);
      sums.forEach((w, i) => {
        const kw = season === "winter" ? w / 1000 : -w / 1000;
        if (kw > peaks[i]) peaks[i] = kw;
      });
    }
    this.areas.forEach((area, i) => {
      if (season === "winter") area.winter = { year, peakKw: peaks[i] };
      else area.summer = { year, exportKw: peaks[i] };
    });
  }

  /** Takes the readings once each season is over. */
  advance(atMs: number): void {
    const date = new Date(toDateMs(atMs));
    const year = date.getUTCFullYear();
    let changed = false;
    const winterDue = date.getUTCMonth() >= WINTER_MEASURED_MONTH ? year : year - 1;
    const summerDue = date.getUTCMonth() >= SUMMER_MEASURED_MONTH ? year : year - 1;
    if (winterDue > this.measuredWinter) {
      this.measure("winter", winterDue);
      this.measuredWinter = winterDue;
      this.routineReinforcement(atMs);
      changed = true;
    }
    if (summerDue > this.measuredSummer) {
      this.measure("summer", summerDue);
      this.measuredSummer = summerDue;
      this.routineReinforcement(atMs);
      changed = true;
    }
    if (changed) this.notify();
  }

  /** The utility's routine programme: after a reading, the worst overloaded areas with nothing on
   * order get the next station size, paid from grid upkeep (no treasury cost). */
  private routineReinforcement(atMs: number): void {
    const overloaded = this.areas
      .filter((a) => !a.upgrades.some((u) => u.atMs > atMs))
      .map((a) => {
        const { drawKw, feedInKw } = this.effectivePeaks(a, atMs);
        return { a, ratio: Math.max(drawKw, feedInKw) / this.capacityAt(a, atMs) };
      })
      .filter((x) => x.ratio > 1)
      .sort((x, y) => y.ratio - x.ratio)
      .slice(0, ROUTINE_REINFORCEMENTS_PER_READING);
    for (const { a } of overloaded) {
      a.upgrades.push({ atMs: atMs + REINFORCE_MONTHS * MONTH_MS, capacityKw: nextStationSize(this.plannedCapacity(a)), byUtility: true });
    }
  }

  // --- the player ---

  /** Orders the next station size up for an area: paid now, in service once built. */
  reinforce(areaId: number, atMs: number): void {
    const area = this.areas[areaId];
    if (!area || spendingFrozen(atMs)) return;
    const from = this.plannedCapacity(area);
    const pendingUntil = area.upgrades.reduce((latest, u) => Math.max(latest, u.atMs), atMs);
    area.upgrades.push({ atMs: Math.max(pendingUntil, atMs + REINFORCE_MONTHS * MONTH_MS), capacityKw: nextStationSize(from) });
    treasury.recordPayout("grid", atMs, reinforceCostRp(from), `grid-${areaId}`);
    this.notify();
  }

  /** Orders a neighbourhood battery for an area — one of GRID_BATTERY_SIZES. */
  addBattery(areaId: number, atMs: number, sizeIndex = 0): void {
    const area = this.areas[areaId];
    const size = GRID_BATTERY_SIZES[sizeIndex];
    if (!area || !size || spendingFrozen(atMs)) return;
    area.batteries.push({ atMs: atMs + BATTERY_MONTHS * MONTH_MS, kw: size.kw });
    treasury.recordPayout("grid", atMs, gridBatteryCostRp(sizeIndex, atMs), `grid-battery-${areaId}`);
    this.notify();
  }

  nextSizeFor(area: GridArea): number {
    return nextStationSize(this.plannedCapacity(area));
  }

  getSelectedId(): number | null {
    return this.selectedId;
  }

  select(id: number | null): void {
    this.selectedId = id;
    this.notify();
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

export const grid = new Grid();
