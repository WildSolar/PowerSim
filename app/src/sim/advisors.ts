/**
 * Advisors: consultants the department retains for a yearly fee (a measure each), who write once a
 * year with what they found — the roof solar advisor, the mobility advisor, the district heating
 * advisor and the finance advisor. Each report is a letter (inbox.ts) whose picks open the matching
 * planning tool at the place they name.
 *
 * They know what a consultant would: the prices, the bills and the town's own record — never what
 * the game has in store. Where they look ahead (whose heating is likely to wear out, what next
 * year's power will cost), they estimate, from the age of what is installed and the usual
 * lifetimes, and from what the utility has already bought.
 */

import { HEATING_WEIBULL_SHAPE } from "../config/heating";
import { WHOLESALE_HEDGED_SHARE, WHOLESALE_SPOT_MONTHLY_SIGMA } from "../config/market";
import type { Building } from "../data/types";
import { toDateMs, toSimTimeMs } from "./calendar";
import { debt } from "./debt";
import { districtHeat, segmentCostRp } from "./districtHeat";
import { networkStatusAt } from "./districtHeatStats";
import { simClock } from "./engine";
import { townTakeRp, utilityProfitRp } from "./finances";
import { annualHeatDemandKWh, currentHeatingSystemId, heatingRenewalsInRange } from "./heatingRenewal";
import { HEATING_SYSTEM_CATALOG, type HeatingSystemId } from "./heatingSystems";
import { inbox, type LetterPick } from "./inbox";
import { existsAt } from "./lifetime";
import { market } from "./market";
import { monthRecords } from "./monthRecords";
import { policyStore } from "./policy";
import { publicCharging } from "./publicCharging";
import { hashSeed, mulberry32 } from "./rng";
import { roofContracts } from "./roofContracts";
import { streets } from "./streets";
import { benchmarkRpKWh, householdRpKWh } from "./tariffApproval";
import { tariffStore } from "./tariffStore";

const DAY_MS = 24 * 60 * 60_000;
const YEAR_MS = 365.25 * DAY_MS;

export type AdvisorId = "roofSolar" | "mobility" | "districtHeat" | "finance";

/** Who signs, and the month of the year each writes (0 = January): before the solar season, after
 * the operators' new year round, before the building season, and before the tariff deadline. */
const ADVISORS: Record<AdvisorId, { from: string; month: number }> = {
  mobility: { from: "Your mobility advisor", month: 1 },
  roofSolar: { from: "Your roof solar advisor", month: 2 },
  districtHeat: { from: "Your district heating advisor", month: 3 },
  finance: { from: "Your finance advisor", month: 5 },
};

/** How far the district heating advisor looks ahead, and how long a run of street it suggests. */
const DH_HORIZON_YEARS = 5;
const DH_RUN_MAX_M = 400;
/** What share of owners on a piped street choose district heat when they replace a boiler, before
 * the town has a record of its own — and how many of its own cases outweigh that guess. */
const DH_UPTAKE_PRIOR = 0.4;
const DH_UPTAKE_PRIOR_WEIGHT = 5;
const FOSSIL_OR_WOOD = new Set<HeatingSystemId>(["oilBoiler", "gasBoiler", "woodPellet"]);

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

const chf = (rp: number) => `CHF ${Math.round(rp / 100).toLocaleString("de-CH")}`;
const mchf = (rp: number) => `CHF ${(rp / 100 / 1_000_000).toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} M`;
const mwh = (kWh: number) => `${Math.round(kWh / 1000).toLocaleString("de-CH")} MWh`;

class Advisors {
  private lastReportMonth: Partial<Record<AdvisorId, number>> = {};
  private lastMonth = 0;
  private buildingsProvider: () => Building[] = () => [];
  private seed = "";
  private unsubscribeClock: (() => void) | null = null;

  init(buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribeClock?.();
    this.buildingsProvider = buildingsProvider;
    this.seed = seed;
    this.lastReportMonth = {};
    this.lastMonth = monthIndex(simClock.getSimTimeMs());
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
  }

  private advance(nowMs: number): void {
    const month = monthIndex(nowMs);
    if (month <= this.lastMonth) return;
    // A long jump writes at most the latest month's reports.
    this.lastMonth = month;
    this.monthly(month);
  }

  private retained(id: AdvisorId): boolean {
    const p = policyStore.get();
    return (id === "roofSolar" ? p.advisorRoofSolar : id === "mobility" ? p.advisorMobility : id === "districtHeat" ? p.advisorDistrictHeat : p.advisorFinance) > 0;
  }

