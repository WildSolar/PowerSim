/**
 * The local electricity grid: transformer areas, each fed by a station of limited capacity. Where
 * the real stations are isn't public, so they are placed from the buildings: grouped by location,
 * weighted by their winter evening load, so each serves about one station's worth (config/grid.ts),
 * and set on the nearest street. Each building then hangs off the station nearest to it by road
 * (gridAreas.ts) — cables follow the streets. Each station was sized with some headroom over the
 * peak it served when the game starts.
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
  SUMMER_PEAK_HUMP,
  WINTER_PEAK_HUMP,
  AUTO_REINFORCE_HEADROOM,
  BATTERY_MONTHS,
  GRID_BATTERY_SIZES,
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
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { liveBalanceRp } from "./finances";
import { simClock } from "./engine";
import { existsAt } from "./lifetime";
import { buildingCellZones, RoadAssignment } from "./gridAreas";
import { LocalProjection, type XY } from "./localGeo";
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
import { cannotPay, spendingFrozen } from "./fiscalRules";

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
  upgrades: { atMs: number; capacityKw: number; auto?: boolean }[];
  batteries: { atMs: number; kw: number; kwh?: number }[];
  /** The last readings: winter peak draw, summer peak feed-in (kW), and which year they're from. */
  winter: { year: number; peakKw: number } | null;
  summer: { year: number; exportKw: number } | null;
  /** Every reading so far, and the capacity it was read against (the charts). */
  readings?: { year: number; season: "winter" | "summer"; kw: number; capacityKw: number }[];
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

/** How much a battery can take off the top of a peak (kW): at most its power, and as much as its
 * storage lasts. Shaving the top `x` off a triangular hump `h` high and `w` hours wide takes
 * w·x²/(2h) kWh; beyond the hump, every further kW takes the whole w hours. */
export function shavedKw(peakKw: number, battery: { kw: number; kwh: number }, hump: { share: number; hours: number }): number {
  if (peakKw <= 0 || battery.kw <= 0) return 0;
  const h = peakKw * hump.share;
  const wholeHumpKWh = 0.5 * h * hump.hours;
  const byStorage = battery.kwh <= wholeHumpKWh ? Math.sqrt((2 * h * battery.kwh) / hump.hours) : h + (battery.kwh - wholeHumpKWh) / hump.hours;
  return Math.min(battery.kw, byStorage, peakKw);
}

