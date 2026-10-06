/**
 * Finishing early. A town that closes a year at net zero may hand over and end the run there, the
 * years left until 2050 counting in full (score.ts) — but only with its books in order, so the net
 * zero can be expected to last: no cantonal supervision, no overdraft, and debt no more than a few
 * years of income. Net zero bought on borrowed money has to show it holds while the debt comes down.
 */

import { HANDOVER_MAX_DEBT_YEARS } from "../config/borrowing";
import { BASELINE_YEAR } from "./calendar";
import { debt } from "./debt";
import { cachedEmissionsForYear } from "./emissions";
import { getFinishedYear, NET_ZERO_TARGET_YEAR } from "./score";

export interface HandoverCheck {
  /** The year closed at net zero, before 2050, and the run isn't finished yet. */
  offered: boolean;
  /** What stands in the way, for the player (empty when the run can finish). */
  problems: string[];
}

/** Whether the run can finish at the end of `year`, checked at `atMs` (that Year in Review). */
export function handoverCheck(year: number, atMs: number): HandoverCheck {
  const e = cachedEmissionsForYear(year);
  const offered = getFinishedYear() === null && year > BASELINE_YEAR && year < NET_ZERO_TARGET_YEAR && !!e && e.netKgCO2 <= 0;
  if (!offered) return { offered, problems: [] };
  const problems: string[] = [];
  if (debt.isSupervised()) problems.push("the canton has the department under supervision");
  const balance = debt.balanceRp(atMs);
  if (balance !== null && balance < 0) problems.push("the department is in overdraft");
  const years = debt.debtYears(atMs);
  if (years > HANDOVER_MAX_DEBT_YEARS) {
    problems.push(`debt stands at ${years.toLocaleString("de-CH", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} years of income, above the ${HANDOVER_MAX_DEBT_YEARS} that still earn an A rating`);
  }
  return { offered, problems };
}
