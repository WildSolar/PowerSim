/**
 * Agri-PV: solar over farmland that stays farmed. Free-standing solar is all but impossible outside
 * the building zones in Switzerland; Agri-PV — panels high above the crops or in rows between them —
 * is the opening. Two steps, two actors:
 *
 *  - The municipality zones fields for it (the plots are real: farmland outside the building zones,
 *    cut along the cadastral parcels — pipeline/sources/farm.py). Like any zoning change it costs the
 *    planning work, takes a procedure, and goes to the voters — and people mind: landscape and food
 *    against, the climate-minded for. Part of that stays for as long as the zones are there. The
 *    Agri-PV dialogue (an information measure) builds acceptance over the years, which takes the edge
 *    off both; so does every field people get to see.
 *  - Businesses with a big electricity use build on the zoned fields. Now and then each looks into
 *    the zoned field nearest to it: a power purchase agreement (PPA) — it takes the field's power as
 *    it comes, instead of buying that energy from the utility. Worth it if the energy it saves beats
 *    the build cost, the upkeep and the farmer's rent, weighed like every investment in the game.
 *
 * The fields generate like any solar (registered with solarAdoption.ts as plants of their own, on
 * no building); the utility pays no feed-in for them, and sells their partners that much less
 * energy (finances.ts).
 */

import { GRID_UPKEEP_RP_PER_KWH } from "../config/market";
import { BLOC_ORDER } from "../config/approval";
import {
  AGRI_PV_ACCEPTANCE_MAX,
  AGRI_PV_ACCEPTANCE_PER_FIELD,
  AGRI_PV_ACCEPTANCE_PER_YEAR_DIALOGUE,
  AGRI_PV_BUILD_MONTHS,
  AGRI_PV_CAPEX_CHF_PER_KWP_AT_500KWP,
  AGRI_PV_CAPEX_FLOOR_CHF_PER_KWP,
  AGRI_PV_CAPEX_SCALE_EXPONENT,
  AGRI_PV_CONSIDER_PER_YEAR,
  AGRI_PV_FULL_SCALE_HA,
  AGRI_PV_KWP_PER_HA,
  AGRI_PV_LASTING_SHARE,
  AGRI_PV_LEAD_MONTHS,
  AGRI_PV_LIFETIME_YEARS,
  AGRI_PV_MIN_CONSUMER_MWH,
  AGRI_PV_MIN_FOOTPRINT_M2,
  AGRI_PV_MIN_KWP,
  AGRI_PV_MIN_SCALE,
  AGRI_PV_PLANNING_COST_CHF,
  AGRI_PV_PLANNING_COST_CHF_PER_HA,
  AGRI_PV_PPA_COVER_SHARE,
  AGRI_PV_PRIME_FACTOR,
  AGRI_PV_RENT_CHF_PER_HA_YEAR,
  AGRI_PV_STANCES,
  AGRI_PV_UNCERTAINTY_FRACTION,
  AGRI_PV_UPKEEP_CHF_PER_KWP_YEAR,
} from "../config/agriPv";
import type { Building, FarmPlotData, MunicipalityDataset, PowerPlant } from "../data/types";
import { approval, setLocalStances, type Stances } from "./approval";
import { consumptionSeriesW } from "./billing";
import { buildingGroup } from "./buildingGroup";
import { toDateMs, toSimTimeMs } from "./calendar";
import { priceFactor } from "./costTrends";
import { energyKWh } from "./energy";
import { simClock } from "./engine";
import { spendingFrozen } from "./fiscalRules";
import { historyTimeSteps, sampleBuildingCategorySeries } from "./history";
import { existsAt } from "./lifetime";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";
import { policyStore } from "./policy";
import { hashSeed, mulberry32 } from "./rng";
import { chooseNext, type RenewalCandidate } from "./renewal";
import { setExtraPlants, specificYieldKWhPerKwp } from "./solarAdoption";
import { tariffStore } from "./tariffStore";
import { treasury } from "./treasury";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = (365.25 * DAY_MS) / 12;
const YEAR_MS = 365.25 * DAY_MS;

export interface AgriPvDesignation {
  id: number;
  plotIds: string[];
  title: string;
  submittedAtMs: number;
  effectiveAtMs: number;
  voteAtMs: number | null;
  rejected: boolean;
  costRp: number;
}

