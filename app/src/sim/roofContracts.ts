/**
 * Roof contracts: the utility rents large roofs and puts its own solar on them — a lever real Swiss
 * utilities use to speed solar up where owners won't invest themselves.
 *
 * The player offers a rent (per m² of roof the panels cover, a year) to the owner of a large roof,
 * one at a time or to every eligible roof at once. The owner answers within weeks:
 *
 *  - Builds their own: the letter makes some look into solar themselves, and for some of those it
 *    pencils out (solarAdoption.ts's own decision, taken there and then). The utility is out, the
 *    roof isn't.
 *  - Accepts: the rent beats what they want for their roof (drawn per owner). The utility then has a
 *    year to build — at the price the owner would pay, less the federal payment, as an investment —
 *    or the contract lapses.
 *  - Declines: they won't hear of it again for a few years.
 *
 * The arrays are the utility's: what they make saves buying power at the wholesale price (no feed-in
 * is paid for them), against the rent and their upkeep (finances.ts).
 */

import {
  OWNER_ASK_LOG_SPREAD,
  OWNER_ASK_MEDIAN_CHF_PER_M2,
  OWNER_ASK_OFFER_NOISE,
  OWNER_PROMPTED_SHARE,
  ROOF_ANSWER_DAYS,
  ROOF_BUILD_WITHIN_MONTHS,
  ROOF_CONTRACT_MIN_FOOTPRINT_M2,
  ROOF_DECLINE_COOLDOWN_YEARS,
  ROOF_INSTALL_MONTHS,
  ROOF_RENT_DEFAULT_CHF_PER_M2,
  ROOF_UPKEEP_CHF_PER_KWP_YEAR,
} from "../config/roofContracts";
import type { Building, MunicipalityDataset, PowerPlant } from "../data/types";
import { toDateMs, toSimTimeMs, formatDate } from "./calendar";
import { simClock } from "./engine";
import { spendingFrozen } from "./fiscalRules";
import { inbox } from "./inbox";
import { existsAt } from "./lifetime";
import { market } from "./market";
import { isPublicBuilding } from "./publicBuildings";
import { hashSeed, mulberry32 } from "./rng";
import { considerOwnSolarNow, contractArrays, installContractSolar, roofArray, solarStatusOf, specificYieldKWhPerKwp } from "./solarAdoption";

const DAY_MS = 24 * 60 * 60_000;
const MONTH_MS = (365.25 * DAY_MS) / 12;
const YEAR_MS = 365.25 * DAY_MS;

export type ContractStatus = "offered" | "accepted" | "declined" | "ownSolar" | "built" | "lapsed";

export interface RoofContract {
  id: number;
  egid: string;
  /** The rent offered, CHF per m² of roof a year. */
  rentChfPerM2: number;
  offeredAtMs: number;
  /** When the owner answers (or answered). */
  answerAtMs: number;
  status: ContractStatus;
  /** Accepted: build by then, or it lapses. */
  buildByMs?: number;
  /** Built: the array, and the roof it covers. */
  orderedAtMs?: number;
  installedAtMs?: number;
  capacityKw?: number;
  areaM2?: number;
  costRp?: number;
}

/** What an offer at a given rent would mean for the utility, at today's prices. */
export interface RoofQuote {
  capacityKw: number;
  areaM2: number;
  /** Build cost less the federal payment, battery included (Rp). */
  costRp: number;
  batteryKwh: number | null;
  /** A year's output (kWh), and what it saves buying power at today's wholesale price (Rp). */
  yieldKWh: number;
  valueRp: number;
  rentRp: number;
  upkeepRp: number;
  /** Value less rent, upkeep and the build cost spread over the contract's term (Rp a year). */
  netRp: number;
}

export type RoofEligibility = { ok: true } | { ok: false; reason: string };

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

