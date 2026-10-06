/**
 * The local paper (into inbox.ts): one edition at the start of each month about the month before —
 * a lead story and a handful of headlines, picked by how newsworthy each item is: votes and
 * elections first, then decisions, prices, the grid's readings, what was built, installed and refused,
 * requests answered or ignored, milestones. The paper leans with the public mood: supportive when
 * approval is high, critical when it's low — in its headlines and its editorial.
 *
 * It reports what happened; it doesn't move anything.
 */

import { SUMMER_MEASURED_MONTH, WINTER_MEASURED_MONTH } from "../config/grid";
import type { Building, MunicipalityDataset } from "../data/types";
import { approval, type ApprovalEvent } from "./approval";
import { BASELINE_YEAR, toDateMs, toSimTimeMs } from "./calendar";
import { debt, type DebtEvent } from "./debt";
import { districtHeat } from "./districtHeat";
import { simClock } from "./engine";
import { grid } from "./grid";
import { currentHeatingSystemId, heatingRenewalsInRange } from "./heatingRenewal";
import { inbox, type NewsStory } from "./inbox";
import { letters } from "./letters";
import { existsAt } from "./lifetime";
import { MEASURE_BY_ID } from "./measureCatalog";
import { measures, type MeasureEvent } from "./measures";
import { mobilityCensus } from "./mobility";
import { publicCharging } from "./publicCharging";
import { market } from "./market";
import { hashSeed, mulberry32 } from "./rng";
import { solarInstallsInRange } from "./solarAdoption";
import { benchmarkBillChf, householdBillChf } from "./tariffApproval";
import { tariffStore, type TariffPublication } from "./tariffStore";

type Leaning = "supportive" | "neutral" | "critical";

interface Item extends NewsStory {
  priority: number;
}

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthStartMs(index: number): number {
  return toSimTimeMs(Date.UTC(Math.floor(index / 12), index % 12, 1));
}

