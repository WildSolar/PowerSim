/**
 * Home batteries next to rooftop solar: how one runs through the day, and what it does to the
 * building's draw from the grid. Who has one is solarAdoption.ts's business (bought with the panels,
 * added later, seeded for registered systems); it hands the battery over on the building's PV plant
 * (PowerPlant.battery).
 *
 * A battery's charge depends on the whole day so far, while everything else in the power model is a
 * pure function of the moment. So each battery's day is worked out once, at half hours, and kept: the
 * sun on its building's panels, the building's own use (sampled every four hours and drawn between),
 * and from those what the battery takes in and gives back at each half hour — never more than it
 * has room for, and HOME_BATTERY_ROUND_TRIP of what it took in. It starts the day with what was left
 * of the night before. A battery at a given moment then does what its day says for that half hour,
 * as far as the building's actual use allows: it charges no more than the building has to spare,
 * and gives no more than the building draws.
 *
 * In plain self-consumption it charges from any surplus, so on a sunny day it is full by mid-morning.
 * In grid-friendly operation it charges as a forecast-based system does: only from the part of the
 * building's surplus above the level that just fills it over the day — the top of the midday peak —
 * and the system never feeds in more than its cap (the rest, once the battery is full, is curtailed).
 * A solar feed-in limit (the law) caps feed-in the same way.
 */

import { HOME_BATTERY_ROUND_TRIP } from "../config/homeBattery";
import type { Building, PowerPlant } from "../data/types";
import { buildingLoadW } from "./buildingPower";
import { toDateMs, toSimTimeMs } from "./calendar";
import { policyStore } from "./policy";
import { irradianceWm2, pvPowerWAt } from "./pv";
import { topSliceLevel } from "./peakShave";
import { snowDepthCm } from "./snow";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const STEPS_PER_DAY = 48; // half hours
const STEP_HOURS = 24 / STEPS_PER_DAY;
const STEP_HOURS_EACH = new Float32Array(STEPS_PER_DAY).fill(STEP_HOURS);
// When a building's own use is sampled for its battery's day (hours); drawn between them, round the clock.
const LOAD_SAMPLE_HOURS = [2, 6, 10, 14, 18, 22];
// Days of batteries kept (the map's day, the statistics' yesterday, the grid's readings).
const DAYS_KEPT = 12;

export interface HomeBattery {
  kwh: number;
  kw: number;
  /** Grid-friendly operation: feed-in held to this share of the array's rating. Null: plain
   * self-consumption. */
  feedInCap: number | null;
}

/** One battery's day. */
interface BatteryDay {
  /** What it does in each half hour (W): positive charging, negative discharging. */
  flowW: Float32Array;
  /** How much it holds at the day's end (kWh): the next day starts with it. */
  endKWh: number;
  /** The battery it was worked out for (a new or larger one starts afresh). */
  kwh: number;
}

// Kept by day (by date), then building. `firstGuesses` holds the days worked out only to give the
// next day its start (from an empty battery), so a day never reaches back further than one day.
const days = new Map<number, Map<string, BatteryDay>>();
const firstGuesses = new Map<number, Map<string, BatteryDay>>();
const loadSamples = new Map<number, Map<string, Float32Array>>();
const sunByDay = new Map<number, Float32Array>();

function dayMap<T>(byDay: Map<number, Map<string, T>>, day: number): Map<string, T> {
  let m = byDay.get(day);
  if (!m) {
    if (byDay.size >= DAYS_KEPT) byDay.delete(byDay.keys().next().value as number);
    m = new Map();
    byDay.set(day, m);
  }
  return m;
}

/** The light on the panels at each half hour of `day` (days since 1970, by date). */
function sunOf(day: number): Float32Array {
  let sun = sunByDay.get(day);
  if (!sun) {
    if (sunByDay.size >= DAYS_KEPT) sunByDay.delete(sunByDay.keys().next().value as number);
    const snow = snowDepthCm(toSimTimeMs(day * DAY_MS + 12 * HOUR_MS));
    sun = Float32Array.from({ length: STEPS_PER_DAY }, (_, i) => irradianceWm2(toSimTimeMs(day * DAY_MS + (i + 0.5) * STEP_HOURS * HOUR_MS), snow));
    sunByDay.set(day, sun);
  }
  return sun;
}

