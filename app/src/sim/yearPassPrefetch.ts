/**
 * Samples each calendar month's share of the year-end report's passes (yearReport.ts's electricity,
 * heating-technology and mobility-fuel samples) in the background as soon as the month is over,
 * instead of all twelve at once when the year ends — the report then only has December left to do
 * when it opens. A finished month never changes, so computing it early gives the same numbers as
 * computing it at New Year: renewal chains are only read up to the month's own end, and a year's
 * solar adoptions are already decided on its first day (see solarAdoption.ts). The one input that
 * can differ is the tariff EV charging times respond to, which is now the one in force just after
 * the month rather than at New Year — if anything the more faithful of the two.
 *
 * On start it also works through the months of the current year that were already over before play
 * began (the first report covers the whole calendar year), after a short delay so it doesn't compete
 * with loading. One month at a time, with a pause in between, so the background work stays in small
 * pieces the player doesn't feel.
 */

import type { PowerPlant } from "../data/types";
import { toDateMs } from "./calendar";
import { simClock } from "./engine";
import { stock } from "./stock";
import { prefetchMonth } from "./yearReport";

const START_DELAY_MS = 5000;
const PAUSE_BETWEEN_MONTHS_MS = 200;

let busy = false;

/** Whether months are still queued or being sampled (for the dev timing harness). */
export function yearPassPrefetchBusy(): boolean {
  return busy;
}

function monthIndexAt(simTimeMs: number): number {
  const d = new Date(toDateMs(simTimeMs));
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

export function startYearPassPrefetch(realPlants: PowerPlant[]): () => void {
  const queue: number[] = [];
  let lastMonth = monthIndexAt(simClock.getSimTimeMs());
  let stopped = false;
  let working = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const work = async () => {
    timer = null;
    if (working || stopped) return;
    working = true;
    while (queue.length > 0 && !stopped) {
      const monthIndex = queue.shift() as number;
      await prefetchMonth(stock.getAll(), realPlants, Math.floor(monthIndex / 12), monthIndex % 12);
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_MONTHS_MS));
    }
    working = false;
    busy = false;
  };

  const schedule = (delayMs: number) => {
    busy = true;
    if (timer === null && !working) timer = setTimeout(work, delayMs);
  };

  // The current year's months already over when play began.
  const firstOfYear = lastMonth - (lastMonth % 12);
  for (let m = firstOfYear; m < lastMonth; m++) queue.push(m);
  schedule(START_DELAY_MS);

  const unsubscribe = simClock.subscribe(() => {
    const month = monthIndexAt(simClock.getSimTimeMs());
    if (month <= lastMonth) return;
    for (let m = lastMonth; m < month; m++) queue.push(m);
    lastMonth = month;
    schedule(0);
  });

  return () => {
    stopped = true;
    busy = false;
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
  };
}
