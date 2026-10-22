/**
 * Municipality-wide aggregates for the year-end report card (ui/ReportCardModal.tsx)
 * — the two pieces that don't already exist elsewhere: energy delivered broken
 * out by heating *technology* (rather than by device category, which is what
 * history.ts already does), and a tally of how many buildings switched from
 * which heating system to which over the calendar year. Both walk every
 * building directly rather than reusing history.ts's CategorySeries machinery,
 * since neither shape (a technology-keyed breakdown; a same-building-repeated
 * lookup filtered to one year) fits what that module already produces.
 *
 * Also home to the year's one municipality-wide electricity pass (yearElectricity), which the
 * report's energy pie, emissions.ts and finances.ts all read from.
 *
 * The sampled passes are the expensive part (a full year, at municipality
 * scale, needs the same per-timestep per-building resolution history.ts's own
 * sampling does) — computed one calendar month at a time with a yield in
 * between, the same reasoning historyLong.ts's own chunking uses, rather than
 * one long synchronous pass, and each computed once per year. The renewal tally
 * is cheap (it only reads each building's already-cached renewal chain) and
 * runs synchronously.
 */

import { designLoadW, networkCoverage } from "./districtHeatStats";
import { publicCharging } from "./publicCharging";
import { chargingTariff } from "./chargingTariff";
import { dynamicTariff } from "./dynamicTariff";
import { wind } from "./wind";
import { agriPv } from "./agriPv";
import { carParks } from "./carParks";
import { timed } from "./devTiming";
import { existsAt } from "./lifetime";
import type { EnergyClassId } from "./energyClass";
import { gfaOf } from "./newBuild";
import { energyClassAt, retrofitsInRange } from "./retrofit";
import type { Building, PowerPlant } from "../data/types";
import { toDateMs, toSimTimeMs } from "./calendar";
import { categoryEnergyFromSeries, energyKWh, ZERO_CATEGORY_ENERGY_KWH, type CategoryEnergyKWh } from "./energy";
import { currentHeatingSystemId, heatingRenewalsInRange } from "./heatingRenewal";
import type { HeatingSystemId } from "./heatingSystems";
import { historyTimeSteps, municipalityCategorySteps, sampleDynamicConsumptionW, type CategorySeries } from "./history";
import { ANNUAL_CAR_KM, ICE_CAR_L_PER_100KM } from "./mobilitySystems";
import { slotsWithVehicleAt } from "./mobility";
import { fleets } from "./fleet";
import { marketAccess } from "./marketAccess";
import { contractArrays, effectivePowerPlantsAt, municipalArrays, roofPotentialKw } from "./solarAdoption";
import { spaceHeatingThermalDemandW } from "./spaceHeating";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { dwellingWaterHeaterProfile, waterHeaterPowerW, waterHeatingKind, type WaterHeaterProfile } from "./waterHeating";
import { dailyMeanTempC, weatherAt } from "./weather";
import { districtHeat, type DhNetworkInfo } from "./districtHeat";
import { addDhEnergy, dhHeatPumpPowerW, dispatchInstant, zeroDhEnergy, type DhEnergyKWh } from "./districtHeatDispatch";
import { monthRecords } from "./monthRecords";
import { DH_SOURCE_SPECS } from "../config/districtHeat";
import { mobilityCensus } from "./mobility";
import { windPowerW } from "./windPower";
import { powerFlows } from "./spotMarket";
import { grid } from "./grid";
import { consumptionSeriesW } from "./billing";

const SAMPLES_PER_MONTH = 24;
// How much work a month pass does between two yields to the event loop (ms).
const YIELD_AFTER_MS = 25; // matches historyLong.ts's own per-period density
const COARSE_SAMPLES_PER_MONTH = 8; // for quantities that don't need weather-grade resolution — see computeMobilityFuelLiters

// A message rather than a timer: browsers throttle timers in a background tab (to one a minute,
// in time), which would stall a year's passes while the player looks at another tab.
const yieldToEventLoop = () =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve(undefined);
    };
    channel.port2.postMessage(null);
  });

/** A completed month's samples never change (the same "immutable once finished" principle as
 * historyLong.ts's periods), so each month of each pass below is computed once and shared — also
 * while still in flight, since the year-end report's sections (energy pie, emissions, finances) and
 * the live treasury readout all ask for the same year at the same moment, and yearPassPrefetch.ts
 * may already be working on it. Each month is one chunk of work after a yield to the event loop.
 * The computation runs to completion even if every caller has lost interest: it's wanted at the
 * year-end report anyway. */
function sharedMonth<T>(results: Map<number, Promise<T>>, year: number, month: number, compute: () => T | Promise<T>, label = "month pass"): Promise<T> {
  const key = year * 12 + month;
  let result = results.get(key);
  if (!result) {
    result = yieldToEventLoop().then(() => timed(label, compute));
    results.set(key, result);
    result.catch(() => results.delete(key));
  }
  return result;
}

/** A year's months, one after another (never all at once — each is a chunk of main-thread work). */
async function eachMonth<T>(monthOf: (month: number) => Promise<T>): Promise<T[]> {
  const months: T[] = [];
  for (let month = 0; month < 12; month++) months.push(await monthOf(month));
  return months;
}

function monthTimes(year: number, month: number, samples: number): number[] {
  const monthStartMs = toSimTimeMs(Date.UTC(year, month, 1));
  const monthEndMs = toSimTimeMs(Date.UTC(year, month + 1, 1));
  return historyTimeSteps(monthEndMs, monthEndMs - monthStartMs, samples);
}

export interface YearElectricityMonth {
  times: number[];
  series: CategorySeries;
  /** The part of the consumption on the dynamic tariff (dynamicTariff.ts). */
  dynamicW: number[];
  /** What the district heating heat pumps draw (W): the utility's own use, not sold to anyone. */
  dhHeatPumpW: number[];
  /** What the businesses on the open market draw (W): carried by the grid, their energy their supplier's. */
  marketW: number[];
  /** The part of series.evW charging vans, and lorries (W). */
  evVanW: number[];
  evTruckW: number[];
  /** What the charging tariff's meters draw (W). */
  chargingMeterW: number[];
}

