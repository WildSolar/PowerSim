/**
 * The municipal treasury's event ledger. Money leaves the treasury only when a
 * decision actually happens: the moment a household installs a subsidised heat pump,
 * buys a subsidised EV, retrofits its envelope or puts up solar panels, the winning
 * option's municipal subsidy is recorded here as a payout dated to that decision
 * (renewal.ts and solarAdoption.ts call recordPayout as they commit). Nothing is
 * "budgeted" or reserved up front, and a subsidy nobody takes up costs nothing —
 * which is also why free-riders (people who would have decided the same way
 * anyway) cost real money: the payout depends on the decision, not on whether the
 * subsidy changed it.
 *
 * Income is the annual allocation from the overall government (finances.ts), and the
 * electricity operations settle once a year. This module only knows the payouts.
 *
 * Decisions in this codebase commit lazily (a chain is only settled when something
 * queries it), so before a period is summed the payouts due in it have to be
 * settled: settleThrough asks whoever registered as the settler (stock.ts) to touch
 * every decision chain up to that moment.
 */

import { GOVERNMENT_ALLOCATION_CHF_PER_RESIDENT, INITIAL_TREASURY_CHF, RESIDENTS_PER_DWELLING } from "../config/treasury";
import type { DecisionLogKind } from "./decisionLog";

// Subsidies paid as households decide, plus what the municipality itself spends: the running and
// one-off costs of campaigns and programmes, money put into infrastructure, and the cost of debt
// (debt.ts): interest, and repaying what was borrowed.
export type PayoutCategory =
  | "solar"
  | "heating"
  | "vehicle"
  | "retrofit"
  | "programs"
  | "infrastructure"
  | "districtHeat"
  | "charging"
  | "zoning"
  | "grid"
  | "interest"
  | "debtRepayment";

export const PAYOUT_CATEGORIES: PayoutCategory[] = [
  "solar",
  "heating",
  "vehicle",
  "retrofit",
  "programs",
  "infrastructure",
  "districtHeat",
  "charging",
  "zoning",
  "grid",
  "interest",
  "debtRepayment",
];

/** Investments (as Swiss municipal accounts, HRM2, set them apart): infrastructure that lasts —
 * they may be financed with loans and don't count as running spending. */
export const INVESTMENT_CATEGORIES: PayoutCategory[] = ["infrastructure", "districtHeat", "charging", "grid"];

/** Running spending: what has to be covered by income — every payout but investments and
 * repaying debt (interest is running spending). */
export function isOperatingCategory(category: PayoutCategory): boolean {
  return !INVESTMENT_CATEGORIES.includes(category) && category !== "debtRepayment";
}

export const PAYOUT_LABEL: Record<PayoutCategory, string> = {
  solar: "Solar and battery subsidies",
  heating: "Heat pump subsidies",
  vehicle: "Electric vehicle subsidies",
  retrofit: "Insulation retrofit subsidies",
  programs: "Campaigns and programmes",
  infrastructure: "Municipal infrastructure",
  districtHeat: "District heating network extensions",
  charging: "Public chargers",
  zoning: "Zoning plans",
  grid: "Grid reinforcement and batteries",
  interest: "Interest on debt",
  debtRepayment: "Debt repaid",
};

/** Which ledger line a decision kind's municipal subsidy belongs on, if it has one. */
export function subsidyCategoryForDecision(kind: DecisionLogKind): PayoutCategory | null {
  switch (kind) {
    case "heating":
      return "heating";
    case "retrofit":
      return "retrofit";
    case "solar":
      return "solar";
    case "mobility-vehicle-car":
    case "mobility-vehicle-bike":
      return "vehicle";
    default:
      return null;
  }
}

interface Payout {
  atMs: number;
  category: PayoutCategory;
  amountRp: number;
  egid: string;
}

export type PayoutsByCategory = Record<PayoutCategory, number>;

function zeroPayouts(): PayoutsByCategory {
  return { solar: 0, heating: 0, vehicle: 0, retrofit: 0, programs: 0, infrastructure: 0, districtHeat: 0, charging: 0, zoning: 0, grid: 0, interest: 0, debtRepayment: 0 };
}

/** Money coming in outside the yearly accounts: the value-capture levy on zoning gains (zoning.ts),
 * due when a project that gains from a zoning change gets its permit, and borrowed money (debt.ts). */
