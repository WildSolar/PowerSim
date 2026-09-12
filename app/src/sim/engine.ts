/**
 * The simulation clock. Advances simulated time on every animation frame and notifies
 * subscribers — it holds no per-device state itself, since device power is a pure
 * function of (seed, simTimeMs) (see devices.ts).
 *
 * TIME_MULTIPLIER is a hardcoded demo-friendly default for this milestone (fast enough
 * that lighting's day/night cycle is visible within a short observation window) — the
 * next milestone replaces this constant with a player-adjustable speed control.
 */

const TIME_MULTIPLIER = 720; // 1 real second = 12 simulated minutes (~2 real minutes per simulated day)

export class SimClock {
  private simTimeMs = 0;
  private lastFrameTime: number | null = null;
  private rafId: number | null = null;
  private readonly listeners = new Set<() => void>();

  start(): void {
    if (this.rafId !== null) return;
    const loop = (now: number) => {
      if (this.lastFrameTime !== null) {
        const realDeltaMs = now - this.lastFrameTime;
        this.simTimeMs += realDeltaMs * TIME_MULTIPLIER;
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

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const simClock = new SimClock();
