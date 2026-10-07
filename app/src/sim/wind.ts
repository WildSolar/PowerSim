/**
 * Wind power: the long road from a hunch to a turning turbine. In Switzerland it is slow, and it
 * can fail at every step — so it is here:
 *
 *  1. A study (a year) finds where turbines could stand in the municipality — far enough from
 *     homes, outside the building zones, windy enough (the federal wind atlas; the sites are found in
 *     the pipeline, pipeline/sources/wind.py) — or that there is nowhere. Until then, nothing is known.
 *  2. A zoning plan for a site (two years), which always goes to the voters: the town as a whole is
 *     split, and the homes within a kilometre mind most. Voted down, the site rests a few years.
 *  3. The permit (a year and a half): the environmental impact assessment and the building permit.
 *     Then, as a rule, an appeal — landscape and bird protection, neighbours — which takes years in the
 *     courts, and is sometimes upheld: then the site rests a few years too.
 *  4. The build (a year), paid by the utility as an investment, less the federal contribution.
 *
 * Every step is the player's to take (and pay for); each phase's end is decided as it comes. The
 * turbines are the utility's: what they make saves buying power (no feed-in is paid for it), against
 * their upkeep; they turn with the wind of windPower.ts. Their neighbours keep minding them.
 */

import { BLOC_ORDER } from "../config/approval";
import {
  TURBINE_KW,
  WIND_APPEAL_CHANCE,
  WIND_APPEAL_UPHELD_CHANCE,
  WIND_APPEAL_YEARS,
  WIND_BUILD_MONTHS,
  WIND_CAPEX_CHF_PER_KW,
  WIND_FEDERAL_SHARE,
  WIND_LASTING_SHARE,
  WIND_LOCAL_FULL_SHARE,
  WIND_LOCAL_RADIUS_M,
  WIND_LOCAL_STANCES,
  WIND_PERMIT_COST_CHF,
  WIND_PERMIT_MONTHS,
  WIND_RETRY_YEARS,
  WIND_STANCES,
  WIND_STUDY_COST_CHF,
  WIND_STUDY_MONTHS,
  WIND_UPKEEP_CHF_PER_KW_YEAR,
  WIND_ZONING_COST_CHF,
  WIND_ZONING_COST_CHF_PER_TURBINE,
  WIND_ZONING_MONTHS,
} from "../config/wind";
import type { Building, MunicipalityDataset, PowerPlant, WindSiteData } from "../data/types";
import { approval, setLocalStances, type Stances } from "./approval";
import { priceFactor } from "./costTrends";
import { simClock } from "./engine";
import { spendingFrozen } from "./fiscalRules";
import { inbox } from "./inbox";
import { existsAt } from "./lifetime";
import { LocalProjection } from "./localGeo";
import { hashSeed, mulberry32 } from "./rng";
import { setExtraPlants } from "./solarAdoption";
import { treasury } from "./treasury";
import { expectedCapacityFactor } from "./windPower";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = (365.25 * DAY_MS) / 12;
const YEAR_MS = 365.25 * DAY_MS;

export type WindPhase =
  | "found" // the study found it; nothing done yet
  | "zoning" // the zoning plan is under way (and to the vote)
  | "zoned" // the zone is in force: a permit can be applied for
  | "permitting" // the permit procedure
  | "appeal" // the permit is appealed, in the courts
  | "permitted" // permitted, ready to build
  | "building"
  | "operating"
  | "rejected" // voted down — resting
  | "struckDown"; // the appeal was upheld — resting

export interface WindProject {
  siteId: string;
  phase: WindPhase;
  /** Turbines the plan is for (fixed when the zoning is put forward). */
  turbines: number;
  /** When the current phase began and when it ends (null: waits on the player). */
  phaseFromMs: number;
  phaseUntilMs: number | null;
  /** The public vote on the zoning plan (approval.ts's key). */
  voteKey?: string;
  /** The appeal's outcome, drawn when the permit is granted. */
  appealUpheld?: boolean;
  costRp: number;
  installedAtMs?: number;
  log: { atMs: number; text: string }[];
}

export interface WindSite extends WindSiteData {
  /** The turbines' mean capacity factor from the atlas. */
  capacityFactor: number;
}

