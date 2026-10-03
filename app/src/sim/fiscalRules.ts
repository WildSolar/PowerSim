/**
 * Whether the canton has frozen the department's spending (cantonal supervision over too much debt —
 * debt.ts registers the answer). While frozen, no new spending measures and no new orders: grid,
 * district heating, chargers, solar on public buildings, zoning plans. Measures already in force run
 * on; laws, repeals and prices stay open. Kept apart so the modules that spend don't depend on debt.ts.
 */

let frozen: (atMs: number) => boolean = () => false;

export function setSpendingFreeze(check: (atMs: number) => boolean): void {
  frozen = check;
}

export function spendingFrozen(atMs: number): boolean {
  return frozen(atMs);
}

export const SPENDING_FROZEN_NOTE = "Under cantonal supervision for too much debt: no new orders or spending measures until debt is back under the limit (Town hall → Treasury → Borrowing).";
