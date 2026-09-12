/**
 * Holds the player-set tariff, mirroring SimClock's singleton+subscribe pattern so
 * both React panels and the pure sampling functions (history.ts, buildingPower.ts)
 * can read the current tariff without threading it through every call site as props.
 *
 * Simplification: changing the tariff is treated as retroactive — history sampling
 * always uses whatever tariff is current "now", not whatever was in effect at each
 * sampled past instant. Tracking tariff changes over time is real complexity with no
 * payoff yet at this milestone's scope.
 */

import { DEFAULT_TARIFF, type Tariff } from "./tariff";

class TariffStore {
  private tariff: Tariff = { ...DEFAULT_TARIFF };
  private readonly listeners = new Set<() => void>();

  get(): Tariff {
    return this.tariff;
  }

  set(patch: Partial<Tariff>): void {
    this.tariff = { ...this.tariff, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const tariffStore = new TariffStore();
