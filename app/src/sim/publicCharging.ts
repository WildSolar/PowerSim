/**
 * Public charging for electric cars. A household that can't charge at home (no own parking
 * space, no wallbox allowed — most flat-dwellers, few house owners) relies on public chargers,
 * and how well that works is a quality of service from 0 to 1 (config/charging.ts): each charger
 * offers one that falls with the distance along the streets (streetDistance.ts) — on foot to an
 * on-street charger, by car to a fast-charging hub or a shop's car park — and with how busy it is;
 * charging at work is one more source for those who can. Several sources add up, each covering
 * part of what the others leave. Below a floor an electric car is not an option (mobility.ts marks
 * it unavailable); above it, running one costs the chargers' price per kWh plus a hassle that
 * shrinks as the quality rises.
 *
 * Chargers have limited room: each charge point serves a few cars (CARS_PER_POINT), and a site
 * gets less useful as it fills, taking nobody new beyond MAX_FILL. When a household buys an
 * electric car relying on public charging, its charging is shared out among its sources by what
 * each contributes, and the car is booked to each of those sites for its share — bookings that last
 * until the car is next replaced — so a site's usage at any moment is simply the bookings covering
 * it. Businesses' vans and trucks without a yard to charge in (fleet.ts) are booked the same way,
 * taking up room by the energy they need — a van about two cars' worth, a truck about twenty
 * (trucks only at fast chargers). The municipality can also build lorry charging parks:
 * high-power bays for businesses' lorries and vans only, so cars can't fill them.
 *
 * Sites come from three places: the real ones in the federal register at game start (private),
 * the ones the player orders (municipal: built over a few months, their sales go to the treasury
 * at the tariff's public charging prices), and private operators: every New Year they look at the
 * unmet demand of the year before — households that would have bought an electric car with an
 * on-street charger next door but didn't — expand busy sites where that demand gathers, open
 * new on-street sites where enough of it has none close by, and put chargers in the car park of
 * a large shop where enough of what is left gathers around it.
 *
 * A publicly charged car draws its power at its sites, not at home: on-street chargers mostly in
 * the evening, fast chargers and shops' car parks during the day; what it charges at work is drawn
 * where its driver works, mostly outside the town.
 */

import { timed } from "./devTiming";
import {
  BUILD_SPEC,
  SITE_SIZES,
  UPGRADE_EXTRA_CHF,
  UPGRADE_MONTHS,
  type SiteSize,
  BUSY_QOS,
  CARS_PER_POINT,
  DEMAND_RADIUS_M,
  HASSLE_CHF,
  HOME_CHARGING_SHARE,
  HOME_CHARGING_SHARE_OTHER,
  WALLBOX_COST_CHF,
  WALLBOX_RIGHT_TO_CHARGE_EXTRA_CHF,
  OPERATOR_BUILD_MONTHS,
  OPERATOR_EXPAND_AT_USE,
  OPERATOR_EXPAND_POINTS,
  OPERATOR_MAX_NEW_SITES_PER_YEAR,
  OPERATOR_MAX_POINTS,
  OPERATOR_NEW_SITE_MIN_DEMAND,
  OPERATOR_NEW_SITE_POINTS,
  OPERATOR_MAX_NEW_SHOPS_PER_YEAR,
  OPERATOR_NEW_SHOP_MIN_DEMAND,
  OPERATOR_SHOP_MIN_FOOTPRINT_M2,
  OPERATOR_SHOP_POINTS,
  OPERATOR_SHOP_POWER_KW,
  SHOP_CAR_PARK_M,
  MAX_FILL,
  PRIVATE_PRICE_RP_PER_KWH,
  QOS_CURVE,
  QOS_FLOOR,
  QOS_MAX_SOURCES,
  QOS_MIN_SHARE,
  SESSION_DAY_SHARE,
  SESSION_POWER_KW,
  SHOP_SITE_NAME,
  WORK_CHARGING_PRICE_RP_PER_KWH,
  WORK_CHARGING_QOS,
  WORK_CHARGING_SHARE,
  type ChargingKind,
  type ChargingVehicle,
  type QosKind,
} from "../config/charging";
import { interpolateCurve } from "../config/curve";
import { ANNUAL_CAR_KM, EV_CAR_KWH_PER_100KM } from "../config/mobility";
import type { Building, Dwelling, MunicipalityDataset } from "../data/types";
import { toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { LocalProjection } from "./localGeo";
import { policyStore } from "./policy";
import { buildingGroup } from "./buildingGroup";
import { commercialCategory } from "./commercial";
import { existsAt } from "./lifetime";
import { firstRandom, hashSeed, hashSeedFrom } from "./rng";
import { streets } from "./streets";
import { streetDistance, type StreetAttachment, type TravelMode } from "./streetDistance";
import { tariffStore } from "./tariffStore";
import { treasury } from "./treasury";
import { priceFactor } from "./costTrends";
import type { CostTrendId } from "../config/costTrends";
import { cannotPay, spendingFrozen } from "./fiscalRules";

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
  /** A municipal site in the car park of one of its public buildings. */
  atBuildingEgid?: string;
  /** On-street points in a shop's car park (the register's sites, by name): used while shopping. */
  shop?: boolean;
  x: number;
  y: number;
}

/** A booking's site id for charging at work (no site of the town's). */
export const AT_WORK = "work";

