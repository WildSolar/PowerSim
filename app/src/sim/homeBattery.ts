/**
 * Home batteries next to rooftop solar: how one runs through the day, and what it does to the
 * building's draw from the grid. Who has one is solarAdoption.ts's business (bought with the panels,
 * added later, seeded for registered systems); it hands the battery over on the building's PV plant
 * (PowerPlant.battery).
 *
 * A battery's state of charge depends on the whole day so far, but everything here is a pure
 * function of the moment, like the rest of the power model. So the day is worked out once per kWp,
 * shared by every battery in town (the same sun on every roof): how full a typical battery is at
 * each quarter hour, from the sunlight since sunrise less what the building uses meanwhile, and
 * when its evening discharge starts and how long it lasts. A battery at a given moment then:
 *  - charges from the building's surplus (up to its power) until the day's curve says it's full;
 *  - discharges into the building's own use from the late afternoon, for as long as the day's
 *    charge lasts (into the night);
 *  - in grid-friendly operation, charges only from the part of the surplus above its feed-in cap
 *    until the early afternoon, and the system never feeds in more than the cap — what's left once
 *    the battery is full is curtailed. A solar feed-in limit (the law) caps feed-in the same way.
 */

import {
  DAYTIME_OWN_USE_KW_PER_KWP,
  GRID_FRIENDLY_PEAK_UNTIL_HOUR,
  HOME_BATTERY_KW_PER_KWH,
  HOME_BATTERY_KWH_PER_KWP,
  HOURS_A_FULL_BATTERY_LASTS,
} from "../config/homeBattery";
import type { PowerPlant } from "../data/types";
import { toDateMs, toSimTimeMs } from "./calendar";
import { policyStore } from "./policy";
import { irradianceWm2, PEAK_IRRADIANCE_WM2, pvPowerWAt } from "./pv";
import { snowDepthCm } from "./snow";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const STEPS_PER_DAY = 96; // quarter hours
const STEP_HOURS = 24 / STEPS_PER_DAY;

export interface HomeBattery {
  kwh: number;
  kw: number;
  /** Grid-friendly operation: feed-in held to this share of the array's rating. Null: plain
   * self-consumption. */
  feedInCap: number | null;
}

interface DayCurve {
  /** How full a typical battery is at the start of each quarter hour (0–1). */
  fill: Float32Array;
  /** Hour of day the evening discharge starts, and ends (past 24: into the next morning). */
  dischargeFromHour: number;
  dischargeToHour: number;
}

const curves = new Map<string, DayCurve>();

/** The day `dayIndex` (days since the epoch) for a battery with the given feed-in cap (0: none). */
function dayCurve(dayIndex: number, cap: number, snowCm: number): DayCurve {
  const key = `${dayIndex}:${cap}`;
  let curve = curves.get(key);
  if (curve) return curve;
  if (curves.size > 256) curves.clear();
  const capacity = HOME_BATTERY_KWH_PER_KWP; // per kWp
  const power = capacity * HOME_BATTERY_KW_PER_KWH;
  const fill = new Float32Array(STEPS_PER_DAY + 1);
  let stored = 0;
  let lastSunStep = -1; // the last quarter hour with a surplus to speak of
  for (let i = 0; i < STEPS_PER_DAY; i++) {
    const hour = (i + 0.5) * STEP_HOURS;
    const sun = irradianceWm2(toSimTimeMs(dayIndex * DAY_MS + hour * HOUR_MS), snowCm) / PEAK_IRRADIANCE_WM2;
    const threshold = cap > 0 && hour < GRID_FRIENDLY_PEAK_UNTIL_HOUR ? cap : 0;
    stored = Math.min(capacity, stored + Math.min(power, Math.max(0, sun - DAYTIME_OWN_USE_KW_PER_KWP - threshold)) * STEP_HOURS);
    fill[i + 1] = stored / capacity;
    if (sun >= DAYTIME_OWN_USE_KW_PER_KWP) lastSunStep = i;
  }
  // The evening discharge starts once the sun has gone for the day (not at the first cloud).
  const dischargeFromHour = Math.max(12, (lastSunStep + 1) * STEP_HOURS);
  const full = stored / capacity;
  curve = { fill, dischargeFromHour, dischargeToHour: dischargeFromHour + full * HOURS_A_FULL_BATTERY_LASTS };
  curves.set(key, curve);
  return curve;
}

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

/** A building's solar and battery together at `simTimeMs`, against the rest of its use (`loadW`). */
export function solarAndBatteryAt(egid: string, plants: PowerPlant[], simTimeMs: number, loadW: number, snowCoverCm?: number): SolarAndBattery {
  let generationW = 0;
  let batteryGenW = 0;
  let ratedW = 0;
  let kwh = 0;
  let kw = 0;
  let cap: number | null = null;
  let irradiance: number | null = null;
  let snow = snowCoverCm;
  for (const plant of plants) {
    if (plant.egid !== egid || plant.technology !== "Photovoltaic") continue;
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
  const dayIndex = Math.floor(dateMs / DAY_MS);
  const hour = (dateMs - dayIndex * DAY_MS) / HOUR_MS;
  const today = dayCurve(dayIndex, cap ?? 0, snow ?? 0);
  const surplusW = generationW - loadW;
  const maxW = kw * 1000;

  let batteryW = 0;
  if (surplusW > 0) {
    const full = today.fill[Math.min(STEPS_PER_DAY, Math.floor(hour / STEP_HOURS))] >= 0.999;
    const threshold = cap !== null && hour < GRID_FRIENDLY_PEAK_UNTIL_HOUR ? cap * ratedW : 0;
    if (!full) batteryW = Math.min(maxW, Math.max(0, surplusW - threshold));
  } else {
    const yesterday = hour < 12 ? dayCurve(dayIndex - 1, cap ?? 0, snow ?? 0) : null;
    const discharging = (hour >= today.dischargeFromHour && hour < today.dischargeToHour) || (yesterday !== null && hour < yesterday.dischargeToHour - 24);
    if (discharging) batteryW = -Math.min(maxW, -surplusW);
  }

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
