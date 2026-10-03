/**
 * Borrowing. The energy department can borrow four ways:
 *
 *  - Bank loans: an amount and a term (5, 10 or 20 years), repaid in equal monthly instalments at the
 *    rate of the day — the market rate (interestRates.ts) plus a spread for the department's credit
 *    rating — fixed for the loan's life.
 *  - The overdraft: whenever the balance is below zero, interest is charged on it automatically, at a
 *    steep premium over the market.
 *  - Green bonds, offered to the town's own residents: they accept a little less than the market for
 *    a local green cause, and subscribe as much as they want to (more when the climate-minded are
 *    content), after a subscription period. Repaid in one go at the end, interest yearly meanwhile.
 *    The money is earmarked: as much has to go into green investment within two years — or the paper
 *    calls it greenwashing.
 *  - Federal decarbonisation loans: cheap and long, but only against decarbonisation investments
 *    already made (up to half of the last twelve months'), and only so much a year.
 *
 * Investments (infrastructure: grid, district heating, chargers, solar on public buildings) are what
 * borrowing is for; they don't count as running spending (treasury.ts). Interest does.
 *
 * Debt is measured against the department's income (its operating income before discretionary
 * spending, from the last booked year). The more indebted, the worse the rating and the dearer new
 * money; taxpayers start to worry (approval); and beyond the limit the canton puts the department
 * under supervision — no new borrowing, no new spending measures or orders — until debt is back down.
 */

