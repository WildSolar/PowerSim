/**
 * The simulation clock. Advances simulated time on every animation frame and notifies
 * subscribers — it holds no per-device state itself, since device power is a pure
 * function of (seed, simTimeMs) (see devices.ts). The speed multiplier is player-
 * adjustable (see ui/TimeControl.tsx); speed 0 is pause, not a special case — the
 * loop just advances simTime by realDelta * 0.
 */

const DEFAULT_MULTIPLIER = 720; // 1 real second = 12 simulated minutes (~2 real minutes per simulated day)

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
        this.simTimeMs += realDeltaMs * this.multiplier;
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const simClock = new SimClock();
