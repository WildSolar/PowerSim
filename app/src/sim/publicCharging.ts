/**
 * Public charging for electric cars. A household that can't charge at home (no own parking
 * space, no wallbox allowed — most flat-dwellers, few house owners) can only run an electric car
 * if a public charger it can rely on is within reach: an on-street (AC) charger within walking
 * distance, or a fast-charging (DC) hub within a short drive. Without one, an electric car is not
 * an option for it (mobility.ts marks it unavailable); with one, running it costs the charger's
 * price per kWh plus the hassle of charging in public, which grows with distance and with how
 * full the charger already is.
 *
 * Chargers have limited room: each charge point serves a few cars (CARS_PER_POINT). When a
 * household buys an electric car relying on public charging, the car is booked to its best site
 * with room — an assignment that lasts until the car is next replaced — so a site's usage at any
 * moment is simply the assignments covering it. A full site takes no new cars. Businesses' vans and
 * trucks without a yard to charge in (fleet.ts) are booked the same way, taking up room by the
 * energy they need — a van about two cars' worth, a truck about twenty (trucks only at fast
 * chargers). The municipality can also build lorry charging parks: high-power bays for businesses'
 * lorries and vans only, so cars can't fill them.
 *
 * Sites come from three places: the real ones in the federal register at game start (private),
 * the ones the player orders (municipal: built over a few months, their sales go to the treasury
 * at the tariff's public charging prices), and private operators: every New Year they look at the
 * unmet demand of the year before — households that would have bought an electric car but had no
 * charger with room in reach — expand full sites where that demand gathers, and open new
 * on-street sites where enough of it has no charger nearby.
 *
 * A publicly charged car draws its power at its site, not at home: on-street chargers mostly in
 * the evening, fast chargers during the day.
 */