function monthLabel(index: number): string {
  return new Date(Date.UTC(Math.floor(index / 12), index % 12, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function dateLabel(atMs: number): string {
  return new Date(toDateMs(atMs)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function firstSentence(text: string): string {
  const m = /^(.*?[.!?])(\s|$)/.exec(text);
  return m ? m[1] : text;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
}

class Newspaper {
  private town = "";
  private seed = "paper";
  private buildingsProvider: () => Building[] = () => [];
  private measureEvents: MeasureEvent[] = [];
  private approvalEvents: ApprovalEvent[] = [];
  private debtEvents: DebtEvent[] = [];
  private tariffEvents: TariffPublication[] = [];
  private lastRate: number | null = null;
  private lastMonth: number | null = null;
  private lastShares: { heatPump: number; ev: number } | null = null;
  private unsubscribers: (() => void)[] = [];

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribers.forEach((u) => u());
    this.town = dataset.name;
    this.seed = seed;
    this.buildingsProvider = buildingsProvider;
    this.measureEvents = [];
    this.approvalEvents = [];
    this.debtEvents = [];
    this.tariffEvents = [];
    this.lastRate = debt.marketPct(simClock.getSimTimeMs());
    this.lastShares = null;
    this.lastMonth = monthIndex(simClock.getSimTimeMs());
    this.unsubscribers = [
      simClock.subscribe(() => this.advance(simClock.getSimTimeMs())),
      measures.onEvent((e) => this.measureEvents.push(e)),
      approval.onEvent((e) => this.approvalEvents.push(e)),
      debt.onEvent((e) => this.debtEvents.push(e)),
      tariffStore.onPublish((e) => this.tariffEvents.push(e)),
    ];
  }

  get title(): string {
    return `The ${this.town} Courier`;
  }

  private advance(nowMs: number): void {
    const month = monthIndex(nowMs);
    if (this.lastMonth === null || month <= this.lastMonth) return;
    // Each month that has ended gets its edition (a long jump: only the last one).
    this.publish(month - 1);
    this.lastMonth = month;
  }

  private publish(month: number): void {
    const from = monthStartMs(month);
    const to = monthStartMs(month + 1);
    const approvalNow = approval.getApproval();
    const leaning: Leaning = approvalNow >= 62 ? "supportive" : approvalNow < 46 ? "critical" : "neutral";
    const rng = mulberry32(hashSeed(this.seed, "edition", String(month)));
    const items = this.items(month, from, to, leaning);
    items.sort((a, b) => b.priority - a.priority);
    const lead = items[0] ?? {
      headline: rng() < 0.5 ? "A quiet month at the town hall" : `Nothing new from the energy department`,
      body: "No decisions, no votes, nothing broke. The town went about its business.",
      priority: 0,
    };
    inbox.addEdition({
      id: `edition-${month}`,
      atMs: to,
      month,
      title: this.title,
      dateLabel: monthLabel(month),
      lead: { headline: lead.headline, body: lead.body },
      stories: items.slice(1, 6).map(({ headline, body }) => ({ headline, body })),
      editorial: this.editorial(leaning, approvalNow, to),
    });
    this.measureEvents = this.measureEvents.filter((e) => e.atMs >= to);
    this.approvalEvents = this.approvalEvents.filter((e) => e.atMs >= to);
    this.debtEvents = this.debtEvents.filter((e) => e.atMs >= to);
    this.tariffEvents = this.tariffEvents.filter((e) => e.atMs >= to);
  }

  private items(month: number, from: number, to: number, leaning: Leaning): Item[] {
    const items: Item[] = [];
    const inMonth = (atMs: number) => atMs >= from && atMs < to;

    // Votes, elections, warnings.
    for (const e of this.approvalEvents.filter((x) => inMonth(x.atMs))) {
      if (e.kind === "voteHeld") {
        const pct = Math.round(e.yesShare);
        items.push({
          priority: 100,
          headline: e.accepted ? `Voters back ${e.title}` : `Voters reject ${e.title}`,
          body: e.accepted
            ? `${pct}% voted yes. ${leaning === "critical" ? "A rare win for the town hall." : "The council can go ahead."}`
            : `Only ${pct}% voted yes, and the measure is struck down. ${leaning === "supportive" ? "A setback for an otherwise popular council." : "A clear rebuke for the town hall."}`,
        });
      } else if (e.kind === "election") {
        items.push({
          priority: 110,
          headline: e.reelected ? "Energy department confirmed in office" : "Voters show the energy department the door",
          body: e.reelected ? `With approval at ${Math.round(e.approval)}%, the voters gave it another four years.` : `Approval stood at just ${Math.round(e.approval)}% on election day.`,
        });
      } else if (e.kind === "warning") {
        items.push({ priority: 85, headline: "Patience with the town hall wears thin", body: `Approval has fallen to ${Math.round(e.approval)}%. Some are already talking about a recall.` });
      } else if (e.kind === "voteScheduled") {
        items.push({ priority: 50, headline: `${e.title} heads to the ballot`, body: `Opponents have forced a public vote, to be held in ${dateLabel(e.voteAtMs)}.` });
      }
    }

    // Decisions.
    for (const e of this.measureEvents.filter((x) => inMonth(x.atMs))) {
      const reaction = approval.reactionTo(e.def.approval?.(e.params) ?? {});
      if (e.kind === "enacted") {
        const headline =
          leaning === "supportive" ? `Town moves ahead with ${e.def.title}` : leaning === "critical" ? `Council pushes through ${e.def.title}` : `${e.def.title} enacted`;
        items.push({ priority: 70, headline, body: `${firstSentence(e.def.summary)} First reactions: ${reaction.label.toLowerCase()}.` });
      } else if (e.kind === "changed") {
        items.push({ priority: 40, headline: `${e.def.title} adjusted`, body: "The council has changed the terms; the new ones apply after the usual lead time." });
      } else if (e.kind === "repealed") {
        items.push({ priority: 60, headline: leaning === "critical" ? `U-turn: ${e.def.title} scrapped` : `${e.def.title} repealed`, body: "It ends with immediate effect." });
      } else if (e.kind === "activated") {
        items.push({ priority: 45, headline: `${e.def.title} now in force`, body: firstSentence(e.def.summary) });
      } else if (e.kind === "retired") {
        items.push({ priority: 35, headline: `${e.def.title} has done its job`, body: `The administration has wound it up: ${e.reason.charAt(0).toLowerCase()}${e.reason.slice(1)}` });
      }
    }

    // The canton and the federal government.
    const monthOfYear = month % 12;
    const year = Math.floor(month / 12);
    if (monthOfYear === 0) {
      for (const ext of measures.externalOutlook(to)) {
        if (ext.startYear === year) items.push({ priority: 68, headline: `From this year: ${ext.title}`, body: firstSentence(ext.summary) });
        else if (ext.startYear > year && measures.externalOutlook(from - 1).every((o) => o.id !== ext.id)) {
          items.push({ priority: 55, headline: `${ext.source === "federal" ? "Bern" : "The canton"} announces ${ext.title}`, body: `${firstSentence(ext.summary)} It takes effect in ${ext.startYear}.` });
        }
      }
    }

    // The grid's readings.
    if (monthOfYear === WINTER_MEASURED_MONTH || monthOfYear === SUMMER_MEASURED_MONTH) {
      const areas = grid.getAreas();
      const winter = monthOfYear === WINTER_MEASURED_MONTH;
      const over = areas.filter((a) => {
        const peaks = grid.effectivePeaks(a, to);
        return (winter ? peaks.drawKw : peaks.feedInKw) > grid.capacityAt(a, to);
      });
      if (over.length > 0) {
        const names = over.slice(0, 3).map((a) => a.name).join(", ");
        items.push({
          priority: 58 + Math.min(20, over.length),
          headline: winter ? `Grid at its limit in ${plural(over.length, "area")}` : `Too much sun for the grid in ${plural(over.length, "area")}`,
          body: winter
            ? `The utility's winter reading found ${plural(over.length, "transformer station")} over capacity (${names}${over.length > 3 ? " and others" : ""}). New heat pumps and wallboxes there have to wait.`
            : `On the sunniest middays, rooftop solar pushed ${plural(over.length, "station")} past capacity (${names}${over.length > 3 ? " and others" : ""}). Large new arrays there have to wait.`,
        });
      } else {
        items.push({ priority: 15, headline: winter ? "Grid came through the winter" : "Grid took the summer sun in its stride", body: "Every transformer station stayed within capacity at the utility's reading." });
      }
    }

    // Heating: heat pumps, boilers, exceptions, refusals.
    let heatPumps = 0;
    let fossil = 0;
    let exceptions = 0;
    let refused = 0;
    const buildings = this.buildingsProvider();
    for (const b of buildings) {
      for (const r of heatingRenewalsInRange(b, from, to)) {
        if (r.system === "airHeatPump" || r.system === "groundHeatPump") heatPumps++;
        if (r.system === "gasBoiler" || r.system === "oilBoiler") fossil++;
        if (r.exception) exceptions++;
        if (r.preferred === "airHeatPump" || r.preferred === "groundHeatPump") refused++;
      }
    }
    if (exceptions > 0) {
      items.push({ priority: 48, headline: `${plural(exceptions, "new boiler")} despite the ban`, body: "No heat pump could go in and no district heating reaches them, so the ban gave way." });
    }
    if (refused >= 3) {
      items.push({ priority: 30, headline: `${plural(refused, "household")} turned away from heat pumps`, body: "A full grid, the ground or the neighbours' quiet stood in the way." });
    }
    if (heatPumps + fossil > 0) {
      items.push({
        priority: 18 + Math.min(10, heatPumps),
        headline: `${plural(heatPumps, "heat pump")} installed in ${monthLabel(month).split(" ")[0]}`,
        body: fossil > 0 ? `${plural(fossil, "building")} replaced their heating with gas or oil again.` : "No one put in a new gas or oil boiler.",
      });
    }

    // Solar.
    const solar = solarInstallsInRange(from, to);
    if (solar.count > 0) {
      items.push({
        priority: 16 + Math.min(10, solar.count),
        headline: `${plural(solar.count, "new solar roof")}`,
        body: `${Math.round(solar.capacityKw)} kWp went up${solar.batteries > 0 ? `, and ${plural(solar.batteries, "home battery", "home batteries")} were installed` : ""}.`,
      });
    }

    // Construction.
    const built = buildings.filter((b) => b.builtAtMs !== undefined && inMonth(b.builtAtMs)).length;
    const demolished = buildings.filter((b) => b.demolishedAtMs !== undefined && inMonth(b.demolishedAtMs)).length;
    if (built > 0) {
      items.push({ priority: 14 + Math.min(8, built), headline: `${plural(built, "building")} completed`, body: demolished > 0 ? `${plural(demolished, "old building")} came down.` : "The town keeps growing." });
    } else if (demolished > 0) {
      items.push({ priority: 12, headline: `${plural(demolished, "old building")} demolished`, body: "Their replacements are on the way." });
    }

    // Charging.
    for (const site of publicCharging.getSites().filter((s) => inMonth(s.openedAtMs))) {
      const municipal = site.owner === "municipal";
      items.push({
        priority: municipal ? 42 : 30,
        headline: `New chargers: ${site.name}`,
        body: `${plural(site.points, "charging point")} ${municipal ? "built by the municipality" : "opened by a private operator"}.`,
      });
    }

    // District heating.
    for (const order of districtHeat.getOrders()) {
      if (inMonth(order.completesAtMs)) items.push({ priority: 42, headline: "District heating reaches new streets", body: `${(order.lengthM / 1000).toFixed(1)} km of new pipes are ready; buildings along them can connect.` });
      else if (inMonth(order.orderedAtMs)) items.push({ priority: 38, headline: "District heating to be extended", body: `Work on ${(order.lengthM / 1000).toFixed(1)} km of new pipes is under way.` });
    }

    for (const s of districtHeat.getSources()) {
      if (s.existing) continue;
      if (inMonth(s.fromMs)) items.push({ priority: 44, headline: `New heat for the district heating: ${s.name}`, body: `${(s.cleanW / 1e6).toFixed(1)} MW of ${s.label.toLowerCase()} is in service.` });
      else if (s.orderedAtMs !== null && inMonth(s.orderedAtMs)) items.push({ priority: 40, headline: `Work starts on ${s.name}`, body: `${(s.cleanW / 1e6).toFixed(1)} MW of ${s.label.toLowerCase()} for the district heating, ready in ${Math.round((s.fromMs - s.orderedAtMs) / (30.44 * 24 * 3_600_000))} months.` });
    }

    // Requests.
    for (const r of letters.resolvedIn(from, to)) {
      if (r.status === "granted") items.push({ priority: 28, headline: "Residents' wish granted", body: `They asked for ${r.ask}, and the town hall delivered.` });
      else if (r.status === "lapsed") items.push({ priority: 32, headline: "Residents left waiting", body: `They asked for ${r.ask}. Nothing came of it.` });
    }

    // Prices: the utility's tariff, the markets.
    // A tariff republished within the month: the last one, against what applied before the first.
    const latest = new Map<number, TariffPublication>();
    for (const e of this.tariffEvents.filter((x) => inMonth(x.atMs))) latest.set(e.year, { ...e, previous: latest.get(e.year)?.previous ?? e.previous });
    for (const e of latest.values()) {
      const before = householdBillChf(e.previous);
      const after = householdBillChf(e.sheet);
      const pct = before > 0 ? Math.round((after / before - 1) * 100) : 0;
      const average = Math.round(benchmarkBillChf(e.year));
      const body = `From 1 January ${e.year}, a typical household pays CHF ${Math.round(after).toLocaleString("en-GB")} a year for its electricity; the Swiss average is about CHF ${average.toLocaleString("en-GB")}.`;
      if (pct > 0) {
        items.push({ priority: 50 + Math.min(30, pct * 2), headline: leaning === "critical" ? `Electricity ${pct}% dearer — again the households pay` : `Electricity tariff up ${pct}% for ${e.year}`, body });
      } else if (pct < 0) {
        items.push({ priority: 45, headline: leaning === "supportive" ? `Good news on the bill: electricity ${-pct}% cheaper` : `Electricity tariff cut ${-pct}% for ${e.year}`, body });
      } else {
        items.push({ priority: 25, headline: `Electricity prices hold steady for ${e.year}`, body });
      }
    }
    const editionYear = Math.floor(month / 12);
    if (month % 12 === 6 && editionYear > BASELINE_YEAR && !tariffStore.isPublished(editionYear + 1)) {
      items.push({ priority: 22, headline: `Tariff for ${editionYear + 1} due this month`, body: `The utility has until the end of August to publish next year’s prices (Town hall → Prices). If it doesn’t, this year’s carry over.` });
    }
    if (month % 12 === 7 && editionYear > BASELINE_YEAR && !tariffStore.isPublished(editionYear + 1)) {
      items.push({ priority: 20, headline: `No new tariff: ${editionYear}'s prices carry over`, body: `The utility let the end-of-August deadline pass. Electricity costs the same in ${editionYear + 1}.` });
    }
    if (market.shocksBetween(from, to).length > 0) {
      items.push({
        priority: 72,
        headline: "Energy prices soar on world markets",
        body: "A supply crisis lifts the price of gas, heating oil and wholesale electricity. Those still burning fuel feel it first; it may take a year or two to ease.",
      });
    }

    // Money: borrowing, the rating, the canton, rates.
    for (const e of this.debtEvents.filter((x) => inMonth(x.atMs))) {
      const chf = (rp: number) => `CHF ${Math.round(rp / 100_000 / 10) / 100} million`;
      if (e.kind === "loanTaken") {
        items.push({
          priority: 50,
          headline: leaning === "critical" ? `Town hall borrows ${chf(e.loan.principalRp)}` : `${chf(e.loan.principalRp)} loan for the energy transition`,
          body: `A ${e.loan.termYears}-year bank loan at ${e.loan.ratePct.toFixed(2)}%.`,
        });
      } else if (e.kind === "bondSubscribed") {
        const full = e.loan.principalRp >= e.loan.requestedRp * 0.999;
        items.push({
          priority: 55,
          headline: full ? "Residents snap up the green bond" : "Green bond falls short",
          body: full
            ? `The town's green bond raised ${chf(e.loan.principalRp)} from its own residents, at ${e.loan.ratePct.toFixed(2)}%.`
            : `Residents subscribed ${chf(e.loan.principalRp)} of the ${chf(e.loan.requestedRp)} on offer.`,
        });
      } else if (e.kind === "federalLoanPaid") {
        items.push({ priority: 40, headline: `Bern lends ${chf(e.loan.principalRp)} for decarbonisation`, body: `A federal loan at ${e.loan.ratePct.toFixed(2)}% over ${e.loan.termYears} years.` });
      } else if (e.kind === "earmark") {
        items.push(
          e.met
            ? { priority: 35, headline: "Green bond promise kept", body: "The money residents lent has gone into green investment, as promised." }
            : { priority: 75, headline: "Greenwashing? Green bond money unspent", body: "Two years on, the town has not invested as much in green projects as residents lent it for them." },
        );
      } else if (e.kind === "supervision") {
        items.push(
          e.on
            ? { priority: 105, headline: "Canton puts energy department under supervision", body: "Debt has passed the limit. No new borrowing, spending measures or orders until it falls back." }
            : { priority: 80, headline: "Canton lifts its supervision", body: "Debt is back within limits; the energy department may spend again." },
        );
      } else if (e.kind === "rating") {
        const order = ["AAA", "AA", "A", "BBB", "BB"];
        const down = order.indexOf(e.to) > order.indexOf(e.from);
        items.push({ priority: down ? 60 : 40, headline: `Credit rating ${down ? "cut" : "raised"} to ${e.to}`, body: down ? "Borrowing gets dearer as debt grows." : "Lenders take a kinder view." });
      }
    }
    const rate = debt.marketPct(to);
    if (this.lastRate !== null && Math.abs(rate - this.lastRate) >= 0.4) {
      items.push({
        priority: rate > this.lastRate ? 54 : 30,
        headline: rate > this.lastRate ? `Interest rates jump to ${rate.toFixed(2)}%` : `Interest rates ease to ${rate.toFixed(2)}%`,
        body: rate > this.lastRate ? "New borrowing gets dearer; loans already taken keep their rate." : "A good moment to borrow, for those who need to.",
      });
      this.lastRate = rate;
    } else if (this.lastRate === null) this.lastRate = rate;

    // Spending.
    if (approval.fiscalPenaltyPoints(to) > 2) {
      items.push({ priority: 52, headline: "Energy department over budget", body: "Spending over the last year has run well beyond the government's allocation. Taxpayers are taking note." });
    }

    // Milestones.
    const shares = this.shares(to);
    if (this.lastShares) {
      const crossed = (now: number, before: number) => Math.floor(now * 10) > Math.floor(before * 10) && now >= 0.1;
      if (crossed(shares.heatPump, this.lastShares.heatPump)) {
        items.push({ priority: 46, headline: `${Math.floor(shares.heatPump * 10) * 10}% of buildings now heat with heat pumps`, body: "Another milestone on the way to net zero." });
      }
      if (crossed(shares.ev, this.lastShares.ev)) {
        items.push({ priority: 46, headline: `${Math.floor(shares.ev * 10) * 10}% of residents' cars are now electric`, body: `Electric cars make up ${Math.round(shares.ev * 100)}% of the cars in town.` });
      }
    }
    this.lastShares = shares;
    return items;
  }

  private shares(atMs: number): { heatPump: number; ev: number } {
    const buildings = this.buildingsProvider().filter((b) => existsAt(b, atMs));
    let heated = 0;
    let heatPumps = 0;
    for (const b of buildings) {
      const system = currentHeatingSystemId(b, atMs);
      if (!system) continue;
      heated++;
      if (system === "airHeatPump" || system === "groundHeatPump") heatPumps++;
    }
    const census = mobilityCensus(buildings, atMs);
    return { heatPump: heated > 0 ? heatPumps / heated : 0, ev: census.byMode.car > 0 ? census.carsElectric / census.byMode.car : 0 };
  }

  private editorial(leaning: Leaning, approvalNow: number, atMs: number): string {
    const election = approval.nextElectionMs();
    const monthsToElection = election !== null ? (election - atMs) / ((365.25 * 24 * 3600e3) / 12) : Infinity;
    const electionNote = monthsToElection > 0 && monthsToElection <= 12 ? ` With the election in ${dateLabel(election as number)}, every decision now counts twice.` : "";
    const pct = Math.round(approvalNow);
    if (leaning === "supportive") return `The energy department has the town behind it: ${pct}% approve of its work. Good will is capital — the question is what it will be spent on.${electionNote}`;
    if (leaning === "critical") return `Only ${pct}% approve of the energy department's work. It would do well to listen before it decides.${electionNote}`;
    return `Opinion on the energy department is divided, with ${pct}% approving. Neither cheers nor jeers — yet.${electionNote}`;
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return {
      // A measure's definition is code: it travels as its id.
      measureEvents: this.measureEvents.map((e) => ({ ...e, def: e.def.id })),
      approvalEvents: this.approvalEvents,
      debtEvents: this.debtEvents,
      tariffEvents: this.tariffEvents,
      lastRate: this.lastRate,
      lastMonth: this.lastMonth,
      lastShares: this.lastShares,
    };
  }

  restore(s: ReturnType<Newspaper["snapshot"]>): void {
    this.measureEvents = s.measureEvents.flatMap((e) => {
      const def = MEASURE_BY_ID.get(e.def);
      return def ? [{ ...e, def } as MeasureEvent] : [];
    });
    this.approvalEvents = s.approvalEvents;
    this.debtEvents = s.debtEvents;
    this.tariffEvents = s.tariffEvents;
    this.lastRate = s.lastRate;
    this.lastMonth = s.lastMonth;
    this.lastShares = s.lastShares;
  }
}

export const newspaper = new Newspaper();
