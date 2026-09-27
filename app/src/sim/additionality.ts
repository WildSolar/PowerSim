/**
 * The ground truth behind every municipal subsidy paid: would the household (or owner) have made
 * the same choice without it? Each time a decision is taken with a municipal subsidy on the winning
 * option, the decision is re-run with that money taken away (renewal.ts, solarAdoption.ts) — same
 * household, same leaning, same prices — and this ledger records whether the subsidy changed it.
 *
 * The player never reads this directly: it's what evaluation studies (studies.ts) sample, with the
 * error margin a real study would have. Transparency mode shows the decisions themselves.
 */

export type SubsidyCategory = "solar" | "battery" | "heating" | "vehicle" | "retrofit";

export interface SubsidisedDecision {
  atMs: number;
  category: SubsidyCategory;
  subsidyRp: number;
  /** The subsidy changed the choice: without it, something else would have been chosen. */
  additional: boolean;
}

const decisions: SubsidisedDecision[] = [];

export function recordSubsidisedDecision(decision: SubsidisedDecision): void {
  decisions.push(decision);
}

/** Subsidised decisions of a category in `[fromMs, toMs)`. */
export function subsidisedDecisions(category: SubsidyCategory, fromMs: number, toMs: number): SubsidisedDecision[] {
  return decisions.filter((d) => d.category === category && d.atMs >= fromMs && d.atMs < toMs);
}

/** A fresh game. */
export function resetAdditionality(): void {
  decisions.length = 0;
}
