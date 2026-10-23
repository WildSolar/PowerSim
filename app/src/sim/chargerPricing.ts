/**
 * Price windows at the municipality's own chargers. The tariff sheet sets, for each kind of charger,
 * a standard price and two more: one at night (the night rate's hours) and one in the town's solar
 * hours (townSurplus.ts). While they are all the same nothing changes; once one is cheaper, drivers
 * move their charging to it: on the street every car (it stays parked overnight, and the charger
 * charges it in the cheapest hours of that time), at a hub or a shop's car park some of the drivers
 * (they choose when to stop by — a shop only while it's open), at a lorry park some of the lorries
 * (at their midday break, or overnight). Use moved out of the busy hours leaves a hub or a lorry park
 * room for more vehicles. Private operators' chargers keep one price all day.
 *
 * A session pays the price of the window it charges in: a driver who keeps to their usual time pays
 * the solar-hours price too if it happens to fall in them. Pure functions of the site, the sheet and
 * the town's solar hours: nothing to save.
 */

import { PRICE_RESPONSIVE_SHARE, SPREAD_ROOM_BONUS, type ChargingKind } from "../config/charging";
import type { TariffSheet } from "./tariff";
import { townSurplus } from "./townSurplus";

export type PriceWindow = "standard" | "night" | "solar";

export const PRICE_WINDOWS: PriceWindow[] = ["standard", "night", "solar"];

/** What a site's pricing depends on. */
export interface PricedSite {
  kind: ChargingKind;
  owner: "private" | "municipal";
  shop?: boolean;
}

/** How a site's drivers can move their charging: on the street, at a hub (or a shop's car park), at a lorry park. */
export type SiteGroup = keyof typeof PRICE_RESPONSIVE_SHARE;

export function siteGroup(site: PricedSite): SiteGroup {
  return site.kind === "fleet" ? "fleet" : site.kind === "ac" && !site.shop ? "street" : "hub";
}

/** The sheet's prices at a municipal charger of `kind`, by window (Rp/kWh). */
export function windowPrices(sheet: TariffSheet, kind: ChargingKind): Record<PriceWindow, number> {
  switch (kind) {
    case "ac":
      return { standard: sheet.publicChargingAcRpKWh, night: sheet.publicChargingAcNightRpKWh, solar: sheet.publicChargingAcSolarRpKWh };
    case "dc":
      return { standard: sheet.publicChargingDcRpKWh, night: sheet.publicChargingDcNightRpKWh, solar: sheet.publicChargingDcSolarRpKWh };
    case "fleet":
      return { standard: sheet.publicChargingFleetRpKWh, night: sheet.publicChargingFleetNightRpKWh, solar: sheet.publicChargingFleetSolarRpKWh };
  }
}

/** The share of a municipal site's drivers who move to a cheaper window (0 at a private one). */
export function responsiveShare(site: PricedSite): number {
  return site.owner === "municipal" ? PRICE_RESPONSIVE_SHARE[siteGroup(site)] : 0;
}

/** Where a driver who moves charges on a day (`solarDay`: the day has solar hours): the cheapest
 * window open to them, if it is cheaper than the standard price — on the street only the night (the
 * car is parked from the evening), at a shop only the solar hours (it's closed at night). */
export function chosenWindow(prices: Record<PriceWindow, number>, group: SiteGroup, shop: boolean, solarDay: boolean): PriceWindow {
  let best: PriceWindow = "standard";
  if (group !== "street" && solarDay && prices.solar < prices[best]) best = "solar";
  if (!shop && prices.night < prices[best]) best = "night";
  return best;
}

/** What a site's drivers expect to pay over `year`, and how its energy splits over the windows:
 * those who move, on days with solar hours and without, and those who keep to their usual time —
 * in the solar hours now and then. */
export function expectedMix(site: PricedSite, sheet: TariffSheet, year: number): { priceRpKWh: number; shares: Record<PriceWindow, number>; prices: Record<PriceWindow, number>; moved: number } {
  const prices = windowPrices(sheet, site.kind);
  const group = siteGroup(site);
  const responsive = responsiveShare(site);
  const shares: Record<PriceWindow, number> = { standard: 0, night: 0, solar: 0 };
  let moved = 0;
  if (prices.night === prices.standard && prices.solar === prices.standard) {
    shares.standard = 1;
  } else {
    // On the street the car charges on arrival in the evening, never in the day's solar hours.
    const { dayShare, middayCoverage } = group === "street" ? { dayShare: 0, middayCoverage: 0 } : townSurplus.solarYear(year);
    const usual = (weight: number, coverage: number) => {
      shares.standard += weight * (1 - coverage);
      shares.solar += weight * coverage;
    };
    const shop = !!site.shop;
    for (const [days, solarDay] of [
      [dayShare, true],
      [1 - dayShare, false],
    ] as const) {
      if (days <= 0) continue;
      const coverage = solarDay ? middayCoverage / dayShare : 0;
      const w = chosenWindow(prices, group, shop, solarDay);
      if (w === "standard") usual(days * responsive, coverage);
      else {
        shares[w] += days * responsive;
        moved += days * responsive;
      }
      usual(days * (1 - responsive), coverage);
    }
  }
  const priceRpKWh = PRICE_WINDOWS.reduce((sum, w) => sum + shares[w] * prices[w], 0);
  return { priceRpKWh, shares, prices, moved };
}

/** How much more room a site has with its use spread out: none on the street (the cars are parked
 * overnight whenever they charge), up to SPREAD_ROOM_BONUS more elsewhere if all its charging moved. */
export function roomFactor(site: PricedSite, sheet: TariffSheet, year: number): number {
  if (site.owner !== "municipal" || siteGroup(site) === "street") return 1;
  return 1 + SPREAD_ROOM_BONUS * expectedMix(site, sheet, year).moved;
}