  /** Each retained advisor writes a first report the month after starting, then once a year in its
   * month (not within a quarter of the last). */
  private monthly(month: number): void {
    for (const id of Object.keys(ADVISORS) as AdvisorId[]) {
      if (!this.retained(id)) {
        delete this.lastReportMonth[id];
        continue;
      }
      const last = this.lastReportMonth[id];
      const due = last === undefined || (month % 12 === ADVISORS[id].month && month - last >= 3);
      if (!due) continue;
      this.lastReportMonth[id] = month;
      const atMs = toSimTimeMs(Date.UTC(Math.floor(month / 12), month % 12, 1)) + 2 * DAY_MS;
      const report = this.reportAt(id, atMs);
      inbox.addLetter({ id: `advisor-${id}-${month}`, atMs, kind: "report", bloc: null, from: ADVISORS[id].from, role: "consultant to the energy department", ...report });
    }
  }

  /** What an advisor would write at `atMs` (also for the dev console). */
  reportAt(id: AdvisorId, atMs: number): { subject: string; paragraphs: string[]; picks?: LetterPick[] } {
    if (id === "roofSolar") return this.roofSolarReport(atMs);
    if (id === "mobility") return this.mobilityReport(atMs);
    if (id === "districtHeat") return this.districtHeatReport(atMs);
    return this.financeReport(atMs);
  }

  // --- roof solar ---

  private roofSolarReport(atMs: number): { subject: string; paragraphs: string[]; picks?: LetterPick[] } {
    const ranked = roofContracts
      .eligibleRoofs(atMs)
      .map((b) => {
        const q = roofContracts.quote(b, atMs);
        const yearlyRp = q ? q.valueRp - q.rentRp - q.upkeepRp : 0;
        return { b, q, yearlyRp, ret: q && q.costRp > 0 ? yearlyRp / q.costRp : 0 };
      })
      .filter((x) => x.q && x.yearlyRp > 0)
      .sort((a, b) => b.ret - a.ret)
      .slice(0, 10);
    const estimate = roofContracts.offerAllEstimate(atMs);
    const accepting = estimate.roofs > 0 ? Math.round((estimate.accepting / estimate.roofs) * 10) : 0;
    if (ranked.length === 0)
      return {
        subject: "No roof worth a contract this year",
        paragraphs: [
          "I went through every large roof the utility could rent. At today's prices and your rent, none would earn back what an array costs over its life — the panels, the rent and the upkeep against the power it saves buying.",
          "Cheaper panels, a dearer market or a lower rent would change that; I'll look again next year.",
        ],
      };
    return {
      subject: `The ${ranked.length} best roofs for the utility's solar`,
      paragraphs: [
        `I went through every large roof the utility could rent and costed an array on each: the panels (less the federal payment), your rent of CHF ${roofContracts.getRent().toLocaleString("de-CH")}/m² and the upkeep, against what its power saves buying at the market's underlying price, on a typical year's sun for the way each roof faces. These ${ranked.length} return the most for what they cost.`,
        `At your current rent, about ${accepting} owners in 10 would accept an offer. Each pick opens the roof's card in the Roof solar tool, where you can offer the contract.`,
      ],
      picks: ranked.map(({ b, q, yearlyRp }) => ({
        label: b.address ?? `Building ${b.egid}`,
        detail: `${Math.round(q!.capacityKw)} kWp · ${chf(yearlyRp)} a year · pays back in about ${Math.max(1, Math.round(q!.costRp / yearlyRp))} years (${chf(q!.costRp)})`,
        lon: b.lon,
        lat: b.lat,
        egid: b.egid,
        tool: "roofSolar" as const,
      })),
    };
  }

  // --- mobility ---