const electricityByMonth = new Map<number, Promise<YearElectricityMonth>>();

// --- sampling a month one instant at a time ---
//
// Each month pass samples a number of instants spread over the month. Each instant is sampled on
// its own and kept (by month, then by instant) until the month's pass puts them together — so the
// work comes in small pieces, a yield to the event loop between them, never all at once; and the
// instants of the month in progress can be sampled in the background as soon as they're past
// (prefillMonthSample, run by yearPassPrefetch.ts), leaving little to do when the month ends. An
// instant that's over never changes: the decisions up to it settle as it's sampled, under the
// policy of that day.

interface ElectricitySample {
  series: CategorySeries;
  /** The part of series.evW that charged vans, and lorries (at public chargers and depots); the
   * rest charged cars. */
  evVanW: number;
  evTruckW: number;
  dynamicW: number;
  /** What the businesses buying on the open market draw (W): their energy isn't the utility's. */
  marketW: number;
  /** What the charging tariff's meters draw (W) — not on the time-of-use or dynamic tariff. */
  chargingMeterW: number;
}
interface FuelSample {
  iceCarSlots: number;
  vanLitersPerYear: number;
  truckLitersPerYear: number;
}

const electricitySamples = new Map<number, (ElectricitySample | null)[]>();
const heatingSamples = new Map<number, (TechnologySeriesW | null)[]>();
const fuelSamples = new Map<number, (FuelSample | null)[]>();

/** A month's slots for samples taken so far (created empty). */
function slotsOf<T>(cache: Map<number, (T | null)[]>, key: number, count: number): (T | null)[] {
  let slots = cache.get(key);
  if (!slots) {
    slots = new Array<T | null>(count).fill(null);
    cache.set(key, slots);
  }
  return slots;
}

/** An electricity sample being taken a pass at a time (municipalityCategorySteps), by month and
 * instant: in a large town the whole sample is too much for the gap between two frames. */
const electricityInProgress = new Map<string, { steps: (() => void)[]; done: number; finish: () => ElectricitySample }>();

/** Takes the next pass of a sample: false once it's complete (and stored). */
function electricitySamplePass(buildings: Building[], realPlants: PowerPlant[], year: number, month: number, i: number): boolean {
  const slots = slotsOf(electricitySamples, year * 12 + month, SAMPLES_PER_MONTH);
  if (slots[i]) return false;
  const id = `${year * 12 + month}:${i}`;
  let job = electricityInProgress.get(id);
  if (!job) {
    const t = monthTimes(year, month, SAMPLES_PER_MONTH)[i];
    const tariff: Tariff = tariffStore.at(toSimTimeMs(Date.UTC(year, month, 15)));
    // The plants in service at the instant — never later ones: asking for those would settle solar
    // decisions early, under whatever measures are in force now.
    const plants = effectivePowerPlantsAt(buildings, realPlants, t);
    const town = municipalityCategorySteps(buildings, [t], tariff, plants);
    let dynamicW = 0;
    let marketW = 0;
    let evVanW = 0;
    let evTruckW = 0;
    let chargingMeterW = 0;
    job = {
      steps: [
        ...town.steps,
        () => (dynamicW = sampleDynamicConsumptionW(buildings, [t], tariff)[0]),
        // The charging meters, apart — and the cars of households also on the dynamic tariff, which
        // charge on their own meter, out of the dynamic consumption.
        () => {
          const meters = chargingTariff.meterPowerW(t, tariff, (key) => dynamicTariff.onDynamicKey(key, t));
          chargingMeterW = meters.allW;
          dynamicW -= meters.onDynamicW;
        },
        () => (marketW = marketAccess.marketPowerW(buildings, t)),
        () => {
          const atChargers = publicCharging.totalLoadByVehicleW(t);
          const atDepots = fleets.depotPowerByClassW(buildings, t);
          evVanW = atChargers.van + atDepots.van;
          evTruckW = atChargers.truck + atDepots.truck;
        },
      ],
      done: 0,
      finish: () => ({ series: town.result(), dynamicW, marketW, evVanW, evTruckW, chargingMeterW }),
    };
    electricityInProgress.set(id, job);
  }
  job.steps[job.done++]();
  if (job.done < job.steps.length) return true;
  slots[i] = job.finish();
  electricityInProgress.delete(id);
  return true;
}

function heatingSampleAt(buildings: Building[], year: number, month: number, i: number): TechnologySeriesW {
  const slots = slotsOf(heatingSamples, year * 12 + month, SAMPLES_PER_MONTH);
  let sample = slots[i];
  if (!sample) {
    sample = sampleTechnologySeries(buildings, [monthTimes(year, month, SAMPLES_PER_MONTH)[i]]);
    slots[i] = sample;
  }
  return sample;
}

function fuelSampleAt(buildings: Building[], year: number, month: number, i: number): FuelSample {
  const slots = slotsOf(fuelSamples, year * 12 + month, COARSE_SAMPLES_PER_MONTH);
  let sample = slots[i];
  if (!sample) {
    const t = monthTimes(year, month, COARSE_SAMPLES_PER_MONTH)[i];
    let iceCarSlots = 0;
    for (const building of buildings) {
      if (!existsAt(building, t)) continue;
      for (const dwelling of building.dwellings) iceCarSlots += slotsWithVehicleAt(building.egid, dwelling, "carICE", t);
    }
    const diesel = fleets.dieselLitersPerYearAt(buildings, t);
    sample = { iceCarSlots, vanLitersPerYear: diesel.van, truckLitersPerYear: diesel.truck };
    slots[i] = sample;
  }
  return sample;
}

/** Every sample of a month's pass, in order: those taken ahead are reused, the rest taken now, one at
 * a time with a yield to the event loop after each. */