export type ReceiptKind = "zoningLevy" | "borrowing";

interface Receipt {
  atMs: number;
  amountRp: number;
  ref: string;
  kind: ReceiptKind;
}

class Treasury {
  private payouts: Payout[] = [];
  private receipts: Receipt[] = [];
  private version = 0;
  private bookedVersion = 0;
  private readonly listeners = new Set<() => void>();
  private settler: ((atMs: number) => void) | null = null;
  private openingMultiplier = 1;
  private allocationMultiplier = 1;

  /** The difficulty scales the starting cash and the government's yearly allocation. */
  setDifficulty(spec: { openingTreasuryMultiplier: number; governmentAllocationMultiplier: number }): void {
    this.openingMultiplier = spec.openingTreasuryMultiplier;
    this.allocationMultiplier = spec.governmentAllocationMultiplier;
    this.notify();
  }

  /** `approvalFactor` is approval.ts's allocationApprovalFactor for the year in question. */
  allocationRp(dwellingCount: number, approvalFactor = 1): number {
    return Math.round(dwellingCount * RESIDENTS_PER_DWELLING * GOVERNMENT_ALLOCATION_CHF_PER_RESIDENT * this.allocationMultiplier * approvalFactor * 100);
  }

  /** A fresh game: forget every payout. */
  reset(): void {
    this.payouts = [];
    this.receipts = [];
    this.notify();
  }

  recordPayout(category: PayoutCategory, atMs: number, amountRp: number, egid: string): void {
    if (!(amountRp > 0)) return;
    this.payouts.push({ atMs, category, amountRp, egid });
    this.notify();
  }

  recordReceipt(atMs: number, amountRp: number, ref: string, kind: ReceiptKind = "zoningLevy"): void {
    if (!(amountRp > 0)) return;
    this.receipts.push({ atMs, amountRp, ref, kind });
    this.notify();
  }

  /** Received in `[fromMs, toMs)`: of one kind, or all. */
  received(fromMs: number, toMs: number, kind?: ReceiptKind): number {
    let total = 0;
    for (const r of this.receipts) if (r.atMs >= fromMs && r.atMs < toMs && (!kind || r.kind === kind)) total += r.amountRp;
    return total;
  }

  /** Total paid out per category in `[fromMs, toMs)`. */
  paidOut(fromMs: number, toMs: number): PayoutsByCategory {
    const totals = zeroPayouts();
    for (const p of this.payouts) if (p.atMs >= fromMs && p.atMs < toMs) totals[p.category] += p.amountRp;
    return totals;
  }

  paidOutTotal(fromMs: number, toMs: number): number {
    const totals = this.paidOut(fromMs, toMs);
    return PAYOUT_CATEGORIES.reduce((sum, c) => sum + totals[c], 0);
  }

  /** Running spending only (no investments, no repayments) in `[fromMs, toMs)`. */
  operatingPaidOutTotal(fromMs: number, toMs: number): number {
    const totals = this.paidOut(fromMs, toMs);
    return PAYOUT_CATEGORIES.filter(isOperatingCategory).reduce((sum, c) => sum + totals[c], 0);
  }

  /** Investments in `[fromMs, toMs)`. */
  investedTotal(fromMs: number, toMs: number): number {
    const totals = this.paidOut(fromMs, toMs);
    return INVESTMENT_CATEGORIES.reduce((sum, c) => sum + totals[c], 0);
  }

  /** Cash the treasury starts the game with. */
  openingBalanceRp(): number {
    return Math.round(INITIAL_TREASURY_CHF * this.openingMultiplier * 100);
  }

  setSettler(settler: (atMs: number) => void): void {
    this.settler = settler;
  }

  /** Makes sure every decision due before `atMs` has been committed (and so has recorded its payout). */
  settleThrough(atMs: number): void {
    this.settler?.(atMs);
  }

  getVersion(): number {
    return this.version;
  }

  /** Changes only when a year's accounts are booked (finances.ts), not on every payout. */
  getBookedVersion(): number {
    return this.bookedVersion;
  }

  /** A year's finances have just been computed and cached. */
  notifyBooked(): void {
    this.bookedVersion++;
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Also called when a year's finances finish computing, so live readouts refresh. */
  notify(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export const treasury = new Treasury();
