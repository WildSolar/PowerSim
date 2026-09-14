/**
 * Thin React bridge onto the simulation clock, using useSyncExternalStore so the
 * clock can tick every animation frame without React re-rendering components that
 * aren't subscribed (e.g. the map itself doesn't need to re-render every frame —
 * only an open dwelling panel showing live device readouts does).
 */

import { useSyncExternalStore } from "react";
import { simClock } from "./engine";
import { policyStore } from "./policy";
import type { Policy } from "./policy";
import { reportCardStore } from "./reportCardStore";
import { tariffStore } from "./tariffStore";
import type { Tariff } from "./tariff";

export function useSimTime(): number {
  return useSyncExternalStore(
    (callback) => simClock.subscribe(callback),
    () => simClock.getSimTimeMs(),
  );
}

const DAY_MS = 24 * 60 * 60_000;

/** The current simulated day, as a day-bucketed timestamp, re-rendering only
 * when it actually changes — unlike useSimTime, safe for a component that
 * shouldn't re-render every animation frame (CityStatsTab, ControlPanel's
 * History tab), but still live enough for solarAdoption.ts's
 * effectivePowerPlantsAt: an adoption decided for later in the year must
 * stay invisible until the simulated day it's actually dated, so a whole
 * *year's* granularity (as this used to be) is too coarse — see
 * useLivePowerPlants.ts. getSnapshot still runs on every clock tick, but
 * useSyncExternalStore only re-renders when the returned value actually
 * differs from last time. */
export function useSimDay(): number {
  return useSyncExternalStore(
    (callback) => simClock.subscribe(callback),
    () => Math.floor(simClock.getSimTimeMs() / DAY_MS) * DAY_MS,
  );
}

export function usePolicy(): Policy {
  return useSyncExternalStore(
    (callback) => policyStore.subscribe(callback),
    () => policyStore.get(),
  );
}

export function useSimSpeed(): number {
  return useSyncExternalStore(
    (callback) => simClock.subscribe(callback),
    () => simClock.getSpeed(),
  );
}

export function useTariff(): Tariff {
  return useSyncExternalStore(
    (callback) => tariffStore.subscribe(callback),
    () => tariffStore.get(),
  );
}

/** The completed calendar year whose year-end report should be showing right
 * now, or null if none is pending — see reportCardStore.ts / yearEndWatcher.ts. */
export function useReportCardYear(): number | null {
  return useSyncExternalStore(
    (callback) => reportCardStore.subscribe(callback),
    () => reportCardStore.get(),
  );
}
