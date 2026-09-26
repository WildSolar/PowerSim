/**
 * Dev-only timing of the expensive municipality-wide computations, run against the live game's own
 * module instances (so caches and the current stock are shared). Exposed as window.__perf in
 * development (see App.tsx). Start a municipality first.
 */

import { toDateMs, toSimTimeMs } from "../sim/calendar";
import { reportCardStore } from "../sim/reportCardStore";
import { yearPassPrefetchBusy } from "../sim/yearPassPrefetch";
import { stock } from "../sim/stock";
import { treasury } from "../sim/treasury";
import { buildingPowerW } from "../sim/buildingPower";
import { snowDepthCm } from "../sim/snow";
import { sampleMunicipalityLast24h } from "../sim/rollingHistory";
import { simClock } from "../sim/engine";
import { tariffStore } from "../sim/tariffStore";
import { historyTimeSteps, sampleMunicipalityCategorySeries, type CategorySeries } from "../sim/history";
import {
  computeHeatingRenewalTally,
  computeHeatingTechnologyBreakdown,
  computeMobilityFuelLiters,
  computeNetElectricityKWh,
  computeRetrofitTally,
} from "../sim/yearReport";
import { effectivePowerPlantsAt, solarAdoptionTallyForYear } from "../sim/solarAdoption";
import { mobilityChargingPowerW } from "../sim/mobility";
import {
  cookingPowerW,
  fridgePowerW,
  laundryPowerW,
  lightingPowerW,
  makeCookingProfile,
  makeFridgeProfile,
  makeLightingProfile,
  makePlugLoadProfile,
  plugLoadPowerW,
} from "../sim/devices";
import { hashSeed } from "../sim/rng";
import { existsAt } from "../sim/lifetime";
import { dwellingWaterHeaterProfile, hasElectricWaterHeating, waterHeaterPowerW } from "../sim/waterHeating";
import { heatPumpPowerWWithWeather } from "../sim/heatPump";
import { acPowerWWithWeather } from "../sim/ac";
import { dailyMeanTempC, weatherAt } from "../sim/weather";

async function timed(fn: () => unknown): Promise<number> {
  const t0 = performance.now();
  await fn();
  return Math.round(performance.now() - t0);
}

/** A zero-delay yield that a hidden tab doesn't throttle (setTimeout there waits ~1s). */
function unthrottledYield(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

async function sleep(ms: number): Promise<void> {
  const until = performance.now() + ms;
  do await unthrottledYield();
  while (performance.now() < until);
}

/** Rolls the clock over into the next year and times the year-end report card: until it shows, until
 * each section has finished, and the longest the main thread was blocked meanwhile. While it runs,
 * zero-delay setTimeouts (the computations' own yields) go through a MessageChannel instead, so the
 * numbers match a visible tab even when the browser pane is hidden. */
export async function timeYearEndReport(waitForPrefetch = true): Promise<Record<string, number | string>> {
  const realSetTimeout = window.setTimeout;
  window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms || typeof handler !== "function") return realSetTimeout(handler, ms, ...args);
    unthrottledYield().then(() => handler(...args));
    return 0;
  }) as typeof window.setTimeout;
  try {
    const year = new Date(toDateMs(simClock.getSimTimeMs())).getUTCFullYear();
    simClock.pauseAt(toSimTimeMs(Date.UTC(year, 11, 31, 23, 0)));
    await sleep(200);
    // In normal play the months before December were sampled in the background long before New Year.
    const prefetchStart = performance.now();
    while (waitForPrefetch && yearPassPrefetchBusy() && performance.now() - prefetchStart < 120_000) await sleep(100);
    const t0 = performance.now();
    // A jump rather than setSpeed: the clock runs on requestAnimationFrame, which a hidden tab never fires.
    simClock.pauseAt(toSimTimeMs(Date.UTC(year + 1, 0, 1, 0, 1)));
    while (reportCardStore.get() === null) await sleep(10);
    const out: Record<string, number | string> = {
      year,
      prefetchWaitMs: Math.round(t0 - prefetchStart),
      msUntilShown: Math.round(performance.now() - t0),
    };
    const shownAt = performance.now();
    let last = shownAt;
    let longestBlockMs = 0;
    for (;;) {
      await sleep(20);
      const now = performance.now();
      longestBlockMs = Math.max(longestBlockMs, now - last - 20);
      last = now;
      const shell = document.querySelector(".report-card-shell");
      if (!shell) continue;
      const headings = [...shell.querySelectorAll("h2")];
      const pending = headings.filter(
        (h) => h.nextElementSibling?.classList.contains("loading-note") || h.nextElementSibling?.nextElementSibling?.classList.contains("loading-note"),
      );
      for (const h of headings) {
        const key = `ms done: ${h.textContent}`;
        if (!(key in out) && !pending.includes(h)) out[key] = Math.round(now - shownAt);
      }
      if (pending.length === 0 || now - shownAt > 120_000) break;
    }
    out.msAllSections = Math.round(performance.now() - shownAt);
    out.reportText = (document.querySelector(".report-card-shell") as HTMLElement | null)?.innerText.replace(/\s+/g, " ").slice(0, 900) ?? "";
    out.longestMainThreadBlockMs = Math.round(longestBlockMs);
    return out;
  } finally {
    window.setTimeout = realSetTimeout;
  }
}

