/**
 * Agri-PV: solar over farmland that stays farmed. Free-standing solar is all but impossible outside
 * the building zones in Switzerland; Agri-PV — panels high above the crops or in rows between them —
 * is the opening. Like wind (wind.ts), a field goes a long road, step by step:
 *
 *  1. The municipality zones fields for it (the plots are real: farmland outside the building zones,
 *     cut along the cadastral parcels — pipeline/sources/farm.py). Like any change to the zoning plan
 *     it costs the planning work, takes a procedure, and goes to the voters — and people mind:
 *     landscape and food against, the climate-minded for. Part of that stays for as long as the
 *     zones are there. The Agri-PV dialogue (an information measure) builds acceptance over the
 *     years, which takes the edge off both; so does every field people get to see.
 *  2. A developer asks the farmer — who may say no: whether each would is drawn once per field,
 *     unknown until asked, and more come round as acceptance grows; a no stands for a few years —
 *     and with the farmer's yes takes the field up and applies for the permit (a year): sometimes
 *     appealed, and now and then struck down in court; then the field rests a few years.
 *  3. The build (a year), over the whole field, of one of the kinds the field takes (config/agriPv.ts
 *     — vertical rows, fixed rows over orchards and vines, or tracking rows; cropland only the first
 *     and the last): each developer picks the one that pays best for it, the municipality the one
 *     the player chooses when applying for the permit.
 *
 * Three kinds of developer:
 *  - Businesses with a big electricity use, each now and then looking into the zoned field nearest to
 *    it, with a power purchase agreement (PPA): it takes the field's power as it comes, up to a share
 *    of its own use, instead of buying that energy from the utility, and sells the rest to the
 *    utility at the feed-in price. Worth it if that beats the build, the upkeep and the farmer's
 *    rent, weighed like every investment in the game.
 *  - Energy cooperatives: residents pooling their savings, selling all the power at the feed-in price
 *    — content with their money back and a little more, but only as big as they can raise.
 *  - The municipality, when the player takes a field up: permit and build paid from the treasury,
 *    the power the utility's own (no feed-in paid for it; it saves buying power), the upkeep and the
 *    rent in the utility's accounts.
 * A business or a cooperative builds as soon as its permit stands; the municipality when the player
 * orders it.
 *
 * The fields generate like any solar (registered with solarAdoption.ts as plants of their own, on
 * no building), each kind facing the sun its own way (sim/pv.ts); finances.ts settles who is paid
 * for what.
 */

