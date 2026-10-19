/**
 * Solar over car parks: canopies over the town's open-air car parks of about 20 spaces and up
 * (the lots are real, from OpenStreetMap — pipeline/sources/car_parks.py). Each lot has an owner:
 *
 *  - The municipality's own — by its schools, halls and the hospital, or open to everyone with no
 *    shop, office or factory as its building. The player orders a canopy on one directly (the car
 *    parks layer) or has a few built each year by measure, the best-paying first. What the panels
 *    save the building next door and earn feeding in is credited to the department, like solar on
 *    public buildings (finances.ts).
 *  - A private owner's — a shop's, a company's, a housing estate's. Now and then the owner looks
 *    into a canopy: its building takes part of the power (up to a share of its own use, by day),
 *    the rest is sold at the feed-in price; worth it if that beats the build cost and the upkeep,
 *    weighed like every investment in the game. A municipal subsidy per kWp helps.
 *
 * A solar duty (a law) makes every lot over a size covered within so many years of its coming into
 * force, each by its own date — the town's own lots included, paid by the treasury.
 *
 * The canopies generate like any solar (registered with solarAdoption.ts as plants on no building),
 * and feed into their transformer area's station (grid.ts).
 */

import {
  CAR_PARK_BUILD_MONTHS,
  CAR_PARK_CAPEX_CHF_PER_KWP_AT_100KWP,
  CAR_PARK_CAPEX_FLOOR_CHF_PER_KWP,
  CAR_PARK_CAPEX_SCALE_EXPONENT,
  CAR_PARK_CONSIDER_PER_YEAR,
  CAR_PARK_KWP_PER_SPACE,
  CAR_PARK_LIFETIME_YEARS,
  CAR_PARK_PAYBACK_YEARS,
  CAR_PARK_PROFILES,
  CAR_PARK_PUBLIC_ACCESS,
  CAR_PARK_SELF_USE_MAX,
  CAR_PARK_SELF_USE_OF_DEMAND,
  CAR_PARK_UNCERTAINTY_FRACTION,
  CAR_PARK_UPKEEP_CHF_PER_KWP_YEAR,
} from "../config/carParks";
import { PUBLIC_SOLAR_SELF_USE_SHARE } from "../config/treasury";
import type { Building, CarParkData, MunicipalityDataset, PowerPlant } from "../data/types";
import { recordSubsidisedDecision } from "./additionality";
import { consumptionSeriesW } from "./billing";
import { buildingGroup, isMunicipalBuilding } from "./buildingGroup";
import { toDateMs, toSimTimeMs } from "./calendar";
import { priceFactor } from "./costTrends";
import { energyKWh } from "./energy";
import { simClock } from "./engine";
import { cannotPay, spendingFrozen } from "./fiscalRules";
import { historyTimeSteps, sampleBuildingCategorySeries } from "./history";
import { existsAt } from "./lifetime";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";
import { policyStore } from "./policy";
import { profileYearFactor } from "./pv";
import { chooseNext, type RenewalCandidate } from "./renewal";
import { hashSeed, mulberry32 } from "./rng";
import { setExtraPlants, specificYieldKWhPerKwp } from "./solarAdoption";
import { federalSubsidyRp } from "./solarSystems";
import { tariffStore } from "./tariffStore";
import { treasury } from "./treasury";
import { feedInExpectedRpKWhFor } from "./feedIn";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = (365.25 * DAY_MS) / 12;
const YEAR_MS = 365.25 * DAY_MS;

const yearOf = (atMs: number) => new Date(toDateMs(atMs)).getUTCFullYear();

export type CarParkOwner = "municipal" | "private";

export interface CarPark extends CarParkData {
  owner: CarParkOwner;
  ringXY: XY[];
  lon: number;
  lat: number;
  /** The canopy it would take (kWp), and how its panels face (config/pvProfiles.ts). */
  canopyKw: number;
  profile: string;
}

export interface Canopy {
  id: number;
  carParkId: string;
  owner: CarParkOwner;
  capacityKw: number;
  profile: string;
  decidedAtMs: number;
  installedAtMs: number;
  /** What it cost to build (before the federal payment), and what the municipality paid towards a
   * private one. */
  costRp: number;
  subsidyRp: number;
  /** Built because the solar duty required it, rather than by choice. */
  mandated: boolean;
}