/** The standard normal distribution's cumulative function (Abramowitz-Stegun 7.1.26). */
function normalCdf(z: number): number {
  const t = 1 / (1 + 0.3275911 * (Math.abs(z) / Math.SQRT2));
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

class RoofContracts {
  private contracts: RoofContract[] = [];
  private rent = ROOF_RENT_DEFAULT_CHF_PER_M2;
  private autoBuild = true;
  private seed = "";
  private realPlants: PowerPlant[] = [];
  private buildingsProvider: () => Building[] = () => [];
  private lastDay = 0;
  private lastMonth = 0;
  private counter = 0;
  private unsubscribeClock: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  init(dataset: MunicipalityDataset, buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribeClock?.();
    this.contracts = [];
    this.rent = ROOF_RENT_DEFAULT_CHF_PER_M2;
    this.autoBuild = true;
    this.seed = seed;
    this.realPlants = dataset.powerPlants;
    this.buildingsProvider = buildingsProvider;
    this.counter = 0;
    const now = simClock.getSimTimeMs();
    this.lastDay = Math.floor(now / DAY_MS);
    this.lastMonth = monthIndex(now);
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    this.notify();
  }

  // --- the player's terms ---

  getRent(): number {
    return this.rent;
  }

  setRent(chfPerM2: number): void {
    this.rent = chfPerM2;
    this.notify();
  }

  getAutoBuild(): boolean {
    return this.autoBuild;
  }

  setAutoBuild(on: boolean): void {
    this.autoBuild = on;
    this.notify();
  }

  // --- roofs ---

  getContracts(): RoofContract[] {
    return this.contracts;
  }

  /** A building's latest contract, if it was ever offered one. */
  latest(egid: string): RoofContract | undefined {
    for (let i = this.contracts.length - 1; i >= 0; i--) if (this.contracts[i].egid === egid) return this.contracts[i];
    return undefined;
  }

  /** Whether a roof can be offered a contract at `atMs`, and if not, why. */
  eligibility(b: Building, atMs: number): RoofEligibility {
    if ((b.footprintAreaM2 ?? 0) < ROOF_CONTRACT_MIN_FOOTPRINT_M2) return { ok: false, reason: `Only roofs of buildings over ${ROOF_CONTRACT_MIN_FOOTPRINT_M2} m² are worth a contract.` };
    if (isPublicBuilding(b)) return { ok: false, reason: "A public building's roof is the municipality's own: put solar on it in the Public buildings layer." };
    if (!existsAt(b, atMs)) return { ok: false, reason: "The building isn't standing." };
    if (solarStatusOf(b, this.realPlants)) return { ok: false, reason: "It has solar already." };
    const c = this.latest(b.egid);
    if (c?.status === "offered") return { ok: false, reason: "The owner is considering your offer." };
    if (c?.status === "accepted") return { ok: false, reason: "The owner has accepted: build the array." };
    if (c && (c.status === "declined" || c.status === "lapsed")) {
      const again = this.askAgainAtMs(c);
      if (atMs < again) return { ok: false, reason: `The owner said no; you can ask again from ${formatDate(again).replace(/^\d+ /, "")}.` };
    }
    return { ok: true };
  }

  private askAgainAtMs(c: RoofContract): number {
    return (c.status === "lapsed" ? (c.buildByMs ?? c.answerAtMs) : c.answerAtMs) + ROOF_DECLINE_COOLDOWN_YEARS * YEAR_MS;
  }

  /** The large roofs that can be offered a contract at `atMs`. */
  eligibleRoofs(atMs: number): Building[] {
    return this.buildingsProvider().filter((b) => (b.footprintAreaM2 ?? 0) >= ROOF_CONTRACT_MIN_FOOTPRINT_M2 && this.eligibility(b, atMs).ok);
  }

  /** What an array on this roof would mean for the utility at `rent`, at `atMs`'s prices. */
  quote(b: Building, atMs: number, rent = this.rent): RoofQuote | null {
    const array = roofArray(b, atMs);
    if (!array) return null;
    const yieldKWh = array.capacityKw * specificYieldKWhPerKwp(atMs);
    const valueRp = yieldKWh * market.price("wholesale", atMs);
    const rentRp = rent * array.areaM2 * 100;
    const upkeepRp = array.capacityKw * ROOF_UPKEEP_CHF_PER_KWP_YEAR * 100;
    const costRp = Math.max(0, array.installCostRp - array.federalRp) + array.batteryRp;
    return {
      capacityKw: array.capacityKw,
      areaM2: array.areaM2,
      costRp,
      batteryKwh: array.battery?.kwh ?? null,
      yieldKWh,
      valueRp,
      rentRp,
      upkeepRp,
      netRp: valueRp - rentRp - upkeepRp - costRp / 25,
    };
  }

  // --- offering and building ---

  /** Offers this roof a contract at the current rent; the owner answers within weeks. */
  offer(b: Building, atMs: number): boolean {
    if (!this.eligibility(b, atMs).ok) return false;
    const rng = mulberry32(hashSeed(this.seed, "answer-day", b.egid, String(Math.floor(atMs / DAY_MS))));
    const [from, to] = ROOF_ANSWER_DAYS;
    this.contracts.push({
      id: ++this.counter,
      egid: b.egid,
      rentChfPerM2: this.rent,
      offeredAtMs: atMs,
      answerAtMs: atMs + (from + rng() * (to - from)) * DAY_MS,
      status: "offered",
    });
    this.notify();
    return true;
  }

  /** Offers every eligible roof a contract at the current rent; how many were asked. */
  offerAll(atMs: number): number {
    let n = 0;
    for (const b of this.eligibleRoofs(atMs)) if (this.offer(b, atMs)) n++;
    return n;
  }

  /** What offering every eligible roof at the current rent would likely bring: how many owners would
   * accept (the share whose ask the rent meets, less those who build their own), the arrays' size
   * and what building them would cost. An expectation, not a promise. */
  offerAllEstimate(atMs: number): { roofs: number; accepting: number; capacityKw: number; costRp: number } {
    const share = (1 - OWNER_PROMPTED_SHARE / 2) * normalCdf(Math.log(this.rent / OWNER_ASK_MEDIAN_CHF_PER_M2) / OWNER_ASK_LOG_SPREAD);
    let capacityKw = 0;
    let costRp = 0;
    const roofs = this.eligibleRoofs(atMs);
    for (const b of roofs) {
      const q = this.quote(b, atMs);
      if (!q) continue;
      capacityKw += q.capacityKw * share;
      costRp += q.costRp * share;
    }
    return { roofs: roofs.length, accepting: Math.round(roofs.length * share), capacityKw, costRp };
  }

  /** Builds the array on a roof whose owner accepted (paid now, in service a few months on). */
  build(egid: string, atMs: number): boolean {
    const c = this.latest(egid);
    const b = this.buildingsProvider().find((x) => x.egid === egid);
    if (!c || c.status !== "accepted" || !b || spendingFrozen(atMs)) return false;
    const built = installContractSolar(b, this.realPlants, atMs, ROOF_INSTALL_MONTHS);
    if (!built) return false;
    Object.assign(c, { status: "built", orderedAtMs: atMs, installedAtMs: built.installedAtMs, capacityKw: built.capacityKw, areaM2: built.areaM2, costRp: built.costRp });
    this.notify();
    return true;
  }

  // --- the money (finances.ts) ---

  /** What the arrays in service at `atMs` cost a year: the rent and their upkeep (Rp). */
  yearlyCostRp(atMs: number): number {
    let total = 0;
    for (const c of this.contracts) {
      if (c.status !== "built" || (c.installedAtMs ?? Infinity) > atMs) continue;
      total += (c.rentChfPerM2 * (c.areaM2 ?? 0) + (c.capacityKw ?? 0) * ROOF_UPKEEP_CHF_PER_KWP_YEAR) * 100;
    }
    return total;
  }

  /** A building's bucket on the Roof solar layer (colorModes.ts's ROOF_SOLAR_LEGEND). */
  bucket(b: Building, atMs: number): string {
    const c = this.latest(b.egid);
    if (c?.status === "built") return "utility";
    if (solarStatusOf(b, this.realPlants)) return "ownSolar";
    if ((b.footprintAreaM2 ?? 0) < ROOF_CONTRACT_MIN_FOOTPRINT_M2 || isPublicBuilding(b) || !existsAt(b, atMs)) return "other";
    if (c?.status === "accepted") return "accepted";
    if (c?.status === "offered") return "offered";
    if (c && (c.status === "declined" || c.status === "lapsed") && atMs < this.askAgainAtMs(c)) return "declined";
    return "eligible";
  }

  /** The utility's arrays (solarAdoption.ts keeps them). */
  arrays(): { egid: string; capacityKw: number; installedAtMs: number }[] {
    return contractArrays();
  }

  // --- time ---

  private advance(nowMs: number): void {
    const day = Math.floor(nowMs / DAY_MS);
    if (day === this.lastDay) return;
    this.lastDay = day;
    let changed = false;
    for (const c of this.contracts) {
      if (c.status === "offered" && c.answerAtMs <= nowMs) {
        this.answer(c, c.answerAtMs);
        changed = true;
      } else if (c.status === "accepted" && (c.buildByMs ?? Infinity) <= nowMs) {
        c.status = "lapsed";
        changed = true;
      }
    }
    const month = monthIndex(nowMs);
    if (month > this.lastMonth) {
      this.summaryLetter(this.lastMonth);
      this.lastMonth = month;
    }
    if (changed) this.notify();
  }

  /** What an owner wants for their roof (CHF per m² a year), drawn once per building. */
  private ownerAsk(egid: string): number {
    const rng = mulberry32(hashSeed(this.seed, "owner-ask", egid));
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rng()))) * Math.cos(2 * Math.PI * rng());
    return OWNER_ASK_MEDIAN_CHF_PER_M2 * Math.exp(OWNER_ASK_LOG_SPREAD * z);
  }

  private answer(c: RoofContract, atMs: number): void {
    const b = this.buildingsProvider().find((x) => x.egid === c.egid);
    if (!b || !existsAt(b, atMs)) {
      c.status = "declined";
      return;
    }
    const prompted = mulberry32(hashSeed(this.seed, "prompted", String(c.id)))() < OWNER_PROMPTED_SHARE;
    if (prompted && considerOwnSolarNow(b, this.realPlants, atMs)) {
      c.status = "ownSolar";
      return;
    }
    const mood = 1 + OWNER_ASK_OFFER_NOISE * (2 * mulberry32(hashSeed(this.seed, "offer-mood", String(c.id)))() - 1);
    if (c.rentChfPerM2 >= this.ownerAsk(c.egid) * mood) {
      c.status = "accepted";
      c.buildByMs = atMs + ROOF_BUILD_WITHIN_MONTHS * MONTH_MS;
      if (this.autoBuild) this.build(c.egid, atMs);
    } else {
      c.status = "declined";
    }
  }

  /** At each month's turn, the answers of the month before, in one letter from the utility. */
  private summaryLetter(month: number): void {
    const from = toSimTimeMs(Date.UTC(Math.floor(month / 12), month % 12, 1));
    const to = toSimTimeMs(Date.UTC(Math.floor((month + 1) / 12), (month + 1) % 12, 1));
    const answered = this.contracts.filter((c) => c.answerAtMs >= from && c.answerAtMs < to && c.status !== "offered");
    if (answered.length === 0) return;
    const lookup = new Map(this.buildingsProvider().map((b) => [b.egid, b]));
    const name = (c: RoofContract) => lookup.get(c.egid)?.address ?? `building ${c.egid}`;
    const list = (cs: RoofContract[]) => (cs.length <= 6 ? cs.map(name).join("; ") : `${cs.slice(0, 5).map(name).join("; ")} and ${cs.length - 5} more`);
    const accepted = answered.filter((c) => c.status === "accepted" || c.status === "built" || c.status === "lapsed");
    const built = accepted.filter((c) => c.status === "built");
    const own = answered.filter((c) => c.status === "ownSolar");
    const declined = answered.filter((c) => c.status === "declined");
    const paragraphs: string[] = [];
    if (accepted.length > 0) {
      const kw = built.reduce((sum, c) => sum + (c.capacityKw ?? 0), 0);
      paragraphs.push(
        `${accepted.length === 1 ? "One owner" : `${accepted.length} owners`} accepted our offer: ${list(accepted)}.` +
          (built.length === accepted.length
            ? ` We have ordered the panels — ${Math.round(kw)} kWp in all, in service in about ${ROOF_INSTALL_MONTHS} months.`
            : built.length > 0
              ? ` We have ordered panels for ${built.length} of them (${Math.round(kw)} kWp); the rest are waiting for your go-ahead, which has to come within a year.`
              : " The roofs are ours to build on for a year — give the go-ahead in the Roof solar layer."),
      );
    }
    if (own.length > 0) {
      paragraphs.push(`${own.length === 1 ? "One owner" : `${own.length} owners`} took our letter as a prompt to put up solar of their own: ${list(own)}. Not ours, but panels all the same.`);
    }
    if (declined.length > 0) {
      paragraphs.push(`${declined.length === 1 ? "One owner" : `${declined.length} owners`} declined: ${list(declined)}. A better rent might change some minds — in a few years, when we may ask again.`);
    }
    inbox.addLetter({
      id: `roof-contracts-${month}`,
      atMs: to,
      kind: "report",
      bloc: null,
      from: "The utility's solar team",
      role: "",
      subject: `Roof contracts: ${answered.length} answer${answered.length === 1 ? "" : "s"} in ${formatDate(from).replace(/^\d+ /, "")}`,
      paragraphs,
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
    return { contracts: this.contracts, rent: this.rent, autoBuild: this.autoBuild, counter: this.counter, lastDay: this.lastDay, lastMonth: this.lastMonth };
  }

  restore(s: ReturnType<RoofContracts["snapshot"]>): void {
    this.contracts = s.contracts;
    this.rent = s.rent;
    this.autoBuild = s.autoBuild;
    this.counter = s.counter;
    this.lastDay = s.lastDay;
    this.lastMonth = s.lastMonth;
    this.notify();
  }
}

export const roofContracts = new RoofContracts();
