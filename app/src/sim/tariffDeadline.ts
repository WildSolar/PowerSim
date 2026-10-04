/**
 * The tariff deadline (tariffStore.ts): if next year's tariff hasn't been published when its
 * deadline comes, the game stops right there and asks — keep this year's prices, or set new ones
 * (ui/TariffDeadlineDialog.tsx). The clock is held at the deadline until one or the other is
 * done, so a deadline is never missed by accident.
 *
 * Like yearEndWatcher.ts it reacts one microtask late: pausing from inside the clock's own
 * listener loop would re-enter it.
 */

import { simClock } from "./engine";
import { PAUSE_SPEED, setSpeed } from "./timeControls";
import { tariffStore } from "./tariffStore";

class TariffDeadline {
  /** The year whose tariff is overdue, while the clock waits at its deadline. */
  private due: number | null = null;
  /** The next year whose deadline is watched. */
  private watchYear = 0;
  private resumeSpeed = PAUSE_SPEED;
  private readonly listeners = new Set<() => void>();
  private unsubscribers: (() => void)[] = [];

  /** For a new or loaded game, after tariffStore. */
  init(): void {
    this.unsubscribers.forEach((u) => u());
    this.due = null;
    this.watchYear = tariffStore.publishableYear(simClock.getSimTimeMs());
    this.unsubscribers = [
      simClock.subscribe(() => this.check()),
      tariffStore.onPublish((p) => {
        if (p.year !== this.due) return;
        this.due = null;
        this.watchYear = p.year + 1;
        this.notify();
      }),
    ];
    this.notify();
  }

  get(): number | null {
    return this.due;
  }

  /** Keeps this year's prices for the overdue year (publishing them unchanged) and carries on. */
  keepPrices(): void {
    if (this.due === null) return;
    const resume = this.resumeSpeed;
    tariffStore.publish(tariffStore.sheetFor(this.due), simClock.getSimTimeMs());
    if (resume !== PAUSE_SPEED) setSpeed(resume);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private check(): void {
    const now = simClock.getSimTimeMs();
    const deadline = tariffStore.deadlineMs(this.watchYear);
    if (now <= deadline) return;
    if (this.due === null && tariffStore.isPublished(this.watchYear)) {
      this.watchYear++;
      return;
    }
    // Overdue: hold the clock at the deadline (again, if the player set it running meanwhile).
    const first = this.due === null;
    if (first) this.resumeSpeed = simClock.getSpeed();
    this.due = this.watchYear;
    queueMicrotask(() => {
      simClock.pauseAt(deadline);
      if (first) this.notify();
    });
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }
}

export const tariffDeadline = new TariffDeadline();
