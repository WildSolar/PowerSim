/**
 * The building stock over time: old buildings get replaced, new ones get built. The
 * dataset's buildings are a snapshot of game start; this layers a timeline on top —
 * every building has an existence interval (builtAtMs..demolishedAtMs, see lifetime.ts)
 * and everything downstream asks "which buildings stand at time t" rather than
 * assuming a fixed list. A replacement is a new building with a new EGID (as in the
 * real register), which gives it fresh seeds/chains/caches with no invalidation logic.
 *
 * Two mechanisms, both feeding the same project machinery:
 *  - Renewal: each eligible building gets a trigger time from an age-dependent Weibull
 *    hazard (nothing before MIN_RENEWAL_AGE_YEARS, then ever likelier), scale-calibrated
 *    so the municipality's overall replacement rate matches its own GWR history. A
 *    trigger pulls in adjacent buildings of the same construction year (a housing
 *    estate is one project). Replacements keep the footprint and address, hold 20-30%
 *    more dwellings, and gain floors accordingly (capped by the neighbourhood).
 *  - Growth: new buildings arrive as a random (Poisson) process whose rate steers
 *    total floor space toward the municipality's historic growth rate, each placed on a
 *    development site (vacant, zoned, still open) by fitting a rectangle of a size drawn
 *    from existing buildings of the same group.
 *
 * Every project's attributes (heating, insulation, solar) are decided when its permit is
 * decided, under the construction rules in force then (constructionRules.ts), then
 * frozen. Physical change follows: demolition a few months later, completion a year or two
 * after that — the site shows as a construction site in between and draws no power.
 *
 * Driven by the sim clock: events are processed in time order as simulated time passes
 * them (any number per frame, so fast-forward just works). Never rewinds.
 */

import {
  CLUSTER_ADJACENT_GAP_M,
  CLUSTER_JOIN_PROBABILITY,
  CLUSTER_MAX_BUILDINGS,
  CONSTRUCTION_MONTHS_BASE,
  CONSTRUCTION_MONTHS_PER_1000_M2_GFA,
  CONSTRUCTION_MONTHS_RANGE,
  DISTRICT_HEATING_REACH_M,
  FALLBACK_BUILDING_AGE_YEARS,
  GFA_PER_APARTMENT_FALLBACK_M2,
  GROWTH_CORRECTION_MAX,
  GROWTH_CORRECTION_MIN,
  GROWTH_RATE_CAP,
  GROWTH_RATE_DEFAULT,
  GROWTH_RATE_FLOOR,
  HEIGHT_CAP_EXTRA_FLOORS,
  HEIGHT_CAP_MIN_FLOORS,
  HEIGHT_CAP_RADIUS_M,
  MATCH_MIN_SIZE_FRACTION,
  MATCH_MODE_SHRINK_STEPS,
  MIN_RENEWAL_AGE_YEARS,
  NEIGHBORHOOD_EXCEPTION_PROBABILITY,
  NEIGHBORHOOD_MIN_BUILDINGS,
  NEIGHBORHOOD_RADIUS_M,
  ORIENTATION_MIN_ASPECT,
  ORIENTATION_RADIUS_M,
  NEW_BUILDING_SIZE_JITTER,
  PERMIT_DELAY_MONTHS,
  RENEWAL_CALIBRATION_HORIZON_YEARS,
  RENEWAL_RATE_CAP,
  RENEWAL_RATE_FLOOR,
  RENEWAL_RATE_HISTORY_YEARS,
  RENEWAL_WEIBULL_SHAPE,
  REPLACEMENT_UPLIFT_MAX,
  REPLACEMENT_UPLIFT_MIN,
  SITE_EXHAUSTED_AFTER_FAILURES,
  SITE_NEW_BUILDING_MARGIN_M,
  SITE_POINT_SAMPLES,
  SITE_SIZE_SHRINK_STEPS,
  SMALL_RESIDENTIAL_SITE_M2,
  ZONE_GROUP_WEIGHTS,
  type BuildingGroup,
} from "../config/stock";
import type { Building, Dwelling, DevelopmentSite, MunicipalityDataset } from "../data/types";
import { toDateMs } from "./calendar";
import { constructionRules, type ConstructionRules } from "./constructionRules";
import { simClock } from "./engine";
import { currentHeatingSystemId } from "./heatingRenewal";
import { existsAt } from "./lifetime";
import {
  boundingRectSides,
  LocalProjection,
  MinHeap,
  PointGrid,
  pointInPolygon,
  rectCorners,
  rectsOverlap,
  ringCentroid,
  ringGap,
  type OrientedRect,
  type XY,
} from "./localGeo";
import { applyNewBuildAttributes, buildingGroup, gfaOf } from "./newBuild";
import { policyStore } from "./policy";
import { commitVehicleDecisions } from "./mobility";
import { energyClassAt } from "./retrofit";
import { measures } from "./measures";
import { treasury } from "./treasury";
import { hashSeed, mulberry32 } from "./rng";

const DAY_MS = 24 * 60 * 60_000;
const YEAR_MS = 365.25 * DAY_MS;
const MONTH_MS = YEAR_MS / 12;

/** Renewal triggers are scheduled at this multiple of the target rate and then thinned,
 * so the player's renewal-rate multiplier can raise the rate up to this factor at any
 * time without rescheduling anything. */
const THINNING_CAP = 2;

// A building that will not fit at its neighbours' proportions may be stretched (same area) before it is shrunk.
const ASPECT_STRETCHES = [1, 1.6, 2.4];
const MAX_ASPECT = 4;
const MATCH_MISSES_BEFORE_SKIP = 3;

type PlacementMode = "match" | "fill";

type StockEvent = { type: "renewalTrigger"; egid: string } | { type: "newArrival" } | { type: "transition" };

export interface StockProject {
  kind: "renewal" | "new";
  decidedAtMs: number;
  oldEgids: string[];
  newEgids: string[];
  constructionStartMs: number;
  completedAtMs: number;
  siteId?: string;
}