import {
  BUILD_SPEC,
  CARS_PER_POINT,
  HASSLE_AT_REACH_CHF,
  HASSLE_BASE_CHF,
  HASSLE_WHEN_FULL_CHF,
  HOME_CHARGING_SHARE,
  HOME_CHARGING_SHARE_OTHER,
  OPERATOR_BUILD_MONTHS,
  OPERATOR_EXPAND_AT_USE,
  OPERATOR_EXPAND_POINTS,
  OPERATOR_MAX_NEW_SITES_PER_YEAR,
  OPERATOR_MAX_POINTS,
  OPERATOR_NEW_SITE_MIN_DEMAND,
  OPERATOR_NEW_SITE_POINTS,
  PRIVATE_PRICE_RP_PER_KWH,
  REACH_M,
  SESSION_DAY_SHARE,
  SESSION_POWER_KW,
  type ChargingKind,
  type ChargingVehicle,
} from "../config/charging";
import { ANNUAL_CAR_KM, EV_CAR_KWH_PER_100KM } from "../config/mobility";
import type { Building, Dwelling, MunicipalityDataset } from "../data/types";
import { buildingGroup } from "./buildingGroup";
import { toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { LocalProjection } from "./localGeo";
import { policyStore } from "./policy";
import { firstRandom, hashSeed, hashSeedFrom } from "./rng";
import { streets } from "./streets";
import { tariffStore } from "./tariffStore";
import { treasury } from "./treasury";
import { priceFactor } from "./costTrends";
import type { CostTrendId } from "../config/costTrends";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = (365.25 * DAY_MS) / 12;
const YEAR_MS = 365.25 * DAY_MS;
/** What an electric car needs a day, on average (kWh). */
export const CAR_DAILY_KWH = ((ANNUAL_CAR_KM / 100) * EV_CAR_KWH_PER_100KM) / 365;

export type SiteOwner = "private" | "municipal";

export interface ChargingSite {
  id: string;
  name: string;
  lon: number;
  lat: number;
  kind: ChargingKind;
  owner: SiteOwner;
  powerKw: number;
  /** The site opens with these points at `openedAtMs` (-Infinity: there at game start)... */
  points: number;
  openedAtMs: number;
  /** ...and gains more over time (a private operator expanding it). */
  expansions: { atMs: number; points: number }[];
  /** Sites placed in the game: the street they're on (naming the next one on it). */
  street?: string;
  x: number;
  y: number;
}

interface Assignment {
  siteId: string;
  fromMs: number;
  toMs: number; // Infinity while the vehicle is still in use
  /** The household slot (mobility.ts's handle), for asking whether it is actually driving; null
   * for a business vehicle, always on the road. */
  slot: unknown;
  seed: number; // the vehicle's charging-session randomness
  vehicle: ChargingVehicle;
  kWhPerDay: number;
  weight: number; // the room it takes, in cars' worth
}

/** What a vehicle needs from a charger: how much energy a day, and which kinds it can use. */
export interface ChargingNeed {
  vehicle: ChargingVehicle;
  kWhPerDay: number;
  kinds: ChargingKind[];
}

export const CAR_NEED: ChargingNeed = { vehicle: "car", kWhPerDay: CAR_DAILY_KWH, kinds: ["ac", "dc"] };

export type VehicleCounts = Record<ChargingVehicle, number>;

export interface ChargingOption {
  site: ChargingSite;
  priceRpPerKWh: number;
  hassleRp: number; // per year
}

export type PublicAccess = "public" | "fastOnly" | "full" | "none";

export interface BuildingChargingAccess {
  households: number;
  atHome: number;
  /** Where the households without home charging stand. */
  others: PublicAccess;
}

export interface SiteStats {
  points: number;
  capacity: number; // in cars' worth
  users: number; // room taken, in cars' worth
  vehicles: VehicleCounts;
  utilization: number; // users / capacity
  kWhPerDay: number;
  kWhLastYear: number;
  /** Municipal sites only: last year's sales, and the upkeep. */
  revenueLastYearRp: number;
  upkeepPerYearRp: number;
}

const BUILD_COST_TREND: Record<ChargingKind, CostTrendId> = { ac: "chargerAc", dc: "chargerDc", fleet: "chargerFleet" };

/** What building a municipal site of this kind costs at `atMs` (Rp) — chargers get cheaper. */
export function buildCostRp(kind: ChargingKind, atMs: number): number {
  return BUILD_SPEC[kind].costChf * 100 * priceFactor(BUILD_COST_TREND[kind], atMs);
}

const SITE_NAME_PREFIX: Record<ChargingKind, string> = { ac: "On-street charger", dc: "Fast-charging hub", fleet: "Lorry charging park" };

export function pointsAt(site: ChargingSite, atMs: number): number {
  if (atMs < site.openedAtMs) return 0;
  let points = site.points;
  for (const e of site.expansions) if (e.atMs <= atMs) points += e.points;
  return points;
}

export function siteCapacityAt(site: ChargingSite, atMs: number): number {
  return pointsAt(site, atMs) * CARS_PER_POINT[site.kind];
}

export function sitePriceRpPerKWh(site: ChargingSite): number {
  if (site.owner === "private") return PRIVATE_PRICE_RP_PER_KWH[site.kind];
  const tariff = tariffStore.get();
  return site.kind === "fleet" ? tariff.publicChargingFleetRpKWh : site.kind === "dc" ? tariff.publicChargingDcRpKWh : tariff.publicChargingAcRpKWh;
}

function yearStartMs(year: number): number {
  return toSimTimeMs(Date.UTC(year, 0, 1));
}

function yearOf(simTimeMs: number): number {
  return new Date(toDateMs(simTimeMs)).getUTCFullYear();
}

class PublicCharging {
  private sites: ChargingSite[] = [];
  private byId = new Map<string, ChargingSite>();
  private bySlot = new Map<string, Assignment[]>();
  private bySite = new Map<string, Assignment[]>();
  private unmet: { atMs: number; x: number; y: number; kind: ChargingKind }[] = [];
  private lastOperatorYear: number | null = null;
  private projection = new LocalProjection(8.4, 47.4);
  private buildingLookup: (egid: string) => Building | undefined = () => undefined;
  private isDriving: (slot: unknown, atMs: number) => boolean = () => true;
  private nextId = 0;
  private unsubscribeClock: (() => void) | null = null;

  // Planning UI state.
  private selectedSiteId: string | null = null;
  private placing: ChargingKind | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset, startMs: number): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.sites = [];
    this.byId = new Map();
    this.bySlot = new Map();
    this.bySite = new Map();
    this.unmet = [];
    this.lastOperatorYear = yearOf(startMs);
    this.selectedSiteId = null;
    this.placing = null;
    for (const s of dataset.chargingSites ?? []) {
      this.addSite({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, kind: s.kind, owner: "private", powerKw: s.powerKw, points: s.points, openedAtMs: Number.NEGATIVE_INFINITY });
    }
    this.unsubscribeClock?.();
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    this.notify();
  }

  /** The stock is the only one who can resolve a building by EGID (set by App at load, to keep
   * this module free of a dependency on stock.ts). */
  setBuildingLookup(lookup: (egid: string) => Building | undefined): void {
    this.buildingLookup = lookup;
  }

  /** mobility.ts's answer to "is this household slot driving right now" (the load only counts
   * cars that are in use). */
  setDrivingCheck(check: (slot: unknown, atMs: number) => boolean): void {
    this.isDriving = check;
  }

  lookupBuilding(egid: string): Building | undefined {
    return this.buildingLookup(egid);
  }

  private addSite(site: Omit<ChargingSite, "x" | "y" | "expansions">): ChargingSite {
    const [x, y] = this.projection.toXY(site.lon, site.lat);
    const full: ChargingSite = { ...site, expansions: [], x, y };
    this.sites.push(full);
    this.byId.set(full.id, full);
    this.bySite.set(full.id, []);
    return full;
  }

  getSites(): ChargingSite[] {
    return this.sites;
  }

  getSite(id: string): ChargingSite | undefined {
    return this.byId.get(id);
  }

  // --- home charging ---

  /** Whether a household can charge at home: a seeded draw per dwelling against its building
   * type's share, raised by the right-to-charge rule for those who couldn't (`atStart`: as things
   * stood before any rule). */
  homeChargingAt(building: Building, dwelling: Dwelling, { atStart = false } = {}): boolean {
    const group = buildingGroup(building);
    const base = (group && HOME_CHARGING_SHARE[group]) ?? HOME_CHARGING_SHARE_OTHER;
    const share = atStart ? base : base + policyStore.get().homeChargingBoost * (1 - base);
    return firstRandom(hashSeed(building.egid, dwelling.ewid, "home-charging")) < share;
  }

  // --- usage ---

  /** How much of a site's room is taken at `atMs`, in cars' worth. */
  usersAt(siteId: string, atMs: number): number {
    let n = 0;
    for (const a of this.bySite.get(siteId) ?? []) if (a.fromMs <= atMs && atMs < a.toMs) n += a.weight;
    return n;
  }

  /** The room a site has promised at or after `atMs`: every booking not yet ended by then, including
   * ones starting later. Decisions settle building by building each month, not strictly in time
   * order, so a booking for later in the month may already be made when an earlier one is decided —
   * the room check has to see it, or the site ends up over full. */
  private committedAt(siteId: string, atMs: number): number {
    let n = 0;
    for (const a of this.bySite.get(siteId) ?? []) if (atMs < a.toMs) n += a.weight;
    return n;
  }

  /** The vehicles relying on a site at `atMs`, by kind. */
  vehiclesAt(siteId: string, atMs: number): VehicleCounts {
    const counts: VehicleCounts = { car: 0, van: 0, truck: 0 };
    for (const a of this.bySite.get(siteId) ?? []) if (a.fromMs <= atMs && atMs < a.toMs) counts[a.vehicle]++;
    return counts;
  }

  private hassleRp(site: ChargingSite, distanceM: number, users: number, capacity: number): number {
    const kind = site.kind;
    const fill = capacity > 0 ? Math.min(1, users / capacity) : 1;
    return (HASSLE_BASE_CHF[kind] + HASSLE_AT_REACH_CHF[kind] * (distanceM / REACH_M[kind]) + HASSLE_WHEN_FULL_CHF[kind] * fill * fill) * 100;
  }

  /** The best public charger a vehicle at (lon, lat) could rely on at `atMs` — open, in reach, of a
   * kind it can use, with room for it — by price plus hassle over a year. Null when there is none. */
  bestOption(lon: number, lat: number, atMs: number, need: ChargingNeed = CAR_NEED): ChargingOption | null {
    const [x, y] = this.projection.toXY(lon, lat);
    const annualKWh = need.kWhPerDay * 365;
    const weight = need.kWhPerDay / CAR_DAILY_KWH;
    let best: (ChargingOption & { score: number }) | null = null;
    for (const site of this.sites) {
      if (!need.kinds.includes(site.kind)) continue;
      const distanceM = Math.hypot(site.x - x, site.y - y);
      if (distanceM > REACH_M[site.kind]) continue;
      const capacity = siteCapacityAt(site, atMs);
      if (capacity === 0) continue;
      const users = this.usersAt(site.id, atMs);
      if (this.committedAt(site.id, atMs) + weight > capacity) continue;
      const priceRpPerKWh = sitePriceRpPerKWh(site);
      const hassleRp = this.hassleRp(site, distanceM, users, capacity);
      const score = priceRpPerKWh * annualKWh + hassleRp;
      if (!best || score < best.score) best = { site, priceRpPerKWh, hassleRp, score };
    }
    return best && { site: best.site, priceRpPerKWh: best.priceRpPerKWh, hassleRp: best.hassleRp };
  }

  /** What relying on public charging would cost a household that has no charger in reach, had
   * there been an on-street one close by — so its decision can tell "wanted an electric car but
   * couldn't" apart from "didn't want one". */
  hypotheticalOptionCostRp(kind: ChargingKind = "ac"): { priceRpPerKWh: number; hassleRp: number } {
    return { priceRpPerKWh: PRIVATE_PRICE_RP_PER_KWH[kind], hassleRp: HASSLE_BASE_CHF[kind] * 100 };
  }

  /** Books a new electric vehicle to the site it will rely on. */
  assign(slotKey: string, slot: unknown, siteId: string, atMs: number, need: ChargingNeed = CAR_NEED): void {
    const a: Assignment = {
      siteId,
      fromMs: atMs,
      toMs: Number.POSITIVE_INFINITY,
      slot,
      seed: hashSeed(slotKey, "public-charging"),
      vehicle: need.vehicle,
      kWhPerDay: need.kWhPerDay,
      weight: need.kWhPerDay / CAR_DAILY_KWH,
    };
    this.assignmentsFor(slotKey).push(a);
    this.bySite.get(siteId)?.push(a);
  }

  /** The household's car was replaced: whatever it relied on is freed. */
  endAssignment(slotKey: string, atMs: number): void {
    const list = this.bySlot.get(slotKey);
    const last = list?.[list.length - 1];
    if (last && last.toMs === Number.POSITIVE_INFINITY && last.fromMs <= atMs) last.toMs = atMs;
  }

  /** A slot's assignments (created empty on first ask) — kept by mobility.ts's slot handle, so the
   * hot path checks them without a keyed lookup. */
  assignmentsFor(slotKey: string): Assignment[] {
    let list = this.bySlot.get(slotKey);
    if (!list) {
      list = [];
      this.bySlot.set(slotKey, list);
    }
    return list;
  }

  chargesPubliclyAt(assignments: Assignment[], atMs: number): boolean {
    for (let i = assignments.length - 1; i >= 0; i--) {
      const a = assignments[i];
      if (a.fromMs <= atMs) return atMs < a.toMs;
    }
    return false;
  }

  /** Someone who would have gone electric with a charger of `kind` close by, but had none with room. */
  logUnmetDemand(lon: number, lat: number, atMs: number, kind: ChargingKind = "ac"): void {
    const [x, y] = this.projection.toXY(lon, lat);
    this.unmet.push({ atMs, x, y, kind });
  }

  /** Households that would have bought an electric car between two instants but had no charger
   * with room in reach. */
  unmetDemandCount(fromMs: number, toMs: number): number {
    let n = 0;
    for (const d of this.unmet) if (d.atMs >= fromMs && d.atMs < toMs) n++;
    return n;
  }

  // --- load ---

  private assignmentLoadW(a: Assignment, kind: ChargingKind, atMs: number): number {
    const day = Math.floor(atMs / DAY_MS);
    const seed = hashSeedFrom(a.seed, String(day));
    const dayShare = SESSION_DAY_SHARE[a.vehicle][kind];
    if (firstRandom(seed) >= dayShare) return 0;
    const startHour = kind === "ac" ? 17.5 + firstRandom(seed ^ 0x5bd1e995) * 3 : 9 + firstRandom(seed ^ 0x5bd1e995) * 10;
    const powerKw = SESSION_POWER_KW[a.vehicle][kind];
    const energyKWh = a.kWhPerDay / dayShare;
    const startMs = day * DAY_MS + startHour * 3_600_000;
    const endMs = startMs + (energyKWh / powerKw) * 3_600_000;
    return atMs >= startMs && atMs < endMs ? powerKw * 1000 : 0;
  }

  siteLoadW(site: ChargingSite, atMs: number): number {
    let total = 0;
    for (const a of this.bySite.get(site.id) ?? []) {
      if (a.fromMs > atMs || atMs >= a.toMs || !this.isDriving(a.slot, atMs)) continue;
      total += this.assignmentLoadW(a, site.kind, atMs);
    }
    return total;
  }

  /** Every public charger's draw at `atMs` (for the town-wide electricity totals). */
  totalLoadW(atMs: number): number {
    let total = 0;
    for (const site of this.sites) total += this.siteLoadW(site, atMs);
    return total;
  }

  // --- statistics ---

  /** Energy a site delivered between two instants (kWh), from the cars relying on it. */
  energyKWh(site: ChargingSite, fromMs: number, toMs: number): number {
    let kWh = 0;
    for (const a of this.bySite.get(site.id) ?? []) {
      const overlap = Math.min(toMs, a.toMs) - Math.max(fromMs, a.fromMs);
      if (overlap > 0) kWh += (overlap / DAY_MS) * a.kWhPerDay;
    }
    return kWh;
  }

  upkeepPerYearRp(site: ChargingSite, atMs: number): number {
    return site.owner === "municipal" ? pointsAt(site, atMs) * BUILD_SPEC[site.kind].upkeepChfPerPointYear * 100 : 0;
  }

  stats(site: ChargingSite, atMs: number): SiteStats {
    const points = pointsAt(site, atMs);
    const capacity = siteCapacityAt(site, atMs);
    const users = this.usersAt(site.id, atMs);
    const kWhLastYear = this.energyKWh(site, atMs - YEAR_MS, atMs);
    let kWhPerDay = 0;
    for (const a of this.bySite.get(site.id) ?? []) if (a.fromMs <= atMs && atMs < a.toMs) kWhPerDay += a.kWhPerDay;
    return {
      points,
      capacity,
      users,
      vehicles: this.vehiclesAt(site.id, atMs),
      utilization: capacity > 0 ? users / capacity : 0,
      kWhPerDay,
      kWhLastYear,
      revenueLastYearRp: site.owner === "municipal" ? kWhLastYear * sitePriceRpPerKWh(site) : 0,
      upkeepPerYearRp: this.upkeepPerYearRp(site, atMs),
    };
  }

  /** The municipality's own chargers over a calendar year: energy sold, what it earned, and their
   * upkeep (finances.ts). */
  municipalYear(year: number): { kWh: number; revenueRp: number; upkeepRp: number } {
    const from = yearStartMs(year);
    const to = yearStartMs(year + 1);
    let kWh = 0;
    let revenueRp = 0;
    let upkeepRp = 0;
    for (const site of this.sites) {
      if (site.owner !== "municipal") continue;
      const siteKWh = this.energyKWh(site, from, to);
      kWh += siteKWh;
      revenueRp += siteKWh * sitePriceRpPerKWh(site);
      for (let m = 0; m < 12; m++) upkeepRp += this.upkeepPerYearRp(site, toSimTimeMs(Date.UTC(year, m, 15))) / 12;
    }
    return { kWh, revenueRp, upkeepRp };
  }

  // --- the map's and the panel's view ---

  /** How each building's households could charge an electric car at `atMs`: how many can at
   * home, and where the others stand — an on-street charger with room in reach ("public"), only a
   * fast-charging hub with room ("fastOnly"), chargers in reach but all full ("full"), or none in
   * reach ("none"). The same for every household of a building
   * without home charging, since they share its location. Buildings without households skipped. */
  householdAccess(buildings: Building[], atMs: number): Map<string, BuildingChargingAccess> {
    const open = this.sites
      .map((site) => ({ site, capacity: siteCapacityAt(site, atMs) }))
      .filter((s) => s.capacity > 0)
      .map((s) => ({ site: s.site, room: this.committedAt(s.site.id, atMs) + 1 <= s.capacity }));
    const result = new Map<string, BuildingChargingAccess>();
    for (const b of buildings) {
      if (b.dwellings.length === 0) continue;
      let atHome = 0;
      for (const d of b.dwellings) if (this.homeChargingAt(b, d)) atHome++;
      const [x, y] = this.projection.toXY(b.lon, b.lat);
      let others: PublicAccess = "none";
      for (const { site, room } of open) {
        if (!CAR_NEED.kinds.includes(site.kind)) continue; // lorry parks: not for cars
        if (Math.hypot(site.x - x, site.y - y) > REACH_M[site.kind]) continue;
        if (!room) {
          if (others === "none") others = "full";
          continue;
        }
        if (site.kind === "ac") {
          others = "public";
          break;
        }
        others = "fastOnly";
      }
      result.set(b.egid, { households: b.dwellings.length, atHome, others });
    }
    return result;
  }

  /** Vehicles relying on public charging, and the room taken against the room there is (in cars'
   * worth), across every open site. */
  townUsage(atMs: number): { users: number; capacity: number; points: number; sites: number; vehicles: VehicleCounts } {
    let users = 0;
    let capacity = 0;
    let points = 0;
    let sites = 0;
    const vehicles: VehicleCounts = { car: 0, van: 0, truck: 0 };
    for (const site of this.sites) {
      const cap = siteCapacityAt(site, atMs);
      if (cap === 0) continue;
      sites++;
      capacity += cap;
      points += pointsAt(site, atMs);
      users += this.usersAt(site.id, atMs);
      const v = this.vehiclesAt(site.id, atMs);
      vehicles.car += v.car;
      vehicles.van += v.van;
      vehicles.truck += v.truck;
    }
    return { users, capacity, points, sites, vehicles };
  }

  /** Charge points in use right now: the sessions under way, never more than the site has. */
  pointsInUseAt(site: ChargingSite, atMs: number): number {
    let inUse = 0;
    for (const a of this.bySite.get(site.id) ?? []) {
      if (a.fromMs > atMs || atMs >= a.toMs || !this.isDriving(a.slot, atMs)) continue;
      if (this.assignmentLoadW(a, site.kind, atMs) > 0) inUse++;
    }
    return Math.min(pointsAt(site, atMs), inUse);
  }

  /** The points a site will have once everything ordered is built. */
  plannedPoints(site: ChargingSite): number {
    return site.points + site.expansions.reduce((sum, e) => sum + e.points, 0);
  }

  // --- the player builds ---

  getPlacing(): ChargingKind | null {
    return this.placing;
  }

  startPlacing(kind: ChargingKind | null): void {
    this.placing = kind;
    this.notify();
  }

  /** A name for a new site on the street at (lon, lat): the kind and the street, and — for the
   * second and later of its kind on the same street — which side of the others it is on. */
  private nameFor(kind: ChargingKind, street: string | null, x: number, y: number): string {
    const base = `${SITE_NAME_PREFIX[kind]} ${street ?? "(unnamed street)"}`;
    const taken = new Set(this.sites.map((s) => s.name));
    const same = this.sites.filter((s) => s.kind === kind && s.street !== undefined && s.street === (street ?? ""));
    if (same.length === 0 && !taken.has(base)) return base;
    const cx = same.length > 0 ? same.reduce((sum, s) => sum + s.x, 0) / same.length : x;
    const cy = same.length > 0 ? same.reduce((sum, s) => sum + s.y, 0) / same.length : y;
    const dx = x - cx;
    const dy = y - cy;
    const ew = dx >= 0 ? "East" : "West";
    const ns = dy >= 0 ? "North" : "South";
    const [main, other] = Math.abs(dx) >= Math.abs(dy) ? [ew, ns] : [ns, ew];
    for (const qualifier of [main, `${ns}-${ew}`, other]) {
      const name = `${base} ${qualifier}`;
      if (!taken.has(name)) return name;
    }
    for (let n = 2; ; n++) if (!taken.has(`${base} ${main} ${n}`)) return `${base} ${main} ${n}`;
  }

  /** Orders a municipal site at the street nearest to (lon, lat): paid now, open once built. */
  build(kind: ChargingKind, lon: number, lat: number, atMs: number): ChargingSite | null {
    const snapped = streets.snapToStreet(lon, lat) ?? { lon, lat, distanceM: 0, street: null };
    const spec = BUILD_SPEC[kind];
    const [x, y] = this.projection.toXY(snapped.lon, snapped.lat);
    const site = this.addSite({
      id: `municipal-${this.nextId++}`,
      name: this.nameFor(kind, snapped.street, x, y),
      street: snapped.street ?? "",
      lon: snapped.lon,
      lat: snapped.lat,
      kind,
      owner: "municipal",
      powerKw: spec.powerKw,
      points: spec.points,
      openedAtMs: atMs + spec.buildMonths * MONTH_MS,
    });
    treasury.recordPayout("charging", atMs, buildCostRp(kind, atMs), site.id);
    this.placing = null;
    this.selectedSiteId = site.id;
    this.notify();
    return site;
  }

  getSelectedId(): string | null {
    return this.selectedSiteId;
  }

  select(id: string | null): void {
    this.selectedSiteId = id;
    this.notify();
  }

  // --- private operators ---

  /** Runs the private operators' yearly round for every New Year reached — see module doc. */
  advance(atMs: number): void {
    const year = yearOf(atMs);
    if (this.lastOperatorYear === null) this.lastOperatorYear = year;
    let changed = false;
    while (this.lastOperatorYear < year) {
      this.lastOperatorYear++;
      changed = this.operatorRound(this.lastOperatorYear) || changed;
    }
    if (changed) this.notify();
  }

  private operatorRound(year: number): boolean {
    const now = yearStartMs(year);
    const opensAt = now + OPERATOR_BUILD_MONTHS * MONTH_MS;
    // Operators build on-street chargers; demand only a fast-charging hub would meet (lorries) is left to the municipality.
    let demand = this.unmet.filter((d) => d.kind === "ac" && d.atMs >= yearStartMs(year - 1) && d.atMs < now);
    let changed = false;

    // Full sites with demand around them grow.
    for (const site of this.sites) {
      if (site.owner !== "private") continue;
      const capacity = siteCapacityAt(site, now);
      const points = pointsAt(site, now);
      if (capacity === 0 || points >= OPERATOR_MAX_POINTS || this.usersAt(site.id, now) / capacity < OPERATOR_EXPAND_AT_USE) continue;
      const near = demand.filter((d) => Math.hypot(d.x - site.x, d.y - site.y) <= REACH_M[site.kind]);
      if (near.length < 2) continue;
      site.expansions.push({ atMs: opensAt, points: Math.min(OPERATOR_EXPAND_POINTS, OPERATOR_MAX_POINTS - points) });
      demand = demand.filter((d) => !near.includes(d));
      changed = true;
    }

    // Where enough demand gathers with no charger around, a new on-street site opens.
    for (let n = 0; n < OPERATOR_MAX_NEW_SITES_PER_YEAR && demand.length >= OPERATOR_NEW_SITE_MIN_DEMAND; n++) {
      let bestGroup: typeof demand = [];
      for (const d of demand) {
        const group = demand.filter((o) => Math.hypot(o.x - d.x, o.y - d.y) <= REACH_M.ac);
        if (group.length > bestGroup.length) bestGroup = group;
      }
      if (bestGroup.length < OPERATOR_NEW_SITE_MIN_DEMAND) break;
      const cx = bestGroup.reduce((s, d) => s + d.x, 0) / bestGroup.length;
      const cy = bestGroup.reduce((s, d) => s + d.y, 0) / bestGroup.length;
      const [lon, lat] = this.projection.toLonLat(cx, cy);
      const snapped = streets.snapToStreet(lon, lat) ?? { lon, lat, distanceM: 0, street: null };
      const [sx, sy] = this.projection.toXY(snapped.lon, snapped.lat);
      this.addSite({
        id: `operator-${this.nextId++}`,
        name: this.nameFor("ac", snapped.street, sx, sy),
        street: snapped.street ?? "",
        lon: snapped.lon,
        lat: snapped.lat,
        kind: "ac",
        owner: "private",
        powerKw: 11,
        points: OPERATOR_NEW_SITE_POINTS,
        openedAtMs: opensAt,
      });
      demand = demand.filter((d) => !bestGroup.includes(d));
      changed = true;
    }
    return changed;
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

export const publicCharging = new PublicCharging();
