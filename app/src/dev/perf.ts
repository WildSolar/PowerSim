/**
 * Dev-only timing of the expensive municipality-wide computations, run against the live game's own
 * module instances (so caches and the current stock are shared). Exposed as window.__perf in
 * development (see App.tsx). Start a municipality first.
 */

import { dataUrl } from "../data/loadDataset";
import { toDateMs, toSimTimeMs } from "../sim/calendar";
import { reportCardStore } from "../sim/reportCardStore";
import { yearPassPrefetchBusy } from "../sim/yearPassPrefetch";
import { prefillMonthSample } from "../sim/yearReport";
import { grid } from "../sim/grid";
import { stock } from "../sim/stock";
import { treasury } from "../sim/treasury";
import { buildingPowerW } from "../sim/buildingPower";
import { snowDepthCm } from "../sim/snow";
import { sampleMunicipalityLast24h } from "../sim/rollingHistory";
import { simClock } from "../sim/engine";
import { tariffDeadline } from "../sim/tariffDeadline";
import { startDevTiming, stopDevTiming } from "../sim/devTiming";
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
import { acPowerWWithWeather, coolingWeatherAt } from "../sim/ac";
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

/** Moves the clock to `atMs`, getting past the tariff deadline's hold on the way (this year's prices
 * kept, as autoplay.ts does). */
async function jumpTo(atMs: number): Promise<void> {
  for (let i = 0; i < 5; i++) {
    simClock.pauseAt(atMs);
    await sleep(50);
    if (!tariffDeadline.get()) return;
    tariffDeadline.keepPrices();
  }
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
export async function timeYearEndReport(waitForPrefetch = true, prefill = true): Promise<Record<string, unknown>> {
  const realSetTimeout = window.setTimeout;
  window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms || typeof handler !== "function") return realSetTimeout(handler, ms, ...args);
    unthrottledYield().then(() => handler(...args));
    return 0;
  }) as typeof window.setTimeout;
  try {
    const year = new Date(toDateMs(simClock.getSimTimeMs())).getUTCFullYear();
    await jumpTo(toSimTimeMs(Date.UTC(year, 11, 31, 23, 0)));
    await sleep(200);
    // In normal play the months before December were sampled in the background long before New Year.
    const prefetchStart = performance.now();
    while (waitForPrefetch && yearPassPrefetchBusy() && performance.now() - prefetchStart < 120_000) await sleep(100);
    // What the background would have taken of December ahead (yearPassPrefetch.ts).
    let prefilled = 0;
    if (prefill) {
      const realPlants = (await (await fetch(dataUrl("schlieren.json"))).json()).powerPlants;
      const at = toSimTimeMs(Date.UTC(year, 11, 31, 23, 0));
      while (prefillMonthSample(stock.getAll(), realPlants, at) || grid.prefillReading(at)) {
        prefilled++;
        await unthrottledYield();
      }
    }
    await sleep(300);
    startDevTiming();
    const profiler = startProfiler();
    const t0 = performance.now();
    // A jump rather than setSpeed: the clock runs on requestAnimationFrame, which a hidden tab never fires.
    simClock.pauseAt(toSimTimeMs(Date.UTC(year + 1, 0, 1, 0, 1)));
    const notifyMs = Math.round(performance.now() - t0);
    while (reportCardStore.get() === null) await sleep(10);
    const out: Record<string, unknown> = {
      year,
      prefilled,
      prefetchWaitMs: Math.round(t0 - prefetchStart),
      notifyMs,
      msUntilShown: Math.round(performance.now() - t0),
    };
    const shownAt = performance.now();
    let last = shownAt;
    let longestBlockMs = 0;
    const blocks: { at: number; ms: number }[] = [];
    let lastCheck = 0;
    for (;;) {
      await unthrottledYield();
      const now = performance.now();
      longestBlockMs = Math.max(longestBlockMs, now - last);
      if (now - last > 30) blocks.push({ at: Math.round(last - t0), ms: Math.round(now - last) });
      last = now;
      if (now - lastCheck < 50) continue;
      lastCheck = now;
      const shell = document.querySelector(".year-review");
      if (!shell) {
        if (now - shownAt > 120_000) break;
        continue;
      }
      const headings = [...shell.querySelectorAll("h2, h3")];
      const pending = headings.filter((h) => {
        const section = h.parentElement;
        return !!section?.querySelector(".loading-note") || section?.querySelector(".yr-value")?.textContent === "…";
      });
      for (const h of headings) {
        const key = `ms done: ${h.textContent}`;
        if (!(key in out) && !pending.includes(h)) out[key] = Math.round(now - shownAt);
      }
      if (pending.length === 0 || now - shownAt > 120_000) break;
    }
    out.msAllSections = Math.round(performance.now() - shownAt);
    out.reportText = (document.querySelector(".year-review") as HTMLElement | null)?.innerText.replace(/\s+/g, " ").slice(0, 900) ?? "";
    out.longestMainThreadBlockMs = Math.round(longestBlockMs);
    out.blocks = blocks;
    out.blockedMs = blocks.reduce((sum, b) => sum + b.ms, 0);
    out.pieces = stopDevTiming();
    out.profile = await summarizeProfile(profiler);
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
  const plants = (await (await fetch(dataUrl("schlieren.json"))).json()).powerPlants;
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
  const plants = (await (await fetch(dataUrl("schlieren.json"))).json()).powerPlants;
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
  const plants = (await (await fetch(dataUrl("schlieren.json"))).json()).powerPlants;
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
    const w = coolingWeatherAt(t);
    buildings.forEach((b) => acPowerWWithWeather(b, w, t));
  });  let heating = 0;
  let net = 0;
  let fuel = 0;
  out.heatingTechYear = await timed(async () => (heating = (await computeHeatingTechnologyBreakdown(buildings, y)).airHeatPumpSpaceKWh));
  out.netElectricityYear = await timed(async () => (net = await computeNetElectricityKWh(buildings, [], y)));
  out.mobilityFuelYear = await timed(async () => {
    const liters = await computeMobilityFuelLiters(buildings, y);
    fuel = liters.cars + liters.vans + liters.lorries;
  });
  // Results too, so an optimisation can be checked for changing nothing.
  out.resultAirHpKWh = Math.round(heating);
  out.resultNetKWh = Math.round(net);
  out.resultFuelL = Math.round(fuel);
  return out;
}

