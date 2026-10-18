/**
 * Prices, as everything in the simulation reads them (tariffStore.ts puts them together for a
 * moment in time):
 *
 *  - The utility's tariff sheet (TariffSheet), published once a year: a simple time-of-use
 *    electricity price — a cheaper off-peak rate overnight (21:00-06:00) and a dearer peak rate —
 *    plus what solar feed-in earns, what district heat costs, and the municipality's own charging
 *    prices, and whether households may opt for a dynamic tariff instead (dynamicTariff.ts). See
 *    tariffStore.ts for the yearly publication.
 *  - Market prices (market.ts), which nobody in the game sets: heating oil (per litre, as it is
 *    sold), gas, petrol and diesel, and the wholesale electricity the utility buys.
 *  - The utility's grid upkeep per kWh (config/market.ts), a cost, not a price.
 *
 * See billing.ts and finances.ts for where each turns into money.
 */

/** What the utility publishes for a calendar year. */
export interface TariffSheet {
  energyOffPeakRpKWh: number; // the energy price (basic supply), off-peak
  energyPeakRpKWh: number; // ...and peak
  offPeakStartHour: number; // e.g. 21 — off-peak begins in the evening
  offPeakEndHour: number; // e.g. 6 — off-peak ends the next morning
  baseFeeChfPerMonth: number; // the network's monthly base fee per meter
  networkOffPeakShare: number; // the off-peak network fee as a share of the peak one (the regulator sets the level — networkTariff.ts)
  feedInBonusRpKWh: number; // the utility's own bonus on top of the federal feed-in price (feedIn.ts)
  districtHeatingPriceRpKWh: number; // per kWh of heat delivered
  publicChargingAcRpKWh: number; // at the municipality's own on-street chargers — see publicCharging.ts
  publicChargingDcRpKWh: number; // at the municipality's own fast-charging hubs
  publicChargingFleetRpKWh: number; // at the municipality's own lorry charging parks
  dynamicMarginRpKWh: number; // the dynamic tariff's margin on the day-ahead price; 0: not offered — see dynamicTariff.ts
}

/** Every price at one moment: the year's sheet plus the month's market prices and the grid upkeep —
 * and what a kWh costs in all, energy and network fee together. */
export interface Tariff extends TariffSheet {
  networkPeakRpKWh: number; // the regulated network fee per kWh, peak (networkTariff.ts)
  networkOffPeakRpKWh: number; // ...and off-peak
  networkAvgRpKWh: number; // ...flat through the day, as on the dynamic tariff
  peakPriceRpKWh: number; // energy and network together, peak — what a kWh costs a consumer in basic supply
  offPeakPriceRpKWh: number; // ...off-peak
  baseFeeRpPerMonth: number; // the base fee, per meter and month
  feedInPriceRpKWh: number; // what solar fed into the grid earns this quarter: the reference market price (or the federal minimum) and the bonus
  feedInExpectedRpKWh: number; // ...over the year, as an owner weighing panels expects it
  oilPriceRpPerLiter: number; // per liter of heating oil burned
  gasPriceRpKWh: number; // per kWh of gas burned (not thermal delivered — see billing.ts)
  woodPelletPriceRpKWh: number; // per kWh of wood pellets burned
  petrolPriceRpPerLiter: number; // per liter of petrol/diesel burned by an ICE car — see mobility.ts
  wholesalePriceRpKWh: number; // what the DSO pays upstream per net kWh purchased — see finances.ts
  gridMaintenanceRpKWh: number; // the DSO's own wires/upkeep cost per kWh delivered — see finances.ts
}

export { DEFAULT_SHEET } from "../config/tariff";

export function isOffPeakHour(tariff: Tariff, hourOfDay: number): boolean {
  return hourOfDay >= tariff.offPeakStartHour || hourOfDay < tariff.offPeakEndHour;
}

/** A cache/effect key for "the tariff prices that affect when power is drawn" —
 * the two time-of-use prices and the dynamic tariff's spread (the off-peak window
 * is fixed), so this deliberately ignores offPeakStartHour/offPeakEndHour rather
 * than invalidating a cache over a value that never actually changes. */
export function tariffKey(tariff: Tariff): string {
  return `${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}:${tariff.dynamicMarginRpKWh}`;
}
