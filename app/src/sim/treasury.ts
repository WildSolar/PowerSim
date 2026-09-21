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
// one-off costs of campaigns and programmes, and money put into infrastructure.
export type PayoutCategory = "solar" | "heating" | "vehicle" | "retrofit" | "programs" | "infrastructure";

export const PAYOUT_CATEGORIES: PayoutCategory[] = ["solar", "heating", "vehicle", "retrofit", "programs", "infrastructure"];

export const PAYOUT_LABEL: Record<PayoutCategory, string> = {
  solar: "Solar subsidies",
  heating: "Heat pump subsidies",
  vehicle: "Electric vehicle subsidies",
  retrofit: "Insulation retrofit subsidies",
  programs: "Campaigns and programmes",
  infrastructure: "Municipal infrastructure",
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
  return { solar: 0, heating: 0, vehicle: 0, retrofit: 0, programs: 0, infrastructure: 0 };
}

class Treasury {
  private payouts: Payout[] = [];
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
    this.notify();
  }

  recordPayout(category: PayoutCategory, atMs: number, amountRp: number, egid: string): void {
    if (!(amountRp > 0)) return;
    this.payouts.push({ atMs, category, amountRp, egid });
    this.notify();
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