/** Crosses into the next calendar month and times what happens: each clock listener's share of the
 * crossing itself, chosen methods wherever they run, and every stretch the main thread is blocked
 * for more than 30 ms until the background month work (yearPassPrefetch) is done. Run in a game; it
 * leaves the clock paused just after the turn. `wrap`: extra [object, method] pairs to time. */
export async function timeMonthTurn(wrap: [Record<string, unknown>, string][] = [], turnAtMs?: number, prefill = true, monthsAhead = 1): Promise<Record<string, unknown>> {
  const realSetTimeout = window.setTimeout;
  window.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
    if (ms || typeof handler !== "function") return realSetTimeout(handler, ms, ...args);
    unthrottledYield().then(() => handler(...args));
    return 0;
  }) as typeof window.setTimeout;
  const clock = simClock as unknown as { listeners: Set<() => void>; notify: () => void };
  const realNotify = clock.notify;
  const listenerMs = new Map<string, number>();
  const methodMs = new Map<string, { ms: number; calls: number }>();
  const restores: (() => void)[] = [];
  try {
    for (const [obj, name] of wrap) {
      const fn = obj[name] as (...a: unknown[]) => unknown;
      const label = `${(obj.constructor as { name?: string })?.name ?? "?"}.${name}`;
      obj[name] = function (this: unknown, ...a: unknown[]) {
        const t0 = performance.now();
        try {
          return fn.apply(this, a);
        } finally {
          const m = methodMs.get(label) ?? { ms: 0, calls: 0 };
          m.ms += performance.now() - t0;
          m.calls++;
          methodMs.set(label, m);
        }
      };
      restores.push(() => (obj[name] = fn));
    }
    clock.notify = function () {
      let index = 0;
      for (const listener of clock.listeners) {
        const t0 = performance.now();
        listener();
        const key = `${index++}: ${listener.toString().replace(/\s+/g, " ").slice(0, 60)}`;
        listenerMs.set(key, (listenerMs.get(key) ?? 0) + performance.now() - t0);
      }
    };
    const d = new Date(toDateMs(simClock.getSimTimeMs()));
    const turn = turnAtMs ?? toSimTimeMs(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthsAhead, 1));
    await jumpTo(turn - 30 * 60_000);
    await sleep(300);
    while (yearPassPrefetchBusy()) await sleep(100);
    // What the background would have taken ahead during the month (yearPassPrefetch.ts).
    let prefilled = 0;
    if (prefill) {
      const realPlants = (await (await fetch(dataUrl("schlieren.json"))).json()).powerPlants;
      while (prefillMonthSample(stock.getAll(), realPlants, turn - 30 * 60_000) || grid.prefillReading(turn - 30 * 60_000)) {
        prefilled++;
        await unthrottledYield();
      }
    }
    await sleep(500);
    listenerMs.clear();
    methodMs.clear();
    startDevTiming();
    const profiler = startProfiler();
    const t0 = performance.now();
    simClock.pauseAt(turn + 5 * 60_000);
    const notifyMs = performance.now() - t0;
    const blocks: { at: number; ms: number }[] = [];
    let last = performance.now();
    while (performance.now() - t0 < 4000 || yearPassPrefetchBusy()) {
      await unthrottledYield();
      const now = performance.now();
      if (now - last > 30) blocks.push({ at: Math.round(last - t0), ms: Math.round(now - last) });
      last = now;
      if (now - t0 > 120_000) break;
    }
    const round = (m: Map<string, number>) => Object.fromEntries([...m].filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]));
    return {
      month: new Date(toDateMs(turn)).toISOString().slice(0, 7),
      prefilled,
      notifyMs: Math.round(notifyMs),
      listeners: round(listenerMs),
      methods: Object.fromEntries([...methodMs].sort((a, b) => b[1].ms - a[1].ms).map(([k, v]) => [k, `${Math.round(v.ms)} ms / ${v.calls}`])),
      blocks,
      blockedMs: blocks.reduce((s, b) => s + b.ms, 0),
      pieces: stopDevTiming(),
      profile: await summarizeProfile(profiler),
      totalMs: Math.round(performance.now() - t0),
    };
  } finally {
    clock.notify = realNotify;
    for (const r of restores) r();
    window.setTimeout = realSetTimeout;
  }
}