  private mobilityReport(atMs: number): { subject: string; paragraphs: string[]; picks?: LetterPick[] } {
    const { spots, fleet } = publicCharging.adviseSites(atMs, 3);
    // A survey's count, not the register: give or take a few.
    const rng = mulberry32(hashSeed(this.seed, "mobility-advisor", String(monthIndex(atMs))));
    const about = (n: number) => Math.max(1, Math.round(n * (0.85 + 0.3 * rng())));
    const paragraphs: string[] = [];
    if (spots.length === 0)
      paragraphs.push(
        "Over the past year I found no corner of town where households who wanted an electric car were held back by the lack of a charger — those who looked found room nearby, or charge at home or at work.",
      );
    else
      paragraphs.push(
        `Over the past year, households across town looked into an electric car and gave up for want of a charger with room nearby. Where most of them live, a new on-street charging site would do most good — the chargers opened or ordered since are already counted. ${spots.length === 1 ? "This is the spot" : `These are the ${spots.length} spots, best first`}.`,
        "Each pick opens the EV charging tool there, where you can place a site.",
      );
    if (fleet && fleet.vehicles >= 3)
      paragraphs.push(
        `Businesses, too: about ${about(fleet.vehicles)} vans and lorries without a yard of their own would have gone electric with a fast-charging hub or a lorry charging park within reach. Most of them are around the spot I've marked last.`,
      );
    const picks: LetterPick[] = spots.map((s) => ({
      label: s.street ? `On ${s.street}` : "Here",
      detail: `about ${about(s.households)} households nearby wanted to charge in the past year and found no room`,
      lon: s.lon,
      lat: s.lat,
      tool: "evCharging" as const,
    }));
    if (fleet && fleet.vehicles >= 3) picks.push({ label: "A hub for vans and lorries", detail: `about ${about(fleet.vehicles)} vehicles would use it`, lon: fleet.lon, lat: fleet.lat, tool: "evCharging" });
    return { subject: spots.length > 0 ? "Where the next chargers should go" : "Charging: no gaps this year", paragraphs, picks: picks.length > 0 ? picks : undefined };
  }

  // --- district heating ---

  /** The share of owners on a piped street who chose district heat when they replaced a boiler, in
   * the town over the last five years — weighed against a general guess while there are few. */
  private uptakeShare(buildings: Building[], atMs: number): { share: number; cases: number } {
    let cases = 0;
    let chose = 0;
    for (const b of buildings) {
      if (!b.streetSegments) continue;
      for (const r of heatingRenewalsInRange(b, atMs - DH_HORIZON_YEARS * YEAR_MS, atMs)) {
        if (!FOSSIL_OR_WOOD.has(r.previousSystem) || !districtHeat.servesAt(b.streetSegments, r.installedAtMs)) continue;
        cases++;
        if (r.system === "districtHeating") chose++;
      }
    }
    return { share: (chose + DH_UPTAKE_PRIOR * DH_UPTAKE_PRIOR_WEIGHT) / (cases + DH_UPTAKE_PRIOR_WEIGHT), cases };
  }

  /** The chance a building's heating comes up for replacement within the horizon: from its age where
   * the town knows when it was put in, else from the usual lifetime alone. */
  private dueWithin(b: Building, system: HeatingSystemId, atMs: number): number {
    const mean = HEATING_SYSTEM_CATALOG[system].lifetimeMeanYears;
    const k = HEATING_WEIBULL_SHAPE;
    const scale = mean / 0.8873; // mean / Γ(1 + 1/k), for k = 2.5
    const last = heatingRenewalsInRange(b, -Infinity, atMs).at(-1);
    if (!last) return Math.min(1, DH_HORIZON_YEARS / mean);
    const age = (atMs - last.installedAtMs) / YEAR_MS;
    return 1 - Math.exp(Math.pow(age / scale, k) - Math.pow((age + DH_HORIZON_YEARS) / scale, k));
  }

