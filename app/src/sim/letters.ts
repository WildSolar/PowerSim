/**
 * Letters from residents, groups and businesses (into inbox.ts). They do three things:
 *
 *  - React. A decision a group feels strongly about brings a letter within days; a measure going to
 *    a vote brings letters from both camps. And every month a group may write about its mood — the
 *    further from content, the likelier — naming what weighs on it most. The tone is read off the
 *    group's mood with some noise: a free hint at what only a survey measures properly.
 *  - Report. What goes wrong in town reaches the town hall: a heat pump refused, a new boiler allowed
 *    despite the ban, nowhere to charge. These are reports only; approval moves with decisions.
 *  - Ask. Now and then a letter asks for something concrete — a charger near a street, district
 *    heating along one, a reinforced transformer station, solar on a public building, a measure — by
 *    a deadline. Answer it in time and the group that asked remembers (goodwill); leave it and it
 *    remembers that too. A request someone else sorts out (a private charging operator) earns nothing.
 */

import { BLOC_ORDER, type Bloc } from "../config/approval";
import { REACH_M } from "../config/charging";
import {
  BLOC_SENDERS,
  CHARGER_REQUEST_MIN_UNMET,
  DH_REQUEST_MIN_BUILDINGS,
  FIRST_NAMES,
  LAST_NAMES,
  MAX_OPEN_REQUESTS,
  MOOD_ANGRY_BELOW,
  MOOD_LETTER_BASE_CHANCE,
  MOOD_LETTER_CHANCE_PER_POINT,
  MOOD_LETTER_COOLDOWN_MONTHS,
  MOOD_LETTER_MAX_CHANCE,
  MOOD_LETTERS_PER_MONTH,
  MOOD_NEUTRAL,
  MOOD_NOISE_POINTS,
  MOOD_PLEASED_FROM,
  MOOD_UNHAPPY_BELOW,
  ORGANISATION_SHARE,
  REACTION_CHANCE,
  REACTION_DELAY_DAYS,
  REACTION_MIN_STANCE,
  REPORT_COOLDOWN_MONTHS,
  REPORT_LETTERS_PER_MONTH,
  REQUEST_CHANCE_PER_MONTH,
  REQUEST_DEADLINE_MONTHS,
  REQUEST_GRANTED_POINTS,
  REQUEST_LAPSED_POINTS,
} from "../config/letters";
import type { Building, MunicipalityDataset, PowerPlant } from "../data/types";
import { approval, type ApprovalEvent, type Stances } from "./approval";
import { toDateMs, toSimTimeMs } from "./calendar";
import { debt } from "./debt";
import { districtHeat } from "./districtHeat";
import { candidateName, districtHeatSources } from "./districtHeatSources";
import { simClock } from "./engine";
import { grid } from "./grid";
import { gridDrawBlockedAt } from "./gridLimits";
import { currentHeatingSystemId, heatingRenewalsInRange } from "./heatingRenewal";
import { HEATING_SYSTEM_CATALOG, type HeatingSystemId } from "./heatingSystems";
import { heatPumpSiting } from "./heatPumpSiting";
import { inbox, type Letter } from "./inbox";
import {
  campaignText,
  fossilExceptionsText,
  grantedText,
  lapsedText,
  moodText,
  noChargerText,
  reactionText,
  refusedHeatPumpText,
  requestText,
  resolvedByOthersText,
  voteResultText,
  heatOfferText,
  welcomeText,
  type LetterText,
  type Mood,
  type MoodCause,
} from "./letterTexts";
import { existsAt } from "./lifetime";
import { measureUnavailableReason } from "./measureAvailability";
import { MEASURE_CATALOG } from "./measureCatalog";
import { measures, type MeasureEvent } from "./measures";
import { defaultParams } from "./measureTypes";
import { publicBuildingKind } from "./publicBuildings";
import { publicCharging } from "./publicCharging";
import { hashSeed, mulberry32 } from "./rng";
import { isMunicipalSolar, municipalSolarCandidates, solarStatusOf } from "./solarAdoption";
import { streets } from "./streets";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = (365.25 * DAY_MS) / 12;