export type CarParkState = "open" | "building" | "canopy";

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthlyChance(annual: number): number {
  return 1 - Math.pow(1 - Math.min(0.999, Math.max(0, annual)), 1 / 12);
}

/** What a canopy of `kw` costs to build per kWp at `atMs`. */
export function canopyCapexRpPerKwp(kw: number, atMs: number): number {
  const chf = Math.max(CAR_PARK_CAPEX_FLOOR_CHF_PER_KWP, CAR_PARK_CAPEX_CHF_PER_KWP_AT_100KWP * Math.pow(Math.max(kw, 1) / 100, -CAR_PARK_CAPEX_SCALE_EXPONENT));
  return chf * 100 * priceFactor("solar", atMs);
}

function pickProfile(id: string): string {
  let u = mulberry32(hashSeed(id, "car-park-profile"))() * CAR_PARK_PROFILES.reduce((s, p) => s + p.weight, 0);
  for (const p of CAR_PARK_PROFILES) {
    u -= p.weight;
    if (u < 0) return p.id;
  }
  return CAR_PARK_PROFILES[0].id;
}

class CarParks {
  private lots: CarPark[] = [];
  private byId = new Map<string, CarPark>();
  private projection = new LocalProjection(8.4, 47.4);
  private canopies: Canopy[] = [];
  /** When the solar duty came into force (null while it isn't). */
  private dutySinceMs: number | null = null;
  private selectedId: string | null = null;
  private buildingByEgid = new Map<string, Building>();
  private seed = "";
  private lastMonth = 0;
  private nextId = 1;
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset, seed: string): void {
    this.unsubscribeClock?.();
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.buildingByEgid = new Map(dataset.buildings.map((b) => [b.egid, b]));
    this.lots = (dataset.carParks ?? []).map((c) => {
      const ring = c.rings[0] ?? [];
      const lon = ring.reduce((s, q) => s + q[0], 0) / Math.max(1, ring.length);
      const lat = ring.reduce((s, q) => s + q[1], 0) / Math.max(1, ring.length);
      return {
        ...c,
        owner: this.ownerOf(c),
        ringXY: ring.map(([x, y]) => this.projection.toXY(x, y)),
        lon,
        lat,
        canopyKw: c.spaces * CAR_PARK_KWP_PER_SPACE,
        profile: pickProfile(c.id),
      };
    });
    this.byId = new Map(this.lots.map((l) => [l.id, l]));
    this.canopies = [];
    this.dutySinceMs = null;
    this.selectedId = null;
    this.seed = seed;
    this.nextId = 1;
    this.lastMonth = monthIndex(simClock.getSimTimeMs());
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    setExtraPlants("carParks", (cutoffMs) => this.plantsBefore(cutoffMs));
    this.notify();
  }

  /** The municipality's: by one of its buildings, or open to everyone with no business as its building. */
  private ownerOf(c: CarParkData): CarParkOwner {
    const host = c.hostEgid ? this.buildingByEgid.get(c.hostEgid) : undefined;
    if (host && isMunicipalBuilding(host)) return "municipal";
    const group = host ? buildingGroup(host) : null;
    const business = group === "commercial" || group === "industrial";
    return !business && (c.access === null || CAR_PARK_PUBLIC_ACCESS.includes(c.access)) ? "municipal" : "private";
  }

  // --- the lots ---

  getLots(): CarPark[] {
    return this.lots;
  }

  getLot(id: string): CarPark | undefined {
    return this.byId.get(id);
  }

  lotIdAt(lon: number, lat: number): string | null {
    const p = this.projection.toXY(lon, lat);
    return this.lots.find((l) => pointInPolygon(p, [l.ringXY]))?.id ?? null;
  }

  host(lot: CarPark): Building | undefined {
    return lot.hostEgid ? this.buildingByEgid.get(lot.hostEgid) : undefined;
  }

  canopyOn(lotId: string): Canopy | undefined {
    return this.canopies.find((c) => c.carParkId === lotId);
  }

  stateAt(lotId: string, atMs: number): CarParkState {
    const c = this.canopyOn(lotId);
    if (!c) return "open";
    return c.installedAtMs <= atMs ? "canopy" : "building";
  }

  getCanopies(): Canopy[] {
    return this.canopies;
  }

  /** The canopies in service at `atMs`, together (kW). */
  capacityAtKw(atMs: number): number {
    return this.canopies.reduce((sum, c) => sum + (c.installedAtMs <= atMs ? c.capacityKw : 0), 0);
  }

  /** What every lot could carry, together (kW). */
  potentialKw(): number {
    return this.lots.reduce((sum, l) => sum + l.canopyKw, 0);
  }

  getSelectedId(): string | null {
    return this.selectedId;
  }

  select(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.notify();
  }

  // --- what a canopy is worth ---

  /** A year of the canopy's output (kWh), at `atMs`'s yield. */
  yearlyKWh(lot: CarPark, atMs: number): number {
    return lot.canopyKw * specificYieldKWhPerKwp(atMs) * profileYearFactor(lot.profile);
  }

  /** A building's electricity use over the year before `atMs` (kWh). */
  private yearlyUseKWh(b: Building, atMs: number): number {
    const times = historyTimeSteps(atMs, YEAR_MS, 96);
    return energyKWh(times, consumptionSeriesW(sampleBuildingCategorySeries(b, times, tariffStore.at(atMs), [])));
  }

  /** The share of the canopy's power its own building takes: a private owner's by its use, a
   * public building's as for solar on its roof, none where no building goes with the lot. */
  private selfUseShare(lot: CarPark, atMs: number): number {
    const host = this.host(lot);
    if (!host || !existsAt(host, atMs)) return 0;
    if (lot.owner === "municipal") return isMunicipalBuilding(host) ? PUBLIC_SOLAR_SELF_USE_SHARE : 0;
    const output = this.yearlyKWh(lot, atMs);
    return output > 0 ? Math.min(CAR_PARK_SELF_USE_MAX, (CAR_PARK_SELF_USE_OF_DEMAND * this.yearlyUseKWh(host, atMs)) / output) : 0;
  }

  /** What the canopy's power is worth a year (Rp): what its building would otherwise buy, and the
   * rest at the feed-in price. */
  private yearlyValueRp(lot: CarPark, atMs: number, selfShare: number): number {
    const t = tariffStore.at(atMs);
    const retail = (t.peakPriceRpKWh + t.offPeakPriceRpKWh) / 2;
    return this.yearlyKWh(lot, atMs) * (selfShare * retail + (1 - selfShare) * feedInExpectedRpKWhFor(t, lot.canopyKw, yearOf(atMs)));
  }

  /** What building a canopy costs at `atMs`, and what the federal payment covers. */
  quote(lot: CarPark, atMs: number): { costRp: number; federalRp: number; netRp: number } {
    const costRp = lot.canopyKw * canopyCapexRpPerKwp(lot.canopyKw, atMs);
    const federalRp = federalSubsidyRp(lot.canopyKw);
    return { costRp, federalRp, netRp: Math.max(0, costRp - federalRp) };
  }

  /** For the card: a year's output, what it is worth, and the upkeep (Rp). */
  outlook(lot: CarPark, atMs: number): { kWh: number; valueRp: number; upkeepRp: number; selfShare: number } {
    const selfShare = this.selfUseShare(lot, atMs);
    return { kWh: this.yearlyKWh(lot, atMs), valueRp: this.yearlyValueRp(lot, atMs, selfShare), upkeepRp: lot.canopyKw * CAR_PARK_UPKEEP_CHF_PER_KWP_YEAR * 100, selfShare };
  }

  /** What each franc the municipality puts into a canopy on its lot brings back a year. */
  private municipalReturn(lot: CarPark, atMs: number): number {
    const { netRp } = this.quote(lot, atMs);
    const o = this.outlook(lot, atMs);
    return netRp > 0 ? (o.valueRp - o.upkeepRp) / netRp : 0;
  }

  // --- building ---

  private addCanopy(lot: CarPark, atMs: number, fields: { costRp: number; subsidyRp: number; mandated: boolean }): Canopy {
    const canopy: Canopy = {
      id: this.nextId++,
      carParkId: lot.id,
      owner: lot.owner,
      capacityKw: lot.canopyKw,
      profile: lot.profile,
      decidedAtMs: atMs,
      installedAtMs: atMs + CAR_PARK_BUILD_MONTHS * MONTH_MS,
      ...fields,
    };
    this.canopies.push(canopy);
    return canopy;
  }

  /** The municipality builds a canopy over one of its own lots: the price less the federal payment,
   * from the treasury, today. A direct order waits out a spending freeze; the measure carries on. */
  buildMunicipal(lotId: string, atMs: number, { direct = true } = {}): Canopy | null {
    const lot = this.byId.get(lotId);
    if (!lot || lot.owner !== "municipal" || this.canopyOn(lotId)) return null;
    const q = this.quote(lot, atMs);
    if (direct && (spendingFrozen(atMs) || cannotPay(q.netRp, atMs))) return null;
    const canopy = this.addCanopy(lot, atMs, { costRp: q.costRp, subsidyRp: 0, mandated: false });
    treasury.recordPayout("infrastructure", atMs, q.netRp, `car-park-${lot.id}`);
    this.notify();
    return canopy;
  }

  /** The town's lots still without a canopy. */
  municipalCandidates(): CarPark[] {
    return this.lots.filter((l) => l.owner === "municipal" && !this.canopyOn(l.id));
  }

  /** What the municipality pays towards a private canopy of `kw`. */
  private subsidyRp(kw: number): number {
    return kw * policyStore.get().carParkSolarSubsidyRpPerKwp;
  }

  /** A private owner weighs a canopy over its lot against doing nothing, with and without the
   * subsidy (whether the subsidy changed the choice). */
  private consider(lot: CarPark, atMs: number): Canopy | null {
    const q = this.quote(lot, atMs);
    const o = this.outlook(lot, atMs);
    const subsidyRp = this.subsidyRp(lot.canopyKw);
    const policy = policyStore.get();
    const decide = (subsidy: number) => {
      type Choice = "none" | "canopy";
      const candidates: RenewalCandidate<Choice>[] = [
        { id: "none", available: true, annualizedCostRp: 0, lifetimeMeanYears: CAR_PARK_LIFETIME_YEARS, greenness: 0 },
        {
          id: "canopy",
          available: true,
          annualizedCostRp: Math.max(0, q.netRp - subsidy) / CAR_PARK_PAYBACK_YEARS + o.upkeepRp - o.valueRp,
          lifetimeMeanYears: CAR_PARK_LIFETIME_YEARS,
          greenness: 1,
        },
      ];
      return chooseNext(candidates, "none", CAR_PARK_UNCERTAINTY_FRACTION * policy.uncertaintyMultiplier, policy.progressiveNudgeRp).chosen;
    };
    if (decide(subsidyRp) === "none") return null;
    if (subsidyRp > 0) recordSubsidisedDecision({ atMs, category: "solar", subsidyRp, additional: decide(0) === "none" });
    const canopy = this.addCanopy(lot, atMs, { costRp: q.costRp, subsidyRp, mandated: false });
    if (subsidyRp > 0) treasury.recordPayout("solar", atMs, subsidyRp, `car-park-${lot.id}`);
    return canopy;
  }

  // --- the solar duty ---

  /** Whether the duty covers a lot (its size), and by when it must have its canopy. */
  dueAtMs(lot: CarPark): number | null {
    const p = policyStore.get();
    if (this.dutySinceMs === null || p.carParkSolarDutyMinSpaces <= 0 || lot.spaces < p.carParkSolarDutyMinSpaces) return null;
    // Owners spread over the period they are given, each by its own date.
    const share = mulberry32(hashSeed(this.seed, "car-park-duty", lot.id))();
    return this.dutySinceMs + (0.15 + 0.85 * share) * p.carParkSolarDutyYears * YEAR_MS;
  }

  getDutySinceMs(): number | null {
    return this.dutySinceMs;
  }

  // --- time ---

  /** Runs the months up to `nowMs` (the clock calls it; so do the dev runners). */
  advance(nowMs: number): void {
    const month = monthIndex(nowMs);
    if (month <= this.lastMonth) return;
    // A long jump takes at most two years of months.
    for (let m = Math.max(this.lastMonth + 1, month - 24); m <= month; m++) this.monthly(m);
    this.lastMonth = month;
  }

  private monthly(month: number): void {
    const atMs = toSimTimeMs(Date.UTC(Math.floor(month / 12), month % 12, 1));
    const policy = policyStore.get();
    let changed = false;

    // The duty: in force from the first month it applies, gone when repealed.
    const dutyOn = policy.carParkSolarDutyMinSpaces > 0;
    if (dutyOn !== (this.dutySinceMs !== null)) {
      this.dutySinceMs = dutyOn ? atMs : null;
      changed = true;
    }

    // Private owners look into a canopy now and then.
    const chance = monthlyChance(CAR_PARK_CONSIDER_PER_YEAR);
    for (const lot of this.lots) {
      if (lot.owner !== "private" || this.canopyOn(lot.id)) continue;
      if (mulberry32(hashSeed(this.seed, "car-park-consider", lot.id, String(month)))() >= chance) continue;
      if (this.consider(lot, atMs)) changed = true;
    }

    // Lots whose date under the duty has come: built now, whoever owns them.
    for (const lot of this.lots) {
      if (this.canopyOn(lot.id)) continue;
      const due = this.dueAtMs(lot);
      if (due === null || due > atMs) continue;
      if (lot.owner === "municipal") {
        const q = this.quote(lot, atMs);
        this.addCanopy(lot, atMs, { costRp: q.costRp, subsidyRp: 0, mandated: true });
        treasury.recordPayout("infrastructure", atMs, q.netRp, `car-park-${lot.id}`);
      } else {
        const q = this.quote(lot, atMs);
        const subsidyRp = this.subsidyRp(lot.canopyKw);
        this.addCanopy(lot, atMs, { costRp: q.costRp, subsidyRp, mandated: true });
        if (subsidyRp > 0) treasury.recordPayout("solar", atMs, subsidyRp, `car-park-${lot.id}`);
      }
      changed = true;
    }

    // The municipality's programme: a few of its lots a year, the best-paying first, one month at a
    // time through the year.
    const perMonth = policy.carParkSolarMunicipalPerYear / 12;
    if (perMonth > 0) {
      const whole = Math.floor(perMonth);
      const count = whole + (mulberry32(hashSeed(this.seed, "car-park-programme", String(month)))() < perMonth - whole ? 1 : 0);
      if (count > 0) {
        const ranked = this.municipalCandidates()
          .map((lot) => ({ lot, r: this.municipalReturn(lot, atMs) }))
          .sort((a, b) => b.r - a.r || a.lot.id.localeCompare(b.lot.id));
        for (const { lot } of ranked.slice(0, count)) if (this.buildMunicipal(lot.id, atMs, { direct: false })) changed = true;
      }
    }

    if (changed) this.notify();
  }

  // --- generation ---

  /** The canopies generating before `cutoffMs`, as plants on no building (solarAdoption.ts). */
  plantsBefore(cutoffMs: number): PowerPlant[] {
    const plants: PowerPlant[] = [];
    for (const c of this.canopies) {
      if (c.installedAtMs >= cutoffMs) continue;
      const lot = this.byId.get(c.carParkId);
      plants.push({ plantId: `car-park:${c.id}`, lon: lot?.lon ?? 0, lat: lot?.lat ?? 0, capacityKw: c.capacityKw, technology: "Photovoltaic", commissioningDate: null, egid: null, pvProfile: c.profile });
    }
    return plants;
  }

  /** The municipality's canopies in service before `cutoffMs`, each with the share of its power its
   * building takes — for the department's credit (finances.ts). */
  municipalPlants(cutoffMs: number): { plant: PowerPlant; selfShare: number }[] {
    const plants = this.plantsBefore(cutoffMs);
    return this.canopies
      .filter((c) => c.owner === "municipal" && c.installedAtMs < cutoffMs)
      .map((c) => {
        const lot = this.byId.get(c.carParkId);
        const host = lot ? this.host(lot) : undefined;
        return { plant: plants.find((p) => p.plantId === `car-park:${c.id}`)!, selfShare: host && isMunicipalBuilding(host) ? PUBLIC_SOLAR_SELF_USE_SHARE : 0 };
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

  snapshot() {
    return { canopies: this.canopies, dutySinceMs: this.dutySinceMs, lastMonth: this.lastMonth, nextId: this.nextId };
  }

  restore(s: ReturnType<CarParks["snapshot"]>): void {
    this.canopies = s.canopies;
    this.dutySinceMs = s.dutySinceMs;
    this.lastMonth = s.lastMonth;
    this.nextId = s.nextId;
    this.selectedId = null;
    this.notify();
  }
}

export const carParks = new CarParks();
