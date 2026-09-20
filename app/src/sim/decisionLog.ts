/**
 * A flat, in-memory record of every stock-renewal/solar-adoption decision
 * actually committed — a development tool for calibration, not something
 * the player ever sees. Every "kind" of decision (heating, mobility mode,
 * mobility vehicle-type, solar) funnels through one of two writers:
 *  - logCandidateDecision(): the four-factor cost comparison (renewal.ts's
 *    chooseNext) — heating, mobility vehicle-type, and solar all share this,
 *    called once from inside chooseNext itself so every consumer logs the
 *    same way for free.
 *  - logWeightedDecision(): a weighted-random draw with no cost comparison
 *    (modeRenewal.ts) — mobility's mode tier.
 * Only *committed* decisions are logged (never a decision that hasn't come
 * due yet), and never the synthetic "initial" event every chain starts
 * with (that's GWR's real observation or an unweighted first guess, not
 * something the sim actually decided) — matching what the player-facing
 * narrative logs already choose to show.
 *
 * A capped ring buffer *per kind* (MAX_ENTRIES_PER_KIND) rather than one
 * shared cap — a long fast-forwarded session could otherwise accumulate an
 * unbounded number of entries, and mobility's mode tier alone fires for
 * every dwelling's every slot (tens of thousands, easily dwarfing heating's
 * one-per-building or solar's one-per-adoption volume); a single shared cap
 * would let that flood evict every heating/solar entry before you ever got
 * to look. Oldest entries within a kind drop first, same trade every other
 * bounded cache in this codebase makes, just scoped per kind.
 */

export interface DecisionCandidateLog {
  id: string;
  label: string;
  available?: boolean; // omitted for weighted-random decisions (mode tier) — availability isn't a concept there
  annualizedCostRp?: number; // cost-based decisions only
  effectiveCostRp?: number; // annualizedCostRp after the bias adjustment — what was actually compared
  weight?: number; // weighted-random decisions only (mode tier) — the target share it was drawn against
  greenness?: number;
}

export type DecisionLogKind = "heating" | "mobility-mode" | "mobility-vehicle-car" | "mobility-vehicle-bike" | "solar";

export interface DecisionLogEntry {
  seq: number;
  atMs: number; // simulated time the decision committed
  kind: DecisionLogKind;
  egid: string;
  entityKey: string; // raw chain key, e.g. "121048:heating" or "121048:2:mobility-vehicle-car:0" — identifies dwelling/slot when relevant
  incumbent: string | null;
  chosen: string;
  reasonKind: string; // "inKind" | "forcedByAvailability" | "financial" | "weighted"
  candidates: DecisionCandidateLog[];
  uncertaintyFraction?: number;
  biasStrengthRp?: number;
  /** Kind-specific extra context worth having for calibration — e.g. solar's
   * hazard/neighbor-count inputs, its capacity and subsidy breakdown. */
  extra?: Record<string, number | string | boolean>;
}

const MAX_ENTRIES_PER_KIND = 2000;
const entriesByKind = new Map<DecisionLogKind, DecisionLogEntry[]>();
let nextSeq = 1;

function push(entry: Omit<DecisionLogEntry, "seq">): void {
  let bucket = entriesByKind.get(entry.kind);
  if (!bucket) {
    bucket = [];
    entriesByKind.set(entry.kind, bucket);
  }
  bucket.push({ ...entry, seq: nextSeq++ });
  if (bucket.length > MAX_ENTRIES_PER_KIND) bucket.shift();
}

export function logCandidateDecision(
  entry: Omit<DecisionLogEntry, "seq" | "reasonKind" | "candidates"> & {
    reasonKind: string;
    candidates: DecisionCandidateLog[];
  },
): void {
  push(entry);
}

export function logWeightedDecision(
  entry: Omit<DecisionLogEntry, "seq" | "reasonKind" | "candidates" | "uncertaintyFraction" | "biasStrengthRp"> & {
    candidates: DecisionCandidateLog[];
  },
): void {
  push({ ...entry, reasonKind: "weighted" });
}

/** Every logged decision across every kind, oldest first by the order it was
 * actually committed in (seq) — DecisionLogTab.tsx re-sorts/filters as
 * needed for display. */
export function getDecisionLog(): DecisionLogEntry[] {
  const all = Array.from(entriesByKind.values()).flat();
  all.sort((a, b) => a.seq - b.seq);
  return all;
}

export function clearDecisionLog(): void {
  entriesByKind.clear();
}