async function eachSample<T>(cache: Map<number, (T | null)[]>, key: number, count: number, take: (i: number) => T, label: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < count; i++) {
    const had = cache.get(key)?.[i];
    if (had) {
      out.push(had);
      continue;
    }
    out.push(timed(label, () => take(i)));
    await yieldToEventLoop();
  }
  cache.delete(key);
  return out;
}

/** Category series sampled instant by instant, put together. */
function joinCategorySeries(parts: CategorySeries[]): CategorySeries {
  const keys = Object.keys(parts[0]) as (keyof CategorySeries)[];
  return Object.fromEntries(keys.map((k) => [k, parts.map((p) => p[k][0])])) as unknown as CategorySeries;
}

const TECHNOLOGY_SERIES_KEYS = [
  "airHeatPumpSpaceW",
  "groundHeatPumpSpaceW",
  "gasBoilerSpaceW",
  "oilBoilerSpaceW",
  "districtHeatingSpaceW",
  "woodPelletSpaceW",
  "heatPumpWaterW",
  "directElectricWaterW",
  "dhOilW",
  "dhGasW",
  "dhHeatPumpPowerW",
] as const;

function joinTechnologySeries(parts: TechnologySeriesW[]): TechnologySeriesW {
  const out = Object.fromEntries(TECHNOLOGY_SERIES_KEYS.map((k) => [k, parts.map((p) => p[k][0])])) as unknown as TechnologySeriesW;
  out.dhSourceW = new Map();
  out.dhNetworkW = new Map();
  parts.forEach((p, i) => {
    for (const [id, w] of p.dhSourceW) {
      let series = out.dhSourceW.get(id);
      if (!series) {
        series = new Array<number>(parts.length).fill(0);
        out.dhSourceW.set(id, series);
      }
      series[i] = w[0];
    }
    for (const [name, w] of p.dhNetworkW ?? []) {
      let series = out.dhNetworkW!.get(name);
      if (!series) {
        series = { clean: new Array<number>(parts.length).fill(0), boiler: new Array<number>(parts.length).fill(0) };
        out.dhNetworkW!.set(name, series);
      }
      series.clean[i] = w.clean[0];
      series.boiler[i] = w.boiler[0];
    }
  });
  return out;
}

/** Takes one sample of the month in progress whose instant is past and that isn't taken yet — the
 * background's share of next month-end's work (yearPassPrefetch.ts) — or, for electricity, one pass
 * of it. True if it did something. */
export function prefillMonthSample(buildings: Building[], realPlants: PowerPlant[], nowMs: number): boolean {
  const d = new Date(toDateMs(nowMs));
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const key = year * 12 + month;
  // A month whose pass has started is the pass's to finish.
  if (electricityByMonth.has(key) || heatingTechnologyByMonth.has(key) || mobilityFuelByMonth.has(key)) return false;
  const due = (t: number) => t <= nowMs - PREFILL_MARGIN_MS;
  const times = monthTimes(year, month, SAMPLES_PER_MONTH);
  for (let i = 0; i < times.length && due(times[i]); i++) {
    if (!electricitySamples.get(key)?.[i]) {
      timed("prefill: electricity", () => electricitySamplePass(buildings, realPlants, year, month, i));
      return true;
    }
    if (!heatingSamples.get(key)?.[i]) {
      timed("prefill: heating", () => heatingSampleAt(buildings, year, month, i));
      return true;
    }
  }
  const coarse = monthTimes(year, month, COARSE_SAMPLES_PER_MONTH);
  for (let i = 0; i < coarse.length && due(coarse[i]); i++) {
    if (!fuelSamples.get(key)?.[i]) {
      timed("prefill: fuel", () => fuelSampleAt(buildings, year, month, i));
      return true;
    }
  }
  return false;
}

// How long after its instant a sample is taken ahead: the clock moves on in steps, and the
// decisions falling due right at the instant settle as it passes.
const PREFILL_MARGIN_MS = 60 * 60_000;

export function monthElectricity(buildings: Building[], realPlants: PowerPlant[], year: number, month: number): Promise<YearElectricityMonth> {
  return sharedMonth(electricityByMonth, year, month, async () => {
    const key = year * 12 + month;
    const times = monthTimes(year, month, SAMPLES_PER_MONTH);
    // A pass at a time, yielding to the event loop whenever a few of them add up to a slice of a
    // frame — after every pass would make counting a large town's year noticeably slower.
    let sliceStart = performance.now();
    for (let i = 0; i < SAMPLES_PER_MONTH; i++) {
      while (timed("month electricity: pass", () => electricitySamplePass(buildings, realPlants, year, month, i))) {
        if (performance.now() - sliceStart < YIELD_AFTER_MS) continue;
        await yieldToEventLoop();
        sliceStart = performance.now();
      }
    }
    const samples = slotsOf(electricitySamples, key, SAMPLES_PER_MONTH) as ElectricitySample[];
    electricitySamples.delete(key);
    const series = joinCategorySeries(samples.map((s) => s.series));
    const monthEndMs = toSimTimeMs(Date.UTC(year, month + 1, 1));
    const plants = effectivePowerPlantsAt(buildings, realPlants, monthEndMs - 1);
    // The district heating heat pumps' draw, instant by instant, from the month's heat pass (the
    // same instants).
    const dhHeatPumpW = (await monthHeatingTechnology(buildings, year, month)).dhHeatPumpW ?? times.map(() => 0);
    await recordMonthElectricity(buildings, year, month, times, series, dhHeatPumpW, plants, monthEndMs - 1);
    await yieldToEventLoop();
    await recordMonthAssets(buildings, year, month, plants, monthEndMs - 1);
    return {
      times,
      series,
      dynamicW: samples.map((s) => s.dynamicW),
      dhHeatPumpW,
      marketW: samples.map((s) => s.marketW ?? 0),
      evVanW: samples.map((s) => s.evVanW ?? 0),
      evTruckW: samples.map((s) => s.evTruckW ?? 0),
      chargingMeterW: samples.map((s) => s.chargingMeterW ?? 0),
    };
  }, "month electricity");
}

