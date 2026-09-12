/**
 * A minimal time-of-use tariff: two flat rate periods per day. The off-peak window
 * is fixed for this milestone (21:00-06:00, the classic overnight "cheap" block) —
 * only the two prices are player-adjustable. A configurable window is a natural
 * follow-up once there's a reason to need it.
 */

export interface Tariff {
  offPeakPriceRpKWh: number;
  peakPriceRpKWh: number;
  offPeakStartHour: number; // e.g. 21 — off-peak begins in the evening
  offPeakEndHour: number; // e.g. 6 — off-peak ends the next morning
}

export const DEFAULT_TARIFF: Tariff = {
  offPeakPriceRpKWh: 18,
  peakPriceRpKWh: 32,
  offPeakStartHour: 21,
  offPeakEndHour: 6,
};

export function isOffPeakHour(tariff: Tariff, hourOfDay: number): boolean {
  return hourOfDay >= tariff.offPeakStartHour || hourOfDay < tariff.offPeakEndHour;
}

/** A cache/effect key for "the tariff prices that affect EV-charging timing" —
 * only the two prices matter for that (the off-peak window is fixed), so this
 * deliberately ignores offPeakStartHour/offPeakEndHour rather than invalidating
 * a cache over a value that never actually changes. */
export function tariffKey(tariff: Tariff): string {
  return `${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}`;
}
