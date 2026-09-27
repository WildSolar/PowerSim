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
  BATTERY_COST_CHF,
  BATTERY_KW,
  BATTERY_MONTHS,
  GRID_FULL_SHARE,
  LOAD_CONTROL_OFF_SHARE_AT_PEAK,
  GRID_TIGHT_SHARE,
  MULTI_TRANSFORMER_STEP_KVA,
  REINFORCE_BASE_CHF,
  REINFORCE_CHF_PER_KVA,
  REINFORCE_MONTHS,
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
import { LocalProjection } from "./localGeo";
import { ghiWm2 } from "./pv";
import { publicCharging } from "./publicCharging";
import { hashSeed, mulberry32 } from "./rng";
import { snowDepthCm } from "./snow";
import { effectivePowerPlantsAt } from "./solarAdoption";
import { streets } from "./streets";
import { treasury } from "./treasury";
import { dailyMeanTempC } from "./weather";
import { setGridLimits } from "./gridLimits";
import { heatPumpPowerW } from "./heatPump";
import { policyStore } from "./policy";

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
  upgrades: { atMs: number; capacityKw: number }[];
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

class Grid {
  private areas: GridArea[] = [];
  private zones: [number, number][][] | null = null;
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

  /** The zone each station serves: the part of the map closer to it than to any other station —
   * which is exactly where its buildings are (each joins its nearest station). Drawn within the
   * buildings' extent plus a margin. [lon, lat] rings, by area id; computed once. */
  zonePolygons(): [number, number][][] {
    if (this.zones) return this.zones;
    const all = this.buildingsProvider();
    const xy = all.map((b) => this.projection.toXY(b.lon, b.lat));
    const margin = 300;
    const minX = Math.min(...xy.map((p) => p[0])) - margin;
    const maxX = Math.max(...xy.map((p) => p[0])) + margin;
    const minY = Math.min(...xy.map((p) => p[1])) - margin;
    const maxY = Math.max(...xy.map((p) => p[1])) + margin;
    this.zones = this.areas.map((a) => {
      let poly: [number, number][] = [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ];
      for (const o of this.areas) {
        if (o.id === a.id || poly.length === 0) continue;
        // Keep the side of the midline between the two stations that is closer to this one.
        const mx = (a.x + o.x) / 2;
        const my = (a.y + o.y) / 2;
        const nx = o.x - a.x;
        const ny = o.y - a.y;
        const side = (p: [number, number]) => (p[0] - mx) * nx + (p[1] - my) * ny;
        const clipped: [number, number][] = [];
        for (let i = 0; i < poly.length; i++) {
          const p = poly[i];
          const q = poly[(i + 1) % poly.length];
          const dp = side(p);
          const dq = side(q);
          if (dp <= 0) clipped.push(p);
          if (dp <= 0 !== dq <= 0) {
            const t = dp / (dp - dq);
            clipped.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
          }
        }
        poly = clipped;
      }
      const ring = poly.map(([x, y]) => this.projection.toLonLat(x, y) as [number, number]);
      return ring.length > 0 ? [...ring, ring[0]] : ring;
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
      changed = true;
    }
    if (summerDue > this.measuredSummer) {
      this.measure("summer", summerDue);
      this.measuredSummer = summerDue;
      changed = true;
    }
    if (changed) this.notify();
  }

  // --- the player ---

  /** Orders the next station size up for an area: paid now, in service once built. */
  reinforce(areaId: number, atMs: number): void {
    const area = this.areas[areaId];
    if (!area) return;
    const from = this.plannedCapacity(area);
    const pendingUntil = area.upgrades.reduce((latest, u) => Math.max(latest, u.atMs), atMs);
    area.upgrades.push({ atMs: Math.max(pendingUntil, atMs + REINFORCE_MONTHS * MONTH_MS), capacityKw: nextStationSize(from) });
    treasury.recordPayout("grid", atMs, reinforceCostRp(from), `grid-${areaId}`);
    this.notify();
  }

  /** Orders a neighbourhood battery for an area. */
  addBattery(areaId: number, atMs: number): void {
    const area = this.areas[areaId];
    if (!area) return;
    area.batteries.push({ atMs: atMs + BATTERY_MONTHS * MONTH_MS, kw: BATTERY_KW });
    treasury.recordPayout("grid", atMs, BATTERY_COST_CHF * 100, `grid-battery-${areaId}`);
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