/** The synchronous pieces around a year rollover, each timed on its own (run on a fresh session,
 * before the rollover, so nothing is cached yet). */
export async function timeNewYearPieces(): Promise<Record<string, number>> {
  const buildings = stock.getAll();
  const year = new Date(toDateMs(simClock.getSimTimeMs())).getUTCFullYear();
  const plants = (await (await fetch("/data/schlieren.json")).json()).powerPlants;
  const yearEnd = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  const out: Record<string, number> = {};
  out.solarAdoptionNextYear = await timed(() => effectivePowerPlantsAt(buildings, plants, yearEnd + 60_000));
  const nextYearSolar = solarAdoptionTallyForYear(buildings, plants, year + 1);
  out.resultNextYearSolarCount = nextYearSolar.count;
  out.resultNextYearSolarKw = Math.round(nextYearSolar.totalCapacityKw * 1000) / 1000;
  out.resultSolarPaidRp = Math.round(treasury.paidOut(-1e15, 1e15).solar);
  out.stockAdvanceToNewYear = await timed(() => stock.advance(yearEnd + 60_000));
  out.retrofitTally = await timed(() => computeRetrofitTally(buildings, year));
  out.heatingRenewalTally = await timed(() => computeHeatingRenewalTally(buildings, year));
  out.solarTally = await timed(() => solarAdoptionTallyForYear(buildings, plants, year));
  out.stockSummary = await timed(() => stock.summaryForYear(year));
  return out;
}

/** One tick of the map's live power layer (every building's draw right now), and a checksum. */
export async function timeMapPowerTick(): Promise<Record<string, number>> {
  const buildings = stock.getAll();
  const plants = (await (await fetch("/data/schlieren.json")).json()).powerPlants;
  const t = simClock.getSimTimeMs();
  const livePlants = effectivePowerPlantsAt(buildings, plants, t);
  const snow = snowDepthCm(t);
  let sum = 0;
  const ms = await timed(() => buildings.forEach((b) => (sum += buildingPowerW(b, t, livePlants, snow))));
  const ms2 = await timed(() => buildings.forEach((b) => buildingPowerW(b, t, livePlants, snow)));
  return { firstTickMs: ms, tickMs: ms2, plants: livePlants.length, sumW: Math.round(sum * 1000) / 1000 };
}

/** City stats' rolling 24h chart: one refresh after the clock moves by what each speed covers in a
 * 3s refresh, against the old full 48-sample pass — and every instant it returns checked against a
 * fresh, independent sample of that instant. */
export async function timeRollingChart(): Promise<Record<string, number | string>> {
  const buildings = stock.getAll();
  const plants = (await (await fetch("/data/schlieren.json")).json()).powerPlants;
  const tariff = tariffStore.get();
  const out: Record<string, number | string> = {};
  const now0 = simClock.getSimTimeMs();
  out.oldFullPassMs = await timed(() =>
    sampleMunicipalityCategorySeries(buildings, historyTimeSteps(now0, 24 * 3_600_000, 48), tariff, effectivePowerPlantsAt(buildings, plants, now0)),
  );
  out.coldMs = await timed(() => sampleMunicipalityLast24h(buildings, plants, now0, tariff));
  const steps: [string, number][] = [
    ["paused", 0],
    ["x60 (3 min)", 3 * 60_000],
    ["x720 (36 min)", 36 * 60_000],
    ["x3600 (3 h)", 3 * 3_600_000],
    ["x21600 (18 h)", 18 * 3_600_000],
  ];
  let result = sampleMunicipalityLast24h(buildings, plants, now0, tariff);
  for (const [label, deltaMs] of steps) {
    simClock.pauseAt(simClock.getSimTimeMs() + deltaMs);
    const now = simClock.getSimTimeMs();
    out[`refresh ${label} ms`] = await timed(() => (result = sampleMunicipalityLast24h(buildings, plants, now, tariff)));
  }
  const grid = 30 * 60_000;
  const fresh = (t: number) => sampleMunicipalityCategorySeries(buildings, [t], tariff, effectivePowerPlantsAt(buildings, plants, t));
  let mismatches = 0;
  result.times.forEach((t, i) => {
    let expected: (key: keyof CategorySeries) => number;
    const gridBefore = Math.floor(t / grid) * grid; // floor, not %: sim time is negative before the game's start
    if (i === 0 && t !== gridBefore) {
      // The window's far end is interpolated between its grid neighbours.
      const before = fresh(gridBefore);
      const after = fresh(gridBefore + grid);
      const f = (t - gridBefore) / grid;
      expected = (key) => before[key][0] + (after[key][0] - before[key][0]) * f;
    } else {
      const s = fresh(t);
      expected = (key) => s[key][0];
    }
    for (const key of Object.keys(result.series) as (keyof CategorySeries)[]) {
      if (Math.abs(expected(key) - result.series[key][i]) > 1e-6) {
        mismatches++;
        out[`mismatch ${i} ${key}`] = `${expected(key)} vs ${result.series[key][i]}`;
      }
    }
  });
  out.points = result.times.length;
  out.spanHours = (result.times[result.times.length - 1] - result.times[0]) / 3_600_000;
  out.mismatches = mismatches;
  return out;
}