import { BLOC_ORDER } from "../config/approval";
import {
  AGRI_PV_ACCEPTANCE_MAX,
  AGRI_PV_ACCEPTANCE_PER_FIELD,
  AGRI_PV_ACCEPTANCE_PER_YEAR_DIALOGUE,
  AGRI_PV_APPEAL_CHANCE,
  AGRI_PV_PERMIT_REFUSED_CHANCE,
  AGRI_PV_APPEAL_UPHELD_CHANCE,
  AGRI_PV_APPEAL_YEARS,
  AGRI_PV_BUILD_MONTHS,
  AGRI_PV_CAPEX_CHF_PER_KWP_AT_500KWP,
  AGRI_PV_CAPEX_FLOOR_CHF_PER_KWP,
  AGRI_PV_CAPEX_SCALE_EXPONENT,
  AGRI_PV_CONSIDER_PER_YEAR,
  AGRI_PV_COOP_CONSIDER_PER_YEAR,
  AGRI_PV_COOP_MAX_CHF,
  AGRI_PV_COOP_MIN_RETURN,
  AGRI_PV_FULL_SCALE_HA,
  AGRI_PV_CROPLAND_SHARE,
  AGRI_PV_CROPLAND_SYSTEMS,
  AGRI_PV_SYSTEMS,
  type AgriPvSystem,
  AGRI_PV_LASTING_SHARE,
  AGRI_PV_LEAD_MONTHS,
  AGRI_PV_LIFETIME_YEARS,
  AGRI_PV_MIN_CONSUMER_MWH,
  AGRI_PV_MIN_FOOTPRINT_M2,
  AGRI_PV_MIN_KWP,
  AGRI_PV_MIN_SCALE,
  AGRI_PV_PERMIT_COST_CHF,
  AGRI_PV_PERMIT_COST_CHF_PER_HA,
  AGRI_PV_PERMIT_MONTHS,
  AGRI_PV_PLANNING_COST_CHF,
  AGRI_PV_PLANNING_COST_CHF_PER_HA,
  AGRI_PV_PPA_COVER_SHARE,
  AGRI_PV_PRIME_FACTOR,
  AGRI_PV_FARMER_ACCEPTANCE_PULL,
  AGRI_PV_FARMER_RETRY_YEARS,
  AGRI_PV_FARMER_WILLING_SHARE,
  AGRI_PV_RENT_CHF_PER_HA_YEAR,
  AGRI_PV_RENT_SPREAD,
  AGRI_PV_RETRY_YEARS,
  AGRI_PV_STANCES,
  AGRI_PV_UNCERTAINTY_FRACTION,
} from "../config/agriPv";
import type { Building, FarmPlotData, MunicipalityDataset, PowerPlant } from "../data/types";
import { approval, setLocalStances, type Stances } from "./approval";
import { consumptionSeriesW } from "./billing";
import { buildingGroup } from "./buildingGroup";
import { toDateMs, toSimTimeMs } from "./calendar";
import { priceFactor } from "./costTrends";
import { energyKWh } from "./energy";
import { simClock } from "./engine";
import { cannotPay, spendingFrozen } from "./fiscalRules";
import { historyTimeSteps, sampleBuildingCategorySeries } from "./history";
import { inbox } from "./inbox";
import { existsAt } from "./lifetime";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";
import { policyStore } from "./policy";
import { hashSeed, mulberry32 } from "./rng";
import { chooseNext, type RenewalCandidate } from "./renewal";
import { setExtraPlants, specificYieldKWhPerKwp } from "./solarAdoption";
import { profileYearFactor } from "./pv";
import { tariffStore } from "./tariffStore";
import { feedInExpectedRpKWhFor } from "./feedIn";
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

export type AgriPvDeveloper = "business" | "cooperative" | "municipality";

export type AgriPvPhase =
  | "permitting" // the permit procedure
  | "appeal" // the permit is appealed, in the courts
  | "permitted" // permitted, waiting on the municipality to build
  | "building"
  | "operating"
  | "refused" // the canton refused the permit — the field rests
  | "struckDown"; // the appeal was upheld — the field rests

export interface AgriPvProject {
  id: number;
  plotId: string;
  developer: AgriPvDeveloper;
  /** A business's: the building whose power the field supplies. */
  partnerEgid?: string;
  system: AgriPvSystem;
  capacityKw: number;
  /** The share of its power its partner takes (the rest is sold to the utility); 0 unless a business's. */
  ppaShare: number;
  phase: AgriPvPhase;
  /** When the current phase began and when it ends (null: waits on the player, or for good). */
  phaseFromMs: number;
  phaseUntilMs: number | null;
  /** The appeal's outcome, drawn when the permit is granted. */
  appealUpheld?: boolean;
  startedAtMs: number;
  installedAtMs?: number;
  /** What the developer has paid: the permit (the municipality's only) and the build. */
  costRp: number;
  log: { atMs: number; text: string }[];
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

/** What a field would be: its kind and size, a year's output, and what it costs. */
export interface AgriPvEconomics {
  system: AgriPvSystem;
  capacityKw: number;
  yearlyKWh: number;
  buildCostRp: number;
  rentRpPerYear: number;
  upkeepRpPerYear: number;
}

export type PlotState = "farmland" | "planned" | "zoned" | "refused" | "underWay" | "fieldBuilding" | "field";

/** What a field's farmer said when asked about panels, and when. */
export interface FarmerAnswer {
  atMs: number;
  yes: boolean;
}

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

const DEVELOPER_LABEL: Record<AgriPvDeveloper, string> = { business: "a business", cooperative: "an energy cooperative", municipality: "the municipality" };

class AgriPv {
  private plots: Plot[] = [];
  private byId = new Map<string, Plot>();
  private projection = new LocalProjection(8.4, 47.4);
  private designations: AgriPvDesignation[] = [];
  private projects: AgriPvProject[] = [];
  private farmerAnswers = new Map<string, FarmerAnswer>();
  private acceptance = 0;
  private selection = new Set<string>();
  private buildingsProvider: () => Building[] = () => [];
  private seed = "";
  private town = "";
  private lastMonth = 0;
  private nextId = 1;
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private stanceCache: { key: string; stances: Stances } | null = null;
  /** The field picked on the map or in a list (UI state, not saved). */
  private selectedId: string | null = null;

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
    this.projects = [];
    this.farmerAnswers = new Map();
    this.acceptance = 0;
    this.selection = new Set();
    this.selectedId = null;
    this.buildingsProvider = buildingsProvider;
    this.seed = seed;
    this.town = dataset.name;
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