interface Assignment {
  /** The site, or AT_WORK. */
  siteId: string;
  fromMs: number;
  toMs: number; // Infinity while the vehicle is still in use
  /** The household slot (mobility.ts's handle), for asking whether it is actually driving; null
   * for a business vehicle, always on the road. */
  slot: unknown;
  seed: number; // the vehicle's charging-session randomness
  vehicle: ChargingVehicle;
  /** The share of the vehicle's charging done here. */
  share: number;
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

/** One source of a vehicle's charging: a public site, or (site null) charging at work. */
export interface ChargingSource {
  site: ChargingSite | null;
  distanceM: number;
  /** Its quality of service on its own (0-1). */
  qos: number;
  /** The share of the vehicle's charging done here. */
  share: number;
}

/** How a vehicle without a charger of its own would charge: the quality of service of its sources
 * together, the ones it would count on, and what that costs a year beyond the energy. */
export interface ChargingOption {
  qos: number;
  sources: ChargingSource[];
  priceRpPerKWh: number;
  hassleRp: number; // per year
}

export interface BuildingChargingAccess {
  households: number;
  /** Households with a wallbox. */
  atHome: number;
  /** Households without one that may put one in. */
  mayInstall: number;
  /** The quality of public charging for its households without home charging (charging at work,
   * which is each person's own, aside). */
  qos: number;
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

/** Quotes are in whole thousands of francs, as a contractor would give them (Rp). */
function roundToThousandChfRp(chf: number): number {
  return Math.round(chf / 1000) * 1000 * 100;
}

/** The sizes a municipal site of this kind can be built in (one, for a kind without a choice). */
export function sizesFor(kind: ChargingKind): SiteSize[] {
  const spec = BUILD_SPEC[kind];
  return SITE_SIZES[kind] ?? [{ points: spec.points, costChf: spec.costChf, buildMonths: spec.buildMonths }];
}

function sizeOf(kind: ChargingKind, points: number): SiteSize {
  const sizes = sizesFor(kind);
  return sizes.find((s) => s.points === points) ?? sizes[0];
}

/** What building a municipal site of this kind and size costs at `atMs` (Rp) — chargers get cheaper
 * over time. */
export function buildCostRp(kind: ChargingKind, atMs: number, points = BUILD_SPEC[kind].points): number {
  return roundToThousandChfRp(sizeOf(kind, points).costChf * priceFactor(BUILD_COST_TREND[kind], atMs));
}

/** Enlarging a municipal site of this kind from `fromPoints` to `toPoints` at `atMs` (Rp). */
export function upgradeCostRp(kind: ChargingKind, fromPoints: number, toPoints: number, atMs: number): number {
  const chf = sizeOf(kind, toPoints).costChf - sizeOf(kind, fromPoints).costChf + (UPGRADE_EXTRA_CHF[kind] ?? 0);
  return roundToThousandChfRp(chf * priceFactor(BUILD_COST_TREND[kind], atMs));
}

/** How long building a municipal site of this kind and size takes (months). */
export function buildMonthsFor(kind: ChargingKind, points = BUILD_SPEC[kind].points): number {
  return sizeOf(kind, points).buildMonths;
}

/** What the player is placing: a kind of site and, on-street, its size. */
export interface Placing {
  kind: ChargingKind;
  points: number;
}

// Public buildings closer together than this are one campus, sharing one charging site.
const PUBLIC_BUILDING_CAMPUS_M = 120;

/** A building's address without its sub-number or letter ("Hofackerstrasse 2.3" -> "Hofackerstrasse 2"). */
function campusAddress(address: string | null): string | null {
  if (!address) return null;
  return /^(.*?\s\d+)/.exec(address.trim())?.[1] ?? address.trim();
}

const SITE_NAME_PREFIX: Record<ChargingKind, string> = { ac: "On-street charger", dc: "Fast-charging hub", fleet: "Lorry charging park" };

/** Which quality curve a site follows: its kind, or a shop's car park. */
export function qosKindOf(site: Pick<ChargingSite, "kind" | "shop">): QosKind {
  return site.shop ? "shop" : site.kind;
}

/** How a household gets to a site: on foot to an on-street charger, by car to the rest. */
function travelModeOf(kind: QosKind): TravelMode {
  return kind === "ac" ? "walk" : "drive";
}

/** How far anyone goes to a site of this kind, along the streets (m). */
export function qosReachM(kind: QosKind): number {
  return QOS_CURVE[kind].plateauM + QOS_CURVE[kind].fadeM;
}

/** A site's quality of service at a distance, as yet unaffected by how busy it is. */
export function qosAtDistance(kind: QosKind, distanceM: number): number {
  const c = QOS_CURVE[kind];
  const t = Math.max(0, Math.min(1, (distanceM - c.plateauM) / c.fadeM));
  return c.ceiling * (1 - t * t * (3 - 2 * t));
}

/** What a site's busyness leaves of its quality, at `fill` (room taken over its room). */
export function busyFactor(kind: ChargingKind, fill: number): number {
  const { from, atFull } = BUSY_QOS[kind];
  if (fill <= from) return 1;
  if (fill <= 1) return 1 - ((1 - atFull) * (fill - from)) / (1 - from);
  return Math.max(0, atFull * (1 - (fill - 1) / (MAX_FILL - 1)));
}

/** The nuisance of relying on public charging at this quality of service (Rp a year). */
export function hassleRp(vehicle: ChargingVehicle, qos: number): number {
  const h = HASSLE_CHF[vehicle];
  return (h.base + h.span * (1 - Math.min(1, qos))) * 100;
}

/** The share of drivers who can charge at work at `atMs`: the employers' own progress, raised by
 * the municipality's programme. */
export function workChargingShareAt(atMs: number): number {
  const base = interpolateCurve(WORK_CHARGING_SHARE, new Date(toDateMs(atMs)).getUTCFullYear());
  return base + policyStore.get().workChargingBoost * (1 - base);
}

/** Whether a household member (a mobility slot) can charge at work at `atMs` — a seeded draw against
 * the share, so someone who can keeps being able to as the share grows. */
export function canChargeAtWork(egid: string, ewid: string, slotIndex: number, atMs: number): boolean {
  return firstRandom(hashSeed(egid, ewid, String(slotIndex), "work-charging")) < workChargingShareAt(atMs);
}

/** The quality of charging at work for a household member (a mobility slot) at `atMs`: 0 if they
 * can't. */
export function workQosFor(egid: string, ewid: string, slotIndex: number, atMs: number): number {
  return canChargeAtWork(egid, ewid, slotIndex, atMs) ? WORK_CHARGING_QOS : 0;
}

/** Whether an option is good enough to run an electric vehicle on at all. */
export function usableOption(option: ChargingOption): boolean {
  return option.qos >= QOS_FLOOR;
}

/** The sources of an option in order, sharing out the charging. Two chargers of the same kind do the
 * same job — the nearer or emptier one is used, the other is a fallback — so only the best of each
 * kind counts (charging at work being a kind of its own); sources of different kinds complement
 * each other, each covering part of what those before it leave. The minor ones are dropped and the
 * rest scaled up. */
function shareOut(candidates: { site: ChargingSite | null; distanceM: number; qos: number }[]): { qos: number; sources: ChargingSource[] } {
  const bestOfKind = new Map<string, { site: ChargingSite | null; distanceM: number; qos: number }>();
  for (const c of candidates) {
    if (c.qos <= 0) continue;
    const kind = c.site ? qosKindOf(c.site) : AT_WORK;
    const best = bestOfKind.get(kind);
    if (!best || c.qos > best.qos) bestOfKind.set(kind, c);
  }
  const sorted = [...bestOfKind.values()].sort((a, b) => b.qos - a.qos);
  let left = 1;
  const contributions = sorted.map((c) => {
    const part = left * c.qos;
    left *= 1 - c.qos;
    return part;
  });
  const qos = 1 - left;
  if (qos <= 0) return { qos: 0, sources: [] };
  const kept = sorted.map((c, i) => ({ ...c, share: contributions[i] / qos })).filter((c, i) => i === 0 || c.share >= QOS_MIN_SHARE).slice(0, QOS_MAX_SOURCES);
  const total = kept.reduce((s, c) => s + c.share, 0);
  return { qos, sources: kept.map((c) => ({ ...c, share: c.share / total })) };
}

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

/** The month of an instant, as year * 12 + month. */
function monthOf(simTimeMs: number): number {
  const d = new Date(toDateMs(simTimeMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

class PublicCharging {
  private sites: ChargingSite[] = [];
  private byId = new Map<string, ChargingSite>();
  private bySlot = new Map<string, Assignment[]>();
  private bySite = new Map<string, Assignment[]>();
  /** Per site, the bookings that may still count for its room: bySite less those ended long ago
   * (committedAt prunes them as it goes) — the room check runs for every site in reach of every
   * decision, and a site's full history keeps growing. */
  private live = new Map<string, Assignment[]>();
  private unmet: { atMs: number; x: number; y: number; kind: ChargingKind }[] = [];
  /** Households' wallboxes ("egid:ewid"), by when they were put in. */
  private wallboxes = new Map<string, number>();
  private lastOperatorYear: number | null = null;
  /** The last month (year * 12 + month) whose start the vehicles' charging was reviewed at. */
  private lastReviewMonth: number | null = null;
  private reviewers: ((slotKey: string, slot: unknown, atMs: number, changed: ChargingSite[] | null) => void)[] = [];
  private projection = new LocalProjection(8.4, 47.4);
  private buildingLookup: (egid: string) => Building | undefined = () => undefined;
  private isDriving: (slot: unknown, atMs: number) => boolean = () => true;
  private buildingsProvider: () => Building[] = () => [];
  private nextId = 0;
  private unsubscribeClock: (() => void) | null = null;
  /** Each site's distances along the streets (where it joins them, and every junction in its reach). */
  private fields = new Map<string, { attach: StreetAttachment | null; field: Map<number, number> }>();
  /** Each building's sites in reach (of the first `count` sites), with their distance. */
  private near = new WeakMap<Building, { count: number; list: { site: ChargingSite; distanceM: number }[] }>();

  // Planning UI state.
  private selectedSiteId: string | null = null;
  private placing: Placing | null = null;
  private coverage = new Set<QosKind>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset, startMs: number): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.sites = [];
    this.byId = new Map();
    this.bySlot = new Map();
    this.bySite = new Map();
    this.live = new Map();
    this.unmet = [];
    this.wallboxes = new Map();
    this.lastOperatorYear = yearOf(startMs);
    this.lastReviewMonth = monthOf(startMs);
    this.selectedSiteId = null;
    this.placing = null;
    this.fields = new Map();
    this.near = new WeakMap();
    for (const s of dataset.chargingSites ?? []) {
      const shop = s.kind === "ac" && SHOP_SITE_NAME.test(s.name);
      this.addSite({ id: s.id, name: s.name, lon: s.lon, lat: s.lat, kind: s.kind, owner: "private", powerKw: s.powerKw, points: s.points, openedAtMs: Number.NEGATIVE_INFINITY, ...(shop ? { shop } : {}) });
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

  /** Every building the stock knows (App wires this to the stock, like the lookup) — for picking
   * the public buildings chargers go to. */
  setBuildingsProvider(provider: () => Building[]): void {
    this.buildingsProvider = provider;
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

  /** Whether a household may put in a wallbox: "own" (its own parking space, a wallbox allowed —
   * a seeded draw per dwelling against its building type's share), "law" (only thanks to the right
   * to charge), or null (it may not). */
  wallboxRight(building: Building, dwelling: Dwelling): "own" | "law" | null {
    const group = buildingGroup(building);
    const base = (group && HOME_CHARGING_SHARE[group]) ?? HOME_CHARGING_SHARE_OTHER;
    const u = firstRandom(hashSeed(building.egid, dwelling.ewid, "home-charging"));
    if (u < base) return "own";
    return u < base + policyStore.get().homeChargingBoost * (1 - base) ? "law" : null;
  }

  /** Whether a household may charge at home (`atStart`: as things stood before any rule). */
  homeChargingAt(building: Building, dwelling: Dwelling, { atStart = false } = {}): boolean {
    const right = this.wallboxRight(building, dwelling);
    return atStart ? right === "own" : right !== null;
  }

  /** Whether a household has a wallbox at `atMs`. */
  hasWallboxAt(building: Building, dwelling: Dwelling, atMs: number): boolean {
    const at = this.wallboxes.get(`${building.egid}:${dwelling.ewid}`);
    return at !== undefined && at <= atMs;
  }

  /** A household puts in a wallbox (its first electric car charging at home). */
  installWallbox(building: Building, dwelling: Dwelling, atMs: number): void {
    const key = `${building.egid}:${dwelling.ewid}`;
    if (!this.wallboxes.has(key)) this.wallboxes.set(key, atMs);
  }

  /** What putting in a wallbox would cost a household at `atMs` (Rp), or null if it may not. */
  wallboxCostRp(building: Building, dwelling: Dwelling, atMs: number): number | null {
    const right = this.wallboxRight(building, dwelling);
    if (!right) return null;
    const chf = (buildingGroup(building) === "houseSingle" ? WALLBOX_COST_CHF.house : WALLBOX_COST_CHF.flat) + (right === "law" ? WALLBOX_RIGHT_TO_CHARGE_EXTRA_CHF : 0);
    return chf * 100 * priceFactor("chargerAc", atMs);
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
    let list = this.live.get(siteId);
    if (!list) {
      list = [...(this.bySite.get(siteId) ?? [])];
      this.live.set(siteId, list);
    }
    let n = 0;
    let kept = 0;
    for (const a of list) {
      if (atMs < a.toMs) n += a.weight;
      if (a.toMs > atMs - YEAR_MS) list[kept++] = a; // ended over a year before: never asked about again
    }
    list.length = kept;
    return n;
  }

  /** The vehicles relying on a site at `atMs`, by kind. */
  vehiclesAt(siteId: string, atMs: number): VehicleCounts {
    const counts: VehicleCounts = { car: 0, van: 0, truck: 0 };
    for (const a of this.bySite.get(siteId) ?? []) if (a.fromMs <= atMs && atMs < a.toMs) counts[a.vehicle]++;
    return counts;
  }

  // --- quality of service ---

  /** A site's distances along the streets, worked out once (a site never moves). */
  private fieldOf(site: ChargingSite): { attach: StreetAttachment | null; field: Map<number, number> } {
    let f = this.fields.get(site.id);
    if (!f) {
      const kind = qosKindOf(site);
      const mode = travelModeOf(kind);
      const attach = streetDistance.attachPoint(site.lon, site.lat, mode);
      f = { attach, field: attach ? streetDistance.field([attach], mode, qosReachM(kind)) : new Map() };
      this.fields.set(site.id, f);
    }
    return f;
  }

  /** How far a building is from a site, along the streets (m). */
  distanceM(b: Building, site: ChargingSite): number {
    const { attach, field } = this.fieldOf(site);
    return streetDistance.buildingDistance(b, travelModeOf(qosKindOf(site)), attach, field, [site.lon, site.lat]);
  }

  /** The sites within reach of a building (open or not), with their distance — kept per building
   * and topped up as sites are added. */
  sitesNear(b: Building): { site: ChargingSite; distanceM: number }[] {
    let entry = this.near.get(b);
    if (!entry || entry.count > this.sites.length) entry = { count: 0, list: [] };
    for (let i = entry.count; i < this.sites.length; i++) {
      const site = this.sites[i];
      const distanceM = this.distanceM(b, site);
      if (distanceM < qosReachM(qosKindOf(site))) entry.list.push({ site, distanceM });
    }
    entry.count = this.sites.length;
    this.near.set(b, entry);
    return entry.list;
  }

  /** A site's quality of service for one more vehicle (`weight`, in cars' worth) at `distanceM`, with
   * `committed` of its room already promised: 0 if it isn't open, or the vehicle would take it past
   * MAX_FILL. */
  private siteQos(site: ChargingSite, distanceM: number, atMs: number, weight: number, committed = this.committedAt(site.id, atMs)): number {
    const capacity = siteCapacityAt(site, atMs);
    if (capacity === 0 || committed + weight > capacity * MAX_FILL) return 0;
    return qosAtDistance(qosKindOf(site), distanceM) * busyFactor(site.kind, committed / capacity);
  }

  /** How a vehicle at `building` without a charger of its own could charge at `atMs`: every open
   * site of a kind it can use in reach (shops' car parks: cars only), plus charging at work at
   * `workQos` — their quality together, the sources it would count on and their shares, and the
   * price and hassle of it. `only`: just these sites (and AT_WORK for work), for what staying with
   * the chargers it has would be like. */
  chargingOption(building: Building, atMs: number, need: ChargingNeed = CAR_NEED, workQos = 0, only?: ReadonlySet<string>): ChargingOption {
    const weight = need.kWhPerDay / CAR_DAILY_KWH;
    const candidates: { site: ChargingSite | null; distanceM: number; qos: number }[] = [];
    for (const { site, distanceM } of this.sitesNear(building)) {
      if (!need.kinds.includes(site.kind) || (site.shop && need.vehicle !== "car") || (only && !only.has(site.id))) continue;
      const qos = this.siteQos(site, distanceM, atMs, weight);
      if (qos > 0) candidates.push({ site, distanceM, qos });
    }
    if (workQos > 0 && (!only || only.has(AT_WORK))) candidates.push({ site: null, distanceM: 0, qos: workQos });
    const { qos, sources } = shareOut(candidates);
    const priceRpPerKWh = sources.reduce((sum, s) => sum + s.share * (s.site ? sitePriceRpPerKWh(s.site) : WORK_CHARGING_PRICE_RP_PER_KWH), 0);
    return { qos, sources, priceRpPerKWh, hassleRp: hassleRp(need.vehicle, qos) };
  }

  /** What relying on public charging would cost had there been an empty charger of `kind` right
   * next door — so a decision can tell "wanted an electric vehicle but couldn't" apart from "didn't
   * want one". */
  hypotheticalOption(vehicle: ChargingVehicle, kind: ChargingKind = "ac"): ChargingOption {
    const qos = QOS_CURVE[kind].ceiling;
    return { qos, sources: [], priceRpPerKWh: PRIVATE_PRICE_RP_PER_KWH[kind], hassleRp: hassleRp(vehicle, qos) };
  }

  /** Books a new electric vehicle to the sources it will rely on, each for its share. */
  assign(slotKey: string, slot: unknown, option: ChargingOption, atMs: number, need: ChargingNeed = CAR_NEED): void {
    const seed = hashSeed(slotKey, "public-charging");
    for (const source of option.sources) {
      const kWhPerDay = need.kWhPerDay * source.share;
      const a: Assignment = {
        siteId: source.site?.id ?? AT_WORK,
        fromMs: atMs,
        toMs: Number.POSITIVE_INFINITY,
        slot,
        seed,
        vehicle: need.vehicle,
        share: source.share,
        kWhPerDay,
        weight: kWhPerDay / CAR_DAILY_KWH,
      };
      this.assignmentsFor(slotKey).push(a);
      if (source.site) {
        this.bySite.get(source.site.id)?.push(a);
        this.live.get(source.site.id)?.push(a);
      }
    }
  }

  /** The household's car was replaced: whatever it relied on is freed. */
  endAssignment(slotKey: string, atMs: number): void {
    for (const a of this.bySlot.get(slotKey) ?? []) if (a.toMs === Number.POSITIVE_INFINITY && a.fromMs <= atMs) a.toMs = atMs;
  }

  /** Ends a vehicle's current bookings at `atMs`, to look at its charging afresh (with its room at
   * its chargers free); returns them, for keep() to undo if it stays. */
  release(slotKey: string, atMs: number): Assignment[] {
    const held = (this.bySlot.get(slotKey) ?? []).filter((a) => a.fromMs <= atMs && atMs < a.toMs);
    for (const a of held) a.toMs = atMs;
    return held;
  }

  /** The vehicle stays with the bookings release() ended. */
  keep(held: Assignment[]): void {
    for (const a of held) a.toMs = Number.POSITIVE_INFINITY;
  }

  /** Who looks at their charging again (mobility.ts for households' cars, fleet.ts for businesses'
   * vans and lorries): called for each vehicle with bookings, as `(slotKey, slot, atMs, changed)` —
   * once a year, each vehicle at the start of a month of its own (`changed` null), and at the start
   * of a month in which a site opened or grew (`changed`: those sites). */
  addReviewer(review: (slotKey: string, slot: unknown, atMs: number, changed: ChargingSite[] | null) => void): void {
    this.reviewers.push(review);
  }

  /** The vehicles' review at the start of month `month` (year * 12 + month): the twelfth of them whose
   * yearly look is due, and — if a site opened or grew the month before — those that have it in reach. */
  private reviewRound(month: number): boolean {
    const atMs = toSimTimeMs(Date.UTC(Math.floor(month / 12), month % 12, 1));
    const fromMs = toSimTimeMs(Date.UTC(Math.floor((month - 1) / 12), (month + 11) % 12, 1));
    const changed = this.sites.filter((s) => (s.openedAtMs >= fromMs && s.openedAtMs < atMs) || s.expansions.some((e) => e.atMs >= fromMs && e.atMs < atMs));
    let reviewed = false;
    for (const [key, list] of [...this.bySlot]) {
      if (!list.some((a) => a.fromMs <= atMs && atMs < a.toMs)) continue;
      const yearly = hashSeed(key, "charging-review") % 12 === month % 12;
      if (!yearly && changed.length === 0) continue;
      const slot = list[list.length - 1].slot;
      for (const review of this.reviewers) review(key, slot, atMs, yearly ? null : changed);
      reviewed = true;
    }
    return reviewed;
  }

  /** The public sites a vehicle's current bookings are at, `atMs` (charging at work aside). */
  sitesOf(assignments: Assignment[], atMs: number): { site: ChargingSite; share: number }[] {
    const out: { site: ChargingSite; share: number }[] = [];
    for (const a of assignments) {
      if (a.fromMs > atMs || atMs >= a.toMs) continue;
      const site = this.byId.get(a.siteId);
      if (site) out.push({ site, share: a.share });
    }
    return out;
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

  /** Where those households were, between two instants. */
  unmetDemandSpots(fromMs: number, toMs: number): { lon: number; lat: number; kind: ChargingKind }[] {
    return this.unmet
      .filter((d) => d.atMs >= fromMs && d.atMs < toMs)
      .map((d) => {
        const [lon, lat] = this.projection.toLonLat(d.x, d.y);
        return { lon, lat, kind: d.kind };
      });
  }

  /** Households that would have bought an electric car between two instants with an empty
   * on-street charger next door, but didn't. */
  unmetDemandCount(fromMs: number, toMs: number): number {
    let n = 0;
    for (const d of this.unmet) if (d.atMs >= fromMs && d.atMs < toMs) n++;
    return n;
  }

  // --- load ---

  private assignmentLoadW(a: Assignment, site: ChargingSite, atMs: number): number {
    const kind = site.kind;
    const day = Math.floor(atMs / DAY_MS);
    const seed = hashSeedFrom(a.seed, String(day), site.id);
    const dayShare = SESSION_DAY_SHARE[a.vehicle][kind];
    if (firstRandom(seed) >= dayShare) return 0;
    // On-street: overnight from the evening; a hub or a shop's car park: during the day.
    const startHour = kind === "ac" && !site.shop ? 17.5 + firstRandom(seed ^ 0x5bd1e995) * 3 : 9 + firstRandom(seed ^ 0x5bd1e995) * 10;
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
      total += this.assignmentLoadW(a, site, atMs);
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
    const total = { kWh: 0, revenueRp: 0, upkeepRp: 0 };
    for (let m = 0; m < 12; m++) {
      const month = this.municipalMonth(year, m);
      total.kWh += month.kWh;
      total.revenueRp += month.revenueRp;
      total.upkeepRp += month.upkeepRp;
    }
    return total;
  }

  /** The same, for one month of a year (0-11). */
  municipalMonth(year: number, month: number): { kWh: number; revenueRp: number; upkeepRp: number } {
    const from = toSimTimeMs(Date.UTC(year, month, 1));
    const to = toSimTimeMs(Date.UTC(year, month + 1, 1));
    let kWh = 0;
    let revenueRp = 0;
    let upkeepRp = 0;
    for (const site of this.sites) {
      if (site.owner !== "municipal") continue;
      const siteKWh = this.energyKWh(site, from, to);
      kWh += siteKWh;
      revenueRp += siteKWh * sitePriceRpPerKWh(site);
      upkeepRp += this.upkeepPerYearRp(site, toSimTimeMs(Date.UTC(year, month, 15))) / 12;
    }
    return { kWh, revenueRp, upkeepRp };
  }

  // --- the map's and the panel's view ---

  /** How each building's households could charge an electric car at `atMs`: how many can at
   * home, and the quality of public charging for the others — the same for every household of a
   * building, since they share its location (charging at work, each person's own, aside).
   * Buildings without households skipped. */
  householdAccess(buildings: Building[], atMs: number): Map<string, BuildingChargingAccess> {
    const committed = new Map<string, number>();
    const result = new Map<string, BuildingChargingAccess>();
    for (const b of buildings) {
      if (b.dwellings.length === 0) continue;
      let atHome = 0;
      let mayInstall = 0;
      for (const d of b.dwellings) {
        if (this.hasWallboxAt(b, d, atMs)) atHome++;
        else if (this.wallboxRight(b, d)) mayInstall++;
      }
      const candidates: { site: ChargingSite; distanceM: number; qos: number }[] = [];
      for (const { site, distanceM } of this.sitesNear(b)) {
        if (!CAR_NEED.kinds.includes(site.kind)) continue; // lorry parks: not for cars
        let c = committed.get(site.id);
        if (c === undefined) {
          c = this.committedAt(site.id, atMs);
          committed.set(site.id, c);
        }
        const qos = this.siteQos(site, distanceM, atMs, 1, c);
        if (qos > 0) candidates.push({ site, distanceM, qos });
      }
      result.set(b.egid, { households: b.dwellings.length, atHome, mayInstall, qos: shareOut(candidates).qos });
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
    }
    // Each vehicle once, however many sites it shares its charging among.
    for (const list of this.bySlot.values()) {
      const a = list.find((x) => x.siteId !== AT_WORK && x.fromMs <= atMs && atMs < x.toMs);
      if (a) vehicles[a.vehicle]++;
    }
    return { users, capacity, points, sites, vehicles };
  }

  /** Charge points in use right now: the sessions under way, never more than the site has. */
  pointsInUseAt(site: ChargingSite, atMs: number): number {
    let inUse = 0;
    for (const a of this.bySite.get(site.id) ?? []) {
      if (a.fromMs > atMs || atMs >= a.toMs || !this.isDriving(a.slot, atMs)) continue;
      if (this.assignmentLoadW(a, site, atMs) > 0) inUse++;
    }
    return Math.min(pointsAt(site, atMs), inUse);
  }

  /** The points a site will have once everything ordered is built. */
  plannedPoints(site: ChargingSite): number {
    return site.points + site.expansions.reduce((sum, e) => sum + e.points, 0);
  }

  // --- the map: how far chargers reach ---

  /** How far the chargers of a kind reach along the streets, as street pieces with the quality of
   * service there (busyness aside) — the map's coverage overlay. Chargers being built count too. */
  coverageOf(kind: QosKind): { line: [number, number][]; qos: number }[] {
    const from = this.sites
      .filter((s) => qosKindOf(s) === kind)
      .map((s) => this.fieldOf(s).attach)
      .filter((a): a is StreetAttachment => a !== null);
    return this.reachPieces(kind, from);
  }

  /** The same for one site, or for one about to be placed at (lon, lat). */
  reach(kind: QosKind, lon: number, lat: number, site?: ChargingSite): { line: [number, number][]; qos: number }[] {
    const attach = site ? this.fieldOf(site).attach : streetDistance.attachPoint(lon, lat, travelModeOf(kind));
    return this.reachPieces(kind, attach ? [attach] : []);
  }

  private reachPieces(kind: QosKind, from: StreetAttachment[]): { line: [number, number][]; qos: number }[] {
    if (from.length === 0) return [];
    const mode = travelModeOf(kind);
    const cutoff = qosReachM(kind);
    const field = streetDistance.field(from, mode, cutoff);
    return streetDistance.pieces(field, from, mode, cutoff).map((p) => ({ line: p.line, qos: qosAtDistance(kind, p.distanceM) }));
  }

  // --- the player builds ---

  getPlacing(): Placing | null {
    return this.placing;
  }

  startPlacing(kind: ChargingKind | null, points = kind ? BUILD_SPEC[kind].points : 0): void {
    this.placing = kind ? { kind, points } : null;
    this.notify();
  }

  /** Which kinds' coverage the map shows (how far they reach along the streets). */
  getCoverage(): ReadonlySet<QosKind> {
    return this.coverage;
  }

  toggleCoverage(kind: QosKind): void {
    if (this.coverage.has(kind)) this.coverage.delete(kind);
    else this.coverage.add(kind);
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

  /** Orders a municipal site at the street nearest to (lon, lat) — on-street with `points` charge
   * points (4, 8 or 12): paid now, open once built. */
  build(kind: ChargingKind, lon: number, lat: number, atMs: number, points = BUILD_SPEC[kind].points): ChargingSite | null {
    if (cannotPay(buildCostRp(kind, atMs, sizeOf(kind, points).points), atMs)) return null;
    const snapped = streets.snapToStreet(lon, lat) ?? { lon, lat, distanceM: 0, street: null };
    const spec = BUILD_SPEC[kind];
    points = sizeOf(kind, points).points; // only the sizes on offer
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
      points,
      openedAtMs: atMs + buildMonthsFor(kind, points) * MONTH_MS,
    });
    treasury.recordPayout("charging", atMs, buildCostRp(kind, atMs, points), site.id);
    this.placing = null;
    this.selectedSiteId = site.id;
    this.notify();
    return site;
  }

  /** Enlarges a municipal site to a bigger size on offer for its kind (on-street 8 or 12 points, a
   * hub 8): paid now, the new points ready some months on (or once the site itself opens, if it's
   * still being built). */
  upgrade(siteId: string, toPoints: number, atMs: number): boolean {
    const site = this.byId.get(siteId);
    if (!site || site.owner !== "municipal" || spendingFrozen(atMs)) return false;
    const planned = this.plannedPoints(site);
    if (toPoints <= planned || !sizesFor(site.kind).some((s) => s.points === toPoints)) return false;
    if (cannotPay(upgradeCostRp(site.kind, planned, toPoints, atMs), atMs)) return false;
    const readyAtMs = Math.max(atMs + (UPGRADE_MONTHS[site.kind] ?? 0) * MONTH_MS, site.openedAtMs);
    site.expansions.push({ atMs: readyAtMs, points: toPoints - planned });
    treasury.recordPayout("charging", atMs, upgradeCostRp(site.kind, planned, toPoints, atMs), site.id);
    this.notify();
    return true;
  }

  getSelectedId(): string | null {
    return this.selectedSiteId;
  }

  select(id: string | null): void {
    this.selectedSiteId = id;
    this.notify();
  }

  // --- private operators ---

  /** Runs the private operators' yearly round for every New Year reached — see module doc — and
   * the vehicles' review of their charging at the start of each month that calls for one. */
  advance(atMs: number): void {
    const year = yearOf(atMs);
    if (this.lastOperatorYear === null) this.lastOperatorYear = year;
    if (this.lastReviewMonth === null) this.lastReviewMonth = monthOf(atMs);
    let changed = false;
    while (this.lastOperatorYear < year) {
      this.lastOperatorYear++;
      changed = this.operatorRound(this.lastOperatorYear) || changed;
      changed = this.publicBuildingRound(this.lastOperatorYear) || changed;
    }
    const month = monthOf(atMs);
    while (this.lastReviewMonth < month) {
      this.lastReviewMonth++;
      changed = timed("charging review", () => this.reviewRound(this.lastReviewMonth!)) || changed;
    }
    if (changed) this.notify();
  }

  // --- chargers at public buildings ---

  /** The municipal sites at a public building. */
  sitesAtBuilding(egid: string): ChargingSite[] {
    return this.sites.filter((s) => s.atBuildingEgid === egid);
  }

  /** Orders a municipal charging site in the car park of a public building: an on-street-type site
   * (same sizes, prices and upkeep), paid now, open once built. */
  buildAtBuilding(building: Building, points: number, atMs: number, { select = true } = {}): ChargingSite | null {
    // A direct order waits out a spending freeze; the programme already in force carries on.
    if (select && spendingFrozen(atMs)) return null;
    points = sizeOf("ac", points).points;
    const street = streets.snapToStreet(building.lon, building.lat)?.street ?? "";
    const site = this.addSite({
      id: `municipal-${this.nextId++}`,
      name: `Chargers at ${campusAddress(building.address) ?? "a public building"}`,
      street,
      atBuildingEgid: building.egid,
      lon: building.lon,
      lat: building.lat,
      kind: "ac",
      owner: "municipal",
      powerKw: BUILD_SPEC.ac.powerKw,
      points,
      openedAtMs: atMs + buildMonthsFor("ac", points) * MONTH_MS,
    });
    treasury.recordPayout("charging", atMs, buildCostRp("ac", atMs, points), site.id);
    if (select) this.selectedSiteId = site.id;
    this.notify();
    return site;
  }

  /** The "Chargers at public buildings" measure's yearly round: this year's number of sites (a
   * fractional rate rounds by chance), each at the public building without chargers that has the
   * most unmet demand around it last year (households that wanted an electric car but found no
   * charger), then the biggest. */
  private publicBuildingRound(year: number): boolean {
    const channels = policyStore.get();
    const perYear = channels.publicBuildingChargerSitesPerYear;
    if (perYear <= 0) return false;
    const now = yearStartMs(year);
    const whole = Math.floor(perYear);
    const count = whole + (firstRandom(hashSeed("public-building-chargers", String(year))) < perYear - whole ? 1 : 0);
    const demand = this.unmet.filter((d) => d.kind === "ac" && d.atMs >= yearStartMs(year - 1) && d.atMs < now);
    const candidates = this.publicBuildingChargerCandidates(now)
      .map((b) => {
        const [x, y] = this.projection.toXY(b.lon, b.lat);
        return { b, demand: demand.filter((d) => Math.hypot(d.x - x, d.y - y) <= DEMAND_RADIUS_M.ac).length };
      })
      .sort((a, c) => c.demand - a.demand || (c.b.footprintAreaM2 ?? 0) - (a.b.footprintAreaM2 ?? 0));
    let placed = 0;
    for (const { b } of candidates) {
      if (placed >= count) break;
      if (this.onChargedCampus(b)) continue; // one placed earlier in this round covers its campus now
      this.buildAtBuilding(b, channels.publicBuildingChargerPoints, now, { select: false });
      placed++;
    }
    return placed > 0;
  }

  /** Whether a building's campus already has a charging site at a public building. One site per
   * campus: a school's several buildings share a car park. The register numbers them as
   * sub-addresses of one address (Hofackerstrasse 2.1, 2.3), and they stand close together. */
  private onChargedCampus(b: Building): boolean {
    const [x, y] = this.projection.toXY(b.lon, b.lat);
    const address = campusAddress(b.address);
    return this.sites.some((s) => {
      if (s.atBuildingEgid === undefined) return false;
      if (Math.hypot(s.x - x, s.y - y) < PUBLIC_BUILDING_CAMPUS_M) return true;
      return address !== null && campusAddress(this.buildingLookup(s.atBuildingEgid)?.address ?? null) === address;
    });
  }

  /** The public buildings the "Chargers at public buildings" measure can still put a site at on
   * `atMs`: standing, and on a campus without one yet. */
  publicBuildingChargerCandidates(atMs: number): Building[] {
    return this.buildingsProvider().filter((b) => buildingGroup(b) === "public" && existsAt(b, atMs) && !this.onChargedCampus(b));
  }

  private operatorRound(year: number): boolean {
    const now = yearStartMs(year);
    const opensAt = now + OPERATOR_BUILD_MONTHS * MONTH_MS;
    // Operators build on-street chargers; demand only a fast-charging hub would meet (lorries) is left to the municipality.
    let demand = this.unmet.filter((d) => d.kind === "ac" && d.atMs >= yearStartMs(year - 1) && d.atMs < now);
    let changed = false;

    // Busy sites with demand around them grow — shops' car parks only from what is left at the end:
    // they gather demand from far around, which would leave none for the streets.
    const expandBusy = (shops: boolean) => {
      for (const site of this.sites) {
        if (site.owner !== "private" || !!site.shop !== shops) continue;
        const capacity = siteCapacityAt(site, now);
        const points = pointsAt(site, now);
        if (capacity === 0 || points >= OPERATOR_MAX_POINTS || this.usersAt(site.id, now) / capacity < OPERATOR_EXPAND_AT_USE) continue;
        const near = demand.filter((d) => Math.hypot(d.x - site.x, d.y - site.y) <= DEMAND_RADIUS_M[qosKindOf(site)]);
        if (near.length < 2) continue;
        site.expansions.push({ atMs: opensAt, points: Math.min(OPERATOR_EXPAND_POINTS, OPERATOR_MAX_POINTS - points) });
        demand = demand.filter((d) => !near.includes(d));
        changed = true;
      }
    };
    expandBusy(false);

    // Where enough demand gathers with no charger around, a new on-street site opens.
    for (let n = 0; n < OPERATOR_MAX_NEW_SITES_PER_YEAR && demand.length >= OPERATOR_NEW_SITE_MIN_DEMAND; n++) {
      let bestGroup: typeof demand = [];
      for (const d of demand) {
        const group = demand.filter((o) => Math.hypot(o.x - d.x, o.y - d.y) <= DEMAND_RADIUS_M.ac);
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

    // What's left may bring chargers to a large shop's car park, where most of it gathers.
    expandBusy(true);
    for (let n = 0; n < OPERATOR_MAX_NEW_SHOPS_PER_YEAR && demand.length >= OPERATOR_NEW_SHOP_MIN_DEMAND; n++) {
      let best: { b: Building; near: typeof demand } | null = null;
      for (const b of this.shopCandidates(now)) {
        const [x, y] = this.projection.toXY(b.lon, b.lat);
        const near = demand.filter((d) => Math.hypot(d.x - x, d.y - y) <= DEMAND_RADIUS_M.shop);
        if (near.length < OPERATOR_NEW_SHOP_MIN_DEMAND) continue;
        if (!best || near.length > best.near.length || (near.length === best.near.length && (b.footprintAreaM2 ?? 0) > (best.b.footprintAreaM2 ?? 0))) best = { b, near };
      }
      if (!best) break;
      const { b, near } = best;
      this.addSite({
        id: `operator-${this.nextId++}`,
        name: `Shop car park ${campusAddress(b.address) ?? "(unnamed)"}`,
        street: streets.snapToStreet(b.lon, b.lat)?.street ?? "",
        lon: b.lon,
        lat: b.lat,
        kind: "ac",
        shop: true,
        owner: "private",
        powerKw: OPERATOR_SHOP_POWER_KW,
        points: OPERATOR_SHOP_POINTS,
        openedAtMs: opensAt,
      });
      demand = demand.filter((d) => !near.includes(d));
      changed = true;
    }
    return changed;
  }

  /** The large shops standing at `atMs` whose car park has no chargers yet. */
  private shopCandidates(atMs: number): Building[] {
    const shopSites = this.sites.filter((s) => s.shop);
    return this.buildingsProvider().filter((b) => {
      if (commercialCategory(b) !== "retail" || (b.footprintAreaM2 ?? 0) < OPERATOR_SHOP_MIN_FOOTPRINT_M2 || !existsAt(b, atMs)) return false;
      const [x, y] = this.projection.toXY(b.lon, b.lat);
      return !shopSites.some((s) => Math.hypot(s.x - x, s.y - y) < SHOP_CAR_PARK_M);
    });
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

  /** `slotRef` turns a booking's household slot into saveable ids (mobility.ts). */
  snapshot(slotRef: (slot: unknown) => unknown) {
    return {
      sites: this.sites,
      bySlot: [...this.bySlot].map(([key, list]) => [key, list.map((a) => ({ ...a, slot: slotRef(a.slot) }))] as const),
      unmet: this.unmet,
      wallboxes: [...this.wallboxes],
      lastOperatorYear: this.lastOperatorYear,
      lastReviewMonth: this.lastReviewMonth,
      nextId: this.nextId,
    };
  }

  /** `slotFrom` turns the ids back into the household's slot handle. */
  restore(s: ReturnType<PublicCharging["snapshot"]>, slotFrom: (ref: unknown) => unknown): void {
    this.sites = s.sites;
    this.byId = new Map(this.sites.map((site) => [site.id, site]));
    this.fields = new Map();
    this.near = new WeakMap();
    this.bySlot = new Map();
    this.bySite = new Map(this.sites.map((site) => [site.id, [] as Assignment[]]));
    this.live = new Map();
    for (const [key, list] of s.bySlot) {
      const assignments = list.map((a) => ({ ...a, slot: slotFrom(a.slot) }) as Assignment);
      this.bySlot.set(key, assignments);
      for (const a of assignments) this.bySite.get(a.siteId)?.push(a);
    }
    this.unmet = s.unmet;
    this.wallboxes = new Map(s.wallboxes);
    this.lastOperatorYear = s.lastOperatorYear;
    this.lastReviewMonth = s.lastReviewMonth;
    this.nextId = s.nextId;
    this.selectedSiteId = null;
    this.placing = null;
    this.notify();
  }
}

export const publicCharging = new PublicCharging();
