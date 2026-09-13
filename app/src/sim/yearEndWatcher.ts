/**
 * Watches the simulation clock for a calendar year boundary and, the instant
 * one is crossed, snaps time back to exactly that boundary, pauses, and asks
 * reportCardStore to show a report for the year that just finished (see
 * ui/ReportCardModal.tsx). Runs for the whole app session (started once from
 * App.tsx alongside simClock.start()), independent of whatever panels happen
 * to be open — the player should get their report even if they weren't
 * looking at anything in particular when the year turned over.
 *
 * Deliberately reacts via a microtask rather than mutating the clock directly
 * inside the tick listener that discovered the crossing: simClock.pauseAt
 * itself notifies every listener (including this one), and doing that
 * synchronously from inside the tick's own listener loop would re-enter it
 * mid-iteration. Deferring one microtask sidesteps that rather than relying on
 * the re-entrant call happening to be harmless.
 */

import { toDateMs, toSimTimeMs } from "./calendar";
import { simClock } from "./engine";
import { reportCardStore } from "./reportCardStore";

let lastCheckedYear: number | null = null;

function currentYear(simTimeMs: number): number {
  return new Date(toDateMs(simTimeMs)).getUTCFullYear();
}

function checkYearBoundary(): void {
  const year = currentYear(simClock.getSimTimeMs());
  if (lastCheckedYear === null) {
    lastCheckedYear = year;
    return;
  }
  if (year <= lastCheckedYear) return;

  const completedYear = lastCheckedYear;
  lastCheckedYear = completedYear + 1;
  queueMicrotask(() => {
    simClock.pauseAt(toSimTimeMs(Date.UTC(completedYear + 1, 0, 1)));
    reportCardStore.show(completedYear);
  });
}

export function startYearEndWatcher(): () => void {
  return simClock.subscribe(checkYearBoundary);
}
