/**
 * Cooling — air conditioning in homes and businesses, and the free cooling a ground-source heat
 * pump gives. Who has it isn't on any register, so it is a seeded draw per building, its odds
 * rising with every hot summer (weather.ts's hot days): rare in Swiss homes today, likelier in new
 * and large ones, common in offices, shops, hotels and hospitals. A draw once passed stays passed,
 * so a building that has cooling keeps it — nothing here needs saving.
 *
 * The load is per m² cooled: what comes in from outside when it is hotter than the setpoint, the
 * sun through the windows, and the heat of the people and equipment inside — the last two are
 * what make an office need cooling on a sunny 22 °C afternoon, while a flat only needs it on a
 * genuinely hot day. A split unit's efficiency falls as it gets hotter outside. A building on a
 * ground-source heat pump cools through its probes instead, gently (the floor can only take so
 * much) and for the pump's power alone — and most of those who could, do.
 */

import { COOLING } from "../config/cooling";
import type { Building } from "../data/types";
import { dayOfWeek, toDateMs } from "./calendar";
import { commercialCategory, commercialOccupancy, totalFloorAreaM2, type CommercialCategory } from "./commercial";
import { currentHeatingSystemId } from "./heatingRenewal";
import { ghiWm2, PEAK_IRRADIANCE_WM2 } from "./pv";
import { hashSeed, mulberry32 } from "./rng";
import { dailyMeanTempC, hotDaysInYear, weatherAt } from "./weather";

const DAY_MS = 24 * 3_600_000;

/** What cooling needs to know about an instant — the same for every building, so worked out once. */
export interface CoolingWeather {
  dailyMeanC: number;
  tempC: number;
  /** Sunshine, 0 (night, overcast) to 1 (a clear midday sky). */
  sun: number;
  hourOfDay: number;
  dow: number;
  /** Hot days since cooling started spreading — what its odds grow with. */
  hotDaysBefore: number;
}

const hotDaysBeforeCache = new Map<number, number>();

/** The hot days of the years from COOLING.spreadFromYear up to (not including) `year`. */
export function hotDaysBefore(year: number): number {
  if (year <= COOLING.spreadFromYear) return 0;
  let n = hotDaysBeforeCache.get(year);
  if (n === undefined) {
    n = hotDaysBefore(year - 1) + hotDaysInYear(year - 1);
    hotDaysBeforeCache.set(year, n);
  }
  return n;
}

export function coolingWeatherAt(simTimeMs: number, dailyMeanC = dailyMeanTempC(simTimeMs), tempC = weatherAt(simTimeMs).tempC): CoolingWeather {
  const dateMs = toDateMs(simTimeMs);
  return {
    dailyMeanC,
    tempC,
    sun: ghiWm2(simTimeMs) / PEAK_IRRADIANCE_WM2,
    hourOfDay: (dateMs % DAY_MS) / 3_600_000,
    dow: dayOfWeek(dateMs),
    hotDaysBefore: hotDaysBefore(new Date(dateMs).getUTCFullYear()),
  };
}

/** A building's fixed facts for cooling: the areas that would be cooled and its seeded draws. */
interface CoolingSite {
  homesAreaM2: number;
  homesBase: number;
  homesDraw: number;
  category: CommercialCategory | null;
  businessAreaM2: number;
  businessBase: number;
  businessDraw: number;
}

const sites = new Map<string, CoolingSite>();

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function siteOf(building: Building): CoolingSite {
  let site = sites.get(building.egid);
  if (site) return site;
  const c = COOLING;
  const homesFloorM2 = building.dwellings.reduce((sum, d) => sum + (d.areaM2 ?? c.homes.fallbackDwellingAreaM2), 0);
  const recency = clamp01(((building.constructionYear ?? c.homes.oldYear) - c.homes.oldYear) / (c.homes.newYear - c.homes.oldYear));
  const size = clamp01((homesFloorM2 - c.homes.smallAreaM2) / (c.homes.largeAreaM2 - c.homes.smallAreaM2));
  const category = commercialCategory(building);
  const businessBase = category ? c.business.baseShare[category] : 0;
  site = {
    homesAreaM2: homesFloorM2 * c.homes.cooledShare,
    homesBase: c.homes.baseShare + c.homes.recencyBoost * recency + c.homes.sizeBoost * size,
    homesDraw: mulberry32(hashSeed(building.egid, "cooling-homes"))(),
    category,
    businessAreaM2: businessBase > 0 ? (totalFloorAreaM2(building) ?? 0) * c.business.cooledShare : 0,
    businessBase,
    businessDraw: mulberry32(hashSeed(building.egid, "cooling-business"))(),
  };
  sites.set(building.egid, site);
  return site;
}

/** The share of homes (or of businesses of a kind) cooling, after `hotDays` hot days. */
function homesShare(site: CoolingSite, hotDays: number): number {
  return Math.min(COOLING.homes.maxShare, site.homesBase + COOLING.homes.perHotDay * hotDays);
}

function businessShare(site: CoolingSite, hotDays: number): number {
  return site.businessBase > 0 ? Math.min(COOLING.business.maxShare, site.businessBase + COOLING.business.perHotDay * hotDays) : 0;
}