/** The street most of these buildings are addressed on. */
function mostCommonStreet(buildings: Building[]): string | null {
  const counts = new Map<string, number>();
  for (const b of buildings) {
    const street = b.address?.replace(/\s+\S+$/, "").trim();
    if (street) counts.set(street, (counts.get(street) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [street, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = street;
  return best;
}

/** A new station of `toKw`: the transformer and the cables with it, whatever stood there before —
 * so one step to the size needed costs less than two smaller ones. */
export function reinforceCostRp(toKw: number): number {
  return (REINFORCE_BASE_CHF + REINFORCE_CHF_PER_KVA * toKw) * 100;
}

/** The station sizes above `kw` (the standard ones, then two or more units), the first `count`. */
function stationSizesAbove(kw: number, count: number): number[] {
  const sizes: number[] = [];
  for (let size = nextStationSize(kw); sizes.length < count; size = nextStationSize(size)) sizes.push(size);
  return sizes;
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
  /** The road network with every junction's nearest station, for buildings that come later. */
  private road: RoadAssignment | null = null;
  private zonesVersion = 0;
  private siteAreas = new Map<string, number>(); // derived from the road: no need to save
  private projection = new LocalProjection(8.4, 47.4);
  private realPlants: PowerPlant[] = [];
  private buildingsProvider: () => Building[] = () => [];
  private measuredWinter = -Infinity;
  private measuredSummer = -Infinity;
  /** The player's setting: reinforce overloaded stations after each reading, money permitting. */
  private autoReinforce = false;
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
    this.autoReinforce = false;
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
    this.siteAreas = new Map();
    this.areas = this.cluster(buildings, load);
    this.road = this.roadFor(this.areas.map((a) => [a.x, a.y] as XY));

    // The readings of the year before the game, and stations sized with headroom over them.
    this.measure("winter", startYear);
    this.measure("summer", startYear);
    for (const area of this.areas) {
      const peak = Math.max(area.winter?.peakKw ?? 0, area.summer?.exportKw ?? 0);
      const [lo, hi] = START_HEADROOM_RANGE;
      const headroom = lo + mulberry32(hashSeed("grid-headroom", String(area.id)))() * (hi - lo);
      area.startCapacityKw = stationSizeFor(Math.max(1, peak * headroom));
      for (const r of area.readings ?? []) r.capacityKw = area.startCapacityKw;
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
    // The stations onto the streets, and every building to the station nearest by road.
    const road = this.roadFor(centres.map((c) => [c.x, c.y] as XY));
    const placed = road.stationPositions();
    centres = placed.map(([x, y]) => ({ x, y }));
    points.forEach((p, i) => {
      assignment[i] = road.stationFor(p.b);
    });
    const used = [...new Set(assignment)].sort((a, c) => a - c);
    const names = new Map<string, number>();
    return used.map((j, id) => {
      const [lon, lat] = this.projection.toLonLat(centres[j].x, centres[j].y);
      points.forEach((p, i) => {
        if (assignment[i] === j) this.areaOfEgid.set(p.b.egid, id);
      });
      const street = mostCommonStreet(points.filter((_, i) => assignment[i] === j).map((p) => p.b)) ?? streets.snapToStreet(lon, lat)?.street ?? "Area";
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

  /** The road network, with each junction's nearest station (by index into `stations`). */
  private roadFor(stations: XY[]): RoadAssignment {
    return new RoadAssignment(streets.all(), (id) => streets.nodesOf(id), this.projection, stations);
  }

  /** The area a building is in (a new one joins the station nearest by road). */
  areaIdOf(b: Building): number {
    let id = this.areaOfEgid.get(b.egid);
    if (id === undefined) {
      id = this.road ? this.road.stationFor(b) : 0;
      this.areaOfEgid.set(b.egid, id); // its cell joins the map with the next reading
    }
    return id;
  }

  /** The area a public charger on the street draws from (by road, like a building). */
  private siteAreaId(lon: number, lat: number): number {
    const key = `${lon},${lat}`;
    let id = this.siteAreas.get(key);
    if (id === undefined) {
      id = this.road ? this.road.stationAt(lon, lat) : 0;
      this.siteAreas.set(key, id);
    }
    return id;
  }

  /** Changes whenever the zones are redrawn (a new building joined an area). */
  getZonesVersion(): number {
    return this.zonesVersion;
  }

  /** The zone each station serves, for the map: its buildings' cells (gridAreas.ts), cut to the
   * municipal boundary. `fill` is a multipolygon; `edges` its borders with other areas and with
   * the open land, inside the town. [lon, lat], by area id; redrawn with each reading, taking in
   * the buildings that have joined since. */
  zonePolygons(): GridZone[] {
    if (this.zones) return this.zones;
    const now = simClock.getSimTimeMs();
    const points = this.buildingsProvider()
      .filter((b) => existsAt(b, now))
      .map((b) => {
        const [x, y] = this.projection.toXY(b.lon, b.lat);
        return { x, y, area: this.areaIdOf(b) };
      });
    this.zones = buildingCellZones(points, this.areas.length, this.boundary, (p) => this.projection.toLonLat(p[0], p[1]));
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

  /** Every neighbourhood battery in service at `atMs`, together: power (kW) and storage (kWh). */
  batteriesInService(atMs: number): { kw: number; kwh: number } {
    let kw = 0;
    let kwh = 0;
    for (const a of this.areas)
      for (const b of a.batteries)
        if (b.atMs <= atMs) {
          kw += b.kw;
          kwh += b.kwh ?? b.kw * 2;
        }
    return { kw, kwh };
  }

  batteryKwAt(area: GridArea, atMs: number): number {
    return area.batteries.reduce((sum, b) => sum + (b.atMs <= atMs ? b.kw : 0), 0);
  }

  /** The area's batteries in service at `atMs`, together: power (kW) and storage (kWh). */
  batteriesAt(area: GridArea, atMs: number): { kw: number; kwh: number } {
    let kw = 0;
    let kwh = 0;
    for (const b of area.batteries)
      if (b.atMs <= atMs) {
        kw += b.kw;
        kwh += b.kwh ?? b.kw * 2;
      }
    return { kw, kwh };
  }

  /** The last readings, less what the area's batteries can shave off them (shavedKw). */
  effectivePeaks(area: GridArea, atMs: number): { drawKw: number; feedInKw: number } {
    const battery = this.batteriesAt(area, atMs);
    const draw = area.winter?.peakKw ?? 0;
    const feedIn = area.summer?.exportKw ?? 0;
    return {
      drawKw: Math.max(0, draw - shavedKw(draw, battery, WINTER_PEAK_HUMP)),
      feedInKw: Math.max(0, feedIn - shavedKw(feedIn, battery, SUMMER_PEAK_HUMP)),
    };
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
      // On-street chargers hang off the local station; a fast-charging hub or a lorry park has its own
      // transformer on the medium-voltage grid (it comes with the site, config/charging.ts).
      for (const site of publicCharging.getSites()) if (site.kind === "ac") sums[this.siteAreaId(site.lon, site.lat)] += publicCharging.siteLoadW(site, t);
      sums.forEach((w, i) => {
        const kw = season === "winter" ? w / 1000 : -w / 1000;
        if (kw > peaks[i]) peaks[i] = kw;
      });
    }
    const readAtMs = toSimTimeMs(Date.UTC(year, season === "winter" ? 2 : 8, 1));
    this.areas.forEach((area, i) => {
      if (season === "winter") area.winter = { year, peakKw: peaks[i] };
      else area.summer = { year, exportKw: peaks[i] };
      (area.readings ??= []).push({ year, season, kw: peaks[i], capacityKw: this.capacityAt(area, readAtMs) });
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
      this.reinforceAutomatically(atMs);
      changed = true;
    }
    if (summerDue > this.measuredSummer) {
      this.measure("summer", summerDue);
      this.measuredSummer = summerDue;
      this.reinforceAutomatically(atMs);
      changed = true;
    }
    if (changed) {
      this.zones = null;
      this.zonesVersion++;
      this.notify();
    }
  }

  /** The player's automatic reinforcement, if switched on: after a reading, each overloaded station
   * with nothing on order gets the size its peak needs (with some headroom), worst first, as long as
   * the treasury has the money — a station it can't pay for waits for the next reading. */
  private reinforceAutomatically(atMs: number): void {
    if (!this.autoReinforce || spendingFrozen(atMs)) return;
    let balance = liveBalanceRp(this.buildingsProvider(), atMs, BASELINE_YEAR);
    if (balance === null) return;
    const overloaded = this.areas
      .filter((a) => !this.pendingUpgrade(a, atMs))
      .map((a) => {
        const { drawKw, feedInKw } = this.effectivePeaks(a, atMs);
        const peakKw = Math.max(drawKw, feedInKw);
        return { a, peakKw, ratio: peakKw / this.capacityAt(a, atMs) };
      })
      .filter((x) => x.ratio > 1)
      .sort((x, y) => y.ratio - x.ratio);
    for (const { a, peakKw } of overloaded) {
      const toKw = Math.max(nextStationSize(this.plannedCapacity(a)), stationSizeFor(peakKw * AUTO_REINFORCE_HEADROOM));
      const costRp = reinforceCostRp(toKw);
      if (costRp > balance) continue;
      a.upgrades.push({ atMs: atMs + REINFORCE_MONTHS * MONTH_MS, capacityKw: toKw, auto: true });
      treasury.recordPayout("grid", atMs, costRp, `grid-${a.id}`);
      balance -= costRp;
    }
  }

  getAutoReinforce(): boolean {
    return this.autoReinforce;
  }

  setAutoReinforce(on: boolean): void {
    this.autoReinforce = on;
    this.notify();
  }

  // --- the player ---

  /** The reinforcement under way at an area, if any. */
  pendingUpgrade(area: GridArea, atMs: number): GridArea["upgrades"][number] | undefined {
    return area.upgrades.find((u) => u.atMs > atMs);
  }

  /** The sizes the player can order for an area, and what each costs — none while an order is
   * under way. */
  reinforceOptions(area: GridArea, atMs: number): { kw: number; costRp: number }[] {
    if (this.pendingUpgrade(area, atMs)) return [];
    return stationSizesAbove(this.plannedCapacity(area), 3).map((kw) => ({ kw, costRp: reinforceCostRp(kw) }));
  }

  /** Orders a bigger station for an area (one of reinforceOptions; the smallest if not said): paid
   * now, in service once built. */
  reinforce(areaId: number, atMs: number, toKw?: number): void {
    const area = this.areas[areaId];
    if (!area || spendingFrozen(atMs)) return;
    const options = this.reinforceOptions(area, atMs);
    const option = toKw === undefined ? options[0] : options.find((o) => o.kw === toKw);
    if (!option || cannotPay(option.costRp, atMs)) return;
    area.upgrades.push({ atMs: atMs + REINFORCE_MONTHS * MONTH_MS, capacityKw: option.kw });
    treasury.recordPayout("grid", atMs, option.costRp, `grid-${areaId}`);
    this.notify();
  }

  /** Orders a neighbourhood battery for an area — one of GRID_BATTERY_SIZES. */
  addBattery(areaId: number, atMs: number, sizeIndex = 0): void {
    const area = this.areas[areaId];
    const size = GRID_BATTERY_SIZES[sizeIndex];
    if (!area || !size || cannotPay(gridBatteryCostRp(sizeIndex, atMs), atMs)) return;
    area.batteries.push({ atMs: atMs + BATTERY_MONTHS * MONTH_MS, kw: size.kw, kwh: size.kwh });
    treasury.recordPayout("grid", atMs, gridBatteryCostRp(sizeIndex, atMs), `grid-battery-${areaId}`);
    this.notify();
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

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { areas: this.areas, areaOfEgid: this.areaOfEgid, measuredWinter: this.measuredWinter, measuredSummer: this.measuredSummer, autoReinforce: this.autoReinforce };
  }

  restore(s: ReturnType<Grid["snapshot"]>): void {
    this.areas = s.areas;
    this.areaOfEgid = s.areaOfEgid;
    this.measuredWinter = s.measuredWinter;
    this.measuredSummer = s.measuredSummer;
    this.autoReinforce = s.autoReinforce ?? false;
    this.road = this.roadFor(this.areas.map((a) => [a.x, a.y] as XY));
    this.siteAreas = new Map();
    this.zones = null;
    this.zonesVersion++;
    this.selectedId = null;
    this.notify();
  }
}

export const grid = new Grid();
