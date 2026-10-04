/**
 * The utility's tariff sheet at the start (sim/tariffStore.ts publishes one per year), and the
 * benchmarks people judge it by (sim/tariffApproval.ts). All Rp (Rappen, 1/100 CHF). Fuel and
 * wholesale prices are the market's (config/market.ts), not the utility's.
 */

import type { TariffSheet } from "../sim/tariff";

export const DEFAULT_SHEET: TariffSheet = {
  offPeakPriceRpKWh: 18,
  peakPriceRpKWh: 32,
  offPeakStartHour: 21,
  offPeakEndHour: 6,
  // Ballpark Swiss figures: feed-in and district heat sit below the electricity tariff.
  feedInPriceRpKWh: 8,
  districtHeatingPriceRpKWh: 12,
  // At the municipality's own public chargers (private operators charge their own, config/charging.ts).
  publicChargingAcRpKWh: 45,
  publicChargingDcRpKWh: 55,
  publicChargingFleetRpKWh: 40,
};

// What a typical household pays elsewhere in Switzerland (ElCom's reference household, about
// 4,500 kWh a year), in Rp/kWh: 2026's median, moving with the wholesale price from then on.
export const BENCHMARK_HOUSEHOLD_RP_KWH = 27.7;
export const BENCHMARK_WHOLESALE_RP_KWH = 9;
/** The reference household's yearly use. */
export const REFERENCE_HOUSEHOLD_KWH = 4500;
/** The share of a household's electricity used in off-peak hours (evenings, nights). */
export const HOUSEHOLD_OFF_PEAK_SHARE = 0.3;
/** What feed-in and district heat are judged against. */
export const BENCHMARK_FEED_IN_RP_KWH = 8;
export const BENCHMARK_DISTRICT_HEAT_RP_KWH = 12;