  /** The latest project on a plot, if any (an earlier one struck down stays in the record). */
  projectOn(plotId: string): AgriPvProject | undefined {
    for (let i = this.projects.length - 1; i >= 0; i--) if (this.projects[i].plotId === plotId) return this.projects[i];
    return undefined;
  }

  /** When a field struck down in court may be taken up again. */
  restingUntil(p: AgriPvProject): number | null {
    return stopped(p) ? p.phaseFromMs + AGRI_PV_RETRY_YEARS * YEAR_MS : null;
  }

  /** Whether a zoned plot is free for a developer to take up at `atMs`: no project on it (or one
   * struck down that has rested), and its farmer hasn't said no lately. */
  isFree(plotId: string, atMs: number): boolean {
    if (!this.zonedAt(plotId, atMs)) return false;
    const p = this.projectOn(plotId);
    if (p) {
      const until = this.restingUntil(p);
      if (until === null || atMs < until) return false;
    }
    return this.farmerAnswer(plotId, atMs)?.yes !== false;
  }

  // --- the farmers ---

  /** How keen a field's farmer is on panels, and the rent they would ask (a factor on the typical
   * one) — drawn once per field, unknown until asked. */
  private farmer(plotId: string): { keenness: number; rentFactor: number } {
    const rng = mulberry32(hashSeed(this.seed, "farmer", plotId));
    const keenness = rng();
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
    return { keenness, rentFactor: Math.exp(AGRI_PV_RENT_SPREAD * z) };
  }

  /** The share of farmers who would say yes now: more as acceptance grows. */
  willingShare(): number {
    return Math.min(1, AGRI_PV_FARMER_WILLING_SHARE + AGRI_PV_FARMER_ACCEPTANCE_PULL * this.acceptance);
  }

  /** What a field's farmer said, if it still stands at `atMs` (a no lapses after a few years). */
  farmerAnswer(plotId: string, atMs: number): FarmerAnswer | undefined {
    const a = this.farmerAnswers.get(plotId);
    if (!a || a.atMs > atMs) return undefined;
    if (!a.yes && atMs >= a.atMs + AGRI_PV_FARMER_RETRY_YEARS * YEAR_MS) return undefined;
    return a;
  }

  /** When a farmer who said no may be asked again. */
  askAgainFromMs(plotId: string): number | null {
    const a = this.farmerAnswers.get(plotId);
    return a && !a.yes ? a.atMs + AGRI_PV_FARMER_RETRY_YEARS * YEAR_MS : null;
  }

  /** Asks a zoned field's farmer whether they'd have panels over it: a yes stands, a no for a few
   * years. Anyone may ask — a developer before weighing a field, or the municipality. */
  askFarmer(plotId: string, atMs: number): boolean {
    const known = this.farmerAnswer(plotId, atMs);
    if (known) return known.yes;
    if (!this.zonedAt(plotId, atMs)) return false;
    const yes = this.farmer(plotId).keenness < this.willingShare();
    this.farmerAnswers.set(plotId, { atMs, yes });
    this.notify();
    return yes;
  }

  /** The farmer's yearly rent for a field: their own ask once they've said yes, else the typical one (Rp). */
  rentRpPerYear(plotId: string, atMs: number): number {
    const ha = (this.byId.get(plotId)?.areaM2 ?? 0) / 10_000;
    const factor = this.farmerAnswer(plotId, atMs)?.yes ? this.farmer(plotId).rentFactor : 1;
    return ha * AGRI_PV_RENT_CHF_PER_HA_YEAR * 100 * factor;
  }