/** Every electricity category, municipality-wide, over one calendar year, month by month — the one
 * expensive sampling pass the year-end energy pie, emissions (net grid electricity) and finances
 * (revenue, feed-in, wholesale) all read from, instead of each sampling the year on its own. Solar
 * uses the plants (real + adopted) in service by the end of each month. The tariff only shifts when within a day EVs
 * charge, never the total; each month uses the prices in force that month. */
export function yearElectricity(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<YearElectricityMonth[]> {
  return eachMonth((month) => monthElectricity(buildings, realPlants, year, month));
}

/** Samples one just-completed month of every year pass ahead of the year-end report, so the report
 * only has what's left (normally December) to do when it opens. */
export async function prefetchMonth(buildings: Building[], realPlants: PowerPlant[], year: number, month: number): Promise<void> {
  await monthElectricity(buildings, realPlants, year, month);
  await monthHeatingTechnology(buildings, year, month);
  await monthMobilityFuel(buildings, year, month);
}

/** What the district heating heat pumps drew over the year (kWh): the utility's own use, on top of
 * the categories (the report card's pie shows it beside them). */
export async function yearDhHeatPumpKWh(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<number> {
  const months = await yearElectricity(buildings, realPlants, year);
  return months.reduce((sum, m) => sum + energyKWh(m.times, m.dhHeatPumpW), 0);
}

/** The year's energy per category (the report card's "Energy by category" pie). */
export async function yearCategoryEnergyKWh(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<CategoryEnergyKWh> {
  const months = await yearElectricity(buildings, realPlants, year);
  const totals = { ...ZERO_CATEGORY_ENERGY_KWH } as Record<keyof CategoryEnergyKWh, number>;
  for (const { times, series } of months) {
    const energy = categoryEnergyFromSeries(times, series);
    for (const key of Object.keys(totals) as (keyof CategoryEnergyKWh)[]) totals[key] += energy[key];
  }
  return totals as CategoryEnergyKWh;
}

export interface HeatingTechnologyEnergyKWh {
  airHeatPumpSpaceKWh: number;
  groundHeatPumpSpaceKWh: number;
  gasBoilerSpaceKWh: number;
  oilBoilerSpaceKWh: number;
  districtHeatingSpaceKWh: number;
  woodPelletSpaceKWh: number;
  heatPumpWaterKWh: number;
  directElectricWaterKWh: number;
  /** Who made the district heat (districtHeatDispatch.ts) — delivered heat plus the pipes' losses. */
  districtHeat: DhEnergyKWh;
  /** A month's: what the networks' heat pumps drew at each of its sampled instants (W) — the month's
   * electricity pass adds it to the town's (monthElectricity). */
  dhHeatPumpW?: number[];
}

type TechnologyAmount = Exclude<keyof HeatingTechnologyEnergyKWh, "districtHeat" | "dhHeatPumpW">;
const TECHNOLOGY_AMOUNTS: TechnologyAmount[] = [
  "airHeatPumpSpaceKWh",
  "groundHeatPumpSpaceKWh",
  "gasBoilerSpaceKWh",
  "oilBoilerSpaceKWh",
  "districtHeatingSpaceKWh",
  "woodPelletSpaceKWh",
  "heatPumpWaterKWh",
  "directElectricWaterKWh",
];

function zeroTechnologyEnergy(): HeatingTechnologyEnergyKWh {
  return {
    airHeatPumpSpaceKWh: 0,
    groundHeatPumpSpaceKWh: 0,
    gasBoilerSpaceKWh: 0,
    oilBoilerSpaceKWh: 0,
    districtHeatingSpaceKWh: 0,
    woodPelletSpaceKWh: 0,
    heatPumpWaterKWh: 0,
    directElectricWaterKWh: 0,
    districtHeat: zeroDhEnergy(),
  };
}

interface TechnologySeriesW {
  airHeatPumpSpaceW: number[];
  groundHeatPumpSpaceW: number[];
  gasBoilerSpaceW: number[];
  oilBoilerSpaceW: number[];
  districtHeatingSpaceW: number[];
  woodPelletSpaceW: number[];
  heatPumpWaterW: number[];
  directElectricWaterW: number[];
  /** District heat production by source, and by the boilers (districtHeatDispatch.ts). */
  dhSourceW: Map<string, number[]>;
  dhOilW: number[];
  dhGasW: number[];
  /** What the networks' heat pumps draw from the grid (W). */
  dhHeatPumpPowerW: number[];
  /** Each network's clean heat and boiler heat (by its name). */
  dhNetworkW?: Map<string, { clean: number[]; boiler: number[] }>;
}

/** Space heating bucketed by which of the five systems is actually installed
 * at each sample instant (not the device-category split history.ts uses),
 * plus water heating split by heat-pump vs. direct-electric (waterHeating.ts's
 * own distinction) — everything else about the physics is unchanged from the
 * live simulation. */
function sampleTechnologySeries(buildings: Building[], times: number[]): TechnologySeriesW {
  const out: TechnologySeriesW = {
    airHeatPumpSpaceW: [],
    groundHeatPumpSpaceW: [],
    gasBoilerSpaceW: [],
    oilBoilerSpaceW: [],
    districtHeatingSpaceW: [],
    woodPelletSpaceW: [],
    heatPumpWaterW: [],
    directElectricWaterW: [],
    dhSourceW: new Map(),
    dhOilW: [],
    dhGasW: [],
    dhHeatPumpPowerW: [],
    dhNetworkW: new Map(),
  };
  for (const [i, t] of times.entries()) {
    const dailyMeanC = dailyMeanTempC(t);
    const outsideTempC = weatherAt(t).tempC;
    let air = 0;
    let ground = 0;
    let gas = 0;
    let oil = 0;
    let district = 0;
    let wood = 0;
    let hpWater = 0;
    let directWater = 0;
    // Each network's load, for the dispatch.
    const dhLoads = new Map<DhNetworkInfo, number>();
    let dhOrphanW = 0;
    for (const building of buildings) {
      if (!existsAt(building, t)) continue;
      const heatingId = currentHeatingSystemId(building, t);
      if (heatingId) {
        const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC, t);
        if (heatingId === "airHeatPump") air += thermalW;
        else if (heatingId === "groundHeatPump") ground += thermalW;
        else if (heatingId === "gasBoiler") gas += thermalW;
        else if (heatingId === "oilBoiler") oil += thermalW;
        else if (heatingId === "woodPellet") wood += thermalW;
        else {
          district += thermalW;
          const network = districtHeat.networkOf(building.streetSegments, t);
          if (network) dhLoads.set(network, (dhLoads.get(network) ?? 0) + thermalW);
          else dhOrphanW += thermalW;
        }
      }
      const kind = waterHeatingKind(building, t);
      if (kind) {
        const profiles = waterProfiles(building);
        let buildingWaterW = 0;
        for (const profile of profiles) buildingWaterW += waterHeaterPowerW(profile, t);
        if (kind === "heatPump") hpWater += buildingWaterW;
        else directWater += buildingWaterW;
      }
    }
    out.airHeatPumpSpaceW.push(air);
    out.groundHeatPumpSpaceW.push(ground);
    out.gasBoilerSpaceW.push(gas);
    out.oilBoilerSpaceW.push(oil);
    out.districtHeatingSpaceW.push(district);
    out.woodPelletSpaceW.push(wood);
    out.heatPumpWaterW.push(hpWater);
    out.directElectricWaterW.push(directWater);
    const production = dispatchInstant(dhLoads, dhOrphanW);
    for (const [id, w] of production.bySource) {
      let series = out.dhSourceW.get(id);
      if (!series) {
        series = new Array(times.length).fill(0);
        out.dhSourceW.set(id, series);
      }
      series[i] = w;
    }
    out.dhOilW.push(production.oilW);
    out.dhGasW.push(production.gasW);
    out.dhHeatPumpPowerW.push(dhHeatPumpPowerW(production.bySource, t));
    for (const [name, w] of production.byNetwork) {
      let series = out.dhNetworkW!.get(name);
      if (!series) {
        series = { clean: new Array(times.length).fill(0), boiler: new Array(times.length).fill(0) };
        out.dhNetworkW!.set(name, series);
      }
      series.clean[i] = w.cleanW;
      series.boiler[i] = w.boilerW;
    }
  }
  return out;
}

// Every dwelling's seeded water heater profile, derived once rather than on every sample.
const waterProfileCache = new WeakMap<Building, WaterHeaterProfile[]>();

function waterProfiles(building: Building): WaterHeaterProfile[] {
  let profiles = waterProfileCache.get(building);
  if (!profiles) {
    profiles = building.dwellings.map((d) => dwellingWaterHeaterProfile(building.egid, d));
    waterProfileCache.set(building, profiles);
  }
  return profiles;
}

const heatingTechnologyByMonth = new Map<number, Promise<HeatingTechnologyEnergyKWh>>();

export function monthHeatingTechnology(buildings: Building[], year: number, month: number): Promise<HeatingTechnologyEnergyKWh> {
  return sharedMonth(heatingTechnologyByMonth, year, month, async () => {
    const times = monthTimes(year, month, SAMPLES_PER_MONTH);
    const parts = await eachSample(heatingSamples, year * 12 + month, SAMPLES_PER_MONTH, (i) => heatingSampleAt(buildings, year, month, i), "month heating: sample");
    const series = joinTechnologySeries(parts);
    recordMonthHeating(year, month, times, series);
    return {
      airHeatPumpSpaceKWh: energyKWh(times, series.airHeatPumpSpaceW),
      groundHeatPumpSpaceKWh: energyKWh(times, series.groundHeatPumpSpaceW),
      gasBoilerSpaceKWh: energyKWh(times, series.gasBoilerSpaceW),
      oilBoilerSpaceKWh: energyKWh(times, series.oilBoilerSpaceW),
      districtHeatingSpaceKWh: energyKWh(times, series.districtHeatingSpaceW),
      woodPelletSpaceKWh: energyKWh(times, series.woodPelletSpaceW),
      heatPumpWaterKWh: energyKWh(times, series.heatPumpWaterW),
      directElectricWaterKWh: energyKWh(times, series.directElectricWaterW),
      districtHeat: {
        bySource: Object.fromEntries([...series.dhSourceW].map(([id, w]) => [id, energyKWh(times, w)])),
        boilerOilKWh: energyKWh(times, series.dhOilW),
        boilerGasKWh: energyKWh(times, series.dhGasW),
      },
      dhHeatPumpW: series.dhHeatPumpPowerW,
    };
  }, "month heating");
}

/** Keeps a month's electricity in the record the charts read (monthRecords.ts): use by category,
 * what wind made of the local generation, rooftop solar against its potential, and the modal split
 * at the month's end. */
/** Keeps a month's electricity in the record — a count at a time, yielding between them (each is a
 * pass over the whole town). */
async function recordMonthElectricity(buildings: Building[], year: number, month: number, times: number[], series: CategorySeries, dhHeatPumpW: number[], plants: PowerPlant[], endMs: number): Promise<void> {
  const energy = categoryEnergyFromSeries(times, series);
  const turbines = plants.filter((p) => p.technology === "Wind");
  const windKWh = turbines.length > 0 ? energyKWh(times, times.map((t) => turbines.reduce((sum, p) => sum + windPowerW(p, t), 0))) : 0;
  let builtKw = 0;
  const builtByEgid = new Map<string, number>();
  for (const p of plants)
    if (p.technology === "Photovoltaic" && p.egid && (p.activeToMs === undefined || p.activeToMs > endMs)) {
      builtKw += p.capacityKw ?? 0;
      builtByEgid.set(p.egid, (builtByEgid.get(p.egid) ?? 0) + (p.capacityKw ?? 0));
    }
  // A roof with panels counts at least what's on it (a real array on a roof the game rates unsuited).
  let potentialKw = 0;
  for (const b of buildings) if (existsAt(b, endMs)) potentialKw += Math.max(roofPotentialKw(b, year), builtByEgid.get(b.egid) ?? 0);
  await yieldToEventLoop();
  // At the month's last sample, which the pass above has already asked about: counting never
  // settles a household's choice sooner than the game would have.
  const census = mobilityCensus(buildings, times[times.length - 1]);
  await yieldToEventLoop();
  const flows = powerFlows(
    times,
    consumptionSeriesW(series).map((w, i) => w + dhHeatPumpW[i]),
    series.solarW,
    grid.batteriesInService(toSimTimeMs(Date.UTC(year, month, 15))),
    0,
  );
  monthRecords.record(year * 12 + month, {
    electricityKWh: { ...energy, solar: Math.max(0, energy.solar - windKWh) },
    dhHeatPumpKWh: energyKWh(times, dhHeatPumpW),
    windKWh,
    solarBuiltKw: builtKw,
    solarPotentialKw: potentialKw,
    mobility: { car: census.byMode.car, carElectric: census.carsElectric, bike: census.byMode.bike, other: census.byMode.other },
    boughtKWh: flows.boughtKWh,
    soldKWh: flows.soldKWh,
    storedKWh: flows.storedKWh,
  });
}

/** Keeps what the town had at a month's end in the record (the charts' equipment): generation,
 * batteries, district heating's pipes and reach, public charging and how good it is. */
async function recordMonthAssets(buildings: Building[], year: number, month: number, plants: PowerPlant[], endMs: number): Promise<void> {
  const standing = buildings.filter((b) => existsAt(b, endMs));
  let homeBatteryKwh = 0;
  for (const p of plants) if (p.battery && (p.activeToMs === undefined || p.activeToMs > endMs)) homeBatteryKwh += p.battery.kwh;
  const coverage = networkCoverage(standing, endMs);
  await yieldToEventLoop();
  const share = (c: { total: number; connected: number; withinReach: number }, which: "connected" | "withinReach") => (c.total > 0 ? c[which] / c.total : 0);
  // Who charges where is only known from the start on: the months before it take the start's.
  const chargingMs = Math.max(endMs, 0);
  const usage = publicCharging.townUsage(chargingMs);
  let households = 0;
  let withWallbox = 0;
  let without = 0;
  let qosSum = 0;
  for (const a of publicCharging.householdAccess(standing, chargingMs).values()) {
    households += a.households;
    withWallbox += a.atHome;
    without += a.households - a.atHome;
    qosSum += (a.households - a.atHome) * a.qos;
  }
  await yieldToEventLoop();
  const fleet = fleets.census(standing, endMs);
  await yieldToEventLoop();
  // Heated buildings (not garages, sheds, or electric or unrecorded heating): by system, by insulation.
  const heatingSystems: Record<string, { buildings: number; floor: number }> = {};
  const insulation: Record<string, { buildings: number; floor: number }> = {};
  const tally = (into: Record<string, { buildings: number; floor: number }>, key: string, floor: number) => {
    const t = (into[key] ??= { buildings: 0, floor: 0 });
    t.buildings++;
    t.floor += floor;
  };
  let airHeatPumpKw = 0;
  let groundHeatPumpKw = 0;
  for (const b of standing) {
    const system = currentHeatingSystemId(b, endMs);
    if (!system) continue;
    const floor = gfaOf(b);
    tally(heatingSystems, system, floor);
    tally(insulation, energyClassAt(b, endMs), floor);
    if (system === "airHeatPump") airHeatPumpKw += designLoadW(b, endMs) / 1000;
    else if (system === "groundHeatPump") groundHeatPumpKw += designLoadW(b, endMs) / 1000;
  }
  monthRecords.record(year * 12 + month, {
    assets: {
      agriPvKw: agriPv.capacityAtKw(endMs),
      carParkKw: carParks.capacityAtKw(endMs),
      windKw: wind.turbinesAt(endMs).reduce((sum, p) => sum + (p.capacityKw ?? 0), 0),
      ownKw:
        wind.turbinesAt(endMs).reduce((sum, p) => sum + (p.capacityKw ?? 0), 0) +
        [...contractArrays(), ...municipalArrays()].reduce((sum, a) => sum + (a.installedAtMs <= endMs ? a.capacityKw : 0), 0) +
        carParks.municipalCapacityAtKw(endMs) +
        agriPv.municipalCapacityAtKw(endMs),
      homeBatteryKwh,
      gridBatteryKwh: grid.batteriesInService(endMs).kwh,
      dhPipeM: districtHeat.pipedLengthM(endMs) + districtHeat.trunkLengthM(endMs) + districtHeat.lineLengthM(endMs),
      dhConnected: { buildings: share(coverage.buildings, "connected"), floor: share(coverage.floorAreaM2, "connected"), demand: share(coverage.heatDemandKWh, "connected") },
      dhWithinReach: { buildings: share(coverage.buildings, "withinReach"), floor: share(coverage.floorAreaM2, "withinReach"), demand: share(coverage.heatDemandKWh, "withinReach") },
      chargerPoints: usage.points,
      chargerRoom: usage.capacity,
      chargerTaken: usage.users,
      chargingQos: without > 0 ? qosSum / without : 0,
      wallboxShare: households > 0 ? withWallbox / households : 0,
      vans: fleet.vans,
      vansElectric: fleet.vansElectric,
      trucks: fleet.trucks,
      trucksElectric: fleet.trucksElectric,
      heatingSystems,
      insulation,
      airHeatPumpKw,
      groundHeatPumpKw,
    },
  });
}

/** Keeps a month's heat in the record: by heating system, and the district heat by what made it. */
function recordMonthHeating(year: number, month: number, times: number[], series: TechnologySeriesW): void {
  const labelOf = new Map(districtHeat.getSources().map((s) => [s.id, s.kind ? DH_SOURCE_SPECS[s.kind].label : "Other clean heat"]));
  const districtHeatKWh: Record<string, number> = {};
  for (const [id, w] of series.dhSourceW) {
    const label = labelOf.get(id) ?? "Other";
    districtHeatKWh[label] = (districtHeatKWh[label] ?? 0) + energyKWh(times, w);
  }
  const oil = energyKWh(times, series.dhOilW);
  const gas = energyKWh(times, series.dhGasW);
  if (oil > 0) districtHeatKWh["Oil boilers"] = oil;
  if (gas > 0) districtHeatKWh["Gas boilers"] = gas;
  const dhNetworkKWh: Record<string, { clean: number; boiler: number }> = {};
  for (const [name, w] of series.dhNetworkW ?? []) dhNetworkKWh[name] = { clean: energyKWh(times, w.clean), boiler: energyKWh(times, w.boiler) };
  monthRecords.record(year * 12 + month, {
    dhNetworkKWh,
    heatingKWh: {
      oil: energyKWh(times, series.oilBoilerSpaceW),
      gas: energyKWh(times, series.gasBoilerSpaceW),
      airHeatPump: energyKWh(times, series.airHeatPumpSpaceW),
      groundHeatPump: energyKWh(times, series.groundHeatPumpSpaceW),
      districtHeating: energyKWh(times, series.districtHeatingSpaceW),
      wood: energyKWh(times, series.woodPelletSpaceW),
    },
    districtHeatKWh,
  });
}

/** Energy delivered per heating technology over the given calendar year (the report card's heating
 * pies, and emissions.ts's fossil fuel burned), month by month — see sharedMonth. */
export async function computeHeatingTechnologyBreakdown(buildings: Building[], year: number): Promise<HeatingTechnologyEnergyKWh> {
  const totals = zeroTechnologyEnergy();
  for (const month of await eachMonth((m) => monthHeatingTechnology(buildings, year, m))) {
    for (const key of TECHNOLOGY_AMOUNTS) totals[key] += month[key];
    addDhEnergy(totals.districtHeat, month.districtHeat);
  }
  return totals;
}

/** Type-safe accessor for the space-heating field matching a given technology
 * id — avoids a template-literal-keyed lookup at every call site. */
export function spaceHeatingKWhFor(technology: HeatingTechnologyEnergyKWh, id: HeatingSystemId): number {
  switch (id) {
    case "airHeatPump":
      return technology.airHeatPumpSpaceKWh;
    case "groundHeatPump":
      return technology.groundHeatPumpSpaceKWh;
    case "gasBoiler":
      return technology.gasBoilerSpaceKWh;
    case "oilBoiler":
      return technology.oilBoilerSpaceKWh;
    case "districtHeating":
      return technology.districtHeatingSpaceKWh;
    case "woodPellet":
      return technology.woodPelletSpaceKWh;
  }
}

export interface RenewalTallyEntry {
  previousSystem: HeatingSystemId;
  system: HeatingSystemId;
  count: number;
}

/** How many buildings switched from which heating system to which, over the
 * given calendar year, most common first. Cheap — every building's renewal
 * chain is already cached by the time the year-end report fires (see
 * yearEndWatcher.ts), so this only ever does cache reads plus, for whichever
 * handful of buildings renew in this specific year, the one-time cost of
 * generating that event (already paid once, not per report). */
export function computeHeatingRenewalTally(buildings: Building[], year: number): RenewalTallyEntry[] {
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  const counts = new Map<string, RenewalTallyEntry>();
  for (const building of buildings) {
    for (const record of heatingRenewalsInRange(building, yearStartMs, yearEndMs)) {
      if (!existsAt(building, record.installedAtMs)) continue; // a demolished building no longer renews anything
      const key = `${record.previousSystem}>${record.system}`;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { previousSystem: record.previousSystem, system: record.system, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

/** Net municipality-wide electricity consumption for the given calendar year — every device
 * category and the district heating heat pumps, minus solar generation — read off the shared year
 * pass (the emissions weigh each sample by the grid's intensity instead, emissions.ts). */
export async function computeNetElectricityKWh(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<number> {
  const energy = await yearCategoryEnergyKWh(buildings, realPlants, year);
  const dhHeatPumpKWh = await yearDhHeatPumpKWh(buildings, realPlants, year);
  return (
    dhHeatPumpKWh +
    energy.fridge +
    energy.lighting +
    energy.cooking +
    energy.laundry +
    energy.plugLoad +
    energy.ev +
    energy.heatPump +
    energy.ac +
    energy.waterHeating +
    energy.commercial -
    energy.solar
  );
}

interface MobilityFuelMonth {
  iceCarSlotSamples: number;
  vanLitersPerYearSum: number;
  truckLitersPerYearSum: number;
  samples: number;
}

const mobilityFuelByMonth = new Map<number, Promise<MobilityFuelMonth>>();

function monthMobilityFuel(buildings: Building[], year: number, month: number): Promise<MobilityFuelMonth> {
  return sharedMonth(mobilityFuelByMonth, year, month, async () => {
    const samples = await eachSample(fuelSamples, year * 12 + month, COARSE_SAMPLES_PER_MONTH, (i) => fuelSampleAt(buildings, year, month, i), "month fuel: sample");
    return {
      iceCarSlotSamples: samples.reduce((s, x) => s + x.iceCarSlots, 0),
      vanLitersPerYearSum: samples.reduce((s, x) => s + x.vanLitersPerYear, 0),
      truckLitersPerYearSum: samples.reduce((s, x) => s + x.truckLitersPerYear, 0),
      samples: samples.length,
    };
  }, "month mobility fuel");
}

/** Liters of petrol/diesel burned by every currently-ICE car slot in the
 * municipality over the given calendar year — mobility's own fuel
 * consumption is a flat per-km rate (unlike heating's weather-driven
 * demand), so this only needs to know *how many ICE car-slot-years* existed,
 * not a fine-grained power curve: each sample just checks which slots are
 * car+ICE right then, and the fraction of samples a slot appears in
 * approximates the fraction of the year it held that state. Coarser
 * sampling than the technology breakdown for the same reason — renewal
 * events are rare (years apart per slot), so the underlying quantity barely
 * moves within a month. */
export async function computeMobilityFuelLiters(buildings: Building[], year: number): Promise<{ cars: number; vans: number; lorries: number }> {
  let iceCarSlotSamples = 0;
  let vanLitersPerYearSum = 0;
  let truckLitersPerYearSum = 0;
  let totalSamples = 0;
  for (const month of await eachMonth((m) => monthMobilityFuel(buildings, year, m))) {
    iceCarSlotSamples += month.iceCarSlotSamples;
    vanLitersPerYearSum += month.vanLitersPerYearSum;
    truckLitersPerYearSum += month.truckLitersPerYearSum;
    totalSamples += month.samples;
  }
  if (totalSamples === 0) return { cars: 0, vans: 0, lorries: 0 };
  const avgIceCarCount = iceCarSlotSamples / totalSamples;
  // Residents' petrol and diesel cars, and businesses' diesel vans and lorries (fleet.ts) at their
  // average yearly rate.
  return {
    cars: avgIceCarCount * (ANNUAL_CAR_KM / 100) * ICE_CAR_L_PER_100KM,
    vans: vanLitersPerYearSum / totalSamples,
    lorries: truckLitersPerYearSum / totalSamples,
  };
}

export interface RetrofitTallyEntry {
  from: EnergyClassId;
  to: EnergyClassId;
  count: number;
}

export interface RetrofitYearTally {
  entries: RetrofitTallyEntry[];
  total: number;
  municipalSubsidyRp: number;
}

/** Insulation retrofits completed in the given calendar year, by class change, most common first. */
export function computeRetrofitTally(buildings: Building[], year: number): RetrofitYearTally {
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  const counts = new Map<string, RetrofitTallyEntry>();
  let total = 0;
  let municipalSubsidyRp = 0;
  for (const building of buildings) {
    for (const record of retrofitsInRange(building, yearStartMs, yearEndMs)) {
      if (!existsAt(building, record.installedAtMs)) continue;
      const key = `${record.from}>${record.to}`;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { from: record.from, to: record.to, count: 1 });
      total++;
      municipalSubsidyRp += record.municipalSubsidyRp;
    }
  }
  return { entries: [...counts.values()].sort((a, b) => b.count - a.count), total, municipalSubsidyRp };
}

// --- saving (saveGame.ts) ---

export interface YearReportSnapshot {
  electricity: Map<number, YearElectricityMonth>;
  heating: Map<number, HeatingTechnologyEnergyKWh>;
  mobility: Map<number, MobilityFuelMonth>;
  /** The month in progress's samples taken ahead — each under the policy of its day. */
  samples: {
    electricity: [number, (ElectricitySample | null)[]][];
    heating: [number, (TechnologySeriesW | null)[]][];
    fuel: [number, (FuelSample | null)[]][];
  };
}

async function settled<T>(cache: Map<number, Promise<T>>, fromKey: number): Promise<Map<number, T>> {
  const out = new Map<number, T>();
  for (const [key, promise] of cache) {
    if (key < fromKey) continue;
    try {
      out.set(key, await promise);
    } catch {
      // a month that failed is simply sampled again later
    }
  }
  return out;
}

/** The months sampled for a year not yet booked (from `fromYear` on): each was sampled under the
 * policy of its day, so they travel with the save. */
export async function snapshotYearReport(fromYear: number): Promise<YearReportSnapshot> {
  const fromKey = fromYear * 12;
  return {
    electricity: await settled(electricityByMonth, fromKey),
    heating: await settled(heatingTechnologyByMonth, fromKey),
    mobility: await settled(mobilityFuelByMonth, fromKey),
    samples: { electricity: [...electricitySamples], heating: [...heatingSamples], fuel: [...fuelSamples] },
  };
}

export function restoreYearReport(saved: YearReportSnapshot): void {
  electricityByMonth.clear();
  heatingTechnologyByMonth.clear();
  mobilityFuelByMonth.clear();
  for (const [key, v] of saved.electricity) electricityByMonth.set(key, Promise.resolve(v));
  for (const [key, v] of saved.heating) heatingTechnologyByMonth.set(key, Promise.resolve(v));
  for (const [key, v] of saved.mobility) mobilityFuelByMonth.set(key, Promise.resolve(v));
  electricitySamples.clear();
  heatingSamples.clear();
  fuelSamples.clear();
  for (const [key, list] of saved.samples?.electricity ?? []) electricitySamples.set(key, list);
  for (const [key, list] of saved.samples?.heating ?? []) heatingSamples.set(key, list);
  for (const [key, list] of saved.samples?.fuel ?? []) fuelSamples.set(key, list);
}

// Dev: which months' passes are under way or done, and the samples taken ahead (dev/perf.ts).
if (import.meta.env.DEV) {
  Object.assign(window, {
    __yearReportState: () => ({
      electricity: [...electricityByMonth.keys()],
      heating: [...heatingTechnologyByMonth.keys()],
      fuel: [...mobilityFuelByMonth.keys()],
      samples: {
        electricity: [...electricitySamples].map(([k, l]) => [k, l.filter(Boolean).length]),
        heating: [...heatingSamples].map(([k, l]) => [k, l.filter(Boolean).length]),
        fuel: [...fuelSamples].map(([k, l]) => [k, l.filter(Boolean).length]),
      },
    }),
  });
}