  private districtHeatReport(atMs: number): { subject: string; paragraphs: string[]; picks?: LetterPick[] } {
    if (districtHeat.getSources().length === 0)
      return {
        subject: "District heating: no network to extend yet",
        paragraphs: [
          "There is no district heating network in town yet, so there is nothing to extend. A network starts with a heat source — waste heat, a heat pump on waste water or a river, groundwater, wood — in the District heating tool; once it has pipes, I'll tell you which streets to take them down next.",
        ],
      };
    const buildings = this.buildingsProvider();
    // The buildings an extension would newly reach, by the street they front on.
    const bySegment = new Map<number, Building[]>();
    for (const b of buildings) {
      if (!b.streetSegments || !existsAt(b, atMs) || networkStatusAt(b, atMs) !== "outOfReach" || districtHeat.buildingAt(b.streetSegments, atMs)) continue;
      for (const id of b.streetSegments) {
        const list = bySegment.get(id) ?? [];
        list.push(b);
        bySegment.set(id, list);
      }
    }
    const { share: uptake, cases } = this.uptakeShare(buildings, atMs);
    const expectedOf = new Map<string, { heatKWh: number; expectedKWh: number }>();
    const expectation = (b: Building) => {
      let e = expectedOf.get(b.egid);
      if (!e) {
        const system = currentHeatingSystemId(b, atMs);
        const heatKWh = annualHeatDemandKWh(b, atMs);
        e = { heatKWh, expectedKWh: system && FOSSIL_OR_WOOD.has(system) ? heatKWh * this.dueWithin(b, system, atMs) * uptake : 0 };
        expectedOf.set(b.egid, e);
      }
      return e;
    };

    // Runs of street from the network's edge: a segment touching it, carried on along the same
    // street while it is unpiped, up to a few hundred metres.
    const reached = districtHeat.reachedNodes();
    const runs: { segments: number[]; lengthM: number; name: string | null; heatKWh: number; expectedKWh: number; buildings: number; costRp: number; lon: number; lat: number }[] = [];
    for (const s of streets.all()) {
      if (districtHeat.isPiped(s.id) || !streets.nodesOf(s.id).some((n) => reached.has(n))) continue;
      const run = [s.id];
      let lengthM = s.lengthM;
      let ends = streets.nodesOf(s.id).filter((n) => !reached.has(n));
      while (lengthM < DH_RUN_MAX_M && s.name) {
        const next = ends.flatMap((n) => streets.atNode(n)).map((id) => streets.get(id)!).find((o) => o && !run.includes(o.id) && !districtHeat.isPiped(o.id) && o.name === s.name);
        if (!next) break;
        run.push(next.id);
        lengthM += next.lengthM;
        ends = streets.nodesOf(next.id).filter((n) => !ends.includes(n) && !reached.has(n));
      }
      const fronting = new Set(run.flatMap((id) => bySegment.get(id) ?? []));
      if (fronting.size === 0) continue;
      let heatKWh = 0;
      let expectedKWh = 0;
      for (const b of fronting) {
        const e = expectation(b);
        heatKWh += e.heatKWh;
        expectedKWh += e.expectedKWh;
      }
      if (expectedKWh <= 0) continue;
      const mid = s.line[Math.floor(s.line.length / 2)];
      runs.push({ segments: run, lengthM, name: s.name, heatKWh, expectedKWh, buildings: fronting.size, costRp: run.reduce((sum, id) => sum + segmentCostRp(id, atMs), 0), lon: mid[0], lat: mid[1] });
    }
    // The best per metre of pipe, no two sharing a street segment.
    runs.sort((a, b) => b.expectedKWh / b.lengthM - a.expectedKWh / a.lengthM);
    const picked: typeof runs = [];
    for (const r of runs) {
      if (picked.length >= 5) break;
      if (picked.some((p) => p.segments.some((id) => r.segments.includes(id)))) continue;
      picked.push(r);
    }
    if (picked.length === 0)
      return {
        subject: "District heating: no street worth extending to",
        paragraphs: [
          "I looked at every street next to your network. None has buildings heating with oil, gas or wood whose heating is likely to be replaced in the next few years — the ones who would connect.",
        ],
      };
    return {
      subject: `District heating: ${picked.length} streets to extend to`,
      paragraphs: [
        `I looked at every street next to your network and asked how much heat it would likely bring within ${DH_HORIZON_YEARS} years: the buildings along it heating with oil, gas or wood, how likely their heating is to need replacing in that time — from when it was put in, where that is known, else from how long such systems usually last — and how many owners choose district heat when it is on their street: about ${Math.round(uptake * 100)}% ${cases >= 10 ? `here, from ${cases} cases in the last ${DH_HORIZON_YEARS} years` : "— a general figure, as there are too few cases in town yet"}.`,
        "These are the best per metre of pipe. An estimate, not a promise: owners decide for themselves. Each pick opens the District heating tool with the streets planned, so you see the extension's cost and can order it.",
      ],
      picks: picked.map((r) => ({
        label: `${r.name ?? "A street"} — ${Math.round(r.lengthM)} m`,
        detail: `about ${mwh(r.expectedKWh)} a year likely within ${DH_HORIZON_YEARS} years (${Math.round(r.expectedKWh / r.lengthM).toLocaleString("de-CH")} kWh per metre), of ${mwh(r.heatKWh)} along it · ${r.buildings} buildings · pipes about ${chf(r.costRp)}`,
        lon: r.lon,
        lat: r.lat,
        tool: "districtHeat" as const,
        segments: r.segments,
      })),
    };
  }

  // --- finance ---

