/**
 * A minimal time-of-use tariff: two flat rate periods per day. The off-peak window
 * is fixed for this milestone (21:00-06:00, the classic overnight "cheap" block) —
 * only the two prices are player-adjustable. A configurable window is a natural
 * follow-up once there's a reason to need it.
 *
 * The other three prices here aren't time-of-use at all — they're what solar
 * export earns (feedInPriceRpKWh) and what the two non-electric space-heating
 * carriers cost (gasPriceRpKWh, districtHeatingPriceRpKWh) — see billing.ts for
 * where each is actually used. Grouped into the same object/store as the
 * electricity prices since they're all "prices the player sets," not because
 * they're mechanically related.
 */

export interface Tariff {
  offPeakPriceRpKWh: number;
  peakPriceRpKWh: number;
  offPeakStartHour: number; // e.g. 21 — off-peak begins in the evening
  offPeakEndHour: number; // e.g. 6 — off-peak ends the next morning
  feedInPriceRpKWh: number; // grid feed-in remuneration for exported solar
  gasPriceRpKWh: number; // per kWh of gas burned (not thermal delivered — see billing.ts)
  districtHeatingPriceRpKWh: number; // per kWh of heat delivered
}

export const DEFAULT_TARIFF: Tariff = {
  offPeakPriceRpKWh: 18,
  peakPriceRpKWh: 32,
  offPeakStartHour: 21,
  offPeakEndHour: 6,
  // Ballpark 2024-2025 Swiss/EKZ-area figures — all three deliberately below the
  // electricity tariff, matching how feed-in and heating-fuel prices actually sit
  // relative to grid electricity today.
  feedInPriceRpKWh: 8,
  gasPriceRpKWh: 10,
  districtHeatingPriceRpKWh: 12,
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
