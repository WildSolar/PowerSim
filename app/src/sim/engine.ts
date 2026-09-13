/**
 * The simulation clock. Advances simulated time on every animation frame and notifies
 * subscribers — it holds no per-device state itself, since device power is a pure
 * function of (seed, simTimeMs) (see devices.ts). The speed multiplier is player-
 * adjustable (see ui/TimeControl.tsx); speed 0 is pause, not a special case — the
 * loop just advances simTime by realDelta * 0.
 */

const DEFAULT_MULTIPLIER = 720; // 1 real second = 12 simulated minutes (~2 real minutes per simulated day)

// A generous but hard ceiling on simulated time, well inside JS's own Date
// range (+-~273,790 years from the epoch) rather than right up against it —
// every calendar-dependent calculation in the app (weather, heating demand,
// stock-renewal timing, the dates shown in a renewal's history log) ultimately
// traces back to `new Date(EPOCH_MS + simTimeMs)`, and silently produces NaN
// once that overflows, with no error anywhere near the actual cause. At max
// speed (x86400) this is centuries of continuous real-time play to reach, but
// a backgrounded tab can accumulate a huge single `realDeltaMs` on its next
// frame once foregrounded again, so it's reachable well within an ordinary
// session — clamping here, the one place simTimeMs is ever incremented, is a
// single choke point rather than guarding every consumer individually.
const MAX_SIM_TIME_MS = 10_000 * 365.25 * 24 * 60 * 60_000; // 10,000 simulated years

export class SimClock {
  private simTimeMs = 0;
  private lastFrameTime: number | null = null;
  private rafId: number | null = null;
  private readonly listeners = new Set<() => void>();
  private multiplier = DEFAULT_MULTIPLIER;

  start(): void {
    if (this.rafId !== null) return;
    const loop = (now: number) => {
      if (this.lastFrameTime !== null) {
        const realDeltaMs = now - this.lastFrameTime;
        this.simTimeMs = Math.min(this.simTimeMs + realDeltaMs * this.multiplier, MAX_SIM_TIME_MS);
        this.listeners.forEach((listener) => listener());
      }
      this.lastFrameTime = now;
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastFrameTime = null;
  }

  getSimTimeMs(): number {
    return this.simTimeMs;
  }

  getSpeed(): number {
    return this.multiplier;
  }

  setSpeed(multiplier: number): void {
    this.multiplier = multiplier;
    this.listeners.forEach((listener) => listener());
  }

  /** Snaps to an exact instant and pauses there in one step — used by
   * yearEndWatcher.ts so a fast-forwarding player lands exactly on a calendar
   * year boundary (never overshoots into the new year) rather than merely
   * noticing after the fact. */
  pauseAt(simTimeMs: number): void {
    this.simTimeMs = Math.min(simTimeMs, MAX_SIM_TIME_MS);
    this.multiplier = 0;
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const simClock = new SimClock();
