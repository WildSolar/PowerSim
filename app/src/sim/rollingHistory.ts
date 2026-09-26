/**
 * The municipality's "last 24h" series (City stats' Net power and Solar charts, and its Day
 * energy pie), sampled incrementally. Instead of 48 instants spaced evenly back from "now" —
 * which all shift every refresh, so every refresh was a full municipality-wide pass — the
 * window is sampled on a fixed half-hour grid, and each grid instant is computed once and kept
 * while it's inside the window. A refresh then only samples the grid instants that entered the
 * window since the last one, plus "now" itself. The window's far end (24h ago) is interpolated
 * between its two neighbouring grid instants, so the Day energy integral still covers exactly a
 * day. At normal speeds that's one or two samples a refresh instead of 48; only when a whole day
 * passes between refreshes is it a full pass again.
 *
 * Each instant is sampled on its own: its snow cover and its set of solar plants are the ones at
 * that instant, so a cached sample reads the same however the window happened to reach it.
 * Samples depend on the tariff (EV charging responds to it), so a tariff change starts afresh.
 */

import type { Building, PowerPlant } from "../data/types";
import { HISTORY_WINDOW_MS, sampleMunicipalityCategorySeries, type CategorySeries } from "./history";
import { effectivePowerPlantsAt } from "./solarAdoption";
import { tariffKey, type Tariff } from "./tariff";

export const ROLLING_GRID_MS = 30 * 60_000;

type CategoryKey = keyof CategorySeries;
type CategorySample = Record<CategoryKey, number>;

const CATEGORY_KEYS: CategoryKey[] = [
  "fridgeW",
  "lightingW",
  "cookingW",
  "laundryW",
  "plugLoadW",
  "evW",
  "heatPumpW",
  "acW",
  "waterHeatingW",
  "commercialW",
  "solarW",
];

let cacheTariffKey: string | null = null;
const gridSamples = new Map<number, CategorySample>();

function sampleAt(buildings: Building[], realPlants: PowerPlant[], t: number, tariff: Tariff): CategorySample {
  const series = sampleMunicipalityCategorySeries(buildings, [t], tariff, effectivePowerPlantsAt(buildings, realPlants, t));
  const sample = {} as CategorySample;
  for (const key of CATEGORY_KEYS) sample[key] = series[key][0];
  return sample;
}

/** Every category over the 24h up to `nowMs`: the window's two ends plus every half-hour grid
 * instant between them, oldest first. */
export function sampleMunicipalityLast24h(
  buildings: Building[],
  realPlants: PowerPlant[],
  nowMs: number,
  tariff: Tariff,
): { times: number[]; series: CategorySeries } {
  const key = tariffKey(tariff);
  if (key !== cacheTariffKey) {
    gridSamples.clear();
    cacheTariffKey = key;
  }

  const startMs = nowMs - HISTORY_WINDOW_MS;
  const gridBeforeStart = Math.floor(startMs / ROLLING_GRID_MS) * ROLLING_GRID_MS;
  for (const t of gridSamples.keys()) if (t < gridBeforeStart) gridSamples.delete(t);

  const gridSample = (t: number): CategorySample => {
    let sample = gridSamples.get(t);
    if (!sample) {
      sample = sampleAt(buildings, realPlants, t, tariff);
      gridSamples.set(t, sample);
    }
    return sample;
  };

  const times: number[] = [];
  const samples: CategorySample[] = [];
  const push = (t: number, sample: CategorySample) => {
    times.push(t);
    samples.push(sample);
  };

  // The window's far end falls between two grid instants: interpolated between them rather than
  // sampled, since it only shapes the last sliver (under half an hour) of the day.
  if (startMs > gridBeforeStart) {
    const before = gridSample(gridBeforeStart);
    const after = gridSample(gridBeforeStart + ROLLING_GRID_MS);
    const f = (startMs - gridBeforeStart) / ROLLING_GRID_MS;
    const start = {} as CategorySample;
    for (const k of CATEGORY_KEYS) start[k] = before[k] + (after[k] - before[k]) * f;
    push(startMs, start);
  }
  for (let t = Math.ceil(startMs / ROLLING_GRID_MS) * ROLLING_GRID_MS; t <= nowMs; t += ROLLING_GRID_MS) push(t, gridSample(t));
  if (times[times.length - 1] < nowMs) push(nowMs, sampleAt(buildings, realPlants, nowMs, tariff));

  const series = {} as CategorySeries;
  for (const k of CATEGORY_KEYS) series[k] = samples.map((s) => s[k]);
  return { times, series };
}
