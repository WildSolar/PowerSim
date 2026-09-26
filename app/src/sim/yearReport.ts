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

import { existsAt } from "./lifetime";
import type { EnergyClassId } from "./energyClass";
import { retrofitsInRange } from "./retrofit";
import type { Building, PowerPlant } from "../data/types";
import { toSimTimeMs } from "./calendar";
import { categoryEnergyFromSeries, energyKWh, ZERO_CATEGORY_ENERGY_KWH, type CategoryEnergyKWh } from "./energy";
import { currentHeatingSystemId, heatingRenewalsInRange } from "./heatingRenewal";
import type { HeatingSystemId } from "./heatingSystems";
import { historyTimeSteps, sampleMunicipalityCategorySeries, type CategorySeries } from "./history";
import { ANNUAL_CAR_KM, ICE_CAR_L_PER_100KM } from "./mobilitySystems";
import { slotsWithVehicleAt } from "./mobility";
import { effectivePowerPlants } from "./solarAdoption";
import { spaceHeatingThermalDemandW } from "./spaceHeating";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { dwellingWaterHeaterProfile, waterHeaterPowerW, waterHeatingKind, type WaterHeaterProfile } from "./waterHeating";
import { dailyMeanTempC, weatherAt } from "./weather";

const SAMPLES_PER_MONTH = 24; // matches historyLong.ts's own per-period density
const COARSE_SAMPLES_PER_MONTH = 8; // for quantities that don't need weather-grade resolution — see computeMobilityFuelLiters

const yieldToEventLoop = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A completed month's samples never change (the same "immutable once finished" principle as
 * historyLong.ts's periods), so each month of each pass below is computed once and shared — also
 * while still in flight, since the year-end report's sections (energy pie, emissions, finances) and
 * the live treasury readout all ask for the same year at the same moment, and yearPassPrefetch.ts
 * may already be working on it. Each month is one chunk of work after a yield to the event loop.
 * The computation runs to completion even if every caller has lost interest: it's wanted at the
 * year-end report anyway. */
function sharedMonth<T>(results: Map<number, Promise<T>>, year: number, month: number, compute: () => T): Promise<T> {
  const key = year * 12 + month;
  let result = results.get(key);
  if (!result) {
    result = yieldToEventLoop().then(compute);
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
}

const electricityByMonth = new Map<number, Promise<YearElectricityMonth>>();

function monthElectricity(buildings: Building[], realPlants: PowerPlant[], year: number, month: number): Promise<YearElectricityMonth> {
  return sharedMonth(electricityByMonth, year, month, () => {
    const times = monthTimes(year, month, SAMPLES_PER_MONTH);
    const tariff: Tariff = tariffStore.get();
    return { times, series: sampleMunicipalityCategorySeries(buildings, times, tariff, effectivePowerPlants(buildings, realPlants, year)) };
  });
}

/** Every electricity category, municipality-wide, over one calendar year, month by month — the one
 * expensive sampling pass the year-end energy pie, emissions (net grid electricity) and finances
 * (revenue, feed-in, wholesale) all read from, instead of each sampling the year on its own. Solar
 * uses that year's effective (real + adopted) plants. The tariff only shifts when within a day EVs
 * charge, never the total; each month uses whichever is current when it's sampled — normally just
 * after it ended (see yearPassPrefetch.ts). */
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
  heatPumpWaterKWh: number;
  directElectricWaterKWh: number;
}

const ZERO_TECHNOLOGY_ENERGY_KWH: HeatingTechnologyEnergyKWh = {
  airHeatPumpSpaceKWh: 0,
  groundHeatPumpSpaceKWh: 0,
  gasBoilerSpaceKWh: 0,
  oilBoilerSpaceKWh: 0,
  districtHeatingSpaceKWh: 0,
  heatPumpWaterKWh: 0,
  directElectricWaterKWh: 0,
};