  stateAt(plotId: string, atMs: number): PlotState {
    const p = this.projectOn(plotId);
    if (p && !stopped(p)) {
      if (p.installedAtMs !== undefined) return p.installedAtMs <= atMs ? "field" : "fieldBuilding";
      return "underWay";
    }
    if (this.zonedAt(plotId, atMs)) return this.farmerAnswer(plotId, atMs)?.yes === false ? "refused" : "zoned";
    if (this.zonedOrPlanned(plotId)) return "planned";
    return "farmland";
  }

  getDesignations(): AgriPvDesignation[] {
    return this.designations;
  }

  getProjects(): AgriPvProject[] {
    return this.projects;
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
    const plotIds = [...this.selection].filter((id) => !this.zonedOrPlanned(id));
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
    if (q.plotIds.length === 0 || cannotPay(q.costRp, atMs)) return null;
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

  // --- a field's numbers ---

  /** The kinds of installation a field takes: on cropland only rows that leave the machines room,
   * elsewhere any. */
  systemsFor(plotId: string): AgriPvSystem[] {
    const prime = this.byId.get(plotId)?.primeShare ?? 0;
    return prime >= AGRI_PV_CROPLAND_SHARE ? AGRI_PV_CROPLAND_SYSTEMS : (Object.keys(AGRI_PV_SYSTEMS) as AgriPvSystem[]);
  }

  /** The size of a field's installation of `system` over the whole field (kWp). */
  capacityFor(plotId: string, system: AgriPvSystem): number {
    return ((this.byId.get(plotId)?.areaM2 ?? 0) / 10_000) * AGRI_PV_SYSTEMS[system].kwpPerHa;
  }

  /** The largest installation a field takes (kWp). */
  largestCapacityKw(plotId: string): number {
    return Math.max(...this.systemsFor(plotId).map((s) => this.capacityFor(plotId, s)));
  }

  /** A field's installation of `system`, its output and costs, were it built at `atMs`. */
  economics(plotId: string, atMs: number, system: AgriPvSystem): AgriPvEconomics {
    const kw = this.capacityFor(plotId, system);
    return {
      system,
      capacityKw: kw,
      yearlyKWh: kw * specificYieldKWhPerKwp(atMs) * profileYearFactor(system),
      buildCostRp: kw * capexRpPerKwp(kw, atMs) * AGRI_PV_SYSTEMS[system].capexFactor,
      rentRpPerYear: this.rentRpPerYear(plotId, atMs),
      upkeepRpPerYear: kw * AGRI_PV_SYSTEMS[system].upkeepChfPerKwpYear * 100,
    };
  }

  /** The permit for a field: the canton's exceptional permit and the building permit (Rp). */
  permitCostRp(plotId: string): number {
    return Math.round((AGRI_PV_PERMIT_COST_CHF + (AGRI_PV_PERMIT_COST_CHF_PER_HA * (this.byId.get(plotId)?.areaM2 ?? 0)) / 10_000) * 100);
  }

  /** What the municipality's fields in service at `atMs` cost the utility a year: their upkeep and
   * the farmers' rent (Rp). */
  upkeepRpPerYear(atMs: number): number {
    let rp = 0;
    for (const p of this.projects) {
      if (p.developer !== "municipality" || p.installedAtMs === undefined || p.installedAtMs > atMs) continue;
      rp += p.capacityKw * AGRI_PV_SYSTEMS[p.system].upkeepChfPerKwpYear * 100 + this.rentRpPerYear(p.plotId, atMs);
    }
    return rp;
  }

  // --- the fields ---

  /** The fields generating before `cutoffMs`, as plants on no building (solarAdoption.ts, and the
   * utility's accounts, finances.ts). */
  plantsBefore(cutoffMs: number): PowerPlant[] {
    const plants: PowerPlant[] = [];
    for (const f of this.projects) {
      if (f.installedAtMs === undefined || f.installedAtMs >= cutoffMs) continue;
      const plot = this.byId.get(f.plotId);
      plants.push({ plantId: `agri-pv:${f.id}`, lon: plot?.lon ?? 0, lat: plot?.lat ?? 0, capacityKw: f.capacityKw, technology: "Photovoltaic", commissioningDate: null, egid: null, pvProfile: f.system });
    }
    return plants;
  }

  /** The fields in service at `atMs`: their combined size (kW). */
  capacityAtKw(atMs: number): number {
    return this.projects.reduce((sum, f) => sum + (f.installedAtMs !== undefined && f.installedAtMs <= atMs ? f.capacityKw : 0), 0);
  }

  /** The municipality's own fields in service at `atMs` (kW). */
  municipalCapacityAtKw(atMs: number): number {
    return this.projects.reduce((sum, f) => sum + (f.developer === "municipality" && f.installedAtMs !== undefined && f.installedAtMs <= atMs ? f.capacityKw : 0), 0);
  }

  /** The energy the fields' partners take instead of buying it from the utility, at `atMs`'s
   * tariff: what they would have paid for it, less the grid fee they still pay (Rp per kWh). */
  ppaEnergyValueRpPerKWh(atMs: number): number {
    const t = tariffStore.at(atMs);
    return (t.energyPeakRpKWh + t.energyOffPeakRpKWh) / 2;
  }

  // --- developers ---

  /** What a field's power fed in is expected to earn over the year (Rp/kWh): a field this size gets
   * no federal minimum, only the market's reference price and the utility's bonus. */
  private feedInRpKWh(kw: number, atMs: number): number {
    return feedInExpectedRpKWhFor(tariffStore.at(atMs), kw, new Date(toDateMs(atMs)).getUTCFullYear());
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

  /** The free zoned field nearest to a business. */
  private nearestFreeField(b: Building, atMs: number): Plot | null {
    const p = this.projection.toXY(b.lon, b.lat);
    let best: { plot: Plot; d: number } | null = null;
    for (const plot of this.plots) {
      if (!this.isFree(plot.id, atMs)) continue;
      const d = Math.hypot(plot.centre[0] - p[0], plot.centre[1] - p[1]);
      if (!best || d < best.d) best = { plot, d };
    }
    return best?.plot ?? null;
  }

  /** A business weighs a field, once its farmer has said yes: an installation over the whole field —
   * of the kind that costs it least a year — its power taken up to a share of its own use and the rest
   * sold to the utility, against doing nothing. */
  private businessConsiders(b: Building, plot: Plot, atMs: number): boolean {
    const useKWh = this.yearlyUseKWh(b, atMs);
    if (useKWh < AGRI_PV_MIN_CONSUMER_MWH * 1000) return false;
    const systems = this.systemsFor(plot.id).filter((s) => this.capacityFor(plot.id, s) >= AGRI_PV_MIN_KWP);
    if (systems.length === 0 || !this.askFarmer(plot.id, atMs)) return false;
    let best: { system: AgriPvSystem; ppaShare: number; annualizedCostRp: number } | null = null;
    for (const system of systems) {
      const e = this.economics(plot.id, atMs, system);
      const ppaShare = Math.min(1, (useKWh * AGRI_PV_PPA_COVER_SHARE) / e.yearlyKWh);
      const savedRp = e.yearlyKWh * (ppaShare * this.ppaEnergyValueRpPerKWh(atMs) + (1 - ppaShare) * this.feedInRpKWh(e.capacityKw, atMs));
      const annualizedCostRp = e.buildCostRp / AGRI_PV_LIFETIME_YEARS + e.rentRpPerYear + e.upkeepRpPerYear - savedRp;
      if (!best || annualizedCostRp < best.annualizedCostRp) best = { system, ppaShare, annualizedCostRp };
    }
    if (!best) return false;
    type Choice = "none" | "field";
    const candidates: RenewalCandidate<Choice>[] = [
      { id: "none", available: true, annualizedCostRp: 0, lifetimeMeanYears: AGRI_PV_LIFETIME_YEARS, greenness: 0 },
      { id: "field", available: true, annualizedCostRp: best.annualizedCostRp, lifetimeMeanYears: AGRI_PV_LIFETIME_YEARS, greenness: 1 },
    ];
    const policy = policyStore.get();
    const { chosen } = chooseNext(candidates, "none", AGRI_PV_UNCERTAINTY_FRACTION * policy.uncertaintyMultiplier, policy.progressiveNudgeRp);
    if (chosen === "none") return false;
    this.start(plot.id, "business", atMs, best.system, { partnerEgid: b.egid, ppaShare: best.ppaShare });
    return true;
  }

  /** An energy cooperative weighs a field: all its power sold at the feed-in price, enough to pay
   * the build, the rent and the upkeep with a little to spare — of the kind that earns the most for
   * what it costs, of those it can raise the money for — and the farmer agrees. */
  private cooperativeConsiders(plot: Plot, atMs: number): boolean {
    const affordable = this.systemsFor(plot.id).filter((s) => {
      const e = this.economics(plot.id, atMs, s);
      return e.capacityKw >= AGRI_PV_MIN_KWP && e.buildCostRp <= AGRI_PV_COOP_MAX_CHF * 100;
    });
    if (affordable.length === 0 || !this.askFarmer(plot.id, atMs)) return false;
    let best: { system: AgriPvSystem; ratio: number } | null = null;
    for (const system of affordable) {
      const e = this.economics(plot.id, atMs, system); // with the farmer's own rent
      const costRp = e.buildCostRp / AGRI_PV_LIFETIME_YEARS + e.rentRpPerYear + e.upkeepRpPerYear;
      const ratio = (e.yearlyKWh * this.feedInRpKWh(e.capacityKw, atMs)) / costRp;
      if (!best || ratio > best.ratio) best = { system, ratio };
    }
    if (!best || best.ratio < 1 + AGRI_PV_COOP_MIN_RETURN) return false;
    this.start(plot.id, "cooperative", atMs, best.system, {});
    return true;
  }

  /** A developer takes up a field, for an installation of `system`: its permit procedure begins. */
  private start(plotId: string, developer: AgriPvDeveloper, atMs: number, system: AgriPvSystem, extra: { partnerEgid?: string; ppaShare?: number }, costRp = 0): AgriPvProject {
    const capacityKw = this.capacityFor(plotId, system);
    const p: AgriPvProject = {
      id: this.nextId++,
      plotId,
      developer,
      partnerEgid: extra.partnerEgid,
      system,
      capacityKw,
      ppaShare: extra.ppaShare ?? 0,
      phase: "permitting",
      phaseFromMs: atMs,
      phaseUntilMs: atMs + AGRI_PV_PERMIT_MONTHS * MONTH_MS,
      startedAtMs: atMs,
      costRp,
      log: [{ atMs, text: `Taken up by ${DEVELOPER_LABEL[developer]}: applied for the permit.` }],
    };
    this.projects.push(p);
    return p;
  }

  /** The municipality takes up a free zoned field whose farmer has said yes, for an installation of
   * `system` (one the field takes): the permit is paid now, from the treasury. */
  applyForPermit(plotId: string, system: AgriPvSystem, atMs: number): boolean {
    if (!this.isFree(plotId, atMs) || !this.farmerAnswer(plotId, atMs)?.yes || spendingFrozen(atMs) || !this.systemsFor(plotId).includes(system)) return false;
    const costRp = this.permitCostRp(plotId);
    if (cannotPay(costRp, atMs)) return false;
    const p = this.start(plotId, "municipality", atMs, system, {}, costRp);
    treasury.recordPayout("infrastructure", atMs, costRp, `agri-pv-permit:${p.id}`);
    this.notify();
    return true;
  }

  /** The municipality builds its permitted field: paid now, in service a year on. */
  build(plotId: string, atMs: number): boolean {
    const p = this.projectOn(plotId);
    if (!p || p.developer !== "municipality" || p.phase !== "permitted") return false;
    const costRp = this.economics(plotId, atMs, p.system).buildCostRp;
    if (cannotPay(costRp, atMs)) return false;
    p.costRp += costRp;
    this.startBuilding(p, atMs);
    treasury.recordPayout("infrastructure", atMs, costRp, `agri-pv-build:${p.id}`);
    this.notify();
    return true;
  }

  private startBuilding(p: AgriPvProject, atMs: number): void {
    if (p.developer !== "municipality") p.costRp = this.economics(p.plotId, atMs, p.system).buildCostRp;
    p.phase = "building";
    p.phaseFromMs = atMs;
    p.phaseUntilMs = atMs + AGRI_PV_BUILD_MONTHS * MONTH_MS;
    p.installedAtMs = p.phaseUntilMs;
    p.log.push({ atMs, text: `Construction began: ${(p.capacityKw / 1000).toFixed(1)} MWp.` });
  }

  /** The permit stands: a business or a cooperative builds at once, the municipality when ordered. */
  private permitted(p: AgriPvProject, atMs: number, text: string): void {
    p.phaseFromMs = atMs;
    p.phaseUntilMs = null;
    p.log.push({ atMs, text });
    if (p.developer === "municipality") {
      p.phase = "permitted";
      this.letter(atMs, `Agri-PV at ${this.fieldName(p)}: permit granted`, ["The permit for the municipality's Agri-PV field stands. The panels can be ordered (Agri-PV tool)."]);
    } else this.startBuilding(p, atMs);
  }

  private endPhase(p: AgriPvProject, atMs: number): void {
    const rng = mulberry32(hashSeed(this.seed, "project", String(p.id), p.phase));
    switch (p.phase) {
      case "permitting": {
        if (rng() < AGRI_PV_PERMIT_REFUSED_CHANCE) {
          p.phase = "refused";
          p.phaseFromMs = atMs;
          p.phaseUntilMs = null;
          p.log.push({ atMs, text: `The canton refused the permit: the farming wouldn't gain enough to set the landscape aside. The field can be taken up again in ${AGRI_PV_RETRY_YEARS} years.` });
          if (p.developer === "municipality")
            this.letter(atMs, `Agri-PV at ${this.fieldName(p)}: permit refused`, [
              "The canton has refused the permit for the municipality's Agri-PV field: in its view the farming there wouldn't gain enough from the panels to justify building outside the building zone. The planning costs are spent; the field can be taken up again in a few years.",
            ]);
          break;
        }
        if (rng() >= AGRI_PV_APPEAL_CHANCE) {
          this.permitted(p, atMs, "The permit was granted, and no one appealed.");
          break;
        }
        const [from, to] = AGRI_PV_APPEAL_YEARS;
        p.phase = "appeal";
        p.phaseFromMs = atMs;
        p.phaseUntilMs = atMs + (from + rng() * (to - from)) * YEAR_MS;
        p.appealUpheld = rng() < AGRI_PV_APPEAL_UPHELD_CHANCE;
        p.log.push({ atMs, text: "The permit was granted — and appealed. The courts will take a while." });
        if (p.developer === "municipality")
          this.letter(atMs, `Agri-PV at ${this.fieldName(p)}: we are appealing`, [
            `Panels over the fields at ${this.fieldName(p)} would spoil an open landscape that belongs to everyone. We have lodged an appeal against the permit with the cantonal court.`,
          ], "Landscape protection association");
        break;
      }
      case "appeal":
        if (p.appealUpheld) {
          p.phase = "struckDown";
          p.phaseFromMs = atMs;
          p.phaseUntilMs = null;
          p.log.push({ atMs, text: `The court upheld the appeal: the permit is void. The field can be taken up again in ${AGRI_PV_RETRY_YEARS} years.` });
          if (p.developer === "municipality") this.letter(atMs, `Agri-PV at ${this.fieldName(p)}: the court has ruled`, ["The court has upheld the appeal against the Agri-PV field's permit. The permit is void."]);
        } else this.permitted(p, atMs, "The court dismissed the appeal: the permit stands.");
        break;
      case "building":
        p.phase = "operating";
        p.phaseFromMs = atMs;
        p.phaseUntilMs = null;
        p.log.push({ atMs, text: "The field is in service." });
        // People see one more field.
        this.acceptance = Math.min(AGRI_PV_ACCEPTANCE_MAX, this.acceptance + AGRI_PV_ACCEPTANCE_PER_FIELD);
        this.stanceCache = null;
        break;
      default:
        p.phaseUntilMs = null;
    }
  }

  fieldName(p: AgriPvProject): string {
    return this.byId.get(p.plotId)?.name ?? "the field";
  }

  private letter(atMs: number, subject: string, paragraphs: string[], from = `The Town Clerk of ${this.town}`): void {
    inbox.addLetter({ id: `agri-pv-${Math.floor(atMs)}-${subject.length}`, atMs, kind: "project", bloc: null, from, role: "", subject, paragraphs });
  }

  // --- time ---

  private advance(nowMs: number): void {
    let changed = false;
    for (const p of this.projects) {
      while (p.phaseUntilMs !== null && p.phaseUntilMs <= nowMs) {
        this.endPhase(p, p.phaseUntilMs);
        changed = true;
      }
    }
    const month = monthIndex(nowMs);
    if (month > this.lastMonth) {
      // A long jump takes at most two years of months.
      for (let m = Math.max(this.lastMonth + 1, month - 24); m <= month; m++) if (this.monthly(m)) changed = true;
      this.lastMonth = month;
    }
    if (changed) {
      this.stanceCache = null;
      this.notify();
    }
  }

  /** A month: acceptance grows while the dialogue runs, and developers look into the free zoned
   * fields — the businesses first (a PPA pays best), then the cooperatives. */
  private monthly(month: number): boolean {
    const atMs = toSimTimeMs(Date.UTC(Math.floor(month / 12), month % 12, 1));
    if (policyStore.get().agriPvDialogue > 0) this.acceptance = Math.min(AGRI_PV_ACCEPTANCE_MAX, this.acceptance + AGRI_PV_ACCEPTANCE_PER_YEAR_DIALOGUE / 12);
    if (!this.plots.some((p) => this.isFree(p.id, atMs))) return false;
    let started = false;
    const withField = new Set(this.projects.filter((p) => p.partnerEgid && !stopped(p)).map((p) => p.partnerEgid));
    const chance = monthlyChance(AGRI_PV_CONSIDER_PER_YEAR);
    for (const b of this.consumers(atMs)) {
      if (withField.has(b.egid)) continue;
      if (mulberry32(hashSeed(this.seed, "consider", b.egid, String(month)))() >= chance) continue;
      const plot = this.nearestFreeField(b, atMs);
      if (!plot) break;
      if (!this.businessConsiders(b, plot, atMs)) continue;
      withField.add(b.egid);
      started = true;
    }
    const coopChance = monthlyChance(AGRI_PV_COOP_CONSIDER_PER_YEAR);
    for (const plot of this.plots) {
      if (!this.isFree(plot.id, atMs)) continue;
      if (mulberry32(hashSeed(this.seed, "cooperative", plot.id, String(month)))() >= coopChance) continue;
      if (this.cooperativeConsiders(plot, atMs)) started = true;
    }
    return started;
  }

  // --- subscription ---

  getSelectedId(): string | null {
    return this.selectedId;
  }

  select(id: string | null): void {
    this.selectedId = id;
    this.notify();
  }

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
    return { designations: this.designations, projects: this.projects, farmerAnswers: this.farmerAnswers, acceptance: this.acceptance, lastMonth: this.lastMonth, nextId: this.nextId };
  }

  restore(s: ReturnType<AgriPv["snapshot"]>): void {
    this.designations = s.designations;
    this.projects = s.projects;
    this.farmerAnswers = s.farmerAnswers;
    this.acceptance = s.acceptance;
    this.lastMonth = s.lastMonth;
    this.nextId = s.nextId;
    this.selection = new Set();
    this.selectedId = null;
    this.stanceCache = null;
    this.notify();
  }
}

export const agriPv = new AgriPv();

/** Whether a project has stopped — the permit refused or struck down — and its field rests. */
export function stopped(p: AgriPvProject): boolean {
  return p.phase === "refused" || p.phase === "struckDown";
}

export const AGRI_PV_PHASE_LABEL: Record<AgriPvPhase, string> = {
  permitting: "Permit procedure",
  appeal: "Appealed, in the courts",
  permitted: "Permitted — ready to build",
  building: "Being built",
  operating: "In service",
  refused: "Permit refused",
  struckDown: "Struck down in court",
};

export const AGRI_PV_DEVELOPER_LABEL: Record<AgriPvDeveloper, string> = { business: "Business (PPA)", cooperative: "Energy cooperative", municipality: "Municipality" };

/** The partner a field's PPA is with: its building's address. */
export function partnerName(egid: string, buildings: Building[]): string {
  return buildings.find((b) => b.egid === egid)?.address ?? `business ${egid}`;
}
