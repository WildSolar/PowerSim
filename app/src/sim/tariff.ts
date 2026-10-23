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
  // ...the same at night (the night rate's hours) and in the town's solar hours (chargerPricing.ts)
  publicChargingAcNightRpKWh: number;
  publicChargingDcNightRpKWh: number;
  publicChargingFleetNightRpKWh: number;
  publicChargingAcSolarRpKWh: number;
  publicChargingDcSolarRpKWh: number;
  publicChargingFleetSolarRpKWh: number;
  dynamicMarginRpKWh: number; // the dynamic tariff's margin on the day-ahead price; 0: not offered — see dynamicTariff.ts
  // The charging tariff: a wallbox on its own meter, at its own price (chargingTariff.ts).
  chargingTariffOffered: boolean;
  chargingEnergyRpKWh: number; // the energy price on the charging meter, flat through the day
  chargingMeterFeeChfPerMonth: number; // what the second meter costs a month
  chargingControlled: boolean; // false: power only in the night rate; true: the utility decides when
  chargingNetworkDiscount: number; // 0-0.6: off the network fee for a utility-controlled wallbox
  chargingSolarEnergyRpKWh: number; // the energy price in the town's solar hours, for a utility-controlled wallbox (townSurplus.ts)
}

/** Every price at one moment: the year's sheet plus the month's market prices and the grid upkeep —
 * and what a kWh costs in all, energy and network fee together. */
export interface Tariff extends TariffSheet {
  networkPeakRpKWh: number; // the regulated network fee per kWh, peak (networkTariff.ts)
  networkOffPeakRpKWh: number; // ...and off-peak
  networkAvgRpKWh: number; // ...flat through the day, as on the dynamic tariff
  chargingNetworkRpKWh: number; // ...on the charging meter: the night rate's, or (utility-controlled) the flat one less the discount
  chargingPriceRpKWh: number; // what a kWh costs on the charging meter, energy and network fee together
  chargingSolarPriceRpKWh: number; // ...in the town's solar hours, on a utility-controlled one
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

/** Each kind's standard price on the sheet, and its night and solar-hours prices. */
export const WINDOW_FIELDS = {
  publicChargingAcRpKWh: ["publicChargingAcNightRpKWh", "publicChargingAcSolarRpKWh"],
  publicChargingDcRpKWh: ["publicChargingDcNightRpKWh", "publicChargingDcSolarRpKWh"],
  publicChargingFleetRpKWh: ["publicChargingFleetNightRpKWh", "publicChargingFleetSolarRpKWh"],
} as const satisfies Record<string, readonly (keyof TariffSheet)[]>;

/** A sheet with a standard price changed: its night and solar-hours prices follow, unless set apart. */
export function withStandardPrice(sheet: TariffSheet, key: keyof TariffSheet, value: number): TariffSheet {
  const next = { ...sheet, [key]: value };
  if (key in WINDOW_FIELDS) {
    for (const w of WINDOW_FIELDS[key as keyof typeof WINDOW_FIELDS]) if (sheet[w] === sheet[key]) next[w] = value;
  }
  return next;
}

/** A saved sheet from before the price windows: none set apart. */
export function withWindowDefaults(sheet: Partial<TariffSheet>): Partial<TariffSheet> {
  const out = { ...sheet };
  for (const [standard, windows] of Object.entries(WINDOW_FIELDS) as [keyof typeof WINDOW_FIELDS, readonly (keyof TariffSheet)[]][]) {
    const price = sheet[standard];
    if (price === undefined) continue;
    for (const w of windows) if (out[w] === undefined) (out as Record<string, unknown>)[w] = price;
  }
  return out;
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
  return `${tariff.offPeakPriceRpKWh}:${tariff.peakPriceRpKWh}:${tariff.dynamicMarginRpKWh}:${tariff.chargingTariffOffered ? `${tariff.chargingPriceRpKWh}:${tariff.chargingControlled}` : "-"}`;
}