interface TechnologySeriesW {
  airHeatPumpSpaceW: number[];
  groundHeatPumpSpaceW: number[];
  gasBoilerSpaceW: number[];
  oilBoilerSpaceW: number[];
  districtHeatingSpaceW: number[];
  heatPumpWaterW: number[];
  directElectricWaterW: number[];
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
    heatPumpWaterW: [],
    directElectricWaterW: [],
  };
  for (const t of times) {
    const dailyMeanC = dailyMeanTempC(t);
    const outsideTempC = weatherAt(t).tempC;
    let air = 0;
    let ground = 0;
    let gas = 0;
    let oil = 0;
    let district = 0;
    let hpWater = 0;
    let directWater = 0;
    for (const building of buildings) {
      if (!existsAt(building, t)) continue;
      const heatingId = currentHeatingSystemId(building, t);
      if (heatingId) {
        const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC, t);
        if (heatingId === "airHeatPump") air += thermalW;
        else if (heatingId === "groundHeatPump") ground += thermalW;
        else if (heatingId === "gasBoiler") gas += thermalW;
        else if (heatingId === "oilBoiler") oil += thermalW;
        else district += thermalW;
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
    out.heatPumpWaterW.push(hpWater);
    out.directElectricWaterW.push(directWater);
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

function monthHeatingTechnology(buildings: Building[], year: number, month: number): Promise<HeatingTechnologyEnergyKWh> {
  return sharedMonth(heatingTechnologyByMonth, year, month, () => {
    const times = monthTimes(year, month, SAMPLES_PER_MONTH);
    const series = sampleTechnologySeries(buildings, times);
    return {
      airHeatPumpSpaceKWh: energyKWh(times, series.airHeatPumpSpaceW),
      groundHeatPumpSpaceKWh: energyKWh(times, series.groundHeatPumpSpaceW),
      gasBoilerSpaceKWh: energyKWh(times, series.gasBoilerSpaceW),
      oilBoilerSpaceKWh: energyKWh(times, series.oilBoilerSpaceW),
      districtHeatingSpaceKWh: energyKWh(times, series.districtHeatingSpaceW),
      heatPumpWaterKWh: energyKWh(times, series.heatPumpWaterW),
      directElectricWaterKWh: energyKWh(times, series.directElectricWaterW),
    };
  });
}

/** Energy delivered per heating technology over the given calendar year (the report card's heating
 * pies, and emissions.ts's fossil fuel burned), month by month — see sharedMonth. */
export async function computeHeatingTechnologyBreakdown(buildings: Building[], year: number): Promise<HeatingTechnologyEnergyKWh> {
  const totals = { ...ZERO_TECHNOLOGY_ENERGY_KWH };
  for (const month of await eachMonth((m) => monthHeatingTechnology(buildings, year, m))) {
    for (const key of Object.keys(totals) as (keyof HeatingTechnologyEnergyKWh)[]) totals[key] += month[key];
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
 * category minus solar generation — for emissions.ts's grid-electricity figure, read off the
 * shared year pass. */
export async function computeNetElectricityKWh(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<number> {
  const energy = await yearCategoryEnergyKWh(buildings, realPlants, year);
  return (
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

const mobilityFuelByMonth = new Map<number, Promise<{ iceCarSlotSamples: number; samples: number }>>();

function monthMobilityFuel(buildings: Building[], year: number, month: number): Promise<{ iceCarSlotSamples: number; samples: number }> {
  return sharedMonth(mobilityFuelByMonth, year, month, () => {
    let iceCarSlotSamples = 0;
    const times = monthTimes(year, month, COARSE_SAMPLES_PER_MONTH);
    for (const t of times) {
      for (const building of buildings) {
        if (!existsAt(building, t)) continue;
        for (const dwelling of building.dwellings) iceCarSlotSamples += slotsWithVehicleAt(building.egid, dwelling, "carICE", t);
      }
    }
    return { iceCarSlotSamples, samples: times.length };
  });
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
export async function computeMobilityFuelLiters(buildings: Building[], year: number): Promise<number> {
  let iceCarSlotSamples = 0;
  let totalSamples = 0;
  for (const month of await eachMonth((m) => monthMobilityFuel(buildings, year, m))) {
    iceCarSlotSamples += month.iceCarSlotSamples;
    totalSamples += month.samples;
  }
  const avgIceCarCount = totalSamples > 0 ? iceCarSlotSamples / totalSamples : 0;
  return avgIceCarCount * (ANNUAL_CAR_KM / 100) * ICE_CAR_L_PER_100KM;
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
