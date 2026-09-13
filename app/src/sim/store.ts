/**
 * Thin React bridge onto the simulation clock, using useSyncExternalStore so the
 * clock can tick every animation frame without React re-rendering components that
 * aren't subscribed (e.g. the map itself doesn't need to re-render every frame —
 * only an open dwelling panel showing live device readouts does).
 */

import { useSyncExternalStore } from "react";
import { simClock } from "./engine";
import { reportCardStore } from "./reportCardStore";
import { tariffStore } from "./tariffStore";
import type { Tariff } from "./tariff";

export function useSimTime(): number {
  return useSyncExternalStore(
    (callback) => simClock.subscribe(callback),
    () => simClock.getSimTimeMs(),
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
