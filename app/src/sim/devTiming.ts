/**
 * Dev-only timing of named pieces of work (dev/perf.ts's timeMonthTurn): wherever they run — a clock
 * listener, the background month work, a React render — each call's duration is added to its label,
 * with the longest single call. Off unless a harness turns it on; then a call costs one clock read.
 */

interface Tally {
  ms: number;
  calls: number;
  maxMs: number;
}

let tallies: Map<string, Tally> | null = null;

function add(label: string, ms: number): void {
  if (!tallies) return;
  const t = tallies.get(label) ?? { ms: 0, calls: 0, maxMs: 0 };
  t.ms += ms;
  t.calls++;
  t.maxMs = Math.max(t.maxMs, ms);
  tallies.set(label, t);
}

/** Runs `fn`, timing it under `label` while timing is on. */
export function timed<T>(label: string, fn: () => T): T {
  if (!tallies) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    add(label, performance.now() - t0);
  }
}

/** The same for async work: the whole span, waits included (`maxMs` is then the longest span). */
export async function timedAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!tallies) return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    add(label, performance.now() - t0);
  }
}

export function startDevTiming(): void {
  tallies = new Map();
}

/** Stops timing and returns what was recorded, the most expensive first. */
export function stopDevTiming(): Record<string, string> {
  const out = Object.fromEntries(
    [...(tallies ?? new Map<string, Tally>())]
      .sort((a, b) => b[1].ms - a[1].ms)
      .map(([k, t]) => [k, `${Math.round(t.ms)} ms in ${t.calls} (longest ${Math.round(t.maxMs)})`]),
  );
  tallies = null;
  return out;
}
