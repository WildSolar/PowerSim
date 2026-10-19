/**
 * Whether the canton has frozen the department's spending (cantonal supervision over too much debt —
 * debt.ts registers the answer). While frozen, no new spending measures and no new orders: grid,
 * district heating, chargers, solar on public buildings, zoning plans. Measures already in force run
 * on; laws, repeals and prices stay open. Kept apart so the modules that spend don't depend on debt.ts.
 */

let frozen: (atMs: number) => boolean = () => false;

// The treasury's balance at a moment (debt.ts registers it; null while last year's accounts settle).
let balance: (atMs: number) => number | null = () => null;

export function setBalanceCheck(check: (atMs: number) => number | null): void {
  balance = check;
}

/** A purchase refused for want of money: what it would have cost, and what the treasury has. */
export interface RefusedPurchase {
  atMs: number;
  costRp: number;
  balanceRp: number;
}

const refusedListeners = new Set<(r: RefusedPurchase) => void>();

/** Told whenever a purchase is refused for want of money (a notice for the player). */
export function onPurchaseRefused(listener: (r: RefusedPurchase) => void): () => void {
  refusedListeners.add(listener);
  return () => refusedListeners.delete(listener);
}

/** Whether the player's purchase of `costRp` at `atMs` can't go ahead: spending is frozen, or it
 * would take the treasury below zero — the department doesn't order what it can't pay (borrow
 * first). Subsidies households claim and the running costs of what is in force still go through: a
 * balance that falls below zero that way is covered by the overdraft, at its steep interest. */
export function cannotPay(costRp: number, atMs: number): boolean {
  if (frozen(atMs)) return true;
  const b = balance(atMs);
  if (b === null || b >= costRp) return false;
  refusedListeners.forEach((l) => l({ atMs, costRp, balanceRp: b }));
  return true;
}

/** The same question without refusing anything: for a screen deciding whether to offer a purchase. */
export function couldNotPay(costRp: number, atMs: number): boolean {
  if (frozen(atMs)) return true;
  const b = balance(atMs);
  return b !== null && b < costRp;
}

export function setSpendingFreeze(check: (atMs: number) => boolean): void {
  frozen = check;
}

export function spendingFrozen(atMs: number): boolean {
  return frozen(atMs);
}

export const SPENDING_FROZEN_NOTE = "Under cantonal supervision for too much debt: no new orders or spending measures until debt is back under the limit (Town hall → Treasury → Borrowing).";
