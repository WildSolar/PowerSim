/**
 * A minimal time-of-use tariff: two flat rate periods per day. The off-peak window
 * is fixed for this milestone (21:00-06:00, the classic overnight "cheap" block) —
 * only the two prices are player-adjustable. A configurable window is a natural
 * follow-up once there's a reason to need it.
 *
 * The other four prices here aren't time-of-use at all — they're what solar
 * export earns (feedInPriceRpKWh) and what the three non-electric
 * space-heating carriers cost (oilPriceRpPerLiter, gasPriceRpKWh,
 * districtHeatingPriceRpKWh) — see billing.ts for where each is actually
 * used. Oil is priced per liter (how it's actually sold in Switzerland)
 * rather than per kWh like the other two. Grouped into the same object/store
 * as the electricity prices since they're all "prices the player sets," not
 * because they're mechanically related.
 *
 * The last two are different again — not a price a consumer ever sees, but
 * the DSO's own cost side: what it pays upstream for wholesale electricity,
 * and what it costs to maintain the local grid. See finances.ts for where
 * they turn into the municipal money ledger.
 */

export interface Tariff {
  offPeakPriceRpKWh: number;
  peakPriceRpKWh: number;
  offPeakStartHour: number; // e.g. 21 — off-peak begins in the evening
  offPeakEndHour: number; // e.g. 6 — off-peak ends the next morning
  feedInPriceRpKWh: number; // grid feed-in remuneration for exported solar
  oilPriceRpPerLiter: number; // per liter of heating oil burned
  gasPriceRpKWh: number; // per kWh of gas burned (not thermal delivered — see billing.ts)
  districtHeatingPriceRpKWh: number; // per kWh of heat delivered
  petrolPriceRpPerLiter: number; // per liter of petrol/diesel burned by an ICE car — see mobility.ts
  wholesalePriceRpKWh: number; // what the DSO pays upstream per net kWh purchased — see finances.ts
  gridMaintenanceRpKWh: number; // the DSO's own wires/upkeep cost per kWh delivered — see finances.ts
}

export const DEFAULT_TARIFF: Tariff = {
  offPeakPriceRpKWh: 18,
  peakPriceRpKWh: 32,
  offPeakStartHour: 21,
  offPeakEndHour: 6,
  // Ballpark 2024-2025 Swiss/EKZ-area figures — all four deliberately below the
  // electricity tariff, matching how feed-in and heating-fuel prices actually sit
  // relative to grid electricity today. Oil (~100 Rp/L, ~10 kWh/L per
  // billing.ts) works out close to gas/district heat per kWh delivered, which
  // matches how the three fuels actually compete with each other in practice.
  feedInPriceRpKWh: 8,
  oilPriceRpPerLiter: 100,
  gasPriceRpKWh: 10,
  districtHeatingPriceRpKWh: 12,
  petrolPriceRpPerLiter: 180, // ~CHF 1.80/L — ballpark 2025 Swiss pump price, blended petrol/diesel
  // Both comfortably below the retail tariff above (18-32 Rp/kWh) — the
  // margin-above-cost shape a real utility's rates are built from. Ballpark
  // figures rather than sourced to one specific real number the way the
  // emissions factors are: recent Swiss/European day-ahead wholesale power
  // has sat roughly in this range, and a small Swiss DSO's own grid-usage
  // fee is a similar order of magnitude.
  wholesalePriceRpKWh: 9,
  gridMaintenanceRpKWh: 6,
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
