/**
 * The municipality's zoning plan (Bau- und Zonenordnung), parcel by parcel. The parcels and their
 * zone types are real (the federal harmonised building-zone layer); the player changes them:
 *
 *  - Rezoning a parcel to another use (residential, mixed, centre, work) changes what gets built on
 *    its vacant land and what its old buildings are replaced with once they come up for renewal — a
 *    factory in what is now a residential zone becomes flats, and comes up sooner.
 *  - Densifying it (+1 or +2 floors) lets new and replacement buildings go higher, holding more
 *    homes, and makes replacing old buildings there pay sooner.
 *  - Energy zones from municipal energy planning: a district-heat priority zone (no new oil or gas
 *    heating; a new building on a piped street must connect), and a high-standard zone (new and
 *    replacement buildings to Minergie-P, with a full roof of solar).
 *
 * A change is put forward for a set of picked parcels, costs the planning work up front, and comes
 * into force after the planning procedure — unless the voters strike it down first: it's a
 * political decision (approval.ts), and a contested one goes to a referendum. Once in force, the
 * land value it creates is partly captured: a levy on each project that uses the gain, due when its
 * permit is granted (treasury receipts).
 *
 * stock.ts, newBuild.ts and heatingRenewal.ts ask this module what a building's parcel allows at a
 * given moment; the answer is folded from the parcel's original zone and every change in force.
 */

import {
  DENSIFY_RENEWAL_BOOST_PER_FLOOR,
  DENSIFY_STANCES_PER_FLOOR,
  DH_PRIORITY_STANCES,
  HIGH_STANDARD_STANCES,
  HIGH_STANDARD_U_VALUE_FACTOR,
  LAND_VALUE_CHF_PER_M2_GFA,
  LIFT_STANCE_FACTOR,
  LOST_WORK_ZONE_STANCE,
  MISFIT_RENEWAL_BOOST,
  REZONE_STANCES,
  VALUE_LEVY_RATE,
  ZONING_LEAD_MONTHS,
  ZONING_PLANNING_COST_CHF,
  ZONING_PLANNING_COST_CHF_PER_HA,
  ZONING_STANCE_FULL_AREA_SHARE,
  ZONING_STANCE_MIN_SCALE,
  ZONING_VOTE_AREA_SHARE,
} from "../config/zoning";
import { ZONE_GROUP_WEIGHTS, type BuildingGroup } from "../config/stock";
import { BLOC_ORDER } from "../config/approval";
import type { Building, DevelopmentSite, MunicipalityDataset, SiteZone } from "../data/types";
import { approval, type Stances } from "./approval";
import type { ConstructionRules } from "./constructionRules";
import { existsAt } from "./lifetime";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";
import { treasury } from "./treasury";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;

export type ZoningAction =
  | { type: "rezone"; zone: SiteZone }
  | { type: "densify"; extraFloors: number } // the floors allowed above today's plan (0 takes it back)
  | { type: "dhPriority"; on: boolean }
  | { type: "highStandard"; on: boolean };

export interface ParcelState {
  zone: SiteZone;
  extraFloors: number;
  dhPriority: boolean;
  highStandard: boolean;
}

export interface ZoningChange {
  id: number;
  parcelIds: string[];
  action: ZoningAction;
  title: string;
  submittedAtMs: number;
  effectiveAtMs: number;
  voteAtMs: number | null;
  rejected: boolean;
  costRp: number;
}

