/**
 * Price windows at the municipality's own chargers. The tariff sheet sets, for each kind of charger,
 * a standard price and two more: one at night (the night rate's hours) and one in the town's solar
 * hours (townSurplus.ts). While they are all the same nothing changes; once one is cheaper, drivers
 * move their charging to it: on the street every car (it stays parked overnight, and the charger
 * charges it in the cheapest hours of that time — or, on a day its driver is at home, in the day's
 * solar hours, if they are cheaper still), at a hub or a shop's car park some of the drivers
 * (they choose when to stop by — a shop only while it's open), at a lorry park some of the lorries
 * (at their midday break, or overnight). Use moved out of the busy hours leaves a hub or a lorry park
 * room for more vehicles. Private operators' chargers keep one price all day.
 *
 * A session pays the price of the window it charges in: a driver who keeps to their usual time pays
 * the solar-hours price too if it happens to fall in them. Pure functions of the site, the sheet and
 * the town's solar hours: nothing to save.
 */

import { PRICE_RESPONSIVE_SHARE, SPREAD_ROOM_BONUS, type ChargingKind } from "../config/charging";
import { HOME_WEEKDAY_SHARE } from "../config/townSurplus";
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

/** The share of days an on-street car's driver is at home by day: every weekend, and some weekdays
 * (home office, part-time, retired) — the days it can charge in the solar hours. */
export const STREET_HOME_DAY_SHARE = (2 + 5 * HOME_WEEKDAY_SHARE) / 7;

/** Where a driver who moves charges on a day: the cheapest window open to them that day, if it is
 * cheaper than the standard price. The solar hours are open on a day that has them — on the street
 * only if the driver is at home by day; the night everywhere but at a shop (it's closed). */
export function chosenWindow(prices: Record<PriceWindow, number>, open: { solar: boolean; night: boolean }): PriceWindow {
  let best: PriceWindow = "standard";
  if (open.solar && prices.solar < prices[best]) best = "solar";
  if (open.night && prices.night < prices[best]) best = "night";
  return best;
}

/** What a site's drivers expect to pay over `year`, and how its energy splits over the windows:
 * those who move, on days the solar hours are open to them and the others, and those who keep to
 * their usual time — in the solar hours now and then, except on the street (in the evening). Also
 * the share of the year's days with solar hours at all. */
export function expectedMix(
  site: PricedSite,
  sheet: TariffSheet,
  year: number,
): { priceRpKWh: number; shares: Record<PriceWindow, number>; prices: Record<PriceWindow, number>; moved: number; solarDays: number } {
  const prices = windowPrices(sheet, site.kind);
  const group = siteGroup(site);
  const responsive = responsiveShare(site);
  const shares: Record<PriceWindow, number> = { standard: 0, night: 0, solar: 0 };
  let moved = 0;
  let solarDays = 0;
  if (prices.night === prices.standard && prices.solar === prices.standard) {
    shares.standard = 1;
  } else {
    const { dayShare, middayCoverage } = townSurplus.solarYear(year);
    solarDays = dayShare;
    const usual = (weight: number, coverage: number) => {
      shares.standard += weight * (1 - coverage);
      shares.solar += weight * coverage;
    };
    const street = group === "street";
    // On the street the solar hours are open only on the days the driver is at home, and a car
    // charging at its usual time does so in the evening, never in them.
    const solarOpen = street ? dayShare * STREET_HOME_DAY_SHARE : dayShare;
    const night = !site.shop;
    for (const [days, solar] of [
      [solarOpen, true],
      [1 - solarOpen, false],
    ] as const) {
      if (days <= 0) continue;
      const coverage = solar && !street ? middayCoverage / dayShare : 0;
      const w = chosenWindow(prices, { solar, night });
      if (w === "standard") usual(days * responsive, coverage);
      else {
        shares[w] += days * responsive;
        moved += days * responsive;
      }
      usual(days * (1 - responsive), coverage);
    }
  }
  const priceRpKWh = PRICE_WINDOWS.reduce((sum, w) => sum + shares[w] * prices[w], 0);
  return { priceRpKWh, shares, prices, moved, solarDays };
}

/** How much more room a site has with its use spread out: none on the street (the cars are parked
 * overnight whenever they charge), up to SPREAD_ROOM_BONUS more elsewhere if all its charging moved. */
export function roomFactor(site: PricedSite, sheet: TariffSheet, year: number): number {
  if (site.owner !== "municipal" || siteGroup(site) === "street") return 1;
  return 1 + SPREAD_ROOM_BONUS * expectedMix(site, sheet, year).moved;
}