import {
  BANK_LOAN_TERMS_YEARS,
  BANK_TERM_PREMIUM_PCT,
  DEBT_LIMIT_YEARS,
  DEBT_MAX_PENALTY_POINTS,
  DEBT_WORRY_FROM_YEARS,
  FEDERAL_LOAN_CHF_PER_RESIDENT_YEAR,
  FEDERAL_LOAN_PROCESSING_MONTHS,
  FEDERAL_LOAN_RATE_PCT,
  FEDERAL_LOAN_SHARE_OF_INVESTMENT,
  FEDERAL_LOAN_TERM_YEARS,
  GREEN_BOND_CHF_PER_RESIDENT,
  GREEN_BOND_DEMAND_RANGE,
  GREEN_BOND_DISCOUNT_PCT,
  GREEN_BOND_EARMARK_MONTHS,
  GREEN_BOND_GREENWASHING_POINTS,
  GREEN_BOND_ISSUE_GOODWILL,
  GREEN_BOND_MIN_MONTHS_APART,
  GREEN_BOND_SUBSCRIPTION_MONTHS,
  GREEN_BOND_TERM_YEARS,
  OVERDRAFT_PREMIUM_PCT,
  PROVISIONAL_INCOME_ALLOCATIONS,
  RATINGS,
  SUPERVISION_EXIT_SHARE,
} from "../config/borrowing";
import { RESIDENTS_PER_DWELLING } from "../config/treasury";
import type { Building } from "../data/types";
import { allocationApprovalFactor, approval, setDebtPenalty } from "./approval";
import { toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { latestBookedFinances, liveBalanceRp, operatingIncomeRp } from "./finances";
import { setSpendingFreeze } from "./fiscalRules";
import { interestRates } from "./interestRates";
import { existsAt } from "./lifetime";
import { treasury } from "./treasury";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;
const BASELINE_YEAR = new Date(toDateMs(0)).getUTCFullYear();

export type LoanKind = "bank" | "greenBond" | "federal";

export interface Loan {
  id: string;
  kind: LoanKind;
  /** Asked for (a green bond raises what residents subscribe, which may be less). */
  requestedRp: number;
  principalRp: number;
  outstandingRp: number;
  ratePct: number;
  termYears: number;
  orderedAtMs: number;
  /** When the money arrives (and repayments start). */
  startMs: number;
  status: "pending" | "active" | "repaid";
  /** A green bond's promise: as much green investment by the deadline. */
  earmark?: { deadlineMs: number; status: "open" | "met" | "missed" };
}

export type DebtEvent =
  | { kind: "loanTaken"; loan: Loan; atMs: number }
  | { kind: "bondSubscribed"; loan: Loan; atMs: number }
  | { kind: "federalLoanPaid"; loan: Loan; atMs: number }
  | { kind: "loanRepaid"; loan: Loan; atMs: number }
  | { kind: "earmark"; loan: Loan; met: boolean; atMs: number }
  | { kind: "supervision"; on: boolean; atMs: number }
  | { kind: "rating"; from: string; to: string; atMs: number };

function monthIndex(atMs: number): number {
  const d = new Date(toDateMs(atMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

function monthStartMs(index: number): number {
  return toSimTimeMs(Date.UTC(Math.floor(index / 12), index % 12, 1));
}

function round1000(rp: number): number {
  return Math.round(rp / 100_000) * 100_000;
}

class Debt {
  private loans: Loan[] = [];
  private buildingsProvider: () => Building[] = () => [];
  private lastMonth: number | null = null;
  private supervised = false;
  private lastRating: string | null = null;
  private counter = 0;
  private version = 0;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(e: DebtEvent) => void>();
  private unsubscribeClock: (() => void) | null = null;

  init(buildingsProvider: () => Building[], seed: string): void {
    this.unsubscribeClock?.();
    this.loans = [];
    this.buildingsProvider = buildingsProvider;
    this.supervised = false;
    this.counter = 0;
    const now = simClock.getSimTimeMs();
    interestRates.init(seed, now);
    this.lastMonth = monthIndex(now);
    this.lastRating = this.rating(now).label;
    setSpendingFreeze(() => this.supervised);
    setDebtPenalty((atMs) => this.penaltyPoints(atMs));
    this.unsubscribeClock = simClock.subscribe(() => this.advance(simClock.getSimTimeMs()));
    this.bump();
  }

  // --- reading ---

  getLoans(): Loan[] {
    return this.loans;
  }

  isSupervised(): boolean {
    return this.supervised;
  }

  getVersion(): number {
    return this.version;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onEvent(listener: (e: DebtEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  marketPct(atMs: number): number {
    return interestRates.marketPct(atMs);
  }

  /** Income debt is measured against: the last booked year's operating income, or before the
   * first year is booked, a multiple of the government's allocation. */
  incomeRp(atMs: number): number {
    const booked = latestBookedFinances();
    if (booked) return Math.max(1, operatingIncomeRp(booked));
    return Math.max(1, this.allocationRp(atMs) * PROVISIONAL_INCOME_ALLOCATIONS);
  }

  /** The balance right now (null while last year's accounts settle). */
  balanceRp(atMs: number): number | null {
    return liveBalanceRp(this.buildingsProvider(), atMs, BASELINE_YEAR);
  }

  /** What is owed: every loan's outstanding principal, and the overdraft (a negative balance). */
  debtRp(atMs: number): number {
    const loans = this.loans.filter((l) => l.status === "active").reduce((sum, l) => sum + l.outstandingRp, 0);
    const balance = this.balanceRp(atMs);
    return loans + (balance !== null && balance < 0 ? -balance : 0);
  }

  debtYears(atMs: number): number {
    return this.debtRp(atMs) / this.incomeRp(atMs);
  }

  limitRp(atMs: number): number {
    return DEBT_LIMIT_YEARS * this.incomeRp(atMs);
  }

  rating(atMs: number): { label: string; spreadPct: number } {
    const years = this.debtYears(atMs);
    return RATINGS.find((r) => years < r.uptoYears) ?? RATINGS[RATINGS.length - 1];
  }

  bankRatePct(termYears: number, atMs: number): number {
    return this.marketPct(atMs) + this.rating(atMs).spreadPct + (BANK_TERM_PREMIUM_PCT[termYears] ?? 0);
  }

  overdraftRatePct(atMs: number): number {
    return this.marketPct(atMs) + this.rating(atMs).spreadPct + OVERDRAFT_PREMIUM_PCT;
  }

  greenBondRatePct(atMs: number): number {
    return Math.max(0.05, this.marketPct(atMs) + this.rating(atMs).spreadPct - GREEN_BOND_DISCOUNT_PCT);
  }

  /** How much more can be borrowed before the limit. */
  headroomRp(atMs: number): number {
    return Math.max(0, this.limitRp(atMs) - this.debtRp(atMs));
  }

  /** Why a new loan can't be taken now, or null. */
  borrowingBlocked(atMs: number): string | null {
    if (this.supervised) return "The canton has put the department under supervision: no new borrowing until debt is back under the limit.";
    if (this.headroomRp(atMs) <= 0) return "Debt is at the limit the canton allows.";
    return null;
  }

  /** What residents would subscribe to a green bond now (CHF in Rp), and whether one can be issued. */
  greenBondOffer(atMs: number): { maxRp: number; ratePct: number; blocked: string | null } {
    const residents = this.residents(atMs);
    const climate = approval.getBlocLevels().climate;
    const demand = GREEN_BOND_DEMAND_RANGE[0] + (GREEN_BOND_DEMAND_RANGE[1] - GREEN_BOND_DEMAND_RANGE[0]) * Math.min(1, Math.max(0, (climate - 30) / 50));
    const maxRp = round1000(Math.min(this.headroomRp(atMs), residents * GREEN_BOND_CHF_PER_RESIDENT * demand * 100));
    const last = this.loans.filter((l) => l.kind === "greenBond").reduce((m, l) => Math.max(m, l.orderedAtMs), Number.NEGATIVE_INFINITY);
    let blocked = this.borrowingBlocked(atMs);
    if (!blocked && atMs - last < GREEN_BOND_MIN_MONTHS_APART * MONTH_MS) blocked = "A green bond was offered less than a year ago; residents need time before the next.";
    return { maxRp, ratePct: this.greenBondRatePct(atMs), blocked };
  }

  /** How much federal decarbonisation money can be drawn now: half the investments of the last
   * twelve months not yet drawn against, within the year's quota. */
  federalOffer(atMs: number): { eligibleRp: number; quotaLeftRp: number; investedRp: number; blocked: string | null } {
    const investedRp = treasury.investedTotal(atMs - 12 * MONTH_MS, atMs + 1);
    const drawnRecently = this.loans.filter((l) => l.kind === "federal" && l.orderedAtMs > atMs - 12 * MONTH_MS).reduce((s, l) => s + l.requestedRp, 0);
    const year = new Date(toDateMs(atMs)).getUTCFullYear();
    const drawnThisYear = this.loans
      .filter((l) => l.kind === "federal" && new Date(toDateMs(l.orderedAtMs)).getUTCFullYear() === year)
      .reduce((s, l) => s + l.requestedRp, 0);
    const quotaLeftRp = Math.max(0, this.residents(atMs) * FEDERAL_LOAN_CHF_PER_RESIDENT_YEAR * 100 - drawnThisYear);
    const eligibleRp = round1000(Math.max(0, Math.min(quotaLeftRp, FEDERAL_LOAN_SHARE_OF_INVESTMENT * investedRp - drawnRecently, this.headroomRp(atMs))));
    return { eligibleRp, quotaLeftRp, investedRp, blocked: this.borrowingBlocked(atMs) };
  }

  federalOfferRate(): number {
    return FEDERAL_LOAN_RATE_PCT;
  }

  /** What a loan costs a month (annuity) or a year in interest (a bond). */
  monthlyPaymentRp(loan: Pick<Loan, "principalRp" | "ratePct" | "termYears" | "kind">): number {
    if (loan.kind === "greenBond") return (loan.principalRp * loan.ratePct) / 100 / 12;
    const r = loan.ratePct / 100 / 12;
    const n = loan.termYears * 12;
    return r === 0 ? loan.principalRp / n : (loan.principalRp * r) / (1 - Math.pow(1 + r, -n));
  }

  // --- borrowing ---

  takeBankLoan(amountRp: number, termYears: number, atMs: number): Loan | null {
    if (this.borrowingBlocked(atMs) || !BANK_LOAN_TERMS_YEARS.includes(termYears)) return null;
    const principal = round1000(Math.min(amountRp, this.headroomRp(atMs)));
    if (principal <= 0) return null;
    const loan = this.add({ kind: "bank", requestedRp: principal, principalRp: principal, ratePct: this.bankRatePct(termYears, atMs), termYears, orderedAtMs: atMs, startMs: atMs });
    this.activate(loan, atMs);
    this.emit({ kind: "loanTaken", loan, atMs });
    return loan;
  }

  issueGreenBond(amountRp: number, atMs: number): Loan | null {
    const offer = this.greenBondOffer(atMs);
    if (offer.blocked) return null;
    const requested = round1000(Math.max(0, amountRp));
    if (requested <= 0) return null;
    const loan = this.add({
      kind: "greenBond",
      requestedRp: requested,
      principalRp: Math.min(requested, offer.maxRp), // what residents will actually subscribe
      ratePct: offer.ratePct,
      termYears: GREEN_BOND_TERM_YEARS,
      orderedAtMs: atMs,
      startMs: atMs + GREEN_BOND_SUBSCRIPTION_MONTHS * MONTH_MS,
    });
    // Offering residents a stake in the town's transition goes down well.
    for (const [bloc, points] of Object.entries(GREEN_BOND_ISSUE_GOODWILL)) approval.goodwill(bloc as keyof typeof GREEN_BOND_ISSUE_GOODWILL, points);
    this.bump();
    return loan;
  }

  drawFederalLoan(amountRp: number, atMs: number): Loan | null {
    const offer = this.federalOffer(atMs);
    if (offer.blocked) return null;
    const principal = round1000(Math.min(amountRp, offer.eligibleRp));
    if (principal <= 0) return null;
    const loan = this.add({
      kind: "federal",
      requestedRp: principal,
      principalRp: principal,
      ratePct: FEDERAL_LOAN_RATE_PCT,
      termYears: FEDERAL_LOAN_TERM_YEARS,
      orderedAtMs: atMs,
      startMs: atMs + FEDERAL_LOAN_PROCESSING_MONTHS * MONTH_MS,
    });
    this.bump();
    return loan;
  }

  /** Repays a loan early (the outstanding principal, at once). Bonds can't be repaid early. */
  repayEarly(loanId: string, atMs: number): boolean {
    const loan = this.loans.find((l) => l.id === loanId);
    if (!loan || loan.status !== "active" || loan.kind === "greenBond") return false;
    treasury.recordPayout("debtRepayment", atMs, loan.outstandingRp, loan.id);
    loan.outstandingRp = 0;
    loan.status = "repaid";
    this.emit({ kind: "loanRepaid", loan, atMs });
    this.bump();
    return true;
  }

  // --- time ---

  private advance(nowMs: number): void {
    // Money due to arrive (a bond's subscription closing, a federal loan paid out) arrives on the day.
    for (const loan of this.loans) {
      if (loan.status !== "pending" || nowMs < loan.startMs) continue;
      this.activate(loan, loan.startMs);
      this.emit({ kind: loan.kind === "greenBond" ? "bondSubscribed" : "federalLoanPaid", loan, atMs: loan.startMs });
    }
    const month = monthIndex(nowMs);
    if (this.lastMonth === null || month <= this.lastMonth) return;
    // A long jump settles at most two years of months.
    for (let m = Math.max(this.lastMonth + 1, month - 24); m <= month; m++) this.monthly(monthStartMs(m));
    this.lastMonth = month;
  }

  /** The first of a month: instalments and interest for the month before, the overdraft, earmarks,
   * the rating and the canton's view. */
  private monthly(atMs: number): void {
    for (const loan of this.loans) {
      if (loan.status !== "active" || loan.startMs >= atMs) continue;
      const interest = (loan.outstandingRp * loan.ratePct) / 100 / 12;
      treasury.recordPayout("interest", atMs, interest, loan.id);
      const maturity = loan.startMs + loan.termYears * 12 * MONTH_MS;
      let principal = 0;
      if (loan.kind === "greenBond") principal = atMs >= maturity - MONTH_MS / 2 ? loan.outstandingRp : 0;
      else principal = Math.min(loan.outstandingRp, Math.max(0, this.monthlyPaymentRp(loan) - interest));
      if (principal > 0) {
        treasury.recordPayout("debtRepayment", atMs, principal, loan.id);
        loan.outstandingRp -= principal;
      }
      if (loan.outstandingRp <= 100) {
        loan.outstandingRp = 0;
        loan.status = "repaid";
        this.emit({ kind: "loanRepaid", loan, atMs });
      }
      if (loan.earmark?.status === "open" && atMs >= loan.earmark.deadlineMs) {
        const invested = treasury.investedTotal(loan.startMs, atMs);
        const met = invested >= loan.principalRp;
        loan.earmark.status = met ? "met" : "missed";
        if (!met) approval.goodwill("climate", GREEN_BOND_GREENWASHING_POINTS);
        this.emit({ kind: "earmark", loan, met, atMs });
      }
    }

    // The overdraft: interest on a negative balance.
    const balance = this.balanceRp(atMs);
    if (balance !== null && balance < 0) treasury.recordPayout("interest", atMs, (-balance * this.overdraftRatePct(atMs)) / 100 / 12, "overdraft");

    // The rating, and the canton.
    const rating = this.rating(atMs).label;
    if (this.lastRating !== null && rating !== this.lastRating) this.emit({ kind: "rating", from: this.lastRating, to: rating, atMs });
    this.lastRating = rating;
    const years = this.debtYears(atMs);
    if (!this.supervised && years >= DEBT_LIMIT_YEARS) {
      this.supervised = true;
      this.emit({ kind: "supervision", on: true, atMs });
    } else if (this.supervised && years < DEBT_LIMIT_YEARS * SUPERVISION_EXIT_SHARE) {
      this.supervised = false;
      this.emit({ kind: "supervision", on: false, atMs });
    }
    this.bump();
  }

  /** Approval points debt costs: nothing up to a worry threshold, rising to the maximum at the limit. */
  private penaltyPoints(atMs: number): number {
    const years = this.debtYears(atMs);
    const share = (years - DEBT_WORRY_FROM_YEARS) / (DEBT_LIMIT_YEARS - DEBT_WORRY_FROM_YEARS);
    return DEBT_MAX_PENALTY_POINTS * Math.min(1, Math.max(0, share));
  }

  // --- internals ---

  private add(fields: Omit<Loan, "id" | "outstandingRp" | "status">): Loan {
    const loan: Loan = { ...fields, id: `loan-${++this.counter}`, outstandingRp: 0, status: "pending" };
    this.loans.push(loan);
    return loan;
  }

  private activate(loan: Loan, atMs: number): void {
    loan.status = "active";
    loan.outstandingRp = loan.principalRp;
    treasury.recordReceipt(atMs, loan.principalRp, loan.id, "borrowing");
    if (loan.kind === "greenBond") {
      loan.earmark = { deadlineMs: atMs + GREEN_BOND_EARMARK_MONTHS * MONTH_MS, status: "open" };
    }
    this.bump();
  }

  private residents(atMs: number): number {
    const dwellings = this.buildingsProvider().reduce((sum, b) => sum + (existsAt(b, atMs) ? b.dwellings.length : 0), 0);
    return dwellings * RESIDENTS_PER_DWELLING;
  }

  private allocationRp(atMs: number): number {
    const year = new Date(toDateMs(atMs)).getUTCFullYear();
    const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
    const dwellings = this.buildingsProvider().reduce((sum, b) => sum + (existsAt(b, yearStartMs) ? b.dwellings.length : 0), 0);
    return treasury.allocationRp(dwellings, allocationApprovalFactor(approval.atYearStart(year)));
  }

  private emit(e: DebtEvent): void {
    this.eventListeners.forEach((l) => l(e));
  }

  private bump(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export const debt = new Debt();