/** The building's own use (W) at each of LOAD_SAMPLE_HOURS of `day`. */
function loadsOf(building: Building, day: number): Float32Array {
  const m = dayMap(loadSamples, day);
  let loads = m.get(building.egid);
  if (!loads) {
    loads = Float32Array.from(LOAD_SAMPLE_HOURS, (h) => buildingLoadW(building, toSimTimeMs(day * DAY_MS + h * HOUR_MS)));
    m.set(building.egid, loads);
  }
  return loads;
}

/** The building's own use at `hour` of the day, drawn between the samples (round midnight too). */
function loadAtHour(loads: Float32Array, hour: number): number {
  const n = LOAD_SAMPLE_HOURS.length;
  let j = LOAD_SAMPLE_HOURS.findIndex((h) => h > hour);
  if (j === -1) j = n; // past the last sample: towards the first one, tomorrow
  const i = j - 1;
  const h0 = i < 0 ? LOAD_SAMPLE_HOURS[n - 1] - 24 : LOAD_SAMPLE_HOURS[i];
  const h1 = j >= n ? LOAD_SAMPLE_HOURS[0] + 24 : LOAD_SAMPLE_HOURS[j];
  const l0 = loads[(i + n) % n];
  const l1 = loads[j % n];
  return l0 + ((l1 - l0) * (hour - h0)) / (h1 - h0);
}

/** What a battery gives the building in half an hour (W): its power, the building's draw, what it holds. */
function dischargeW(maxW: number, drawW: number, storedKWh: number): number {
  return Math.min(maxW, drawW, (storedKWh * HOME_BATTERY_ROUND_TRIP * 1000) / STEP_HOURS);
}

/** The battery's day: from the sun on the building's arrays and its sampled use, what it takes in
 * and gives back at each half hour. Starts with what was left of the day before (worked out from an empty battery) —
 * or, for a first guess, empty. */
function batteryDay(building: Building, arrays: PowerPlant[], battery: HomeBattery, ratedW: number, day: number, firstGuess: boolean): BatteryDay {
  const byEgid = dayMap(firstGuess ? firstGuesses : days, day);
  const known = byEgid.get(building.egid);
  if (known && known.kwh === battery.kwh) return known;

  const start = firstGuess ? 0 : batteryDay(building, arrays, battery, ratedW, day - 1, true).endKWh;
  const sun = sunOf(day);
  const loads = loadsOf(building, day);
  const surplusW = new Float32Array(STEPS_PER_DAY);
  for (let i = 0; i < STEPS_PER_DAY; i++) {
    const hour = (i + 0.5) * STEP_HOURS;
    const t = toSimTimeMs(day * DAY_MS + hour * HOUR_MS);
    let gen = 0;
    for (const plant of arrays) gen -= pvPowerWAt(plant, t, sun[i]);
    surplusW[i] = gen - loadAtHour(loads, hour);
  }
  const maxW = battery.kw * 1000;

  // Grid-friendly: the level of the day's surplus above which what's left just fills the battery —
  // the room it has once the night's discharge is over — and never above the feed-in cap.
  let thresholdW = 0;
  if (battery.feedInCap !== null) {
    let morning = start;
    for (let i = 0; i < STEPS_PER_DAY && surplusW[i] <= 0; i++) morning -= (dischargeW(maxW, -surplusW[i], morning) / 1000 / HOME_BATTERY_ROUND_TRIP) * STEP_HOURS;
    thresholdW = topSliceLevel(surplusW, STEP_HOURS_EACH, maxW, (battery.kwh - morning) * 1000);
    const law = policyStore.get().feedInLimitPct / 100;
    thresholdW = Math.min(thresholdW, Math.min(law, battery.feedInCap) * ratedW);
  }

  const flowW = new Float32Array(STEPS_PER_DAY);
  let stored = start;
  for (let i = 0; i < STEPS_PER_DAY; i++) {
    const s = surplusW[i];
    if (s > thresholdW) flowW[i] = Math.min(maxW, s - thresholdW, ((battery.kwh - stored) * 1000) / STEP_HOURS);
    else if (s < 0) flowW[i] = -dischargeW(maxW, -s, stored);
    stored += flowW[i] > 0 ? (flowW[i] / 1000) * STEP_HOURS : (flowW[i] / 1000 / HOME_BATTERY_ROUND_TRIP) * STEP_HOURS;
  }
  const result: BatteryDay = { flowW, endKWh: stored, kwh: battery.kwh };
  byEgid.set(building.egid, result);
  return result;
}

