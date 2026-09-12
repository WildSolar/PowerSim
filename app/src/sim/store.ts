/**
 * Thin React bridge onto the simulation clock, using useSyncExternalStore so the
 * clock can tick every animation frame without React re-rendering components that
 * aren't subscribed (e.g. the map itself doesn't need to re-render every frame —
 * only an open dwelling panel showing live device readouts does).
 */

import { useSyncExternalStore } from "react";
import { simClock } from "./engine";

export function useSimTime(): number {
  return useSyncExternalStore(
    (callback) => simClock.subscribe(callback),
    () => simClock.getSimTimeMs(),
  );
}