class Wind {
  private sites: WindSite[] = [];
  private projection = new LocalProjection(8.4, 47.4);
  private studyOrderedAtMs: number | null = null;
  private projects = new Map<string, WindProject>();
  private buildingsProvider: () => Building[] = () => [];
  private seed = "";
  private town = "";
  private lastDay = 0;
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private localCache: { key: string; stances: Stances } | null = null;

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribeClock?.();
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.sites = (dataset.windSites ?? []).map((s) => ({
      ...s,
      capacityFactor: s.turbines.reduce((sum, t) => sum + expectedCapacityFactor(t.a, t.k), 0) / Math.max(1, s.turbines.length),
    }));
    this.studyOrderedAtMs = null;
    this.projects = new Map();
    this.buildingsProvider = buildingsProvider;
    this.seed = seed;
    this.town = dataset.name;
    this.lastDay = Math.floor(simClock.getSimTimeMs() / DAY_MS);
    this.localCache = null;
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    setExtraPlants("wind", (cutoffMs) => this.plantsBefore(cutoffMs));
    setLocalStances("wind", (atMs) => this.lastingStances(atMs));
    this.notify();
  }

  // --- the study ---

  studyState(atMs: number): "none" | "running" | "done" {
    if (this.studyOrderedAtMs === null) return "none";
    return atMs >= this.studyOrderedAtMs + WIND_STUDY_MONTHS * MONTH_MS ? "done" : "running";
  }

  studyDoneAtMs(): number | null {
    return this.studyOrderedAtMs === null ? null : this.studyOrderedAtMs + WIND_STUDY_MONTHS * MONTH_MS;
  }

  studyCostRp(atMs: number): number {
    void atMs;
    return WIND_STUDY_COST_CHF * 100;
  }

  orderStudy(atMs: number): boolean {
    if (this.studyOrderedAtMs !== null || spendingFrozen(atMs)) return false;
    this.studyOrderedAtMs = atMs;
    treasury.recordPayout("programs", atMs, this.studyCostRp(atMs), "wind-study");
    this.notify();
    return true;
  }

  /** The sites the study found (none before it is done). */
  sitesAt(atMs: number): WindSite[] {
    return this.studyState(atMs) === "done" ? this.sites : [];
  }

  getSite(id: string): WindSite | undefined {
    return this.sites.find((s) => s.id === id);
  }

  project(siteId: string): WindProject | undefined {
    return this.projects.get(siteId);
  }

  /** Where a site stands at `atMs`. */
  phaseOf(siteId: string): WindPhase {
    return this.projects.get(siteId)?.phase ?? "found";
  }

  // --- a site's numbers ---

  /** A year's output from `turbines` turbines at a site (kWh). */
  yearlyKWh(site: WindSite, turbines: number): number {
    return site.turbines.slice(0, turbines).reduce((sum, t) => sum + TURBINE_KW * 8_766 * expectedCapacityFactor(t.a, t.k), 0);
  }

  /** The homes within reach of a site's turbines, and the town's homes, at `atMs`. */
  homesNear(site: WindSite, turbines: number, atMs: number): { near: number; all: number } {
    const ts = site.turbines.slice(0, turbines).map((t) => this.projection.toXY(t.lon, t.lat));
    let near = 0;
    let all = 0;
    for (const b of this.buildingsProvider()) {
      if (b.dwellings.length === 0 || !existsAt(b, atMs)) continue;
      all += b.dwellings.length;
      const p = this.projection.toXY(b.lon, b.lat);
      if (ts.some((t) => Math.hypot(t[0] - p[0], t[1] - p[1]) <= WIND_LOCAL_RADIUS_M)) near += b.dwellings.length;
    }
    return { near, all };
  }

  /** How the town takes a wind park at a site: the town as a whole, and its neighbours. */
  stancesFor(site: WindSite, turbines: number, atMs: number, localOnly = false): Stances {
    const { near, all } = this.homesNear(site, turbines, atMs);
    const local = Math.min(1, all > 0 ? near / all / WIND_LOCAL_FULL_SHARE : 0);
    const stances: Stances = {};
    for (const b of BLOC_ORDER) {
      const town = localOnly ? 0 : (WIND_STANCES[b as keyof typeof WIND_STANCES] ?? 0);
      const neighbours = (WIND_LOCAL_STANCES[b as keyof typeof WIND_LOCAL_STANCES] ?? 0) * local;
      if (town + neighbours !== 0) stances[b] = town + neighbours;
    }
    return stances;
  }

  zoningCostRp(turbines: number): number {
    return (WIND_ZONING_COST_CHF + WIND_ZONING_COST_CHF_PER_TURBINE * turbines) * 100;
  }

  permitCostRp(): number {
    return WIND_PERMIT_COST_CHF * 100;
  }

  /** The build: per kW, less the federal contribution (Rp). */
  buildCostRp(turbines: number, atMs: number): number {
    return turbines * TURBINE_KW * WIND_CAPEX_CHF_PER_KW * (1 - WIND_FEDERAL_SHARE) * 100 * priceFactor("solar", atMs);
  }

  upkeepRpPerYear(atMs: number): number {
    let kw = 0;
    for (const p of this.projects.values()) if (p.phase === "operating" && (p.installedAtMs ?? Infinity) <= atMs) kw += p.turbines * TURBINE_KW;
    return kw * WIND_UPKEEP_CHF_PER_KW_YEAR * 100;
  }

  // --- the steps ---

  /** Whether a site can be taken up again after resting. */
  private restingUntil(p: WindProject | undefined): number | null {
    if (!p || (p.phase !== "rejected" && p.phase !== "struckDown")) return null;
    return p.phaseFromMs + WIND_RETRY_YEARS * YEAR_MS;
  }

  canStartZoning(siteId: string, atMs: number): boolean {
    const p = this.projects.get(siteId);
    if (!p) return true;
    const until = this.restingUntil(p);
    return until !== null && atMs >= until;
  }

  /** Puts a zoning plan for a site forward: paid now, to the voters, in force after the procedure. */
  startZoning(siteId: string, turbines: number, atMs: number): boolean {
    const site = this.getSite(siteId);
    if (!site || this.studyState(atMs) !== "done" || !this.canStartZoning(siteId, atMs) || spendingFrozen(atMs)) return false;
    const n = Math.max(1, Math.min(site.turbines.length, turbines));
    const costRp = this.zoningCostRp(n);
    const voteKey = `wind:${siteId}:${Math.floor(atMs)}`;
    const p: WindProject = {
      siteId,
      voteKey,
      phase: "zoning",
      turbines: n,
      phaseFromMs: atMs,
      phaseUntilMs: atMs + WIND_ZONING_MONTHS * MONTH_MS,
      costRp: (this.projects.get(siteId)?.costRp ?? 0) + costRp,
      log: [...(this.projects.get(siteId)?.log ?? []), { atMs, text: `Zoning plan for ${n} turbine${n === 1 ? "" : "s"} put forward.` }],
    };
    this.projects.set(siteId, p);
    treasury.recordPayout("zoning", atMs, costRp, `wind-zoning:${siteId}`);
    approval.decide({
      key: voteKey,
      title: `Wind park ${site.name ?? siteId}: zoning plan for ${n} turbine${n === 1 ? "" : "s"}`,
      stances: this.stancesFor(site, n, atMs),
      referendum: "mandatory",
      leadTimeMonths: WIND_ZONING_MONTHS,
      atMs,
      onVote: (accepted, voteAtMs) => this.voteResult(siteId, accepted, voteAtMs),
    });
    this.localCache = null;
    this.notify();
    return true;
  }

  /** What the vote on a site's zoning plan does (also rebuilt for a loaded game's pending votes). */
  voteResult(siteId: string, accepted: boolean, atMs: number): void {
    const p = this.projects.get(siteId);
    if (!p || p.phase !== "zoning") return;
    if (accepted) {
      p.log.push({ atMs, text: "The voters approved the zoning plan." });
    } else {
      p.phase = "rejected";
      p.phaseFromMs = atMs;
      p.phaseUntilMs = null;
      p.log.push({ atMs, text: `The voters rejected the zoning plan. The site can be taken up again in ${WIND_RETRY_YEARS} years.` });
    }
    this.localCache = null;
    this.notify();
  }

  /** Applies for the permit, once the zone is in force: the impact assessment is paid now. */
  applyForPermit(siteId: string, atMs: number): boolean {
    const p = this.projects.get(siteId);
    if (!p || p.phase !== "zoned" || spendingFrozen(atMs)) return false;
    p.phase = "permitting";
    p.phaseFromMs = atMs;
    p.phaseUntilMs = atMs + WIND_PERMIT_MONTHS * MONTH_MS;
    p.costRp += this.permitCostRp();
    p.log.push({ atMs, text: "Applied for the building permit, with the environmental impact assessment." });
    treasury.recordPayout("infrastructure", atMs, this.permitCostRp(), `wind-permit:${siteId}`);
    this.notify();
    return true;
  }

  /** Builds the permitted turbines: paid now, turning a year on. */
  build(siteId: string, atMs: number): boolean {
    const p = this.projects.get(siteId);
    if (!p || p.phase !== "permitted" || spendingFrozen(atMs)) return false;
    const costRp = this.buildCostRp(p.turbines, atMs);
    p.phase = "building";
    p.phaseFromMs = atMs;
    p.phaseUntilMs = atMs + WIND_BUILD_MONTHS * MONTH_MS;
    p.installedAtMs = p.phaseUntilMs;
    p.costRp += costRp;
    p.log.push({ atMs, text: `Construction of ${p.turbines} turbine${p.turbines === 1 ? "" : "s"} began.` });
    treasury.recordPayout("infrastructure", atMs, costRp, `wind-build:${siteId}`);
    this.notify();
    return true;
  }

  // --- time ---

  private advance(nowMs: number): void {
    const day = Math.floor(nowMs / DAY_MS);
    if (day === this.lastDay) return;
    this.lastDay = day;
    let changed = false;
    for (const p of this.projects.values()) {
      while (p.phaseUntilMs !== null && p.phaseUntilMs <= nowMs) {
        this.endPhase(p, p.phaseUntilMs);
        changed = true;
      }
    }
    if (changed) {
      this.localCache = null;
      this.notify();
    }
  }

  private endPhase(p: WindProject, atMs: number): void {
    const site = this.getSite(p.siteId);
    const name = site?.name ?? p.siteId;
    const rng = mulberry32(hashSeed(this.seed, p.siteId, p.phase, String(Math.floor(p.phaseFromMs / DAY_MS))));
    switch (p.phase) {
      case "zoning":
        p.phase = "zoned";
        p.phaseFromMs = atMs;
        p.phaseUntilMs = null;
        p.log.push({ atMs, text: "The zoning plan is in force: a building permit can be applied for." });
        break;
      case "permitting": {
        const appealed = rng() < WIND_APPEAL_CHANCE;
        if (!appealed) {
          p.phase = "permitted";
          p.phaseFromMs = atMs;
          p.phaseUntilMs = null;
          p.log.push({ atMs, text: "The permit was granted, and no one appealed. The turbines can be built." });
          this.letter(atMs, `Wind park ${name}: permit granted`, ["The building permit for the wind park has been granted, and the appeal period has passed without an appeal. The turbines can be ordered."]);
          break;
        }
        const [from, to] = WIND_APPEAL_YEARS;
        p.phase = "appeal";
        p.phaseFromMs = atMs;
        p.phaseUntilMs = atMs + (from + rng() * (to - from)) * YEAR_MS;
        p.appealUpheld = rng() < WIND_APPEAL_UPHELD_CHANCE;
        p.log.push({ atMs, text: "The permit was granted — and appealed. The courts will take a while." });
        this.letter(atMs, `Wind park ${name}: we are appealing`, [
          `The permit for the wind park at ${name} ignores the landscape, the birds and bats, and the people who live there. Together with neighbours, we have lodged an appeal with the cantonal court, and will take it further if need be.`,
        ], "Landscape protection association");
        break;
      }
      case "appeal":
        if (p.appealUpheld) {
          p.phase = "struckDown";
          p.phaseFromMs = atMs;
          p.phaseUntilMs = null;
          p.log.push({ atMs, text: `The court upheld the appeal: the permit is void. The site can be taken up again in ${WIND_RETRY_YEARS} years, from the zoning plan.` });
          this.letter(atMs, `Wind park ${name}: the court has ruled`, ["The court has upheld the appeal against the wind park's permit. The permit is void."]);
        } else {
          p.phase = "permitted";
          p.phaseFromMs = atMs;
          p.phaseUntilMs = null;
          p.log.push({ atMs, text: "The court dismissed the appeal: the permit stands. The turbines can be built." });
          this.letter(atMs, `Wind park ${name}: the court has ruled`, ["The court has dismissed the appeal against the wind park's permit. The permit stands; the turbines can be ordered."]);
        }
        break;
      case "building":
        p.phase = "operating";
        p.phaseFromMs = atMs;
        p.phaseUntilMs = null;
        p.log.push({ atMs, text: "The turbines are turning." });
        break;
      default:
        p.phaseUntilMs = null;
    }
  }

  private letter(atMs: number, subject: string, paragraphs: string[], from = `The Town Clerk of ${this.town}`): void {
    inbox.addLetter({ id: `wind-${Math.floor(atMs)}-${subject.length}`, atMs, kind: "report", bloc: null, from, role: "", subject, paragraphs });
  }

  // --- the turbines ---

  /** The turbines turning before `cutoffMs`, as plants (solarAdoption.ts). */
  private plantsBefore(cutoffMs: number): PowerPlant[] {
    const plants: PowerPlant[] = [];
    for (const p of this.projects.values()) {
      if (p.installedAtMs === undefined || p.installedAtMs >= cutoffMs || (p.phase !== "operating" && p.phase !== "building")) continue;
      const site = this.getSite(p.siteId);
      if (!site) continue;
      site.turbines.slice(0, p.turbines).forEach((t, i) => {
        plants.push({ plantId: `wind:${p.siteId}:${i}`, lon: t.lon, lat: t.lat, capacityKw: TURBINE_KW, technology: "Wind", commissioningDate: null, egid: null, wind: { a: t.a, k: t.k } });
      });
    }
    return plants;
  }

  /** The turbines turning at `atMs`, as plants. */
  turbinesAt(atMs: number): PowerPlant[] {
    return this.plantsBefore(atMs + 1);
  }

  /** The turbines' combined rating at `atMs` (kW). */
  capacityAtKw(atMs: number): number {
    let kw = 0;
    for (const p of this.projects.values()) if ((p.phase === "operating" || p.phase === "building") && (p.installedAtMs ?? Infinity) <= atMs) kw += p.turbines * TURBINE_KW;
    return kw;
  }

  /** The neighbours of turning turbines keep minding them. */
  private lastingStances(atMs: number): Stances {
    const key = `${Math.floor(atMs / (12 * MONTH_MS))}:${this.version}`;
    if (this.localCache?.key === key) return this.localCache.stances;
    const stances: Stances = {};
    for (const p of this.projects.values()) {
      if (p.phase !== "operating" || (p.installedAtMs ?? Infinity) > atMs) continue;
      const site = this.getSite(p.siteId);
      if (!site) continue;
      const s = this.stancesFor(site, p.turbines, atMs, true);
      for (const b of BLOC_ORDER) if (s[b]) stances[b] = (stances[b] ?? 0) + (s[b] as number) * WIND_LASTING_SHARE;
    }
    this.localCache = { key, stances };
    return stances;
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
    return { studyOrderedAtMs: this.studyOrderedAtMs, projects: this.projects, lastDay: this.lastDay };
  }

  restore(s: ReturnType<Wind["snapshot"]>): void {
    this.studyOrderedAtMs = s.studyOrderedAtMs;
    this.projects = s.projects;
    this.lastDay = s.lastDay;
    this.localCache = null;
    this.notify();
  }
}

export const wind = new Wind();

export const WIND_PHASE_LABEL: Record<WindPhase, string> = {
  found: "Found by the study",
  zoning: "Zoning plan under way",
  zoned: "Zoned — permit to apply for",
  permitting: "Permit procedure",
  appeal: "Appealed, in the courts",
  permitted: "Permitted — ready to build",
  building: "Being built",
  operating: "Turning",
  rejected: "Voted down",
  struckDown: "Struck down in court",
};
