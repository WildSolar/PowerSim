/**
 * Starting values for the player-adjustable tariff (sim/tariff.ts defines
 * the Tariff shape and tariffStore.ts holds the live, player-editable
 * value — this is only where it *starts*). All Rp (Rappen, 1/100 CHF).
 * See sim/tariff.ts's own doc for what each field actually prices.
 */

import type { Tariff } from "../sim/tariff";

export const DEFAULT_TARIFF: Tariff = {
  offPeakPriceRpKWh: 18,
  peakPriceRpKWh: 32,
  offPeakStartHour: 21,
  offPeakEndHour: 6,

  // Ballpark 2024-2025 Swiss/EKZ-area figures — all four deliberately below
  // the electricity tariff, matching how feed-in and heating-fuel prices
  // actually sit relative to grid electricity today. Oil (~100 Rp/L, ~10
  // kWh/L) works out close to gas/district heat per kWh delivered, matching
  // how the three fuels actually compete with each other in practice.
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