export interface StockYearSummary {
  year: number;
  newBuildings: number;
  replacementBuildings: number;
  demolished: number;
  dwellingsBuilt: number;
  dwellingsDemolished: number;
  gfaBuiltM2: number;
  gfaDemolishedM2: number;
  /** Net floor-space change as a share of the floor space standing at the start of the year. */
  netGrowthPct: number;
}

interface Template {
  footprintAreaM2: number;
  floors: number;
  long: number;
  short: number;
  dwellings: number;
  gfa: number;
  buildingClass: string | null;
  category: string | null;
}

interface SiteState {
  site: DevelopmentSite;
  rings: XY[][];
  angleRad: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  used: OrientedRect[];
  usedAreaM2: number;
  failures: number;
  /** Times a search for a neighbour-like building on this site came up empty; after a few, match mode skips it. */
  matchMisses: number;
  exhausted: boolean;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function yearOf(simTimeMs: number): number {
  return new Date(toDateMs(simTimeMs)).getUTCFullYear();
}

function stochasticRound(x: number, u: number): number {
  const base = Math.floor(x);
  return u < x - base ? base + 1 : base;
}

function pickWeighted<T>(items: T[], weights: number[], u: number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = u * total;
  for (let i = 0; i < items.length; i++) {
    pick -= weights[i];
    if (pick <= 0) return items[i];
  }
  return items[items.length - 1];
}

class StockStore {
  private dataset: MunicipalityDataset | null = null;
  private seed = "stock";
  private all: Building[] = [];
  private byEgid = new Map<string, Building>();
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribeClock: (() => void) | null = null;

  private projection = new LocalProjection(8.4, 47.4);
  private grid = new PointGrid(60);
  private ringXY = new Map<string, XY[]>();
  private centroidXY = new Map<string, XY>();
  private groupOf = new Map<string, BuildingGroup | null>();
  private streetNumbers = new Map<string, { odd: number; even: number }>();

  private templates: Record<BuildingGroup, Template[]> = { houseSingle: [], apartments: [], commercial: [], industrial: [], public: [] };
  private dwellingPool: { rooms: number | null; area: number | null }[] = [];
  private gfaPerApartment = GFA_PER_APARTMENT_FALLBACK_M2;
  private meanProjectGfa = 600; // running estimate of a new building's floor space, refined as buildings are placed
  private sites: SiteState[] = [];
  private templateCache = new Map<string, Template | null>();
  // Footprint of a small (10th percentile) existing building of each kind — a site must be able to hold this to be offered to that kind.
  private smallFootprint: Record<BuildingGroup, number> = { houseSingle: 0, apartments: 0, commercial: 0, industrial: 0, public: 0 };
  private medianFootprint: Record<BuildingGroup, number> = { houseSingle: 0, apartments: 0, commercial: 0, industrial: 0, public: 0 };
  private orientationCache = new Map<string, { angleRad: number; aspect: number }>();
  // Neighbourhood lookups repeat for nearby candidate points within one placement search, so they are
  // cached per 30 m cell and dropped whenever a building is added or removed.
  private neighbourCache = new Map<string, Template[]>();
  private orientationNearCache = new Map<string, number | null>();

  private heap = new MinHeap<StockEvent>();
  private growthRate = GROWTH_RATE_DEFAULT;
  private renewalRate = 0.005;
  private weibullScaleYears = 80;
  private startYear = 2026;

  private gfaTotal = 0;
  private gfaStart = 0;
  private targetGrowthGfa = 0;
  private lastArrivalScheduleMs = 0;

  private egidCounter = 0;
  private arrivalCounter = 0;
  private thinCounter = 0;
  private lastDecisionMonth = -1;
  private projects: StockProject[] = [];

  // --- public API ---