  private financeReport(atMs: number): { subject: string; paragraphs: string[] } {
    const year = new Date(toDateMs(atMs)).getUTCFullYear();
    const month = monthIndex(atMs);
    const last12 = monthRecords.all().filter((r) => r.utility && r.month >= month - 12 && r.month < month);
    let profitRp = 0;
    let keptRp = 0;
    let boughtKWh = 0;
    let deliveredKWh = 0;
    for (const r of last12) {
      const u = r.utility!;
      const p = utilityProfitRp(u);
      profitRp += p;
      keptRp += p - townTakeRp(Math.floor(r.month / 12), p, u.networkKWh) + u.publicSolarSavingsRp;
      boughtKWh += r.boughtKWh ?? 0;
      deliveredKWh += u.deliveredKWh;
    }
    const thisRp = market.hedgedPrice(year);
    const nextRp = market.hedgedPrice(year + 1);
    const deltaRp = nextRp - thisRp;
    const impactRp = -deltaRp * WHOLESALE_HEDGED_SHARE * boughtKWh;
    // What the part still bought month by month could add or take away, roughly (a crisis aside).
    const marginRp = WHOLESALE_SPOT_MONTHLY_SIGMA * nextRp * (1 - WHOLESALE_HEDGED_SHARE) * boughtKWh;
    const neededRpKWh = deliveredKWh > 0 ? (deltaRp * WHOLESALE_HEDGED_SHARE * boughtKWh) / deliveredKWh : 0;
    const householdNow = householdRpKWh(tariffStore.sheetFor(year), year);
    const benchNow = benchmarkRpKWh(year);
    const benchNext = benchNow + (nextRp - thisRp);
    const vsAverage = (householdNow / benchNext - 1) * 100;
    const balance = debt.balanceRp(atMs);
    const owed = debt.debtRp(atMs);
    const up = deltaRp >= 0;
    const paragraphs = [
      last12.length > 0
        ? `Over the last ${last12.length} months the utility ${profitRp >= 0 ? "made" : "lost"} ${mchf(Math.abs(profitRp))}; after the town's concession fee, and with the public buildings' solar, your department ${keptRp >= 0 ? "kept" : "was left short by"} ${mchf(Math.abs(keptRp))}.`
        : "The utility has no settled months yet to judge by; I'll have more to say next year.",
      `Power for ${year + 1}: ${Math.round(WHOLESALE_HEDGED_SHARE * 100)}% is bought already, at about ${nextRp.toFixed(1)} Rp/kWh against ${thisRp.toFixed(1)} this year — ${up ? "up" : "down"} ${Math.abs((nextRp / thisRp - 1) * 100).toFixed(0)}%. On the power the town bought in the last twelve months, that ${up ? "costs" : "saves"} the utility about ${mchf(Math.abs(impactRp))} next year, give or take ${mchf(marginRp)} for what is still bought month by month — more if a supply crisis hits, which nobody can see coming.`,
      Math.abs(neededRpKWh) >= 0.05
        ? `To keep the utility's result where it is, the electricity prices would have to ${up ? "rise" : "could fall"} by about ${Math.abs(neededRpKWh).toFixed(1)} Rp/kWh on average.`
        : "The utility's result shouldn't move much on account of the power it buys.",
      `Utilities elsewhere buy on the same market: the Swiss average household will likely pay about ${benchNext.toFixed(1)} Rp/kWh next year, against ${benchNow.toFixed(1)} this year. Yours pay ${householdNow.toFixed(1)} today — ${Math.abs(vsAverage) < 1 ? "about the same as" : `${Math.abs(vsAverage).toFixed(0)}% ${vsAverage > 0 ? "above" : "below"}`} that. People take a price that follows the average better than one that runs ahead of it.`,
      balance !== null
        ? `The treasury holds ${mchf(balance)}${owed > 0 ? `, and the town owes ${mchf(owed)}` : ""}. Next year's prices are yours to publish by the end of August (Town hall → Prices).`
        : "Next year's prices are yours to publish by the end of August (Town hall → Prices).",
    ];
    return { subject: `Next year's power: ${up ? "dearer" : "cheaper"} by about ${Math.abs(nextRp - thisRp).toFixed(1)} Rp/kWh`, paragraphs };
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { lastReportMonth: this.lastReportMonth, lastMonth: this.lastMonth };
  }

  restore(s: ReturnType<Advisors["snapshot"]>): void {
    this.lastReportMonth = { ...s.lastReportMonth };
    this.lastMonth = s.lastMonth;
  }
}

export const advisors = new Advisors();