export interface Parcel {
  id: string;
  zone: SiteZone; // as the plan had it at the start
  areaM2: number;
  rings: [number, number][][][];
  polygonsXY: XY[][][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ZoningQuote {
  /** The picked parcels this change would actually alter. */
  parcelIds: string[];
  areaM2: number;
  areaShare: number; // of all zoned land
  buildings: number;
  dwellings: number;
  vacantM2: number; // open building land in them (as the game started)
  costRp: number;
  stances: Stances;
  /** Big changes always go to a vote; smaller ones only when contested. */
  referendum: "optional" | "mandatory";
  title: string;
}

const ZONE_LABEL: Record<SiteZone, string> = { residential: "residential", mixed: "mixed", centre: "centre", work: "work", public: "public use" };

function sameAction(state: ParcelState, action: ZoningAction): boolean {
  switch (action.type) {
    case "rezone":
      return state.zone === action.zone;
    case "densify":
      return state.extraFloors === action.extraFloors;
    case "dhPriority":
      return state.dhPriority === action.on;
    case "highStandard":
      return state.highStandard === action.on;
  }
}

function applyAction(state: ParcelState, action: ZoningAction): ParcelState {
  switch (action.type) {
    case "rezone":
      return { ...state, zone: action.zone };
    case "densify":
      return { ...state, extraFloors: action.extraFloors };
    case "dhPriority":
      return { ...state, dhPriority: action.on };
    case "highStandard":
      return { ...state, highStandard: action.on };
  }
}

function addStances(into: Stances, add: Stances, factor: number): void {
  for (const b of BLOC_ORDER) if (add[b] !== undefined) into[b] = (into[b] ?? 0) + (add[b] as number) * factor;
}

/** Whether a building of this group belongs in a zone of this type. */
export function groupFitsZone(group: BuildingGroup, zone: SiteZone): boolean {
  return (ZONE_GROUP_WEIGHTS[zone][group] ?? 0) > 0;
}

class Zoning {
  private parcels: Parcel[] = [];
  private byId = new Map<string, Parcel>();
  private totalAreaM2 = 0;
  private projection = new LocalProjection(8.4, 47.4);
  private changes: ZoningChange[] = [];
  private changesByParcel = new Map<string, ZoningChange[]>();
  private parcelOfBuilding = new Map<string, string | null>();
  private parcelOfSite = new Map<string, string | null>();
  private levies: { atMs: number; amountRp: number; egid: string }[] = [];
  private sites: DevelopmentSite[] = [];
  private nextId = 1;

  // Planning UI state.
  private selection = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.parcels = (dataset.zoneParcels ?? []).map((p) => {
      const polygonsXY = p.rings.map((polygon) => polygon.map((ring) => ring.map(([lon, lat]) => this.projection.toXY(lon, lat))));
      const xs = polygonsXY.flatMap((poly) => poly[0].map((q) => q[0]));
      const ys = polygonsXY.flatMap((poly) => poly[0].map((q) => q[1]));
      return { ...p, polygonsXY, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });
    this.byId = new Map(this.parcels.map((p) => [p.id, p]));
    this.totalAreaM2 = this.parcels.reduce((sum, p) => sum + p.areaM2, 0);
    this.changes = [];
    this.changesByParcel = new Map();
    this.parcelOfBuilding = new Map();
    this.parcelOfSite = new Map();
    this.levies = [];
    this.sites = dataset.developmentSites ?? [];
    this.nextId = 1;
    this.selection = new Set();
    this.notify();
  }

  getParcels(): Parcel[] {
    return this.parcels;
  }

  getParcel(id: string): Parcel | undefined {
    return this.byId.get(id);
  }

  // --- where things are ---

  private parcelIdAt(x: number, y: number): string | null {
    const p: XY = [x, y];
    for (const parcel of this.parcels) {
      if (x < parcel.minX || x > parcel.maxX || y < parcel.minY || y > parcel.maxY) continue;
      if (parcel.polygonsXY.some((rings) => pointInPolygon(p, rings))) return parcel.id;
    }
    return null;
  }

  parcelIdAtLonLat(lon: number, lat: number): string | null {
    const [x, y] = this.projection.toXY(lon, lat);
    return this.parcelIdAt(x, y);
  }

  parcelIdOfBuilding(b: Building): string | null {
    let id = this.parcelOfBuilding.get(b.egid);
    if (id === undefined) {
      id = this.parcelIdAtLonLat(b.lon, b.lat);
      this.parcelOfBuilding.set(b.egid, id);
    }
    return id;
  }

  private parcelIdOfSite(site: DevelopmentSite): string | null {
    let id = this.parcelOfSite.get(site.id);
    if (id === undefined) {
      const ring = site.rings[0] ?? [];
      const lon = ring.reduce((s, q) => s + q[0], 0) / Math.max(1, ring.length);
      const lat = ring.reduce((s, q) => s + q[1], 0) / Math.max(1, ring.length);
      id = this.parcelIdAtLonLat(lon, lat);
      this.parcelOfSite.set(site.id, id);
    }
    return id;
  }

  // --- the plan over time ---

  /** What the plan says for a parcel at `atMs`: its original zone with every change in force folded in. */
  stateAt(parcelId: string, atMs: number): ParcelState | null {
    const parcel = this.byId.get(parcelId);
    if (!parcel) return null;
    let state: ParcelState = { zone: parcel.zone, extraFloors: 0, dhPriority: false, highStandard: false };
    for (const c of this.changesByParcel.get(parcelId) ?? []) {
      if (!c.rejected && c.effectiveAtMs <= atMs) state = applyAction(state, c.action);
    }
    return state;
  }

  /** The same, with every change put forward and not rejected counted as if in force — the plan
   * as it will be. */
  plannedState(parcelId: string): ParcelState | null {
    return this.stateAt(parcelId, Number.POSITIVE_INFINITY);
  }

  /** Whether a parcel has a change put forward that isn't in force yet (and isn't rejected). */
  hasPendingChange(parcelId: string, atMs: number): boolean {
    return (this.changesByParcel.get(parcelId) ?? []).some((c) => !c.rejected && c.effectiveAtMs > atMs);
  }

  stateForBuilding(b: Building, atMs: number): ParcelState | null {
    const id = this.parcelIdOfBuilding(b);
    return id ? this.stateAt(id, atMs) : null;
  }

  /** The zone a development site builds to at `atMs` (its own zone when it lies outside every parcel). */
  zoneForSite(site: DevelopmentSite, atMs: number): SiteZone {
    const id = this.parcelIdOfSite(site);
    return (id && this.stateAt(id, atMs)?.zone) || site.zone;
  }

  extraFloorsForSite(site: DevelopmentSite, atMs: number): number {
    const id = this.parcelIdOfSite(site);
    return (id && this.stateAt(id, atMs)?.extraFloors) || 0;
  }

  /** Whether a building's parcel was given another zone than it started with (by the player). */
  rezoned(b: Building, atMs: number): SiteZone | null {
    const id = this.parcelIdOfBuilding(b);
    if (!id) return null;
    const state = this.stateAt(id, atMs);
    const parcel = this.byId.get(id);
    return state && parcel && state.zone !== parcel.zone ? state.zone : null;
  }

  // --- effects on building and renewal ---

  /** How much likelier an old building is to be replaced, given its parcel's zoning. */
  renewalBoost(b: Building, group: BuildingGroup | null, atMs: number): number {
    const state = this.stateForBuilding(b, atMs);
    if (!state) return 1;
    let boost = 1 + DENSIFY_RENEWAL_BOOST_PER_FLOOR * state.extraFloors;
    const newZone = this.rezoned(b, atMs);
    if (newZone && group && !groupFitsZone(group, newZone)) boost *= MISFIT_RENEWAL_BOOST;
    return boost;
  }

  /** The construction rules for a new or replacement building, with its parcel's energy zones. */
  localRules(rules: ConstructionRules, b: Building, atMs: number, districtHeatingOnStreet: boolean): ConstructionRules {
    const state = this.stateForBuilding(b, atMs);
    if (!state || (!state.dhPriority && !state.highStandard)) return rules;
    const local = { ...rules };
    if (state.dhPriority) {
      local.allowedHeating = districtHeatingOnStreet
        ? new Set(["districtHeating"] as const)
        : new Set([...rules.allowedHeating].filter((id) => id !== "gasBoiler" && id !== "oilBoiler"));
    }
    if (state.highStandard) {
      local.uValueFactor = Math.min(local.uValueFactor, HIGH_STANDARD_U_VALUE_FACTOR);
      local.solarMandateFraction = 1;
      local.solarMandateMinFootprintM2 = 0;
    }
    return local;
  }

  /** No new oil or gas heating in a district-heat priority zone (heatingRenewal.ts). */
  fossilHeatingBannedAt(b: Building, atMs: number): boolean {
    return this.stateForBuilding(b, atMs)?.dhPriority ?? false;
  }

  /** The value-capture levy on a project that gained from a zoning change, recorded as a treasury
   * receipt at its permit: on the extra floor space densification allows, and on the rest of its
   * floor space if its parcel was rezoned to a more valuable use. */
  chargeLevy(b: Building, gfaM2: number, atMs: number): number {
    const id = this.parcelIdOfBuilding(b);
    const parcel = id ? this.byId.get(id) : undefined;
    const state = id ? this.stateAt(id, atMs) : null;
    if (!parcel || !state) return 0;
    const extraGfa = Math.min(gfaM2, (b.footprintAreaM2 ?? 0) * state.extraFloors);
    const valueNow = LAND_VALUE_CHF_PER_M2_GFA[state.zone];
    const gain = Math.max(0, valueNow - LAND_VALUE_CHF_PER_M2_GFA[parcel.zone]);
    const levyRp = Math.round(VALUE_LEVY_RATE * (extraGfa * valueNow + gain * (gfaM2 - extraGfa)) * 100);
    if (levyRp > 0) {
      treasury.recordReceipt(atMs, levyRp, b.egid);
      this.levies.push({ atMs, amountRp: levyRp, egid: b.egid });
    }
    return levyRp;
  }

  leviesTotalRp(toMs: number): number {
    return this.levies.reduce((sum, l) => sum + (l.atMs < toMs ? l.amountRp : 0), 0);
  }

  // --- planning ---

  getSelection(): ReadonlySet<string> {
    return this.selection;
  }

  toggle(parcelId: string): void {
    if (!this.byId.has(parcelId)) return;
    if (this.selection.has(parcelId)) this.selection.delete(parcelId);
    else this.selection.add(parcelId);
    this.notify();
  }

  clearSelection(): void {
    if (this.selection.size === 0) return;
    this.selection.clear();
    this.notify();
  }

  /** What putting this change forward for the picked parcels would do. */
  quote(action: ZoningAction, buildings: Building[], atMs: number): ZoningQuote {
    const parcelIds = [...this.selection].filter((id) => {
      const planned = this.plannedState(id);
      const parcel = this.byId.get(id);
      if (!planned || !parcel) return false;
      if (action.type === "rezone" && parcel.zone === "public") return false; // public-use land stays so
      return !sameAction(planned, action);
    });
    const ids = new Set(parcelIds);
    const areaM2 = parcelIds.reduce((sum, id) => sum + (this.byId.get(id)?.areaM2 ?? 0), 0);
    const areaShare = this.totalAreaM2 > 0 ? areaM2 / this.totalAreaM2 : 0;
    let count = 0;
    let dwellings = 0;
    for (const b of buildings) {
      if (!existsAt(b, atMs)) continue;
      const id = this.parcelIdOfBuilding(b);
      if (id && ids.has(id)) {
        count++;
        dwellings += b.dwellings.length;
      }
    }
    const scale = Math.min(1, Math.max(ZONING_STANCE_MIN_SCALE, areaShare / ZONING_STANCE_FULL_AREA_SHARE));
    const stances: Stances = {};
    if (parcelIds.length > 0) {
      if (action.type === "rezone") {
        addStances(stances, REZONE_STANCES[action.zone], scale);
        const workArea = parcelIds.reduce((sum, id) => sum + (this.plannedState(id)?.zone === "work" ? (this.byId.get(id)?.areaM2 ?? 0) : 0), 0);
        if (action.zone !== "work" && workArea > 0) addStances(stances, LOST_WORK_ZONE_STANCE, (scale * workArea) / areaM2);
      } else if (action.type === "densify") {
        const change = parcelIds.reduce((sum, id) => sum + action.extraFloors - (this.plannedState(id)?.extraFloors ?? 0), 0) / parcelIds.length;
        addStances(stances, DENSIFY_STANCES_PER_FLOOR, scale * change);
      } else {
        const base = action.type === "dhPriority" ? DH_PRIORITY_STANCES : HIGH_STANDARD_STANCES;
        addStances(stances, base, scale * (action.on ? 1 : LIFT_STANCE_FACTOR));
      }
    }
    const costRp = parcelIds.length > 0 ? Math.round((ZONING_PLANNING_COST_CHF + (ZONING_PLANNING_COST_CHF_PER_HA * areaM2) / 10_000) * 100) : 0;
    const vacantM2 = this.sites.reduce((sum, s) => {
      const id = this.parcelIdOfSite(s);
      return sum + (id && ids.has(id) ? s.areaM2 : 0);
    }, 0);
    const referendum = areaShare >= ZONING_VOTE_AREA_SHARE ? "mandatory" : "optional";
    return { parcelIds, areaM2, areaShare, buildings: count, dwellings, vacantM2, costRp, stances, referendum, title: this.titleFor(action, parcelIds.length) };
  }

  private titleFor(action: ZoningAction, n: number): string {
    const parcels = `${n} parcel${n === 1 ? "" : "s"}`;
    switch (action.type) {
      case "rezone":
        return `Rezoning ${parcels} to ${ZONE_LABEL[action.zone]}`;
      case "densify":
        return action.extraFloors > 0
          ? `Densification of ${parcels} (+${action.extraFloors} floor${action.extraFloors === 1 ? "" : "s"})`
          : `Taking back the extra floors on ${parcels}`;
      case "dhPriority":
        return action.on ? `District-heat priority zone (${parcels})` : `Lifting the district-heat priority zone (${parcels})`;
      case "highStandard":
        return action.on ? `High-standard zone (${parcels})` : `Lifting the high-standard zone (${parcels})`;
    }
  }

  /** Puts a change forward for the picked parcels: the planning cost is paid now, the public
   * reacts, and it comes into force after the planning procedure unless voters strike it down.
   * `withoutVote`: skip the politics (the scenario runner). Null if it would change nothing. */
  submit(action: ZoningAction, buildings: Building[], atMs: number, { withoutVote = false } = {}): ZoningChange | null {
    const quote = this.quote(action, buildings, atMs);
    if (quote.parcelIds.length === 0) return null;
    const change: ZoningChange = {
      id: this.nextId++,
      parcelIds: quote.parcelIds,
      action,
      title: quote.title,
      submittedAtMs: atMs,
      effectiveAtMs: atMs + ZONING_LEAD_MONTHS * MONTH_MS,
      voteAtMs: null,
      rejected: false,
      costRp: quote.costRp,
    };
    this.changes.push(change);
    for (const id of change.parcelIds) {
      const list = this.changesByParcel.get(id) ?? [];
      list.push(change);
      list.sort((a, b) => a.effectiveAtMs - b.effectiveAtMs);
      this.changesByParcel.set(id, list);
    }
    treasury.recordPayout("zoning", atMs, quote.costRp, `zoning-${change.id}`);
    if (!withoutVote) {
      change.voteAtMs = approval.decide({
        key: `zoning:${change.id}`,
        title: change.title,
        stances: quote.stances,
        referendum: quote.referendum,
        leadTimeMonths: ZONING_LEAD_MONTHS,
        atMs,
        onVote: (accepted) => {
          if (!accepted) {
            change.rejected = true;
            this.notify();
          }
        },
      });
    }
    this.selection = new Set();
    this.notify();
    return change;
  }

  getChanges(): ZoningChange[] {
    return this.changes;
  }

  /** Every parcel of a zone type, as the plan stands now (for picking a whole zone at once). */
  parcelIdsInZone(zone: SiteZone, atMs: number): string[] {
    return this.parcels.filter((p) => this.stateAt(p.id, atMs)?.zone === zone).map((p) => p.id);
  }

  selectMany(ids: string[]): void {
    for (const id of ids) if (this.byId.has(id)) this.selection.add(id);
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

export const zoning = new Zoning();