export interface AgriPvField {
  id: number;
  plotId: string;
  /** The business that built it and buys its power. */
  partnerEgid: string;
  capacityKw: number;
  decidedAtMs: number;
  installedAtMs: number;
  costRp: number;
}

export interface AgriPvQuote {
  plotIds: string[];
  areaM2: number;
  /** The share of it that is prime cropland. */
  primeShare: number;
  costRp: number;
  stances: Stances;
  title: string;
}

export type PlotState = "farmland" | "planned" | "zoned" | "field" | "fieldBuilding";

interface Plot extends FarmPlotData {
  ringXY: XY[];
  centre: XY;
  lon: number;
  lat: number;
}

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthlyChance(annual: number): number {
  return 1 - Math.pow(1 - Math.min(0.999, Math.max(0, annual)), 1 / 12);
}

/** What a field of `kw` costs to build per kWp at `atMs`. */
function capexRpPerKwp(kw: number, atMs: number): number {
  const chf = Math.max(AGRI_PV_CAPEX_FLOOR_CHF_PER_KWP, AGRI_PV_CAPEX_CHF_PER_KWP_AT_500KWP * Math.pow(Math.max(kw, 1) / 500, -AGRI_PV_CAPEX_SCALE_EXPONENT));
  return chf * 100 * priceFactor("solar", atMs);
}

