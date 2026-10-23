/**
 * The town's solar hours: the hours of a day in which its own solar and wind are forecast to make
 * more than it uses. A forecast, made the day before as a utility would — the plants in service that
 * day (rooftops, car parks, fields, turbines) at that day's weather, against the town's expected use
 * at that hour of that season — not a reading of what the town then actually draws, so everything that
 * responds to it (utility-controlled wallboxes, employers charging with the sun, the solar-hours price)
 * can plan by it, and the same day always gives the same hours.
 *
 * The plants are those in service at the end of the year before: a year's forecasts count the
 * arrays of the year as they come only from the next January. The forecast never makes an owner
 * decide (solar decisions themselves look at a year of the town's use, its cars charging in solar
 * hours included): it reads the decisions already taken, and the year before's are always settled by
 * the time anyone asks about a day — so a day's hours are the same whoever asks first. The expected use is the town's typical draw: its homes and businesses as
 * they stand on 1 January, spread over the day and the year by a typical profile. Pure functions of
 * the town and the weather: nothing to save.
 */

import {
  SURPLUS_BUSINESS_KWH_PER_M2,
  SURPLUS_HOME_KWH,
  SURPLUS_PV_PERFORMANCE,
  SURPLUS_USE_HOUR_SHAPE,
  SURPLUS_USE_SEASON,
} from "../config/townSurplus";
import type { Building, PowerPlant } from "../data/types";
import { dayOfYear, toDateMs, toSimTimeMs } from "./calendar";
import { commercialCategory, totalFloorAreaM2 } from "./commercial";
import { existsAt } from "./lifetime";
import { irradianceWm2 } from "./pv";
import { decidedPowerPlantsAt } from "./solarAdoption";
import { windPowerW } from "./windPower";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const HOUR_SHAPE_MEAN = SURPLUS_USE_HOUR_SHAPE.reduce((a, b) => a + b, 0) / 24;

/** A day's solar hours: the window from the first surplus hour to the last (empty if none). */
export interface SolarWindow {
  startMs: number;
  endMs: number;
}

class TownSurplus {
  private buildingsProvider: () => Building[] = () => [];
  private realPlants: PowerPlant[] = [];
  private windows = new Map<number, SolarWindow | null>();
  private useByYear = new Map<number, number>();
  private plantsByYear = new Map<number, PowerPlant[]>();

  init(buildingsProvider: () => Building[], realPlants: PowerPlant[]): void {
    this.buildingsProvider = buildingsProvider;
    this.realPlants = realPlants;
    this.windows.clear();
    this.useByYear.clear();
    this.plantsByYear.clear();
  }

  /** The plants in service at the end of the year before `year` (or at `atMs`, if earlier). */
  private plantsFor(year: number, atMs = Infinity): PowerPlant[] {
    const endOfYearBefore = toSimTimeMs(Date.UTC(year, 0, 1)) - 1;
    if (atMs < endOfYearBefore) return decidedPowerPlantsAt(this.buildingsProvider(), this.realPlants, atMs);
    let plants = this.plantsByYear.get(year);
    if (!plants) {
      plants = decidedPowerPlantsAt(this.buildingsProvider(), this.realPlants, endOfYearBefore);
      this.plantsByYear.set(year, plants);
    }
    return plants;
  }

  /** The town's typical draw in `year`, on average (W): its homes and businesses on 1 January. */
  private averageUseW(year: number): number {
    let w = this.useByYear.get(year);
    if (w === undefined) {
      const jan1 = toSimTimeMs(Date.UTC(year, 0, 1));
      let kWh = 0;
      for (const b of this.buildingsProvider()) {
        if (!existsAt(b, jan1)) continue;
        kWh += b.dwellings.length * SURPLUS_HOME_KWH;
        if (commercialCategory(b)) kWh += (totalFloorAreaM2(b) ?? 0) * SURPLUS_BUSINESS_KWH_PER_M2;
      }
      w = (kWh * 1000) / 8760;
      this.useByYear.set(year, w);
    }
    return w;
  }

  /** The town's expected draw at `simMs` (W). */
  private expectedUseW(simMs: number): number {
    const dateMs = toDateMs(simMs);
    const hour = Math.floor((((simMs % DAY_MS) + DAY_MS) % DAY_MS) / HOUR_MS);
    const season = 1 + SURPLUS_USE_SEASON * Math.cos((2 * Math.PI * (dayOfYear(dateMs) - 15)) / 365);
    return this.averageUseW(new Date(dateMs).getUTCFullYear()) * season * (SURPLUS_USE_HOUR_SHAPE[hour] / HOUR_SHAPE_MEAN);
  }

  /** What the town's own plants are forecast to make at `simMs` (W), with the plants of `plants`. */
  private generationW(simMs: number, plants: PowerPlant[]): number {
    let solarKw = 0;
    let windW = 0;
    for (const p of plants) {
      if (p.technology === "Photovoltaic") solarKw += p.capacityKw ?? 0;
      else if (p.technology === "Wind") windW += windPowerW(p, simMs);
    }
    return solarKw * 1000 * (irradianceWm2(simMs) / 1000) * SURPLUS_PV_PERFORMANCE + windW;
  }

  /** The day's solar hours (simDay: days since the epoch). */
  windowOf(simDay: number): SolarWindow | null {
    if (this.windows.has(simDay)) return this.windows.get(simDay) ?? null;
    const plants = this.plantsFor(new Date(toDateMs(simDay * DAY_MS + 12 * HOUR_MS)).getUTCFullYear());
    let first = -1;
    let last = -1;
    for (let h = 5; h < 21; h++) {
      const t = simDay * DAY_MS + (h + 0.5) * HOUR_MS;
      if (this.generationW(t, plants) > this.expectedUseW(t)) {
        if (first < 0) first = h;
        last = h;
      }
    }
    const window = first < 0 ? null : { startMs: simDay * DAY_MS + first * HOUR_MS, endMs: simDay * DAY_MS + (last + 1) * HOUR_MS };
    if (this.windows.size > 2000) this.windows.clear();
    this.windows.set(simDay, window);
    return window;
  }

  /** Whether `simMs` falls in its day's solar hours. */
  isSolarHour(simMs: number): boolean {
    const w = this.windowOf(Math.floor(simMs / DAY_MS));
    return w !== null && simMs >= w.startMs && simMs < w.endMs;
  }

  /** The share of `year`'s days with solar hours — with the plants it will count, or, for a year
   * still ahead, those in service at `atMs` — what a household weighing the solar-hours price
   * expects. */
  solarDayShare(year: number, atMs: number): number {
    const plants = this.plantsFor(year, atMs);
    const start = Math.floor(toSimTimeMs(Date.UTC(year, 0, 1)) / DAY_MS);
    let days = 0;
    let withSun = 0;
    // Every third day is enough for a share; computed without caching the windows (another day's plants).
    for (let d = start; d < start + 365; d += 3) {
      days++;
      for (let h = 9; h < 16; h++) {
        const t = d * DAY_MS + (h + 0.5) * HOUR_MS;
        if (this.generationW(t, plants) > this.expectedUseW(t)) {
          withSun++;
          break;
        }
      }
    }
    return days > 0 ? withSun / days : 0;
  }
}

export const townSurplus = new TownSurplus();
