/**
 * How far the town's decisions may be made: up to the present, never ahead. Owners decide lazily —
 * a heating system, a car, a way to get around, solar on the roof — the first time anything asks
 * about the moment the decision falls due, under the policy of the moment of asking. Something
 * looking ahead (a solar owner weighing a year of their building's use, say) must not make those
 * later decisions early: a grant repealed in between would still be paid, a ban enacted in between
 * ignored. So decisions are made up to the horizon only, and a question about a later moment reads
 * things as they stand — what is installed now stays installed.
 *
 * The horizon is the clock's time in the game (engine.ts) and the scripted run's in a scenario
 * (dev/scenario.ts); unset, nothing limits it (tools that ask about any moment).
 */

let horizonMs = Number.POSITIVE_INFINITY;

export function setDecisionHorizon(ms: number): void {
  horizonMs = ms;
}

/** The latest moment decisions may be made for. */
export function decisionHorizon(): number {
  return horizonMs;
}