export type CoolingKind = "ac" | "ground";

/** Whether a building cools at `simTimeMs`, and how: air conditioning, or through a ground-source
 * heat pump's probes. Null when it doesn't. */
export function coolingKind(building: Building, simTimeMs: number, hotDays = hotDaysBefore(new Date(toDateMs(simTimeMs)).getUTCFullYear())): CoolingKind | null {
  const site = siteOf(building);
  const homesAc = site.homesAreaM2 > 0 && site.homesDraw < homesShare(site, hotDays);
  const businessAc = site.businessAreaM2 > 0 && site.businessDraw < businessShare(site, hotDays);
  // Probes cool for next to nothing: most homes on them use it, cooling or not before.
  const groundCandidate = homesAc || businessAc || (site.homesAreaM2 > 0 && site.homesDraw < COOLING.ground.homesShare);
  if (groundCandidate && currentHeatingSystemId(building, simTimeMs) === "groundHeatPump") return "ground";
  return homesAc || businessAc ? "ac" : null;
}

/** The area a building cools (m²), when it does. */
export function cooledAreaM2(building: Building, simTimeMs: number): number {
  const site = siteOf(building);
  const hotDays = hotDaysBefore(new Date(toDateMs(simTimeMs)).getUTCFullYear());
  const kind = coolingKind(building, simTimeMs, hotDays);
  if (!kind) return 0;
  const homes = kind === "ground" || site.homesDraw < homesShare(site, hotDays) ? site.homesAreaM2 : 0;
  const business = site.businessDraw < businessShare(site, hotDays) ? site.businessAreaM2 : 0;
  return homes + business;
}

/** Heat to remove from a cooled home, per m² (W): only on a hot day, once it is warm outside. */
function homesLoadWPerM2(w: CoolingWeather): number {
  const h = COOLING.homes;
  if (w.dailyMeanC < h.dayMeanOnC || w.tempC < h.onC) return 0;
  return Math.min(h.maxWPerM2, Math.max(0, h.internalWPerM2 + h.sunWPerM2 * w.sun + h.wPerM2K * (w.tempC - h.setpointC)));
}

/** Heat to remove from a cooled business, per m² (W): while it is open, its people, equipment and
 * the sun make it warm well before the day is hot. */
function businessLoadWPerM2(category: CommercialCategory, w: CoolingWeather): number {
  const b = COOLING.business;
  if (w.tempC < b.onC) return 0;
  const occupancy = commercialOccupancy(category, w.hourOfDay, w.dow);
  const load = b.internalWPerM2 + b.sunWPerM2 * w.sun + b.wPerM2K * (w.tempC - b.setpointC);
  return Math.min(b.maxWPerM2, Math.max(0, load)) * (b.idleShare + (1 - b.idleShare) * occupancy);
}

/** A split unit's efficiency (heat removed per unit of power), lower the hotter it is outside. */
function acEfficiency(tempC: number): number {
  const e = COOLING.efficiency;
  return Math.min(e.max, Math.max(e.min, e.at20C - e.dropPerC * (tempC - 20)));
}

/** A building's cooling power at an instant (W), split into its homes' and its businesses'. */
export function coolingPowerSplitW(building: Building, w: CoolingWeather, simTimeMs: number): { homesW: number; businessW: number } {
  const site = siteOf(building);
  if (site.homesAreaM2 === 0 && site.businessAreaM2 === 0) return { homesW: 0, businessW: 0 };
  // Nothing to cool: skip the ownership checks.
  if (w.tempC < Math.min(COOLING.homes.onC, COOLING.business.onC)) return { homesW: 0, businessW: 0 };
  const kind = coolingKind(building, simTimeMs, w.hotDaysBefore);
  if (!kind) return { homesW: 0, businessW: 0 };
  const homesArea = kind === "ground" || site.homesDraw < homesShare(site, w.hotDaysBefore) ? site.homesAreaM2 : 0;
  const businessArea = site.category && site.businessDraw < businessShare(site, w.hotDaysBefore) ? site.businessAreaM2 : 0;
  let homesQ = homesArea > 0 ? homesLoadWPerM2(w) : 0;
  let businessQ = businessArea > 0 && site.category ? businessLoadWPerM2(site.category, w) : 0;
  let efficiency = acEfficiency(w.tempC);
  if (kind === "ground") {
    homesQ = Math.min(homesQ, COOLING.ground.maxWPerM2);
    businessQ = Math.min(businessQ, COOLING.ground.maxWPerM2);
    efficiency = COOLING.ground.efficiency;
  }
  return { homesW: (homesQ * homesArea) / efficiency, businessW: (businessQ * businessArea) / efficiency };
}

/** Takes the instant's cooling weather from the caller — see heatPump.ts's equivalent for why. */
export function acPowerWWithWeather(building: Building, w: CoolingWeather, simTimeMs: number): number {
  const { homesW, businessW } = coolingPowerSplitW(building, w, simTimeMs);
  return homesW + businessW;
}

export function acPowerW(building: Building, simTimeMs: number): number {
  return acPowerWWithWeather(building, coolingWeatherAt(simTimeMs), simTimeMs);
}