export async function runPerf(year?: number): Promise<Record<string, number>> {
  const buildings = stock.getAll();
  const now = simClock.getSimTimeMs();
  const tariff = tariffStore.get();
  const y = year ?? new Date(Date.now()).getUTCFullYear();
  const times = historyTimeSteps(now, 30 * 24 * 3_600_000, 24);
  const dwellings = buildings.flatMap((b) => b.dwellings.map((d) => ({ b, d })));
  const out: Record<string, number> = { buildings: buildings.length, dwellings: dwellings.length };
  sampleMunicipalityCategorySeries(buildings, times.slice(0, 1), tariff, []); // warm profile caches
  let series: CategorySeries | null = null;
  out.msPerMunicipalitySample = (await timed(() => (series = sampleMunicipalityCategorySeries(buildings, times, tariff, [])))) / times.length;
  // Every category's sum over the samples: an optimisation must leave these exactly as they were.
  for (const [key, values] of Object.entries(series as unknown as CategorySeries)) out[`sum_${key}`] = Math.round((values as number[]).reduce((a, b) => a + b, 0));

  // Per-device cost of one municipality-wide sample, in ms.
  const perSample = async (fn: (t: number) => void) => Math.round(((await timed(() => times.forEach(fn))) / times.length) * 100) / 100;
  const profiles = dwellings.map(({ b, d }) => ({
    b,
    d,
    fridge: makeFridgeProfile(hashSeed(b.egid, d.ewid, "fridge")),
    lighting: makeLightingProfile(hashSeed(b.egid, d.ewid, "lighting")),
    cooking: makeCookingProfile(hashSeed(b.egid, d.ewid, "cooking")),
    plug: makePlugLoadProfile(b.egid, d),
    water: dwellingWaterHeaterProfile(b.egid, d),
  }));
  out.ms_existsAt = await perSample((t) => profiles.forEach((p) => existsAt(p.b, t)));
  out.ms_fridge = await perSample((t) => profiles.forEach((p) => fridgePowerW(p.fridge, t)));
  out.ms_lighting = await perSample((t) => profiles.forEach((p) => lightingPowerW(p.lighting, t)));
  out.ms_cooking = await perSample((t) => profiles.forEach((p) => cookingPowerW(p.cooking, t)));
  out.ms_laundry = await perSample((t) => profiles.forEach((p) => laundryPowerW(p.b.egid, p.d, t)));
  out.ms_plugLoad = await perSample((t) => profiles.forEach((p) => plugLoadPowerW(p.plug, t)));
  out.ms_ev = await perSample((t) => profiles.forEach((p) => mobilityChargingPowerW(p.b.egid, p.d, t, tariff)));
  out.ms_waterPower = await perSample((t) => profiles.forEach((p) => waterHeaterPowerW(p.water, t)));
  out.ms_hasElectricWater = await perSample((t) => buildings.forEach((b) => hasElectricWaterHeating(b, t)));
  out.ms_heatPump = await perSample((t) => {
    const dm = dailyMeanTempC(t);
    const o = weatherAt(t).tempC;
    buildings.forEach((b) => heatPumpPowerWWithWeather(b, dm, o, t));
  });
  out.ms_ac = await perSample((t) => {
    const dm = dailyMeanTempC(t);
    const o = weatherAt(t).tempC;
    buildings.forEach((b) => acPowerWWithWeather(b, dm, o));
  });  let heating = 0;
  let net = 0;
  let fuel = 0;
  out.heatingTechYear = await timed(async () => (heating = (await computeHeatingTechnologyBreakdown(buildings, y)).airHeatPumpSpaceKWh));
  out.netElectricityYear = await timed(async () => (net = await computeNetElectricityKWh(buildings, [], y)));
  out.mobilityFuelYear = await timed(async () => (fuel = await computeMobilityFuelLiters(buildings, y)));
  // Results too, so an optimisation can be checked for changing nothing.
  out.resultAirHpKWh = Math.round(heating);
  out.resultNetKWh = Math.round(net);
  out.resultFuelL = Math.round(fuel);
  return out;
}