/** Plays the live game at `speed` for `seconds` of real time — frames, map and background work as a
 * player gets them — and reports how far the clock got, every main-thread block over 50 ms (what a
 * player sees as stutter), each clock listener's share, and where the CPU went. Needs the browser
 * pane visible (a hidden one runs no animation frames). Leaves the game paused. */
export async function timeLivePlay(seconds = 20, speed = 86400): Promise<Record<string, unknown>> {
  const clock = simClock as unknown as { listeners: Set<() => void>; notify: () => void };
  const realNotify = clock.notify;
  const listenerMs = new Map<string, number>();
  let notifies = 0;
  clock.notify = function () {
    notifies++;
    let index = 0;
    for (const listener of clock.listeners) {
      const t0 = performance.now();
      listener();
      const key = `${index++}: ${listener.toString().replace(/\s+/g, " ").slice(0, 60)}`;
      listenerMs.set(key, (listenerMs.get(key) ?? 0) + performance.now() - t0);
    }
  };
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(Math.round(e.duration))));
  try {
    observer.observe({ type: "longtask", buffered: false });
  } catch {
    /* not supported */
  }
  const startSim = simClock.getSimTimeMs();
  const profiler = startProfiler();
  const t0 = performance.now();
  simClock.setSpeed(speed);
  try {
    while (performance.now() - t0 < seconds * 1000) {
      await new Promise((r) => setTimeout(r, 250));
      if (tariffDeadline.get()) tariffDeadline.keepPrices();
      if (simClock.getSpeed() === 0) simClock.setSpeed(speed); // past a year-end or a letter's pause
    }
  } finally {
    simClock.setSpeed(0);
    clock.notify = realNotify;
    observer.disconnect();
  }
  const wallMs = performance.now() - t0;
  const round = (m: Map<string, number>) => Object.fromEntries([...m].filter(([, v]) => v >= 5).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, Math.round(v)]));
  return {
    simDays: Math.round(((simClock.getSimTimeMs() - startSim) / 86_400_000) * 10) / 10,
    targetSimDays: Math.round(((wallMs * speed) / 86_400_000) * 10) / 10,
    frames: notifies,
    fps: Math.round((notifies / wallMs) * 1000),
    longTasks: longTasks.length,
    longTaskMs: longTasks.reduce((a, b) => a + b, 0),
    worstMs: Math.max(0, ...longTasks),
    listeners: round(listenerMs),
    profile: await summarizeProfile(profiler),
  };
}

