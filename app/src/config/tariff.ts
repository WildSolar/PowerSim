/**
 * The utility's tariff sheet at the start (sim/tariffStore.ts publishes one per year), and the
 * benchmarks people judge it by (sim/tariffApproval.ts). All Rp (Rappen, 1/100 CHF). Fuel and
 * wholesale prices are the market's (config/market.ts), not the utility's.
 */

import type { TariffSheet } from "../sim/tariff";

export const DEFAULT_SHEET: TariffSheet = {
  // The energy price, the utility's own (basic supply); the network fee is the regulator's
  // (sim/networkTariff.ts) — together about what households paid before the split.
  energyOffPeakRpKWh: 8,
  energyPeakRpKWh: 16.5,
  offPeakStartHour: 21,
  offPeakEndHour: 6,
  // The network fee's structure, which is the utility's to choose: a monthly base fee per meter,
  // and the off-peak rate as a share of the peak one.
  baseFeeChfPerMonth: 6,
  networkOffPeakShare: 0.6,
  // Ballpark Swiss figures: feed-in and district heat sit below the electricity tariff.
  feedInPriceRpKWh: 8,
  districtHeatingPriceRpKWh: 12,
  // At the municipality's own public chargers (private operators charge their own, config/charging.ts).
  publicChargingAcRpKWh: 45,
  publicChargingDcRpKWh: 55,
  publicChargingFleetRpKWh: 40,
  // No dynamic tariff at the start (config/dynamicTariff.ts).
  dynamicSpreadRpKWh: 0,
};

// The network fee, regulated cost-plus (sim/networkTariff.ts): what the grid costs to run (config/
// market.ts's upkeep per kWh), a return on top, and the capital cost of the reinforcements and
// batteries the town has paid for, spread over their life. Whatever it collects beyond that in a
// year is handed back over the next three, and the shortfall made up the same way.
export const NETWORK_RETURN = 0.03;
export const NETWORK_CAPITAL_ANNUITY = 0.055; // 3.5% over 30 years
export const NETWORK_COVERAGE_YEARS = 3;
/** The share of the town's electricity used in off-peak hours, for splitting the fee. */
export const NETWORK_OFF_PEAK_KWH_SHARE = 0.44;
/** Before the town has a year of its own to go on: a meter's yearly use, about. */
export const NETWORK_KWH_PER_METER_FALLBACK = 10_000;
/** The base fee's range (CHF a month per meter). */
export const BASE_FEE_MAX_CHF_PER_MONTH = 30;

// What a typical household pays elsewhere in Switzerland (ElCom's reference household, about
// 4,500 kWh a year), in Rp/kWh: 2026's median, moving with the wholesale price from then on.
export const BENCHMARK_HOUSEHOLD_RP_KWH = 27.7;
export const BENCHMARK_WHOLESALE_RP_KWH = 9;
/** The reference household's yearly use. */
export const REFERENCE_HOUSEHOLD_KWH = 4500;
/** The share of a household's electricity used in off-peak hours (evenings, nights). */
export const HOUSEHOLD_OFF_PEAK_SHARE = 0.3;
/** The energy price ceiling (sim/tariffCap.ts): a typical household's average energy price may be at
 * most what the utility pays for it — the power bought, the concession fee — plus this share, and
 * its sales costs per kWh: ElCom's "reasonable return" on a monopoly's basic supply. */
export const TARIFF_CAP_MARGIN = 0.2;
export const ENERGY_SALES_COST_RP_KWH = 2;

/** What feed-in and district heat are judged against. */
export const BENCHMARK_FEED_IN_RP_KWH = 8;
export const BENCHMARK_DISTRICT_HEAT_RP_KWH = 12;
