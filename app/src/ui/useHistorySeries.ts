import { useEffect, useRef, useState } from "react";

/**
 * Recomputes `compute()` on a fixed interval, keyed off `key` (e.g. an egid) rather
 * than the function identity — so the interval isn't torn down and rebuilt every
 * render, but always calls the latest closure (captured via ref) rather than a
 * stale one from when the effect first ran.
 */
export function useHistorySeries<T>(compute: () => T, intervalMs: number, key: string): T {
  const computeRef = useRef(compute);
  computeRef.current = compute;
  const [value, setValue] = useState<T>(() => computeRef.current());

  useEffect(() => {
    setValue(computeRef.current());
    const id = setInterval(() => setValue(computeRef.current()), intervalMs);
    return () => clearInterval(id);
    // intentionally keyed on `key`/`intervalMs` only — computeRef.current always
    // holds the latest closure, so re-running this effect on every render isn't needed
  }, [key, intervalMs]);

  return value;
}
