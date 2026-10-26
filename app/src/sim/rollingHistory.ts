/**
 * The municipality's "last 24h" series (the Statistics page's At a glance), sampled incrementally. Instead of 48 instants spaced evenly back from "now" —
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
 *
 * A first look (or one after a long jump) needs the whole window: warmLast24h fills it in slices of
 * a few samples, handing the page back between them, so the page shows at once and the chart follows.
 *
 * Next to the categories, each sample keeps what the town's home batteries did at that instant —
 * charging (positive) or discharging (negative), each against its own building's solar and use — and
 * the solar their grid-friendly feed-in caps held back (homeBattery.ts).
 */

import type { Building, PowerPlant } from "../data/types";
import { buildingLoadW } from "./buildingPower";
import { HISTORY_WINDOW_MS, sampleMunicipalityCategorySeries, type CategorySeries } from "./history";
import { solarAndBatteryAt } from "./homeBattery";
import { existsAt } from "./lifetime";
import { snowDepthCm } from "./snow";
import { effectivePowerPlantsAt } from "./solarAdoption";
import { tariffKey, type Tariff } from "./tariff";

export const ROLLING_GRID_MS = 30 * 60_000;

type CategoryKey = keyof CategorySeries;
type SampleKey = CategoryKey | "homeBatteryW" | "curtailedW";
type CategorySample = Record<SampleKey, number>;

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

const SAMPLE_KEYS: SampleKey[] = [...CATEGORY_KEYS, "homeBatteryW", "curtailedW"];

let cacheTariffKey: string | null = null;
const gridSamples = new Map<number, CategorySample>();

/** The buildings by EGID, once per building list (the stock hands out a new list when it changes). */
const byEgidOf = new WeakMap<Building[], Map<string, Building>>();

function sampleAt(buildings: Building[], realPlants: PowerPlant[], t: number, tariff: Tariff): CategorySample {
  const plants = effectivePowerPlantsAt(buildings, realPlants, t);
  const series = sampleMunicipalityCategorySeries(buildings, [t], tariff, plants);
  const sample = {} as CategorySample;
  for (const key of CATEGORY_KEYS) sample[key] = series[key][0];
  // The home batteries, building by building (only those with one).
  let byEgid = byEgidOf.get(buildings);
  if (!byEgid) {
    byEgid = new Map(buildings.map((b) => [b.egid, b]));
    byEgidOf.set(buildings, byEgid);
  }
  const withBattery = new Set<string>();
  for (const p of plants) if (p.battery && p.egid && (p.activeToMs === undefined || t < p.activeToMs)) withBattery.add(p.egid);
  let batteryW = 0;
  let curtailedW = 0;
  if (withBattery.size > 0) {
    const snow = snowDepthCm(t);
    for (const egid of withBattery) {
      const b = byEgid.get(egid);
      if (!b || !existsAt(b, t)) continue;
      const r = solarAndBatteryAt(b, plants, t, () => buildingLoadW(b, t), snow);
      batteryW += r.batteryW;
      curtailedW += r.curtailedW;
    }
  }
  sample.homeBatteryW = batteryW;
  sample.curtailedW = curtailedW;
  return sample;
}

/** Forgets every kept sample (dev/perf.ts: timing a cold chart). */
export function clearLast24h(): void {
  gridSamples.clear();
}

/** Every category over the 24h up to `nowMs`: the window's two ends plus every half-hour grid
 * instant between them, oldest first. */
/** Drops what no longer applies — another tariff, instants before the window — and returns the
 * window's start and the grid instant just before it. */
function prepare(nowMs: number, tariff: Tariff): { startMs: number; gridBeforeStart: number } {
  const key = tariffKey(tariff);
  if (key !== cacheTariffKey) {
    gridSamples.clear();
    cacheTariffKey = key;
  }
  const startMs = nowMs - HISTORY_WINDOW_MS;
  const gridBeforeStart = Math.floor(startMs / ROLLING_GRID_MS) * ROLLING_GRID_MS;
  for (const t of gridSamples.keys()) if (t < gridBeforeStart) gridSamples.delete(t);
  return { startMs, gridBeforeStart };
}

// How long one slice of warmLast24h may work before handing the page back (ms): a frame's worth.
const WARM_SLICE_MS = 12;

/** Hands the page back for a moment — through a message rather than setTimeout(0), which browsers
 * hold back by 4 ms or more once it repeats, and by a second in a background tab. */
function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

/** Samples the window's grid instants not yet kept, in slices of WARM_SLICE_MS with the page handed
 * back between them, so sampleMunicipalityLast24h then only has "now" left to do. Reports how far
 * it has got (0–1) through `progress`; stops when `cancelled()` says so. */
export async function warmLast24h(
  buildings: Building[],
  realPlants: PowerPlant[],
  nowMs: number,
  tariff: Tariff,
  cancelled: () => boolean,
  progress?: (share: number) => void,
): Promise<void> {
  const { gridBeforeStart } = prepare(nowMs, tariff);
  const missing: number[] = [];
  for (let t = gridBeforeStart; t <= nowMs; t += ROLLING_GRID_MS) if (!gridSamples.has(t)) missing.push(t);
  let done = 0;
  while (done < missing.length) {
    await yieldToPage();
    if (cancelled() || tariffKey(tariff) !== cacheTariffKey) return;
    const sliceStart = performance.now();
    do {
      const t = missing[done++];
      gridSamples.set(t, sampleAt(buildings, realPlants, t, tariff));
    } while (done < missing.length && performance.now() - sliceStart < WARM_SLICE_MS);
    progress?.(done / missing.length);
  }
}

export function sampleMunicipalityLast24h(
  buildings: Building[],
  realPlants: PowerPlant[],
  nowMs: number,
  tariff: Tariff,
): { times: number[]; series: CategorySeries; homeBatteryW: number[]; curtailedW: number[] } {
  const { startMs, gridBeforeStart } = prepare(nowMs, tariff);

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
    for (const k of SAMPLE_KEYS) start[k] = before[k] + (after[k] - before[k]) * f;
    push(startMs, start);
  }
  for (let t = Math.ceil(startMs / ROLLING_GRID_MS) * ROLLING_GRID_MS; t <= nowMs; t += ROLLING_GRID_MS) push(t, gridSample(t));
  if (times[times.length - 1] < nowMs) push(nowMs, sampleAt(buildings, realPlants, nowMs, tariff));

  const series = {} as CategorySeries;
  for (const k of CATEGORY_KEYS) series[k] = samples.map((s) => s[k]);
  return { times, series, homeBatteryW: samples.map((s) => s.homeBatteryW), curtailedW: samples.map((s) => s.curtailedW) };
}
