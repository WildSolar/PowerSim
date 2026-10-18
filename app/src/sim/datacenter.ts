/**
 * A data centre: now and then one comes to a town with open land in a work zone. Whether and when,
 * and how big, is drawn once per municipality (config/datacenter.ts); if the time comes and no
 * work-zone site has room for it, it goes elsewhere.
 *
 * It is a building like any other (stock.ts places it), with a load of its own (commercial.ts): its
 * IT load and the cooling on top, almost flat day and night, filling up over a few years. It buys
 * its energy on the open market from the start (marketAccess.ts) and certified renewable power, so
 * its electricity carries no emissions in the town's balance (emissions.ts); it pays the network fee
 * like any business, and its concession fee straight to the town, not through the utility
 * (finances.ts). It has its own substation, so it loads no neighbourhood's transformer (grid.ts).
 *
 * Its waste heat is the prize: a year after it opens it offers it to the utility, nearly free, for a
 * heat pump that lifts it to the network's temperature (districtHeatSources.ts).
 */

import {
  DATACENTER_BUILD_MONTHS,
  DATACENTER_CHANCE_PER_YEAR,
  DATACENTER_FLOORS,
  DATACENTER_HEAT_PER_IT_KW,
  DATACENTER_IT_KW,
  DATACENTER_M2_PER_IT_KW,
  DATACENTER_MIN_FOOTPRINT_M2,
  DATACENTER_OFFER_MONTHS,
} from "../config/datacenter";
import { DH_FULL_LOAD_HOURS } from "../config/districtHeat";
import type { Building, DhCandidateData } from "../data/types";
import { BASELINE_YEAR, toSimTimeMs } from "./calendar";
import { commercialPowerW } from "./commercial";
import { districtHeat } from "./districtHeat";
import { simClock } from "./engine";
import { existsAt } from "./lifetime";
import { marketAccess } from "./marketAccess";
import { hashSeed, mulberry32 } from "./rng";
import { stock } from "./stock";
import { streets } from "./streets";

const HOUR_MS = 3_600_000;
const MONTH_MS = (365.25 * 24 * HOUR_MS) / 12;
const LAST_YEAR = 2050;

class Datacenter {
  /** When it is announced, and how big — drawn per municipality; null: none comes. */
  private plan: { announceMs: number; itKw: number } | null = null;
  /** Whether the announcement has come (and it was placed, or found no room). */
  private attempted = false;
  private egid: string | null = null;
  private unsubscribeClock: (() => void) | null = null;
  private candidateCache: { egid: string; candidate: DhCandidateData } | null = null;

  init(seed: string): void {
    this.unsubscribeClock?.();
    const rng = mulberry32(hashSeed(seed, "datacenter"));
    this.plan = null;
    for (let year = BASELINE_YEAR + 1; year <= LAST_YEAR; year++) {
      const hit = rng() < DATACENTER_CHANCE_PER_YEAR;
      const month = Math.floor(rng() * 12);
      if (!hit) continue;
      const [lo, hi] = DATACENTER_IT_KW;
      this.plan = { announceMs: toSimTimeMs(Date.UTC(year, month, 1 + Math.floor(rng() * 27))), itKw: Math.round((lo + rng() * (hi - lo)) / 500) * 500 };
      break;
    }
    this.attempted = false;
    this.egid = null;
    this.candidateCache = null;
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    districtHeat.setExtraCandidates(() => this.candidates());
  }

  /** Once its time has come: the hall is placed on the work-zone site with the most room, its
   * construction starting now. The clock calls it; so does the scenario runner. */
  advance(atMs: number): void {
    if (this.attempted || !this.plan || atMs < this.plan.announceMs) return;
    this.attempted = true;
    const footprintM2 = Math.max(DATACENTER_MIN_FOOTPRINT_M2, this.plan.itKw * DATACENTER_M2_PER_IT_KW);
    const b = stock.placeDatacenter(this.plan.announceMs, this.plan.itKw, footprintM2, DATACENTER_FLOORS, this.plan.announceMs + DATACENTER_BUILD_MONTHS * MONTH_MS);
    if (!b) return;
    this.egid = b.egid;
    marketAccess.joinMarket(b.egid, b.builtAtMs ?? this.plan.announceMs);
  }

  /** The data centre, once announced (it stands from its opening). */
  building(): Building | undefined {
    return this.egid ? stock.lookup(this.egid) : undefined;
  }

  isDatacenter(b: Building): boolean {
    return b.datacenterItKw !== undefined;
  }

  /** What it draws at `atMs` (W), 0 before it opens. */
  powerW(atMs: number): number {
    const b = this.building();
    return b && existsAt(b, atMs) ? commercialPowerW(b, atMs) : 0;
  }

  /** What it drew between two moments (kWh), hour by hour. */
  kWhBetween(fromMs: number, toMs: number): number {
    const b = this.building();
    if (!b) return 0;
    let wh = 0;
    for (let t = fromMs + HOUR_MS / 2; t < toMs; t += HOUR_MS) wh += existsAt(b, t) ? commercialPowerW(b, t) : 0;
    return wh / 1000;
  }

  /** When it offers its waste heat to the utility. */
  offerAtMs(): number {
    const b = this.building();
    return (b?.builtAtMs ?? Number.POSITIVE_INFINITY) + DATACENTER_OFFER_MONTHS * MONTH_MS;
  }

  /** Its waste heat as a source for district heating (once it stands). */
  private candidates(): DhCandidateData[] {
    const b = this.building();
    if (!b || b.datacenterItKw === undefined) return [];
    if (this.candidateCache?.egid !== b.egid) {
      const junction = streets.nearestJunction(b.lon, b.lat);
      if (!junction) return [];
      const heatMw = (b.datacenterItKw / 1000) * DATACENTER_HEAT_PER_IT_KW;
      this.candidateCache = {
        egid: b.egid,
        candidate: {
          id: `datacenter:${b.egid}`,
          kind: "datacenter",
          name: "Data centre",
          lon: b.lon,
          lat: b.lat,
          node: junction.node,
          feedLon: junction.lon,
          feedLat: junction.lat,
          trunkM: junction.distanceM > 30 ? Math.round(junction.distanceM * 1.2) : 0,
          outside: false,
          potentialMwh: heatMw * DH_FULL_LOAD_HOURS.datacenter,
          egid: b.egid,
        },
      };
    }
    return [this.candidateCache.candidate];
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { attempted: this.attempted, egid: this.egid };
  }

  restore(s: ReturnType<Datacenter["snapshot"]>): void {
    this.attempted = s.attempted;
    this.egid = s.egid;
    this.candidateCache = null;
  }
}

export const datacenter = new Datacenter();
