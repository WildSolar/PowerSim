/**
 * Cars charging at the town's workplaces. Everyone who works in the town and drives an electric car
 * to an employer with chargers — residents and commuters alike — charges there on working days. A
 * building's staff is its jobs (BFS STATENT by hectare, Building.jobs); the cars are worked out as
 * expected numbers, not car by car: the staff who come by car (by the public transport class where
 * the building stands), the region's share of electric cars (commuters' cars are other towns', so the
 * town's own measures don't move it), and the share of employers with chargers
 * (publicCharging.workChargingShareAt — the workplace charging programme raises it). Most charge as
 * soon as they arrive; load management spreads the rest over the sunny hours — most of it, with the
 * programme set to charge with the sun.
 *
 * Residents' own charging at work (publicCharging.ts) is another matter: it lowers what they charge
 * at home or in public, and happens wherever they work, mostly elsewhere — it isn't drawn here.
 * Buildings put up during the game have no jobs on record, so no staff cars. Pure functions of the
 * building, the time and the policy: nothing to save.
 */

import {
  REGIONAL_EV_CAR_SHARE,
  WORK_ARRIVAL_HOURS,
  WORK_CAR_COMMUTE_SHARE,
  WORK_CHARGE_KWH_PER_DAY,
  WORK_CHARGER_KW,
  WORK_CHARGING_WITH_SUN_SHARE,
  WORK_SUN_HOURS,
  WORK_WEEKEND_FACTOR,
} from "../config/charging";
import { interpolateCurve } from "../config/curve";
import type { Building } from "../data/types";
import { dayOfWeek, toDateMs } from "./calendar";
import { existsAt } from "./lifetime";
import { policyStore } from "./policy";
import { workChargingShareAt } from "./publicCharging";
import { transit } from "./transit";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const YEAR_MS = 365.25 * DAY_MS;

/** The staff who come to `building` by car (full-time equivalents): fixed for a building. */
const carStaffCache = new WeakMap<Building, number>();

function carStaff(building: Building): number {
  let n = carStaffCache.get(building);
  if (n === undefined) {
    n = (building.jobs ?? 0) * WORK_CAR_COMMUTE_SHARE[transit.classOf(building)];
    carStaffCache.set(building, n);
  }
  return n;
}

/** The share of a building's car-borne staff who charge an electric car at work at `atMs`. */
function chargingShareAt(atMs: number): number {
  const year = new Date(toDateMs(atMs)).getUTCFullYear() + (toDateMs(atMs) % YEAR_MS) / YEAR_MS;
  return interpolateCurve(REGIONAL_EV_CAR_SHARE, year) * workChargingShareAt(atMs);
}

/** What one car charging at work draws at `atMs` (kW), on average over the cars: those charging as
 * they arrive, and those whose charge load management spreads over the sunny hours. */
function perCarKwAt(atMs: number): number {
  const dow = dayOfWeek(toDateMs(atMs));
  const day = dow === 6 ? WORK_WEEKEND_FACTOR.saturday : dow === 0 ? WORK_WEEKEND_FACTOR.sunday : 1;
  const hour = (((atMs % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS;
  const withSun = policyStore.get().workChargingWithSun ? WORK_CHARGING_WITH_SUN_SHARE.programme : WORK_CHARGING_WITH_SUN_SHARE.base;
  // As they arrive: arrivals spread evenly over the arrival hours, each charging until the day's
  // energy is in — the share of cars charging at `hour` is the share that arrived within that time.
  const [a0, a1] = WORK_ARRIVAL_HOURS;
  const duration = WORK_CHARGE_KWH_PER_DAY / WORK_CHARGER_KW;
  const arrived = Math.max(0, Math.min(hour, a1) - Math.max(hour - duration, a0)) / (a1 - a0);
  const onArrivalKw = WORK_CHARGER_KW * arrived;
  // With the sun: the day's energy over the sunny hours, most at midday (a half sine).
  const [s0, s1] = WORK_SUN_HOURS;
  const sunKw = hour > s0 && hour < s1 ? (WORK_CHARGE_KWH_PER_DAY * Math.sin((Math.PI * (hour - s0)) / (s1 - s0)) * Math.PI) / (2 * (s1 - s0)) : 0;
  return day * ((1 - withSun) * onArrivalKw + withSun * sunKw);
}

/** Electric cars charging at `building` on a working day around `atMs` (expected number). */
export function workChargingCars(building: Building, atMs: number): number {
  if (!building.jobs || !existsAt(building, atMs)) return 0;
  return carStaff(building) * chargingShareAt(atMs);
}

/** What the staff cars charging at `building` draw at `atMs` (W). */
export function workChargingPowerW(building: Building, atMs: number): number {
  if (!building.jobs) return 0;
  const cars = workChargingCars(building, atMs);
  return cars > 0 ? cars * perCarKwAt(atMs) * 1000 : 0;
}

/** The buildings with staff, once per building list (the stock hands out a new list when it changes). */
const withStaff = new WeakMap<Building[], Building[]>();

/** Every workplace's staff cars charging at `atMs` (W). */
export function totalWorkChargingPowerW(buildings: Building[], atMs: number): number {
  let list = withStaff.get(buildings);
  if (!list) {
    list = buildings.filter((b) => (b.jobs ?? 0) > 0);
    withStaff.set(buildings, list);
  }
  const perCarW = perCarKwAt(atMs) * 1000;
  if (perCarW === 0) return 0;
  const share = chargingShareAt(atMs);
  let staff = 0;
  for (const b of list) if (existsAt(b, atMs)) staff += carStaff(b);
  return staff * share * perCarW;
}