// --- sampling call stacks (the JS Self-Profiling API; the dev server sends the header it needs) ---

interface ProfilerTrace {
  frames: { name: string; resourceId?: number; line?: number }[];
  stacks: { frameId: number; parentId?: number }[];
  samples: { timestamp: number; stackId?: number }[];
  resources: string[];
}
interface SelfProfiler {
  stop(): Promise<ProfilerTrace>;
}

function startProfiler(): SelfProfiler | null {
  const P = (window as unknown as { Profiler?: new (o: { sampleInterval: number; maxBufferSize: number }) => SelfProfiler }).Profiler;
  if (!P) return null;
  try {
    return new P({ sampleInterval: 1, maxBufferSize: 200_000 });
  } catch {
    return null;
  }
}

/** The functions the samples were in: by time spent in them alone ("self") and including what they
 * called ("total"), in ms (one sample ~ one ms), the top ones each. */
async function summarizeProfile(profiler: SelfProfiler | null): Promise<unknown> {
  if (!profiler) return "no profiler (needs the dev server's Document-Policy header and a Chromium browser)";
  const trace = await profiler.stop();
  const label = (frameId: number) => {
    const f = trace.frames[frameId];
    const file = f.resourceId !== undefined ? (trace.resources[f.resourceId] ?? "").replace(/^.*\/src\//, "").replace(/\?.*$/, "") : "";
    return `${f.name || "(anonymous)"} ${file}${f.line ? `:${f.line}` : ""}`;
  };
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  let busy = 0;
  for (let i = 1; i < trace.samples.length; i++) {
    const sample = trace.samples[i];
    if (sample.stackId === undefined) continue;
    const ms = Math.min(50, sample.timestamp - trace.samples[i - 1].timestamp);
    busy += ms;
    const seen = new Set<string>();
    let stackId: number | undefined = sample.stackId;
    let first = true;
    while (stackId !== undefined) {
      const stack: { frameId: number; parentId?: number } = trace.stacks[stackId];
      const key = label(stack.frameId);
      if (first) self.set(key, (self.get(key) ?? 0) + ms);
      first = false;
      if (!seen.has(key)) total.set(key, (total.get(key) ?? 0) + ms);
      seen.add(key);
      stackId = stack.parentId;
    }
  }
  const top = (m: Map<string, number>, n: number) => Object.fromEntries([...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v)]));
  return { busyMs: Math.round(busy), self: top(self, 25), total: top(total, 40) };
}
