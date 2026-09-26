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
 *
 * Starting values live in config/tariff.ts (re-exported below as
 * DEFAULT_TARIFF) — edit that file to recalibrate, not this one.
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
  publicChargingAcRpKWh: number; // at the municipality's own on-street chargers — see publicCharging.ts
  publicChargingDcRpKWh: number; // at the municipality's own fast-charging hubs
  publicChargingFleetRpKWh: number; // at the municipality's own lorry charging parks
  wholesalePriceRpKWh: number; // what the DSO pays upstream per net kWh purchased — see finances.ts
  gridMaintenanceRpKWh: number; // the DSO's own wires/upkeep cost per kWh delivered — see finances.ts
}

export { DEFAULT_TARIFF } from "../config/tariff";

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