export type RequestTarget =
  | { kind: "charger"; lon: number; lat: number; street: string | null }
  | { kind: "districtHeat"; segmentId: number; street: string; lon: number; lat: number }
  | { kind: "grid"; areaId: number; areaName: string; lon: number; lat: number; capacityPlans: number }
  | { kind: "publicSolar"; egid: string; name: string; lon: number; lat: number }
  | { kind: "measure"; measureId: string; title: string };

export interface LetterRequest {
  id: string;
  letterId: string;
  bloc: Bloc;
  atMs: number;
  deadlineMs: number;
  target: RequestTarget;
  /** What would answer it, in a few words ("a public charger near Badenerstrasse"). */
  ask: string;
  status: "open" | "granted" | "resolvedByOthers" | "lapsed";
  resolvedAtMs?: number;
}

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthStartMs(index: number): number {
  return toSimTimeMs(Date.UTC(Math.floor(index / 12), index % 12, 1));
}

function monthYearLabel(atMs: number): string {
  return new Date(toDateMs(atMs)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function metres(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dx = (aLon - bLon) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  const dy = (aLat - bLat) * 111_320;
  return Math.hypot(dx, dy);
}

function streetOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const m = /^(.*?)\s+\d/.exec(address);
  return m ? m[1] : address;
}

class Letters {
  private town = "";
  private seed = "letters";
  private buildingsProvider: () => Building[] = () => [];
  private realPlants: PowerPlant[] = [];
  private requests: LetterRequest[] = [];
  private lastReport = new Map<keyof typeof REPORT_COOLDOWN_MONTHS, number>();
  private lastMood = new Map<Bloc, number>();
  private lastMonth: number | null = null;
  private lastDay: number | null = null;
  private counter = 0;
  private unsubscribers: (() => void)[] = [];
  private readonly listeners = new Set<() => void>();

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribers.forEach((u) => u());
    this.town = dataset.name;
    this.seed = seed;
    this.buildingsProvider = buildingsProvider;
    this.realPlants = dataset.powerPlants;
    this.requests = [];
    this.lastReport = new Map();
    this.lastMood = new Map();
    this.counter = 0;
    const now = simClock.getSimTimeMs();
    this.lastMonth = monthIndex(now);
    this.lastDay = Math.floor(now / DAY_MS);
    this.unsubscribers = [
      simClock.subscribe(() => this.advance(simClock.getSimTimeMs())),
      measures.onEvent((e) => this.onMeasureEvent(e)),
      approval.onEvent((e) => this.onApprovalEvent(e)),
    ];
    const welcome = welcomeText(this.town);
    this.post({ atMs: now, kind: "welcome", bloc: null, from: `The Town Clerk of ${this.town}`, role: "", ...welcome });
  }

  getRequests(): LetterRequest[] {
    return this.requests;
  }

  getRequest(id: string): LetterRequest | undefined {
    return this.requests.find((r) => r.id === id);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Requests answered, lapsed or sorted out by others in `[fromMs, toMs)` — for the paper. */
  resolvedIn(fromMs: number, toMs: number): LetterRequest[] {
    return this.requests.filter((r) => r.resolvedAtMs !== undefined && r.resolvedAtMs >= fromMs && r.resolvedAtMs < toMs);
  }

  // --- time ---

  private advance(nowMs: number): void {
    if (approval.getGameOver()) return;
    const day = Math.floor(nowMs / DAY_MS);
    if (day !== this.lastDay) {
      this.lastDay = day;
      this.checkRequests(nowMs);
    }
    const month = monthIndex(nowMs);
    if (this.lastMonth === null || month <= this.lastMonth) return;
    // A long jump writes only the latest month's letters.
    const first = Math.max(this.lastMonth + 1, month);
    for (let m = first; m <= month; m++) this.monthly(m);
    this.lastMonth = month;
  }

  /** A new month: what happened in the last one, moods, and perhaps a request — dated across the month. */
  private monthly(month: number): void {
    const start = monthStartMs(month);
    const rng = mulberry32(hashSeed(this.seed, "month", String(month)));
    this.reports(month - 1, start, rng);
    this.heatOffers(month - 1);
    this.moods(month, start, rng);
    if (rng() < REQUEST_CHANCE_PER_MONTH) this.maybeRequest(start, rng);
  }

  // --- reactions ---

  private onMeasureEvent(e: MeasureEvent): void {
    if (e.kind !== "enacted" && e.kind !== "repealed") return;
    const stances = e.def.approval?.(e.params) ?? {};
    // A repeal reverses how each group feels about it.
    const sign = e.kind === "repealed" ? -1 : 1;
    this.react(stances, sign, e.def.title, e.kind, e.atMs, e.id);
  }

  private onApprovalEvent(e: ApprovalEvent): void {
    if (e.kind === "voteHeld") {
      const until = measures.moratoriumUntilMs(e.key, e.atMs + 1);
      this.post({ atMs: e.atMs, kind: "voteResult", bloc: null, from: `The Town Clerk of ${this.town}`, role: "", ...voteResultText(e.title, e.accepted, e.yesShare, until !== null ? monthYearLabel(until) : null) });
      return;
    }
    if (e.kind !== "voteScheduled") return;
    const ranked = BLOC_ORDER.map((b) => ({ b, s: e.stances[b] ?? 0 })).sort((x, y) => x.s - y.s);
    const when = monthYearLabel(e.voteAtMs);
    const rng = mulberry32(hashSeed(this.seed, "campaign", e.key, String(e.atMs | 0)));
    const against = ranked[0];
    const forIt = ranked[ranked.length - 1];
    if (against.s <= -REACTION_MIN_STANCE) {
      this.post({ atMs: e.atMs + (3 + Math.floor(rng() * 10)) * DAY_MS, kind: "campaign", ...this.organisation(against.b), ...campaignText(against.b, false, e.title, when) });
    }
    if (forIt.s >= REACTION_MIN_STANCE) {
      this.post({ atMs: e.atMs + (5 + Math.floor(rng() * 12)) * DAY_MS, kind: "campaign", ...this.organisation(forIt.b), ...campaignText(forIt.b, true, e.title, when) });
    }
  }

  private react(stances: Stances, sign: number, title: string, kind: "enacted" | "repealed", atMs: number, key: string): void {
    const rng = mulberry32(hashSeed(this.seed, "react", key, kind, String(atMs | 0)));
    const felt = BLOC_ORDER.map((b) => ({ b, s: (stances[b] ?? 0) * sign }))
      .filter((x) => Math.abs(x.s) >= REACTION_MIN_STANCE)
      .sort((x, y) => Math.abs(y.s) - Math.abs(x.s))
      .slice(0, 2);
    felt.forEach(({ b, s }, i) => {
      if (rng() >= REACTION_CHANCE * (i === 0 ? 1 : 0.5)) return;
      const [lo, hi] = REACTION_DELAY_DAYS;
      const delay = (lo + Math.floor(rng() * (hi - lo + 1))) * DAY_MS;
      this.post({ atMs: atMs + delay, kind: "reaction", ...this.sender(b, rng), ...reactionText(b, s > 0, title, kind, [rng()]) });
    });
  }

  // --- moods ---

  private moods(month: number, start: number, rng: () => number): void {
    const levels = approval.getBlocLevels();
    const fiscal = approval.fiscalPenaltyPoints(start);
    let written = 0;
    for (const b of [...BLOC_ORDER].sort(() => rng() - 0.5)) {
      if (written >= MOOD_LETTERS_PER_MONTH) break;
      if (month - (this.lastMood.get(b) ?? -Infinity) < MOOD_LETTER_COOLDOWN_MONTHS) continue;
      const level = levels[b];
      const chance = Math.min(MOOD_LETTER_MAX_CHANCE, MOOD_LETTER_BASE_CHANCE + MOOD_LETTER_CHANCE_PER_POINT * Math.abs(level - MOOD_NEUTRAL));
      if (rng() >= chance) continue;
      const read = level + (rng() * 2 - 1) * MOOD_NOISE_POINTS; // the letter's view, not the truth
      const mood: Mood | null = read < MOOD_ANGRY_BELOW ? "angry" : read < MOOD_UNHAPPY_BELOW ? "unhappy" : read >= MOOD_PLEASED_FROM ? "pleased" : null;
      if (!mood) continue;
      let cause: MoodCause = null;
      if (mood !== "pleased" && debt.debtYears(start) > 2.5 && (b === "homeowners" || b === "business") && rng() < 0.6) cause = { kind: "debt" };
      else if (mood !== "pleased" && fiscal > 3 && (b === "homeowners" || b === "business") && rng() < 0.6) cause = { kind: "spending" };
      else {
        const feeling = approval.strongestFeeling(b, mood === "pleased" ? 1 : -1);
        if (feeling) cause = { kind: "measure", title: feeling.def.title, likes: feeling.stance > 0 };
      }
      this.post({ atMs: start + Math.floor(rng() * 26) * DAY_MS, kind: "mood", ...this.organisation(b), ...moodText(b, mood, cause, rng()) });
      this.lastMood.set(b, month);
      written++;
    }
  }

  // --- offers ---

  /** A factory offering its waste heat for district heating (districtHeatSources.ts), dated the day
   * the offer was made. */
  private heatOffers(month: number): void {
    const from = monthStartMs(month);
    const to = monthStartMs(month + 1);
    for (const c of districtHeat.getCandidates()) {
      if (c.kind !== "industry") continue;
      const atMs = districtHeatSources.offerAtMs(c);
      if (atMs < from || atMs >= to) continue;
      const b = c.egid ? this.buildingsProvider().find((x) => x.egid === c.egid) : undefined;
      const quote = districtHeatSources.candidateQuote(c, atMs);
      const where = b?.address ?? "our site";
      const name = candidateName(c);
      this.post({
        atMs,
        kind: "offer",
        bloc: "business",
        from: `${name}, ${where}`,
        role: "",
        focus: { lon: c.lon, lat: c.lat, egid: c.egid },
        ...heatOfferText(name, Math.round(c.potentialMwh ?? 0), quote.sizeMw, quote.yearlyRp, quote.capexRp, districtHeat.servesAt(b?.streetSegments, atMs)),
      });
    }
  }

  // --- reports ---

  private reports(month: number, start: number, rng: () => number): void {
    const from = monthStartMs(month);
    const to = monthStartMs(month + 1);
    const candidates: (() => void)[] = [];
    const buildings = this.buildingsProvider();
    // The same complaint doesn't come every month.
    const due = (kind: keyof typeof REPORT_COOLDOWN_MONTHS) => month - (this.lastReport.get(kind) ?? -Infinity) >= REPORT_COOLDOWN_MONTHS[kind];
    const mark = (kind: keyof typeof REPORT_COOLDOWN_MONTHS) => this.lastReport.set(kind, month);

    // Heat pumps refused, and boilers allowed despite a ban.
    const refused: { b: Building; record: ReturnType<typeof heatingRenewalsInRange>[number] }[] = [];
    let exceptions = 0;
    for (const b of buildings) {
      for (const record of heatingRenewalsInRange(b, from, to)) {
        if (record.exception) exceptions++;
        if (record.preferred && (record.preferred === "airHeatPump" || record.preferred === "groundHeatPump") && record.system !== record.preferred) refused.push({ b, record });
      }
    }
    if (refused.length > 0 && due("refused")) {
      const { b, record } = refused[Math.floor(rng() * refused.length)];
      candidates.push(() => {
        mark("refused");
        const at = record.installedAtMs;
        const got = articleFor(record.system);
        let kind: "ground" | "air" | "grid";
        let detail: string;
        if (gridDrawBlockedAt(b, at)) {
          kind = "grid";
          detail = `the utility says the transformer station for the ${grid.getArea(grid.areaIdOf(b))?.name ?? "local"} area is full and can't take another one`;
        } else if (record.preferred === "groundHeatPump") {
          kind = "ground";
          const source = heatPumpSiting.groundSource(b, at);
          detail = source.kind === "none" ? source.reason : "it wasn't allowed here";
        } else {
          kind = "air";
          detail = "the outdoor unit would be too loud for our neighbours, even installed indoors";
        }
        this.post({
          atMs: start + Math.floor(rng() * 20) * DAY_MS,
          kind: "report",
          bloc: "homeowners",
          from: this.personName(rng),
          role: `owner, ${b.address ?? "in town"}`,
          focus: { lon: b.lon, lat: b.lat, egid: b.egid },
          ...refusedHeatPumpText(kind, detail, got, b.address ?? "our house"),
        });
      });
    }
    if (exceptions > 0 && due("exceptions")) {
      candidates.push(() => mark("exceptions") && this.post({ atMs: start + Math.floor(rng() * 20) * DAY_MS, kind: "report", ...this.organisation("climate"), ...fossilExceptionsText(exceptions) }));
    }

    // Nowhere to charge.
    const spots = publicCharging.unmetDemandSpots(from, to).filter((s) => s.kind === "ac");
    if (spots.length >= 2 && due("noCharger")) {
      const spot = spots[Math.floor(rng() * spots.length)];
      const street = streets.snapToStreet(spot.lon, spot.lat)?.street ?? null;
      const near = spots.filter((s) => metres(s.lon, s.lat, spot.lon, spot.lat) < 500).length;
      candidates.push(() =>
        mark("noCharger") &&
        this.post({
          atMs: start + Math.floor(rng() * 20) * DAY_MS,
          kind: "report",
          bloc: "drivers",
          from: this.personName(rng),
          role: `car owner${street ? `, ${street}` : ""}`,
          focus: { lon: spot.lon, lat: spot.lat },
          ...noChargerText(street, near),
        }),
      );
    }

    for (const write of candidates.sort(() => rng() - 0.5).slice(0, REPORT_LETTERS_PER_MONTH)) write();
  }

  // --- requests ---

  private maybeRequest(start: number, rng: () => number): void {
    const open = this.requests.filter((r) => r.status === "open");
    if (open.length >= MAX_OPEN_REQUESTS) return;
    const all = this.requestOptions(start, open);
    // Prefer something nobody is already waiting for.
    const fresh = all.filter((o) => !open.some((r) => r.target.kind === o.target.kind));
    const options = fresh.length > 0 ? fresh : all;
    if (options.length === 0) return;
    const { bloc, target, ask, focus } = options[Math.floor(rng() * options.length)];
    const atMs = start + Math.floor(rng() * 24) * DAY_MS;
    const deadlineMs = atMs + REQUEST_DEADLINE_MONTHS[target.kind] * MONTH_MS;
    const id = `request-${++this.counter}`;
    const label = target.kind === "charger" ? (target.street ?? "our street") : target.kind === "districtHeat" ? target.street : target.kind === "grid" ? target.areaName : target.kind === "publicSolar" ? target.name : target.title;
    const text = requestText(target.kind, label, monthYearLabel(deadlineMs));
    const sender = target.kind === "measure" || target.kind === "grid" ? this.organisation(bloc) : this.sender(bloc, rng, target.kind === "charger" || target.kind === "districtHeat" ? label : undefined);
    const letter = this.post({ atMs, kind: "request", ...sender, ...text, focus, requestId: id });
    this.requests.push({ id, letterId: letter.id, bloc, atMs, deadlineMs, target, ask, status: "open" });
    this.listeners.forEach((l) => l());
  }

  private requestOptions(atMs: number, open: LetterRequest[]): { bloc: Bloc; target: RequestTarget; ask: string; focus?: { lon: number; lat: number; egid?: string } }[] {
    const options: { bloc: Bloc; target: RequestTarget; ask: string; focus?: { lon: number; lat: number; egid?: string } }[] = [];
    const taken = (pred: (t: RequestTarget) => boolean) => open.some((r) => pred(r.target));
    const buildings = this.buildingsProvider().filter((b) => existsAt(b, atMs));

    // A charger where households found none in the last half year.
    const spots = publicCharging.unmetDemandSpots(atMs - 6 * MONTH_MS, atMs).filter((s) => s.kind === "ac");
    let best: { lon: number; lat: number; n: number } | null = null;
    for (const s of spots) {
      const n = spots.filter((o) => metres(o.lon, o.lat, s.lon, s.lat) < REACH_M.ac).length;
      if (!best || n > best.n) best = { lon: s.lon, lat: s.lat, n };
    }
    if (best && best.n >= CHARGER_REQUEST_MIN_UNMET && !taken((t) => t.kind === "charger" && metres(t.lon, t.lat, best.lon, best.lat) < 2 * REACH_M.ac)) {
      const street = streets.snapToStreet(best.lon, best.lat)?.street ?? null;
      options.push({ bloc: "drivers", target: { kind: "charger", lon: best.lon, lat: best.lat, street }, ask: `a public charger near ${street ?? "their street"}`, focus: { lon: best.lon, lat: best.lat } });
    }

    // District heating along a street next to the network, where gas and oil still heat.
    const fossilBySegment = new Map<number, Building[]>();
    for (const b of buildings) {
      const system = currentHeatingSystemId(b, atMs);
      if (system !== "gasBoiler" && system !== "oilBoiler") continue;
      if (districtHeat.servesAt(b.streetSegments, atMs) || districtHeat.buildingAt(b.streetSegments, atMs)) continue;
      for (const seg of b.streetSegments ?? []) {
        if (!this.nextToNetwork(seg, atMs)) continue;
        fossilBySegment.set(seg, [...(fossilBySegment.get(seg) ?? []), b]);
      }
    }
    const dhBest = [...fossilBySegment.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (dhBest && dhBest[1].length >= DH_REQUEST_MIN_BUILDINGS) {
      const street = streets.get(dhBest[0])?.name ?? streetOf(dhBest[1][0].address) ?? "our street";
      const b = dhBest[1][0];
      if (!taken((t) => t.kind === "districtHeat" && t.segmentId === dhBest[0])) {
        options.push({
          bloc: "homeowners",
          target: { kind: "districtHeat", segmentId: dhBest[0], street, lon: b.lon, lat: b.lat },
          ask: `district heating along ${street}`,
          focus: { lon: b.lon, lat: b.lat, egid: b.egid },
        });
      }
    }

    // A full transformer area, with nothing ordered for it.
    for (const area of grid.getAreas()) {
      const { drawKw } = grid.effectivePeaks(area, atMs);
      const planned = area.upgrades.some((u) => u.atMs > atMs) || area.batteries.some((u) => u.atMs > atMs);
      if (drawKw <= grid.capacityAt(area, atMs) || planned || taken((t) => t.kind === "grid" && t.areaId === area.id)) continue;
      options.push({
        bloc: "homeowners",
        target: { kind: "grid", areaId: area.id, areaName: area.name, lon: area.lon, lat: area.lat, capacityPlans: area.upgrades.length + area.batteries.length },
        ask: `a reinforced grid in the ${area.name} area`,
        focus: { lon: area.lon, lat: area.lat },
      });
      break;
    }

    // Solar on a public building.
    const roofs = municipalSolarCandidates(buildings, this.realPlants, atMs).filter((b) => !taken((t) => t.kind === "publicSolar" && t.egid === b.egid));
    if (roofs.length > 0) {
      const b = roofs[hashSeed(this.seed, "roof", String(atMs | 0)) % roofs.length];
      const name = `the ${publicBuildingKind(b).toLowerCase()} at ${b.address ?? "the town centre"}`;
      options.push({ bloc: "climate", target: { kind: "publicSolar", egid: b.egid, name, lon: b.lon, lat: b.lat }, ask: `solar panels on ${name}`, focus: { lon: b.lon, lat: b.lat, egid: b.egid } });
    }

    // A measure the unhappiest group wants.
    const levels = approval.getBlocLevels();
    for (const bloc of [...BLOC_ORDER].sort((a, b) => levels[a] - levels[b])) {
      const wanted = MEASURE_CATALOG.filter((def) => (def.approval?.(defaultParams(def))[bloc] ?? 0) >= 0.4)
        .filter((def) => !measures.getState(def.id) && measureUnavailableReason(def.id, atMs) === null && !taken((t) => t.kind === "measure" && t.measureId === def.id))
        .sort((a, b) => (b.approval?.(defaultParams(b))[bloc] ?? 0) - (a.approval?.(defaultParams(a))[bloc] ?? 0));
      if (wanted.length > 0) {
        options.push({ bloc, target: { kind: "measure", measureId: wanted[0].id, title: wanted[0].title }, ask: `"${wanted[0].title}"` });
        break;
      }
    }
    return options;
  }

  private nextToNetwork(segmentId: number, atMs: number): boolean {
    if (districtHeat.stateAt(segmentId, atMs) !== "none") return false;
    for (const node of streets.nodesOf(segmentId)) {
      for (const other of streets.atNode(node)) if (other !== segmentId && districtHeat.stateAt(other, atMs) === "piped") return true;
    }
    return false;
  }

  /** Has an open request been answered, sorted out by others, or run out of time? */
  private checkRequests(nowMs: number): void {
    let changed = false;
    for (const r of this.requests) {
      if (r.status !== "open" || nowMs < r.atMs) continue;
      const outcome = this.outcome(r, nowMs);
      if (outcome === "open" && nowMs < r.deadlineMs) continue;
      r.status = outcome === "open" ? "lapsed" : outcome;
      r.resolvedAtMs = nowMs;
      changed = true;
      const original = inbox.getLetter(r.letterId);
      const sender = original ? { bloc: original.bloc, from: original.from, role: original.role } : this.organisation(r.bloc);
      const text: LetterText = r.status === "granted" ? grantedText(r.ask) : r.status === "lapsed" ? lapsedText(r.ask) : resolvedByOthersText(r.ask);
      if (r.status === "granted") approval.goodwill(r.bloc, REQUEST_GRANTED_POINTS);
      if (r.status === "lapsed") approval.goodwill(r.bloc, REQUEST_LAPSED_POINTS);
      this.post({ atMs: nowMs + 2 * DAY_MS, kind: "followUp", ...sender, ...text, requestId: r.id });
    }
    if (changed) this.listeners.forEach((l) => l());
  }

  private outcome(r: LetterRequest, nowMs: number): "open" | "granted" | "resolvedByOthers" {
    const t = r.target;
    switch (t.kind) {
      case "charger": {
        const site = publicCharging
          .getSites()
          .find((s) => s.kind === "ac" && s.openedAtMs >= r.atMs - 30 * DAY_MS && metres(s.lon, s.lat, t.lon, t.lat) <= REACH_M.ac && (s.owner === "municipal" || s.openedAtMs <= nowMs));
        if (!site) return "open";
        return site.owner === "municipal" ? "granted" : "resolvedByOthers";
      }
      case "districtHeat":
        return districtHeat.stateAt(t.segmentId, nowMs) !== "none" ? "granted" : "open";
      case "grid": {
        const area = grid.getArea(t.areaId);
        return area && area.upgrades.length + area.batteries.length > t.capacityPlans ? "granted" : "open";
      }
      case "publicSolar": {
        const b = this.buildingsProvider().find((x) => x.egid === t.egid);
        if (!b || !solarStatusOf(b, this.realPlants)) return "open";
        return isMunicipalSolar(b.egid) ? "granted" : "resolvedByOthers";
      }
      case "measure":
        return measures.getState(t.measureId) ? "granted" : "open";
    }
  }

  // --- senders ---

  private post(letter: Omit<Letter, "id">): Letter {
    const full: Letter = { ...letter, id: `letter-${++this.counter}` };
    inbox.addLetter(full);
    return full;
  }

  private personName(rng: () => number): string {
    return `${FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]}`;
  }

  private organisation(bloc: Bloc): { bloc: Bloc; from: string; role: string } {
    return { bloc, from: BLOC_SENDERS[bloc].organisation.replace("{town}", this.town), role: "" };
  }

  /** An organisation or one of the group's members (on a given street, or a random one). */
  private sender(bloc: Bloc, rng: () => number, street?: string): { bloc: Bloc; from: string; role: string } {
    if (!street && rng() < ORGANISATION_SHARE) return this.organisation(bloc);
    const roles = BLOC_SENDERS[bloc].individual;
    const role = roles[Math.floor(rng() * roles.length)];
    const where = street ?? streetOf(this.randomAddress(rng));
    return { bloc, from: this.personName(rng), role: where ? `${role}, ${where}` : role };
  }

  private randomAddress(rng: () => number): string | null {
    const buildings = this.buildingsProvider();
    return buildings.length > 0 ? (buildings[Math.floor(rng() * buildings.length)].address ?? null) : null;
  }

  // --- saving (saveGame.ts) ---

  snapshot() {
    return { requests: this.requests, lastReport: this.lastReport, lastMood: this.lastMood, lastMonth: this.lastMonth, lastDay: this.lastDay, counter: this.counter };
  }

  restore(s: ReturnType<Letters["snapshot"]>): void {
    this.requests = s.requests;
    this.lastReport = s.lastReport;
    this.lastMood = s.lastMood;
    this.lastMonth = s.lastMonth;
    this.lastDay = s.lastDay;
    this.counter = s.counter;
    this.listeners.forEach((l) => l());
  }
}

function articleFor(id: HeatingSystemId): string {
  if (id === "districtHeating") return "a district heating connection";
  const label = HEATING_SYSTEM_CATALOG[id].label.toLowerCase();
  return (/^[aeiou]/.test(label) ? "an " : "a ") + label;

}

export const letters = new Letters();
