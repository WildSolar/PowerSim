import { useEffect, useRef, useState } from "react";
import { simClock } from "../sim/engine";

/**
 * Recomputes `compute()` on a fixed interval, keyed off `key` (e.g. an egid) rather
 * than the function identity — so the interval isn't torn down and rebuilt every
 * render, but always calls the latest closure (captured via ref) rather than a
 * stale one from when the effect first ran.
 *
 * Skips a recompute when neither `key` nor simulated time has moved since the last
 * one: a paused clock means the same answer again, and for the municipality-wide
 * charts that answer costs a full sampling pass. (Anything else a computation
 * depends on, like the tariff, belongs in `key`.)
 */
export function useHistorySeries<T>(compute: () => T, intervalMs: number, key: string): T {
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const lastRef = useRef<{ key: string; simTimeMs: number } | null>(null);
  const [value, setValue] = useState<T>(() => {
    lastRef.current = { key, simTimeMs: simClock.getSimTimeMs() };
    return computeRef.current();
  });

  useEffect(() => {
    const refresh = () => {
      const simTimeMs = simClock.getSimTimeMs();
      if (lastRef.current?.key === key && lastRef.current.simTimeMs === simTimeMs) return;
      lastRef.current = { key, simTimeMs };
      setValue(computeRef.current());
    };
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
    // intentionally keyed on `key`/`intervalMs` only — computeRef.current always
    // holds the latest closure, so re-running this effect on every render isn't needed
  }, [key, intervalMs]);

  return value;
}