class AgriPv {
  private plots: Plot[] = [];
  private byId = new Map<string, Plot>();
  private projection = new LocalProjection(8.4, 47.4);
  private designations: AgriPvDesignation[] = [];
  private fields: AgriPvField[] = [];
  private acceptance = 0;
  private selection = new Set<string>();
  private buildingsProvider: () => Building[] = () => [];
  private seed = "";
  private lastMonth = 0;
  private nextId = 1;
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private stanceCache: { key: string; stances: Stances } | null = null;

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribeClock?.();
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.plots = (dataset.farmPlots ?? []).map((p) => {
      const ring = p.rings[0] ?? [];
      const ringXY = ring.map(([lon, lat]) => this.projection.toXY(lon, lat));
      const lon = ring.reduce((s, q) => s + q[0], 0) / Math.max(1, ring.length);
      const lat = ring.reduce((s, q) => s + q[1], 0) / Math.max(1, ring.length);
      return { ...p, ringXY, centre: this.projection.toXY(lon, lat), lon, lat };
    });
    this.byId = new Map(this.plots.map((p) => [p.id, p]));
    this.designations = [];
    this.fields = [];
    this.acceptance = 0;
    this.selection = new Set();
    this.buildingsProvider = buildingsProvider;
    this.seed = seed;
    this.nextId = 1;
    this.lastMonth = monthIndex(simClock.getSimTimeMs());
    this.stanceCache = null;
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    setExtraPlants("agriPv", (cutoffMs) => this.plantsBefore(cutoffMs));
    setLocalStances("agriPv", (atMs) => this.lastingStances(atMs));
    this.notify();
  }

  // --- the plots ---

  getPlots(): Plot[] {
    return this.plots;
  }

  getPlot(id: string): Plot | undefined {
    return this.byId.get(id);
  }

  plotIdAt(lon: number, lat: number): string | null {
    const p = this.projection.toXY(lon, lat);
    return this.plots.find((plot) => pointInPolygon(p, [plot.ringXY]))?.id ?? null;
  }

  /** Whether a plot is zoned for Agri-PV at `atMs` (a designation in force, not struck down). */
  zonedAt(plotId: string, atMs: number): boolean {
    return this.designations.some((d) => !d.rejected && d.effectiveAtMs <= atMs && d.plotIds.includes(plotId));
  }

  /** Whether a plot is zoned or on its way to being so. */
  zonedOrPlanned(plotId: string): boolean {
    return this.designations.some((d) => !d.rejected && d.plotIds.includes(plotId));
  }

  fieldOn(plotId: string): AgriPvField | undefined {
    return this.fields.find((f) => f.plotId === plotId);
  }

  stateAt(plotId: string, atMs: number): PlotState {
    const field = this.fieldOn(plotId);
    if (field) return field.installedAtMs <= atMs ? "field" : "fieldBuilding";
    if (this.zonedAt(plotId, atMs)) return "zoned";
    if (this.zonedOrPlanned(plotId)) return "planned";
    return "farmland";
  }

  getDesignations(): AgriPvDesignation[] {
    return this.designations;
  }

  getFields(): AgriPvField[] {
    return this.fields;
  }

  getAcceptance(): number {
    return this.acceptance;
  }

  /** The zoned area in force at `atMs` (m²). */
  zonedAreaM2(atMs: number): number {
    return this.plots.reduce((sum, p) => sum + (this.zonedAt(p.id, atMs) ? p.areaM2 : 0), 0);
  }

  // --- designating ---

  getSelection(): ReadonlySet<string> {
    return this.selection;
  }

  toggle(plotId: string): void {
    if (!this.byId.has(plotId)) return;
    if (this.selection.has(plotId)) this.selection.delete(plotId);
    else this.selection.add(plotId);
    this.notify();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.notify();
  }

  /** The stances toward designating `areaM2` of farmland (`primeShare` of it prime), softened by
   * acceptance where they are against. */
  private stancesFor(areaM2: number, primeShare: number, factor = 1): Stances {
    const scale = Math.min(1, Math.max(AGRI_PV_MIN_SCALE, areaM2 / 10_000 / AGRI_PV_FULL_SCALE_HA));
    const against = (1 - this.acceptance) * (1 + (AGRI_PV_PRIME_FACTOR - 1) * primeShare);
    const stances: Stances = {};
    for (const b of BLOC_ORDER) {
      const s = AGRI_PV_STANCES[b as keyof typeof AGRI_PV_STANCES];
      if (s === undefined) continue;
      stances[b] = s * scale * factor * (s < 0 ? against : 1);
    }
    return stances;
  }

  /** What putting the picked plots forward would do. */
  quote(): AgriPvQuote {
    const plotIds = [...this.selection].filter((id) => !this.zonedOrPlanned(id) && !this.fieldOn(id));
    const plots = plotIds.map((id) => this.byId.get(id) as Plot);
    const areaM2 = plots.reduce((sum, p) => sum + p.areaM2, 0);
    const primeShare = areaM2 > 0 ? plots.reduce((sum, p) => sum + p.areaM2 * p.primeShare, 0) / areaM2 : 0;
    const costRp = plotIds.length > 0 ? Math.round((AGRI_PV_PLANNING_COST_CHF + (AGRI_PV_PLANNING_COST_CHF_PER_HA * areaM2) / 10_000) * 100) : 0;
    const title = `Agri-PV zone: ${plotIds.length} field${plotIds.length === 1 ? "" : "s"}, ${(areaM2 / 10_000).toFixed(1)} ha`;
    return { plotIds, areaM2, primeShare, costRp, stances: plotIds.length > 0 ? this.stancesFor(areaM2, primeShare) : {}, title };
  }

  /** Puts the picked plots forward as an Agri-PV zone: the planning cost now, the public reacts,
   * and it always goes to the voters before it comes into force. */
  submit(atMs: number): AgriPvDesignation | null {
    const q = this.quote();
    if (q.plotIds.length === 0 || spendingFrozen(atMs)) return null;
    const d: AgriPvDesignation = {
      id: this.nextId++,
      plotIds: q.plotIds,
      title: q.title,
      submittedAtMs: atMs,
      effectiveAtMs: atMs + AGRI_PV_LEAD_MONTHS * MONTH_MS,
      voteAtMs: null,
      rejected: false,
      costRp: q.costRp,
    };
    this.designations.push(d);
    treasury.recordPayout("zoning", atMs, q.costRp, `agri-pv-${d.id}`);
    d.voteAtMs = approval.decide({
      key: `agriPv:${d.id}`,
      title: d.title,
      stances: q.stances,
      referendum: "mandatory",
      leadTimeMonths: AGRI_PV_LEAD_MONTHS,
      atMs,
      onVote: (accepted) => this.voteResult(d.id, accepted),
    });
    this.selection = new Set();
    this.stanceCache = null;
    this.notify();
    return d;
  }

  /** What a lost vote does (also rebuilt for a loaded game's pending votes). */
  voteResult(id: number, accepted: boolean): void {
    const d = this.designations.find((x) => x.id === id);
    if (!d || accepted) return;
    d.rejected = true;
    this.stanceCache = null;
    this.notify();
  }

  /** The lasting pull of the zones in force at `atMs`: part of the stance toward them, softened by
   * acceptance as it grows. */
  private lastingStances(atMs: number): Stances {
    const key = `${Math.floor(atMs / MONTH_MS)}:${this.version}`;
    if (this.stanceCache?.key === key) return this.stanceCache.stances;
    let areaM2 = 0;
    let primeM2 = 0;
    for (const p of this.plots) {
      if (!this.zonedAt(p.id, atMs)) continue;
      areaM2 += p.areaM2;
      primeM2 += p.areaM2 * p.primeShare;
    }
    const stances = areaM2 > 0 ? this.stancesFor(areaM2, primeM2 / areaM2, AGRI_PV_LASTING_SHARE) : {};
    this.stanceCache = { key, stances };
    return stances;
  }

  // --- the fields ---

  /** The fields generating before `cutoffMs`, as plants on no building (solarAdoption.ts). */
  private plantsBefore(cutoffMs: number): PowerPlant[] {
    const plants: PowerPlant[] = [];
    for (const f of this.fields) {
      if (f.installedAtMs >= cutoffMs) continue;
      const plot = this.byId.get(f.plotId);
      plants.push({ plantId: `agri-pv:${f.id}`, lon: plot?.lon ?? 0, lat: plot?.lat ?? 0, capacityKw: f.capacityKw, technology: "Photovoltaic", commissioningDate: null, egid: null });
    }
    return plants;
  }

  /** The fields in service at `atMs`, and their combined size (kW). */
  capacityAtKw(atMs: number): number {
    return this.fields.reduce((sum, f) => sum + (f.installedAtMs <= atMs ? f.capacityKw : 0), 0);
  }

  /** The energy the fields' partners take instead of buying it from the utility, at `atMs`'s
   * tariff: what they would have paid for it, less the grid fee they still pay (Rp per kWh). */
  ppaEnergyValueRpPerKWh(atMs: number): number {
    const t = tariffStore.at(atMs);
    return Math.max(0, (t.peakPriceRpKWh + t.offPeakPriceRpKWh) / 2 - GRID_UPKEEP_RP_PER_KWH);
  }

  /** A business's electricity use over the year before `atMs` (kWh). */
  private yearlyUseKWh(b: Building, atMs: number): number {
    const times = historyTimeSteps(atMs, YEAR_MS, 96);
    return energyKWh(times, consumptionSeriesW(sampleBuildingCategorySeries(b, times, tariffStore.at(atMs), [])));
  }

  /** The businesses big enough to look into a field. */
  private consumers(atMs: number): Building[] {
    return this.buildingsProvider().filter((b) => {
      if ((b.footprintAreaM2 ?? 0) < AGRI_PV_MIN_FOOTPRINT_M2 || !existsAt(b, atMs)) return false;
      const g = buildingGroup(b);
      return g === "commercial" || g === "industrial";
    });
  }

  /** The zoned field nearest to a business, free to build on. */
  private nearestFreeField(b: Building, atMs: number): Plot | null {
    const p = this.projection.toXY(b.lon, b.lat);
    let best: { plot: Plot; d: number } | null = null;
    for (const plot of this.plots) {
      if (!this.zonedAt(plot.id, atMs) || this.fieldOn(plot.id)) continue;
      const d = Math.hypot(plot.centre[0] - p[0], plot.centre[1] - p[1]);
      if (!best || d < best.d) best = { plot, d };
    }
    return best?.plot ?? null;
  }

  /** A business weighs a field: a PPA sized to the field and to its use, against doing nothing. */
  private consider(b: Building, plot: Plot, atMs: number): AgriPvField | null {
    const useKWh = this.yearlyUseKWh(b, atMs);
    if (useKWh < AGRI_PV_MIN_CONSUMER_MWH * 1000) return null;
    const yieldPerKwp = specificYieldKWhPerKwp(atMs);
    const kw = Math.min((plot.areaM2 / 10_000) * AGRI_PV_KWP_PER_HA, (useKWh * AGRI_PV_PPA_COVER_SHARE) / yieldPerKwp);
    if (kw < AGRI_PV_MIN_KWP) return null;
    const costRp = kw * capexRpPerKwp(kw, atMs);
    const rentRp = (kw / AGRI_PV_KWP_PER_HA) * AGRI_PV_RENT_CHF_PER_HA_YEAR * 100;
    const upkeepRp = kw * AGRI_PV_UPKEEP_CHF_PER_KWP_YEAR * 100;
    const savedRp = kw * yieldPerKwp * this.ppaEnergyValueRpPerKWh(atMs);
    type Choice = "none" | "field";
    const candidates: RenewalCandidate<Choice>[] = [
      { id: "none", available: true, annualizedCostRp: 0, lifetimeMeanYears: AGRI_PV_LIFETIME_YEARS, greenness: 0 },
      { id: "field", available: true, annualizedCostRp: costRp / AGRI_PV_LIFETIME_YEARS + rentRp + upkeepRp - savedRp, lifetimeMeanYears: AGRI_PV_LIFETIME_YEARS, greenness: 1 },
    ];
    const policy = policyStore.get();
    const { chosen } = chooseNext(candidates, "none", AGRI_PV_UNCERTAINTY_FRACTION * policy.uncertaintyMultiplier, policy.progressiveNudgeRp);
    if (chosen === "none") return null;
    return { id: this.nextId++, plotId: plot.id, partnerEgid: b.egid, capacityKw: kw, decidedAtMs: atMs, installedAtMs: atMs + AGRI_PV_BUILD_MONTHS * MONTH_MS, costRp };
  }

  // --- time ---

  private advance(nowMs: number): void {
    const month = monthIndex(nowMs);
    if (month <= this.lastMonth) return;
    // A long jump takes at most two years of months.
    for (let m = Math.max(this.lastMonth + 1, month - 24); m <= month; m++) this.monthly(m);
    this.lastMonth = month;
  }

  private monthly(month: number): void {
    const atMs = toSimTimeMs(Date.UTC(Math.floor(month / 12), month % 12, 1));
    // Acceptance: the dialogue, while it runs.
    if (policyStore.get().agriPvDialogue > 0) this.acceptance = Math.min(AGRI_PV_ACCEPTANCE_MAX, this.acceptance + AGRI_PV_ACCEPTANCE_PER_YEAR_DIALOGUE / 12);
    // Businesses look into the zoned fields.
    if (!this.plots.some((p) => this.zonedAt(p.id, atMs) && !this.fieldOn(p.id))) return;
    const withField = new Set(this.fields.map((f) => f.partnerEgid));
    const chance = monthlyChance(AGRI_PV_CONSIDER_PER_YEAR);
    let built = false;
    for (const b of this.consumers(atMs)) {
      if (withField.has(b.egid)) continue;
      if (mulberry32(hashSeed(this.seed, "consider", b.egid, String(month)))() >= chance) continue;
      const plot = this.nearestFreeField(b, atMs);
      if (!plot) break;
      const field = this.consider(b, plot, atMs);
      if (!field) continue;
      this.fields.push(field);
      withField.add(b.egid);
      this.acceptance = Math.min(AGRI_PV_ACCEPTANCE_MAX, this.acceptance + AGRI_PV_ACCEPTANCE_PER_FIELD);
      built = true;
    }
    if (built) {
      this.stanceCache = null;
      this.notify();
    }
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
    return { designations: this.designations, fields: this.fields, acceptance: this.acceptance, lastMonth: this.lastMonth, nextId: this.nextId };
  }

  restore(s: ReturnType<AgriPv["snapshot"]>): void {
    this.designations = s.designations;
    this.fields = s.fields;
    this.acceptance = s.acceptance;
    this.lastMonth = s.lastMonth;
    this.nextId = s.nextId;
    this.selection = new Set();
    this.stanceCache = null;
    this.notify();
  }
}

export const agriPv = new AgriPv();

/** The partner a field's PPA is with: its building's address. */
export function partnerName(egid: string, buildings: Building[]): string {
  return buildings.find((b) => b.egid === egid)?.address ?? `business ${egid}`;
}
