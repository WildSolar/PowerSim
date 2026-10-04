/**
 * Prices, as everything in the simulation reads them (tariffStore.ts puts them together for a
 * moment in time):
 *
 *  - The utility's tariff sheet (TariffSheet), published once a year: a simple time-of-use
 *    electricity price — a cheaper off-peak rate overnight (21:00-06:00) and a dearer peak rate —
 *    plus what solar feed-in earns, what district heat costs, and the municipality's own charging
 *    prices. See tariffStore.ts for the yearly publication.
 *  - Market prices (market.ts), which nobody in the game sets: heating oil (per litre, as it is
 *    sold), gas, petrol and diesel, and the wholesale electricity the utility buys.
 *  - The utility's grid upkeep per kWh (config/market.ts), a cost, not a price.
 *
 * See billing.ts and finances.ts for where each turns into money.
 */

/** What the utility publishes for a calendar year. */
export interface TariffSheet {
  offPeakPriceRpKWh: number;
  peakPriceRpKWh: number;
  offPeakStartHour: number; // e.g. 21 — off-peak begins in the evening
  offPeakEndHour: number; // e.g. 6 — off-peak ends the next morning
  feedInPriceRpKWh: number; // grid feed-in remuneration for exported solar
  districtHeatingPriceRpKWh: number; // per kWh of heat delivered
  publicChargingAcRpKWh: number; // at the municipality's own on-street chargers — see publicCharging.ts
  publicChargingDcRpKWh: number; // at the municipality's own fast-charging hubs
  publicChargingFleetRpKWh: number; // at the municipality's own lorry charging parks
}

/** Every price at one moment: the year's sheet plus the month's market prices and the grid upkeep. */
export interface Tariff extends TariffSheet {
  oilPriceRpPerLiter: number; // per liter of heating oil burned
  gasPriceRpKWh: number; // per kWh of gas burned (not thermal delivered — see billing.ts)
  petrolPriceRpPerLiter: number; // per liter of petrol/diesel burned by an ICE car — see mobility.ts
  wholesalePriceRpKWh: number; // what the DSO pays upstream per net kWh purchased — see finances.ts
  gridMaintenanceRpKWh: number; // the DSO's own wires/upkeep cost per kWh delivered — see finances.ts
}

export { DEFAULT_SHEET } from "../config/tariff";

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
