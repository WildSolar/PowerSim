/**
 * The shared parts of switching early (renewal.ts's EarlySwitch; config/earlySwitch.ts): how likely an
 * owner is to consider it, and the comparison they make.
 */

import { EARLY_SWITCH_ADVICE_BOOST, type EarlySwitchSpec } from "../config/earlySwitch";
import { policyStore } from "./policy";
import type { RenewalCandidate } from "./renewal";

/** The chance of seriously considering an early switch this year: a base rate, raised by a grant
 * (against the price of the new system) and by energy advice in town. */
export function earlySwitchChance(spec: EarlySwitchSpec, grantRp: number, newPriceRp: number): number {
  const grantShare = newPriceRp > 0 ? Math.min(1, grantRp / newPriceRp) : 0;
  const advice = Math.max(0, 1 - policyStore.get().uncertaintyMultiplier);
  return Math.min(0.9, spec.baseChancePerYear * (1 + spec.grantBoost * grantShare) * (1 + EARLY_SWITCH_ADVICE_BOOST * advice));
}

/** The early comparison, from the renewal candidates: keeping the old system costs its running costs
 * and its repairs at this age; the greener alternatives cost what they would at a renewal, plus the
 * hassle of switching while the old one still works. Nothing less green is on offer. */
export function earlyCandidates<T extends string>(
  base: RenewalCandidate<T>[],
  incumbent: T,
  keepRunningRp: number,
  ageYears: number,
  spec: EarlySwitchSpec,
): RenewalCandidate<T>[] {
  const repairRp = Math.max(0, ageYears - spec.minAgeYears) * spec.repairChfPerYearOfAge * 100;
  const greenness = base.find((c) => c.id === incumbent)?.greenness ?? 0;
  return base.map((c) =>
    c.id === incumbent
      ? { ...c, available: true, annualizedCostRp: keepRunningRp + repairRp, municipalSubsidyRp: undefined, exception: undefined, onChosen: undefined }
      : { ...c, available: c.available && !c.exception && c.greenness > greenness, annualizedCostRp: c.annualizedCostRp + spec.hassleChfPerYear * 100 },
  );
}