// Each plant list's solar arrays by building, made the first time a building is looked up in it:
// a pass over the town asks for every building, and scanning the whole list each time made it
// buildings × plants. The lists aren't changed once handed out (effectivePowerPlantsAt makes a
// fresh one each call), so an index stays good for as long as its list lives.
const arraysByEgid = new WeakMap<PowerPlant[], Map<string, PowerPlant[]>>();

function arraysOf(plants: PowerPlant[], egid: string): PowerPlant[] {
  let index = arraysByEgid.get(plants);
  if (!index) {
    index = new Map();
    for (const plant of plants) {
      if (!plant.egid || plant.technology !== "Photovoltaic") continue;
      const list = index.get(plant.egid);
      if (list) list.push(plant);
      else index.set(plant.egid, [plant]);
    }
    arraysByEgid.set(plants, index);
  }
  return index.get(egid) ?? NO_ARRAYS;
}
const NO_ARRAYS: PowerPlant[] = [];

export interface SolarAndBattery {
  /** What the panels generate (W, positive). */
  generationW: number;
  /** The battery: positive while charging, negative while discharging. */
  batteryW: number;
  /** Generation thrown away to keep feed-in under a cap (W). */
  curtailedW: number;
  /** The whole lot's effect on the building's power: −generation + battery + curtailed. */
  netW: number;
  battery: HomeBattery | null;
}

/** A building's solar and battery together at `simTimeMs`, against the rest of its use (`load`: in W,
 * or a function that works it out — called only when the answer depends on it: not while the panels
 * make nothing and the battery is empty, the building's use being all from the grid then either way). */
export function solarAndBatteryAt(building: Building, plants: PowerPlant[], simTimeMs: number, load: number | (() => number), snowCoverCm?: number): SolarAndBattery {
  const arrays = arraysOf(plants, building.egid);
  let generationW = 0;
  let batteryGenW = 0;
  let ratedW = 0;
  let kwh = 0;
  let kw = 0;
  let cap: number | null = null;
  let irradiance: number | null = null;
  let snow = snowCoverCm;
  for (const plant of arrays) {
    snow ??= snowDepthCm(simTimeMs);
    irradiance ??= irradianceWm2(simTimeMs, snow);
    const w = -pvPowerWAt(plant, simTimeMs, irradiance);
    generationW += w;
    if (plant.battery && (plant.activeToMs === undefined || simTimeMs < plant.activeToMs)) {
      batteryGenW += w;
      ratedW += (plant.capacityKw ?? 0) * 1000;
      kwh += plant.battery.kwh;
      kw += plant.battery.kw;
      if (plant.battery.feedInCap !== null) cap = Math.min(cap ?? 1, plant.battery.feedInCap);
    }
  }
  if (kwh <= 0) return { generationW, batteryW: 0, curtailedW: 0, netW: -generationW, battery: null };

  const battery: HomeBattery = { kwh, kw, feedInCap: cap };
  const dateMs = toDateMs(simTimeMs);
  const day = Math.floor(dateMs / DAY_MS);
  const step = Math.min(STEPS_PER_DAY - 1, Math.floor((dateMs - day * DAY_MS) / HOUR_MS / STEP_HOURS));
  const plannedW = batteryDay(building, arrays, battery, ratedW, day, false).flowW[step];
  // Nothing to charge from, and nothing to give: the building's use doesn't matter.
  if (generationW <= 0 && plannedW >= 0 && typeof load === "function") return { generationW, batteryW: 0, curtailedW: 0, netW: -generationW, battery };
  const loadW = typeof load === "function" ? load() : load;
  const surplusW = generationW - loadW;

  // What its day says, as far as the building allows: no charging from the grid, no feeding in from the battery.
  const batteryW = plannedW > 0 ? Math.min(plannedW, Math.max(0, surplusW)) : plannedW < 0 ? -Math.min(-plannedW, Math.max(0, -surplusW)) : 0;

  // Feed-in over the cap (grid-friendly operation, or the law's feed-in limit) is curtailed. The
  // arrays without a battery are already held to the law by pv.ts.
  const law = policyStore.get().feedInLimitPct / 100;
  const capShare = Math.min(law, cap ?? 1);
  let curtailedW = 0;
  if (capShare < 1) {
    const feedInW = surplusW - batteryW;
    const allowedW = capShare * ratedW + (generationW - batteryGenW);
    curtailedW = Math.max(0, Math.min(batteryGenW, feedInW - allowedW));
  }
  return { generationW, batteryW, curtailedW, netW: -generationW + batteryW + curtailedW, battery };
}