  /** Every building that ever existed or is planned: the base stock plus everything
   * created since. A new array identity on every change, so memoized consumers refresh. */
  getAll(): Building[] {
    return this.all;
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  lookup(egid: string): Building | undefined {
    return this.byEgid.get(egid);
  }

  getProjects(): StockProject[] {
    return this.projects;
  }

  /** What was built and demolished in a calendar year (by completion/demolition date). */
  summaryForYear(year: number): StockYearSummary {
    const yearStart = Date.UTC(year, 0, 1) - toDateMs(0);
    const yearEnd = Date.UTC(year + 1, 0, 1) - toDateMs(0);
    const summary: StockYearSummary = {
      year,
      newBuildings: 0,
      replacementBuildings: 0,
      demolished: 0,
      dwellingsBuilt: 0,
      dwellingsDemolished: 0,
      gfaBuiltM2: 0,
      gfaDemolishedM2: 0,
      netGrowthPct: 0,
    };
    let gfaAtStart = 0;
    for (const b of this.all) {
      if (existsAt(b, yearStart)) gfaAtStart += gfaOf(b);
      if (b.builtAtMs !== undefined && b.builtAtMs >= yearStart && b.builtAtMs < yearEnd) {
        if (b.origin === "new") summary.newBuildings++;
        else summary.replacementBuildings++;
        summary.dwellingsBuilt += b.dwellings.length;
        summary.gfaBuiltM2 += gfaOf(b);
      }
      if (b.demolishedAtMs !== undefined && b.demolishedAtMs >= yearStart && b.demolishedAtMs < yearEnd) {
        summary.demolished++;
        summary.dwellingsDemolished += b.dwellings.length;
        summary.gfaDemolishedM2 += gfaOf(b);
      }
    }
    summary.netGrowthPct = gfaAtStart > 0 ? ((summary.gfaBuiltM2 - summary.gfaDemolishedM2) / gfaAtStart) * 100 : 0;
    return summary;
  }

  /** The rates the stock was calibrated to, for the wiki/debugging. */
  getCalibration(): { growthRate: number; renewalRate: number; weibullScaleYears: number; siteCount: number } {
    return { growthRate: this.growthRate, renewalRate: this.renewalRate, weibullScaleYears: this.weibullScaleYears, siteCount: this.sites.length };
  }

  init(dataset: MunicipalityDataset): void {
    this.unsubscribeClock?.();
    treasury.reset(); // a new municipality starts with an empty ledger
    measures.setDwellingCounter((atMs) => this.all.reduce((sum, b) => sum + (existsAt(b, atMs) ? b.dwellings.length : 0), 0));
    treasury.setSettler((atMs) => this.commitDecisions(atMs));
    this.dataset = dataset;
    this.seed = `stock:${dataset.bfsNumber}`;
    this.all = dataset.buildings.slice();
    this.byEgid = new Map(this.all.map((b) => [b.egid, b]));
    this.version = 0;
    this.heap = new MinHeap<StockEvent>();
    this.projects = [];
    this.egidCounter = 0;
    this.arrivalCounter = 0;
    this.thinCounter = 0;
    this.lastDecisionMonth = -1;
    this.startYear = yearOf(0);

    const first = this.all[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.grid = new PointGrid(60);
    this.ringXY = new Map();
    this.centroidXY = new Map();
    this.groupOf = new Map();
    for (const b of this.all) this.index(b);

    this.buildStreetNumbers();
    this.buildTemplatesAndPools();
    this.buildSites();
    this.calibrate();
    this.scheduleInitialTriggers();

    this.gfaStart = this.all.reduce((sum, b) => sum + gfaOf(b), 0);
    this.gfaTotal = this.gfaStart;
    this.targetGrowthGfa = 0;
    this.lastArrivalScheduleMs = 0;
    if (this.sites.length > 0) this.scheduleNextArrival(0);

    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    this.commit();
  }

  /** Processes every event due by `nowMs`, in time order. */
  advance(nowMs: number): void {
    let changed = false;
    let guard = 0;
    while (this.heap.peekKey() <= nowMs && guard++ < 20_000) {
      const item = this.heap.pop();
      if (!item) break;
      const event = item.value;
      if (event.type === "renewalTrigger") changed = this.onRenewalTrigger(event.egid, item.key) || changed;
      else if (event.type === "newArrival") changed = this.onNewArrival(item.key) || changed;
      else changed = true;
    }
    if (changed) this.commit();

    // Once a simulated month, settle the household decisions that have fallen due (see commitDecisions).
    const month = Math.floor(nowMs / MONTH_MS);
    if (month !== this.lastDecisionMonth) {
      this.lastDecisionMonth = month;
      this.commitDecisions(nowMs);
    }
  }

  /** Settles every household decision (heating system, envelope, vehicles) that has fallen due by
   * `nowMs`. Decision chains otherwise commit only when something happens to look at them; this makes
   * each one commit under the policy and prices of the time, and record its subsidy payout. */
  commitDecisions(nowMs: number): void {
    for (const b of this.all) {
      if (!existsAt(b, nowMs)) continue;
      energyClassAt(b, nowMs);
      currentHeatingSystemId(b, nowMs);
      commitVehicleDecisions(b, nowMs);
    }
  }

  // --- setup ---

  private rng(...parts: string[]): () => number {
    return mulberry32(hashSeed(this.seed, ...parts));
  }

  private index(b: Building): void {
    let ring: XY[];
    if (b.footprint && b.footprint.length >= 3) {
      ring = b.footprint.map(([lon, lat]) => this.projection.toXY(lon, lat));
    } else {
      const [x, y] = this.projection.toXY(b.lon, b.lat);
      ring = [
        [x - 3, y - 3],
        [x + 3, y - 3],
        [x + 3, y + 3],
        [x - 3, y + 3],
      ];
    }
    const centroid = ringCentroid(ring);
    this.ringXY.set(b.egid, ring);
    this.centroidXY.set(b.egid, centroid);
    this.grid.insert(b.egid, centroid[0], centroid[1]);
    this.groupOf.set(b.egid, buildingGroup(b));
  }

  private buildStreetNumbers(): void {
    this.streetNumbers = new Map();
    for (const b of this.all) {
      const parsed = this.parseAddress(b.address);
      if (!parsed) continue;
      this.noteHouseNumber(parsed.street, parsed.number);
    }
  }

  private parseAddress(address: string | null): { street: string; number: number } | null {
    if (!address) return null;
    const m = /^(.*\S)\s+(\d+)\s*[A-Za-z]?$/.exec(address.trim());
    return m ? { street: m[1], number: Number(m[2]) } : null;
  }

  private noteHouseNumber(street: string, number: number): void {
    const entry = this.streetNumbers.get(street) ?? { odd: 0, even: 0 };
    if (number % 2 === 1) entry.odd = Math.max(entry.odd, number);
    else entry.even = Math.max(entry.even, number);
    this.streetNumbers.set(street, entry);
  }

  private buildTemplatesAndPools(): void {
    this.templates = { houseSingle: [], apartments: [], commercial: [], industrial: [], public: [] };
    this.templateCache = new Map();
    this.orientationCache = new Map();
    this.neighbourCache = new Map();
    this.orientationNearCache = new Map();
    const recentPool: { rooms: number | null; area: number | null }[] = [];
    const anyPool: { rooms: number | null; area: number | null }[] = [];
    const gfaPerApt: number[] = [];

    for (const b of this.all) {
      const group = this.groupOf.get(b.egid);
      const template = this.templateFor(b);
      if (!group || !template) continue;
      this.templates[group].push(template);
      if (group === "apartments") gfaPerApt.push(template.gfa / b.dwellings.length);
      if (group === "apartments" || group === "houseSingle") {
        for (const d of b.dwellings) {
          if (d.areaM2 == null && d.roomCount == null) continue;
          anyPool.push({ rooms: d.roomCount, area: d.areaM2 });
          if ((b.constructionYear ?? 0) >= 1995) recentPool.push({ rooms: d.roomCount, area: d.areaM2 });
        }
      }
    }
    for (const group of Object.keys(this.templates) as BuildingGroup[]) {
      const sizes = this.templates[group].map((t) => t.footprintAreaM2).sort((a, b) => a - b);
      this.smallFootprint[group] = sizes.length > 0 ? sizes[Math.floor(sizes.length * 0.1)] : Infinity;
      this.medianFootprint[group] = sizes.length > 0 ? sizes[Math.floor(sizes.length / 2)] : Infinity;
    }
    this.dwellingPool = recentPool.length >= 30 ? recentPool : anyPool;
    if (gfaPerApt.length > 0) {
      gfaPerApt.sort((a, b) => a - b);
      this.gfaPerApartment = gfaPerApt[Math.floor(gfaPerApt.length / 2)];
    }
  }

  /** A building as a template for new construction of its kind. Null for anything that
   * is not one: ancillary structures, slivers, or a house / apartment block with an odd dwelling count. */
  private templateFor(b: Building): Template | null {
    const cached = this.templateCache.get(b.egid);
    if (cached !== undefined) return cached;
    let template: Template | null = null;
    const group = this.groupOf.get(b.egid);
    const ring = this.ringXY.get(b.egid);
    const validCount = group === "houseSingle" ? b.dwellings.length >= 1 && b.dwellings.length <= 2 : group === "apartments" ? b.dwellings.length >= 3 : true;
    if (group && ring && b.footprintAreaM2 && b.footprintAreaM2 >= 40 && validCount) {
      const { long, short } = boundingRectSides(ring);
      const floors = Math.max(1, b.floorCount ?? 2);
      template = {
        footprintAreaM2: b.footprintAreaM2,
        floors,
        long,
        short: Math.max(short, 1),
        dwellings: b.dwellings.length,
        gfa: b.footprintAreaM2 * floors,
        buildingClass: b.buildingClass,
        category: b.category,
      };
    }
    this.templateCache.set(b.egid, template);
    return template;
  }

  private buildSites(): void {
    this.sites = [];
    for (const site of this.dataset?.developmentSites ?? []) {
      const rings = site.rings.map((r) => r.map(([lon, lat]) => this.projection.toXY(lon, lat)));
      const angleRad = (site.angleDeg * Math.PI) / 180;
      const xs = rings[0].map((p) => p[0]);
      const ys = rings[0].map((p) => p[1]);
      this.sites.push({
        site,
        rings,
        angleRad,
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        used: [],
        usedAreaM2: 0,
        failures: 0,
        matchMisses: 0,
        exhausted: false,
      });
    }
  }

  private calibrate(): void {
    this.growthRate = GROWTH_RATE_DEFAULT;
    this.renewalRate = 0.005;
    const h = this.dataset?.stockHistory;
    if (h && h.builtGfaM2.length > 0 && h.totalGfaM2 > 0) {
      const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
      this.growthRate = clamp((mean(h.builtGfaM2) - mean(h.demolishedGfaM2)) / h.totalGfaM2, GROWTH_RATE_FLOOR, GROWTH_RATE_CAP);
      this.renewalRate = clamp(mean(h.demolishedGfaM2.slice(-RENEWAL_RATE_HISTORY_YEARS)) / h.totalGfaM2, RENEWAL_RATE_FLOOR, RENEWAL_RATE_CAP);
    }

    // Choose the Weibull scale so the eligible stock's expected trigger count over the
    // horizon matches the target rate (times the thinning cap, which thinning takes back off).
    const ages = this.eligibleBuildings().map((b) => this.ageYearsAtStart(b));
    const target = this.renewalRate * THINNING_CAP * ages.length * RENEWAL_CALIBRATION_HORIZON_YEARS;
    const k = RENEWAL_WEIBULL_SHAPE;
    const expected = (scale: number) => {
      let sum = 0;
      for (const age of ages) {
        const x0 = age - MIN_RENEWAL_AGE_YEARS;
        const T = RENEWAL_CALIBRATION_HORIZON_YEARS;
        if (x0 >= 0) sum += 1 - Math.exp(-Math.pow((x0 + T) / scale, k) + Math.pow(x0 / scale, k));
        else if (T > -x0) sum += 1 - Math.exp(-Math.pow((T + x0) / scale, k));
      }
      return sum;
    };
    let lo = 5;
    let hi = 2000;
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (expected(mid) > target) lo = mid;
      else hi = mid;
    }
    this.weibullScaleYears = Math.sqrt(lo * hi);
  }

  private eligibleBuildings(): Building[] {
    return this.all.filter((b) => this.groupOf.get(b.egid) !== null && b.footprint && b.footprint.length >= 3);
  }

  private ageYearsAtStart(b: Building): number {
    return b.constructionYear == null ? FALLBACK_BUILDING_AGE_YEARS : Math.max(0, this.startYear - b.constructionYear);
  }

  private ageYearsAt(b: Building, atMs: number): number {
    if (b.builtAtMs !== undefined) return Math.max(0, (atMs - b.builtAtMs) / YEAR_MS);
    return this.ageYearsAtStart(b) + atMs / YEAR_MS;
  }

  /** Years until the next renewal trigger for a building of the given age, drawn from the
   * age-conditional Weibull hazard: nothing before the minimum age, then a rising rate. */
  private drawRemainingYears(ageYears: number, u: number): number {
    const k = RENEWAL_WEIBULL_SHAPE;
    const scale = this.weibullScaleYears;
    const x0 = ageYears - MIN_RENEWAL_AGE_YEARS;
    const e = -Math.log(1 - Math.min(0.999999, Math.max(1e-6, u)));
    if (x0 >= 0) return Math.pow(Math.pow(x0 / scale, k) + e, 1 / k) * scale - x0;
    return -x0 + scale * Math.pow(e, 1 / k);
  }

  private scheduleInitialTriggers(): void {
    for (const b of this.eligibleBuildings()) this.scheduleTrigger(b, 0, this.rng("trigger", b.egid)());
  }

  private scheduleTrigger(b: Building, fromMs: number, u: number): void {
    const remainingMs = Math.max(30 * DAY_MS, this.drawRemainingYears(this.ageYearsAt(b, fromMs), u) * YEAR_MS);
    this.heap.push(fromMs + remainingMs, { type: "renewalTrigger", egid: b.egid });
  }

  private commit(): void {
    this.all = this.all.slice();
    this.version++;
    this.listeners.forEach((l) => l());
  }

  // --- renewal ---

  private onRenewalTrigger(egid: string, atMs: number): boolean {
    const b = this.byEgid.get(egid);
    if (!b || b.demolishedAtMs !== undefined) return false;

    const rules = constructionRules(policyStore.get(), yearOf(atMs));
    const thin = this.rng("thin", egid, String(this.thinCounter++));
    if (thin() >= Math.min(1, (rules.renewalRateMultiplier * this.densificationBoost()) / THINNING_CAP)) {
      this.scheduleTrigger(b, atMs, thin());
      return false;
    }
    this.startRenewalProject(b, atMs, rules);
    return true;
  }

  /** As vacant sites fill up, growth has to come from replacing old buildings with denser
   * ones instead: the renewal rate climbs from its calibrated value toward the thinning
   * cap. (With no sites at all — a municipality we have no zoning data for — that is
   * simply the case from the start.) */
  private densificationBoost(): number {
    const total = this.sites.reduce((sum, s) => sum + s.site.areaM2, 0);
    if (total === 0) return THINNING_CAP;
    const open = this.sites.reduce((sum, s) => sum + (s.exhausted ? 0 : Math.max(0, s.site.areaM2 - s.usedAreaM2)), 0);
    return 1 + (THINNING_CAP - 1) * (1 - open / total);
  }

  private collectCluster(seed: Building, atMs: number): Building[] {
    const members = [seed];
    if (seed.constructionYear == null) return members;
    const seen = new Set([seed.egid]);
    const rng = this.rng("cluster", seed.egid, String(atMs | 0));
    const queue = [seed];
    while (queue.length > 0 && members.length < CLUSTER_MAX_BUILDINGS) {
      const current = queue.shift() as Building;
      const [cx, cy] = this.centroidXY.get(current.egid) as XY;
      const currentRing = this.ringXY.get(current.egid) as XY[];
      for (const id of this.grid.query(cx, cy, 70)) {
        if (seen.has(id) || members.length >= CLUSTER_MAX_BUILDINGS) continue;
        seen.add(id);
        const other = this.byEgid.get(id);
        if (!other || other.origin !== undefined || other.demolishedAtMs !== undefined) continue;
        if (other.constructionYear !== seed.constructionYear) continue;
        if (ringGap(currentRing, this.ringXY.get(id) as XY[]) > CLUSTER_ADJACENT_GAP_M) continue;
        if (rng() >= CLUSTER_JOIN_PROBABILITY) continue;
        members.push(other);
        queue.push(other);
      }
    }
    return members;
  }

  private constructionTimeline(atMs: number, maxGfa: number, rng: () => number): { startMs: number; builtAtMs: number } {
    const [pMin, pMax] = PERMIT_DELAY_MONTHS;
    const startMs = atMs + (pMin + rng() * (pMax - pMin)) * MONTH_MS;
    const [dMin, dMax] = CONSTRUCTION_MONTHS_RANGE;
    const months = clamp((CONSTRUCTION_MONTHS_BASE + (CONSTRUCTION_MONTHS_PER_1000_M2_GFA * maxGfa) / 1000) * (0.85 + 0.3 * rng()), dMin, dMax);
    return { startMs, builtAtMs: startMs + months * MONTH_MS };
  }

  private startRenewalProject(seed: Building, atMs: number, rules: ConstructionRules): void {
    const members = this.collectCluster(seed, atMs);
    const rng = this.rng("project", seed.egid, String(atMs | 0));
    const maxGfa = Math.max(...members.map(gfaOf));
    const { startMs, builtAtMs } = this.constructionTimeline(atMs, maxGfa, rng);

    const newEgids: string[] = [];
    for (const old of members) {
      const replacement = this.makeReplacement(old, startMs, builtAtMs, atMs, rules);
      old.demolishedAtMs = startMs;
      old.replacedByEgid = replacement.egid;
      this.register(replacement, atMs);
      newEgids.push(replacement.egid);
      this.gfaTotal += gfaOf(replacement) - gfaOf(old);
    }
    this.projects.push({ kind: "renewal", decidedAtMs: atMs, oldEgids: members.map((m) => m.egid), newEgids, constructionStartMs: startMs, completedAtMs: builtAtMs });
    this.heap.push(startMs, { type: "transition" });
    this.heap.push(builtAtMs, { type: "transition" });
  }

  private makeReplacement(old: Building, startMs: number, builtAtMs: number, atMs: number, rules: ConstructionRules): Building {
    const rng = this.rng("replace", old.egid);
    const group = this.groupOf.get(old.egid) ?? null;
    const oldDwellings = old.dwellings.length;
    const oldFloors = Math.max(1, old.floorCount ?? 2);

    let dwellingCount = oldDwellings;
    let floors = oldFloors;
    let areaScale = 1;
    if (group !== null) {
      const uplift = REPLACEMENT_UPLIFT_MIN + rng() * (REPLACEMENT_UPLIFT_MAX - REPLACEMENT_UPLIFT_MIN);
      if (oldDwellings > 0) dwellingCount = Math.max(oldDwellings, stochasticRound(oldDwellings * uplift, rng()));
      const effectiveUplift = oldDwellings > 0 ? dwellingCount / oldDwellings : uplift;
      const desiredFloors = Math.max(oldFloors, stochasticRound(oldFloors * effectiveUplift, rng()));
      const [cx, cy] = this.centroidXY.get(old.egid) as XY;
      floors = Math.max(oldFloors, Math.min(desiredFloors, this.heightCap(cx, cy, old.egid)));
      if (floors < desiredFloors) areaScale = floors / desiredFloors; // capped: same dwellings, squeezed into less floor area
    }

    const building: Building = {
      egid: this.newEgid(),
      lon: old.lon,
      lat: old.lat,
      footprint: old.footprint,
      address: old.address,
      constructionYear: yearOf(builtAtMs),
      category: old.category,
      buildingClass: old.buildingClass,
      floorCount: floors,
      energyReferenceAreaM2: null,
      footprintAreaM2: old.footprintAreaM2,
      heatingGenerator: null,
      heatingEnergySource: null,
      hotWaterGenerator: null,
      hotWaterEnergySource: null,
      dwellings: this.sampleDwellings(dwellingCount, rng, areaScale),
      origin: "renewal",
      constructionStartMs: startMs,
      builtAtMs,
      replacesEgids: [old.egid],
    };
    this.finishBuilding(building, atMs, builtAtMs, rules, this.centroidXY.get(old.egid) as XY, rng);
    // The replacement stands on the old footprint: same outline, same neighbours.
    this.ringXY.set(building.egid, this.ringXY.get(old.egid) as XY[]);
    return building;
  }

  // --- growth ---

  private scheduleNextArrival(fromMs: number): void {
    const rules = constructionRules(policyStore.get(), yearOf(fromMs));
    const g = this.growthRate * rules.growthMultiplier;
    const dtYears = Math.max(0, (fromMs - this.lastArrivalScheduleMs) / YEAR_MS);
    this.targetGrowthGfa += g * this.gfaTotal * dtYears;
    this.lastArrivalScheduleMs = fromMs;

    const basePerYear = g * this.gfaTotal;
    if (basePerYear <= 0) return;
    const deficit = this.targetGrowthGfa - (this.gfaTotal - this.gfaStart);
    const correction = clamp(1 + deficit / basePerYear, GROWTH_CORRECTION_MIN, GROWTH_CORRECTION_MAX);
    const arrivalsPerYear = (correction * basePerYear) / this.meanProjectGfa;
    const u = this.rng("interarrival", String(this.arrivalCounter))();
    const gapYears = -Math.log(1 - Math.min(0.999999, u)) / arrivalsPerYear;
    this.heap.push(fromMs + Math.max(3 * DAY_MS, gapYears * YEAR_MS), { type: "newArrival" });
  }

  private onNewArrival(atMs: number): boolean {
    const placed = this.placeNewBuilding(atMs);
    this.scheduleNextArrival(atMs);
    return placed;
  }

  /** Places one new building. Normally it has to be a proper neighbour (see templateNear's
   * "match" mode); a share of arrivals, and any arrival that finds no such place, instead
   * fill a small plot with whatever fits ("fill" mode). */
  private placeNewBuilding(atMs: number): boolean {
    const rules = constructionRules(policyStore.get(), yearOf(atMs));
    const rng = this.rng("arrival", String(this.arrivalCounter++));
    const modes: PlacementMode[] = rng() < NEIGHBORHOOD_EXCEPTION_PROBABILITY ? ["fill"] : ["match", "fill"];
    return modes.some((mode) => this.attemptPlacement(atMs, rules, rng, mode));
  }

  private attemptPlacement(atMs: number, rules: ConstructionRules, rng: () => number, mode: PlacementMode): boolean {
    const maxShrinkSteps = mode === "match" ? MATCH_MODE_SHRINK_STEPS : SITE_SIZE_SHRINK_STEPS;
    for (let tries = 0; tries < 8; tries++) {
      const open = this.sites.filter((s) => !s.exhausted && (mode === "fill" || s.matchMisses < MATCH_MISSES_BEFORE_SKIP));
      if (open.length === 0) return false;
      const state = pickWeighted(open, open.map((s) => Math.sqrt(Math.max(1, s.site.areaM2 - s.usedAreaM2))), rng());

      const group = this.pickGroup(state, rng);
      if (!group) {
        state.exhausted = true;
        continue;
      }
      const remaining = state.site.areaM2 - state.usedAreaM2;
      // Every location is tried at full size before anything is shrunk: otherwise the first
      // thing to fit wins, which systematically favours small buildings.
      let placed: { rect: OrientedRect; template: Template } | null = null;
      search: for (let step = 0; step <= maxShrinkSteps; step++) {
        const shrink = Math.pow(0.85, step);
        for (let sample = 0; sample < SITE_POINT_SAMPLES; sample++) {
          const point = this.samplePoint(state, rng);
          if (!point) continue;
          const template = this.templateNear(point, group, remaining, rng, mode);
          if (!template) continue;
          const targetArea = template.footprintAreaM2 * (1 + (rng() * 2 - 1) * NEW_BUILDING_SIZE_JITTER) * shrink * shrink;
          const aspect = clamp(template.long / template.short, 1, 3);
          // Prefer lining up with the street (the nearest building); a narrow plot may
          // instead take the building along its own axis, or a longer and thinner shape.
          const neighbourAngle = this.orientationNear(point);
          const angles = neighbourAngle === null ? [state.angleRad] : [neighbourAngle, state.angleRad];
          let rect: OrientedRect | null = null;
          for (const angle of angles) {
            for (const stretch of ASPECT_STRETCHES) {
              rect = this.fitRectAt(state, point, targetArea, Math.min(aspect * stretch, MAX_ASPECT), angle);
              if (rect) break;
            }
            if (rect) break;
          }
          if (rect) {
            placed = { rect, template };
            break search;
          }
        }
      }
      if (!placed) {
        // Only a fill-mode failure says the plot itself is unusable; a match-mode miss just means
        // it cannot take a building like its neighbours.
        if (mode === "fill") {
          state.failures++;
          if (state.failures >= SITE_EXHAUSTED_AFTER_FAILURES) state.exhausted = true;
        } else {
          state.matchMisses++;
        }
        continue;
      }
      const { rect, template } = placed;
      state.failures = 0;
      state.used.push(rect);
      const footprintArea = 4 * rect.halfLong * rect.halfShort;
      state.usedAreaM2 += footprintArea;

      const [lon, lat] = this.projection.toLonLat(rect.cx, rect.cy);
      const corners = rectCorners(rect).map(([x, y]) => this.projection.toLonLat(x, y) as [number, number]);
      const ring = [...corners, corners[0]];

      let floors = Math.max(1, template.floors + (group === "apartments" ? Math.floor(rng() * 3) - 1 : 0));
      floors = Math.min(floors, group === "houseSingle" ? 3 : this.heightCap(rect.cx, rect.cy, ""), 12);
      const gfa = footprintArea * floors;
      let dwellingCount = 0;
      if (group === "apartments") dwellingCount = Math.max(3, Math.round(gfa / this.gfaPerApartment));
      else if (group === "houseSingle") dwellingCount = rng() < 0.15 ? 2 : 1;

      const { startMs, builtAtMs } = this.constructionTimeline(atMs, gfa, rng);
      const building: Building = {
        egid: this.newEgid(),
        lon,
        lat,
        footprint: ring,
        address: this.newAddress(rect.cx, rect.cy),
        constructionYear: yearOf(builtAtMs),
        category: template.category,
        buildingClass: template.buildingClass,
        floorCount: floors,
        energyReferenceAreaM2: null,
        footprintAreaM2: footprintArea,
        heatingGenerator: null,
        heatingEnergySource: null,
        hotWaterGenerator: null,
        hotWaterEnergySource: null,
        dwellings: this.sampleDwellings(dwellingCount, rng, 1),
        origin: "new",
        constructionStartMs: startMs,
        builtAtMs,
      };
      this.finishBuilding(building, atMs, builtAtMs, rules, [rect.cx, rect.cy], rng);
      this.ringXY.set(building.egid, rectCorners(rect));
      this.register(building, atMs);
      this.gfaTotal += gfa;
      this.meanProjectGfa = 0.9 * this.meanProjectGfa + 0.1 * gfa;
      this.projects.push({ kind: "new", decidedAtMs: atMs, oldEgids: [], newEgids: [building.egid], constructionStartMs: startMs, completedAtMs: builtAtMs, siteId: state.site.id });
      this.heap.push(startMs, { type: "transition" });
      this.heap.push(builtAtMs, { type: "transition" });
      return true;
    }
    return false;
  }

  private pickGroup(state: SiteState, rng: () => number): BuildingGroup | null {
    const weights = { ...ZONE_GROUP_WEIGHTS[state.site.zone] } as Partial<Record<BuildingGroup, number>>;
    if (state.site.zone === "residential") {
      const small = state.site.areaM2 - state.usedAreaM2 < SMALL_RESIDENTIAL_SITE_M2;
      weights.houseSingle = small ? 0.8 : 0.15;
      weights.apartments = small ? 0.2 : 0.85;
    }
    const remaining = state.site.areaM2 - state.usedAreaM2;
    const groups = (Object.keys(weights) as BuildingGroup[]).filter(
      (g) => (weights[g] ?? 0) > 0 && this.templates[g].length > 0 && this.smallFootprint[g] <= remaining * 0.6,
    );
    if (groups.length === 0) return null;

    // Favour the kinds whose typical local building actually fits this plot: a small plot
    // among houses gets a house, and offices go where an office-sized plot is free.
    const centre: XY = [(state.minX + state.maxX) / 2, (state.minY + state.maxY) / 2];
    const nearby = this.grid.query(centre[0], centre[1], NEIGHBORHOOD_RADIUS_M);
    const weightFor = (g: BuildingGroup): number => {
      const sizes: number[] = [];
      for (const id of nearby) {
        const b = this.byEgid.get(id);
        if (!b || b.demolishedAtMs !== undefined || this.groupOf.get(id) !== g) continue;
        const t = this.templateFor(b);
        if (t) sizes.push(t.footprintAreaM2);
      }
      sizes.sort((a, b) => a - b);
      const typical = sizes.length >= NEIGHBORHOOD_MIN_BUILDINGS ? sizes[Math.floor(sizes.length / 2)] : this.medianFootprint[g];
      const fit = Math.min(1, (remaining * 0.6) / typical);
      return (weights[g] as number) * Math.max(0.02, fit * fit);
    };
    return pickWeighted(groups, groups.map(weightFor), rng());
  }

  private samplePoint(state: SiteState, rng: () => number): XY | null {
    for (let i = 0; i < 25; i++) {
      const p: XY = [state.minX + rng() * (state.maxX - state.minX), state.minY + rng() * (state.maxY - state.minY)];
      if (pointInPolygon(p, state.rings)) return p;
    }
    return null;
  }

  /** The size template for a new building at `p`, drawn from same-kind buildings within the
   * neighbourhood (or the whole town when there are too few). "match" mode only accepts a
   * building at least MATCH_MIN_SIZE_FRACTION as large as the local typical one, so new
   * buildings look like their surroundings; "fill" mode accepts anything that fits the plot.
   * Null when nothing qualifies. */
  private templateNear(p: XY, group: BuildingGroup, remainingAreaM2: number, rng: () => number, mode: PlacementMode): Template | null {
    const neighbours = this.neighbourTemplates(p, group);
    const pool = neighbours.length >= NEIGHBORHOOD_MIN_BUILDINGS ? neighbours : this.templates[group];
    const fitting = pool.filter((t) => t.footprintAreaM2 <= remainingAreaM2 * 0.6);
    if (mode === "fill") {
      if (fitting.length === 0) return pool.reduce((a, b) => (b.footprintAreaM2 < a.footprintAreaM2 ? b : a));
      return fitting[Math.floor(rng() * fitting.length)];
    }
    const sizes = pool.map((t) => t.footprintAreaM2).sort((a, b) => a - b);
    const typical = sizes[Math.floor(sizes.length / 2)];
    const proper = fitting.filter((t) => t.footprintAreaM2 >= typical * MATCH_MIN_SIZE_FRACTION);
    return proper.length > 0 ? proper[Math.floor(rng() * proper.length)] : null;
  }

  private neighbourTemplates(p: XY, group: BuildingGroup): Template[] {
    const key = `${group}:${Math.floor(p[0] / 30)},${Math.floor(p[1] / 30)}`;
    let found = this.neighbourCache.get(key);
    if (!found) {
      found = [];
      for (const id of this.grid.query(p[0], p[1], NEIGHBORHOOD_RADIUS_M)) {
        const b = this.byEgid.get(id);
        if (!b || b.demolishedAtMs !== undefined || this.groupOf.get(id) !== group) continue;
        const t = this.templateFor(b);
        if (t) found.push(t);
      }
      this.neighbourCache.set(key, found);
    }
    return found;
  }

  /** The direction (long axis) of the nearest clearly-elongated building, so a new
   * building lines up with its street rather than with the site outline. */
  private orientationNear(p: XY): number | null {
    const key = `${Math.floor(p[0] / 30)},${Math.floor(p[1] / 30)}`;
    const cached = this.orientationNearCache.get(key);
    if (cached !== undefined) return cached;
    const result = this.orientationNearUncached(p);
    this.orientationNearCache.set(key, result);
    return result;
  }

  private orientationNearUncached(p: XY): number | null {
    let checked = 0;
    for (const id of this.grid.query(p[0], p[1], ORIENTATION_RADIUS_M)) {
      const b = this.byEgid.get(id);
      if (!b || b.demolishedAtMs !== undefined) continue;
      let o = this.orientationCache.get(id);
      if (!o) {
        const { long, short, angleRad } = boundingRectSides(this.ringXY.get(id) as XY[]);
        o = { angleRad, aspect: long / Math.max(short, 1) };
        this.orientationCache.set(id, o);
      }
      if (o.aspect >= ORIENTATION_MIN_ASPECT) return o.angleRad;
      if (++checked >= 3) break;
    }
    return null;
  }

  /** A rectangle of the given area centred on `p`, if every probe point is inside the
   * site and it clears the buildings already placed there. */
  private fitRectAt(state: SiteState, p: XY, area: number, aspect: number, angleRad: number): OrientedRect | null {
    const rect: OrientedRect = {
      cx: p[0],
      cy: p[1],
      halfLong: Math.sqrt(area * aspect) / 2,
      halfShort: Math.sqrt(area / aspect) / 2,
      angleRad,
    };
    const corners = rectCorners(rect);
    const probes: XY[] = [
      ...corners,
      [(corners[0][0] + corners[1][0]) / 2, (corners[0][1] + corners[1][1]) / 2],
      [(corners[1][0] + corners[2][0]) / 2, (corners[1][1] + corners[2][1]) / 2],
      [(corners[2][0] + corners[3][0]) / 2, (corners[2][1] + corners[3][1]) / 2],
      [(corners[3][0] + corners[0][0]) / 2, (corners[3][1] + corners[0][1]) / 2],
    ];
    if (!probes.every((q) => pointInPolygon(q, state.rings))) return null;
    if (state.used.some((other) => rectsOverlap(rect, other, SITE_NEW_BUILDING_MARGIN_M / 2))) return null;
    return rect;
  }

  // --- shared ---

  private newEgid(): string {
    this.egidCounter++;
    // Real EGIDs stay below 9e9; this range can never collide with the register.
    return `9${String(this.dataset?.bfsNumber ?? 0).padStart(4, "0")}${String(this.egidCounter).padStart(5, "0")}`;
  }

  private heightCap(x: number, y: number, excludeEgid: string): number {
    let maxFloors = 0;
    for (const id of this.grid.query(x, y, HEIGHT_CAP_RADIUS_M)) {
      if (id === excludeEgid) continue;
      const b = this.byEgid.get(id);
      if (b && b.demolishedAtMs === undefined) maxFloors = Math.max(maxFloors, b.floorCount ?? 0);
    }
    return Math.max(HEIGHT_CAP_MIN_FLOORS, maxFloors + HEIGHT_CAP_EXTRA_FLOORS);
  }

  private districtHeatingNearby(x: number, y: number, atMs: number): boolean {
    for (const id of this.grid.query(x, y, DISTRICT_HEATING_REACH_M)) {
      const b = this.byEgid.get(id);
      if (b && existsAt(b, atMs) && currentHeatingSystemId(b, atMs) === "districtHeating") return true;
    }
    return false;
  }

  private sampleDwellings(count: number, rng: () => number, areaScale: number): Dwelling[] {
    const dwellings: Dwelling[] = [];
    for (let i = 0; i < count; i++) {
      const sample = this.dwellingPool.length > 0 ? this.dwellingPool[Math.floor(rng() * this.dwellingPool.length)] : { rooms: 3.5, area: 90 };
      dwellings.push({ ewid: String(i + 1), roomCount: sample.rooms, areaM2: sample.area == null ? null : Math.round(sample.area * areaScale) });
    }
    return dwellings;
  }

  private newAddress(x: number, y: number): string | null {
    for (const radius of [200, 600, 2000]) {
      for (const id of this.grid.query(x, y, radius)) {
        const b = this.byEgid.get(id);
        const parsed = b ? this.parseAddress(b.address) : null;
        if (!parsed) continue;
        const entry = this.streetNumbers.get(parsed.street) ?? { odd: 0, even: 0 };
        const parityMax = parsed.number % 2 === 1 ? entry.odd : entry.even;
        const number = Math.max(parityMax, parsed.number) + 2;
        this.noteHouseNumber(parsed.street, number);
        return `${parsed.street} ${number}`;
      }
    }
    return null;
  }

  /** The attributes decided at permit time: heating, insulation, solar. */
  private finishBuilding(b: Building, permitAtMs: number, builtAtMs: number, rules: ConstructionRules, at: XY, rng: () => number): void {
    applyNewBuildAttributes(b, {
      rules,
      permitAtMs,
      builtAtMs,
      districtHeatingNearby: this.districtHeatingNearby(at[0], at[1], permitAtMs),
      draws: { quality: rng(), heating: rng(), solar: rng() },
    });
  }

  private register(b: Building, atMs: number): void {
    this.neighbourCache.clear();
    this.orientationNearCache.clear();
    this.all.push(b);
    this.byEgid.set(b.egid, b);
    const ring = this.ringXY.get(b.egid);
    if (!ring) {
      // New builds set their ring before registering; replacements set it right after
      // makeReplacement returns — either way it must exist for the spatial index.
      throw new Error(`stock.ts: no footprint ring for ${b.egid}`);
    }
    const centroid = ringCentroid(ring);
    this.centroidXY.set(b.egid, centroid);
    this.grid.insert(b.egid, centroid[0], centroid[1]);
    this.groupOf.set(b.egid, buildingGroup(b));
    if (this.groupOf.get(b.egid) !== null) this.scheduleTrigger(b, b.builtAtMs ?? atMs, this.rng("trigger", b.egid)());
  }
}

export const stock = new StockStore();
