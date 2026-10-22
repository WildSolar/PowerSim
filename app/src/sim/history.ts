/**
 * Historical time series, sampled by re-evaluating the same pure device functions
 * at earlier points in simulated time — there's no recorded/logged history to
 * maintain, because fridge/lighting/EV/heat-pump/AC/PV power was never anything but
 * a function of (seed, simTime[, tariff/weather]) in the first place (see devices.ts,
 * ev.ts, heatPump.ts, ac.ts, pv.ts). PV generation is negative-signed, so it nets directly
 * against consumption in every sum below rather than needing separate handling. A
 * dwelling's device *profiles* and EV traits (derived once
 * from its seed) are cached across calls since they don't depend on simTime — only
 * their evaluation at a given t does — which keeps municipality-wide sampling
 * (~11k dwellings, ~2.5k buildings) cheap to repeat on every chart refresh.
 */

import { totalWorkChargingPowerW, workChargingPowerW } from "./workCharging";
import { dynamicTariff } from "./dynamicTariff";
import type { Building, Dwelling, PowerPlant } from "../data/types";
import {
  cookingPowerW,
  fridgePowerW,
  laundryPowerWFrom,
  laundrySeed,
  lightingPowerW,
  makeCookingProfile,
  makeFridgeProfile,
  makeLightingProfile,
  makePlugLoadProfile,
  plugLoadPowerW,
  type CookingProfile,
  type FridgeProfile,
  type LightingProfile,
  type PlugLoadProfile,
} from "./devices";
import { coolingPowerSplitW, coolingWeatherAt } from "./ac";
import { commercialPowerWFromProfile, makeCommercialProfile, type CommercialProfile } from "./commercial";
import { heatPumpPowerWWithWeather } from "./heatPump";
import { mobilityChargingPowerW } from "./mobility";
import { publicCharging } from "./publicCharging";
import { fleets } from "./fleet";
import { irradianceWm2, pvPowerWAt } from "./pv";
import { existsAt } from "./lifetime";
import { hashSeed } from "./rng";
import { snowDepthCm } from "./snow";
import type { Tariff } from "./tariff";
import { dwellingWaterHeaterProfile, hasElectricWaterHeating, waterHeaterPowerW, type WaterHeaterProfile } from "./waterHeating";
import { dailyMeanTempC, weatherAt } from "./weather";

interface DwellingProfiles {
  building: Building;
  egid: string;
  dwelling: Dwelling;
  key: string; // `${egid}:${ewid}`, as dynamicTariff.ts keys households
  fridge: FridgeProfile;
  lighting: LightingProfile;
  cooking: CookingProfile;
  plugLoad: PlugLoadProfile;
  laundrySeed: number;
  waterHeater: WaterHeaterProfile;
}

export const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
export const HISTORY_SAMPLE_COUNT = 96;
export const HISTORY_REFRESH_MS = 3000;
// The municipality-wide 24h chart samples on its own half-hour grid instead — see rollingHistory.ts.

const profileCache = new Map<string, DwellingProfiles>();

function getDwellingProfiles(building: Building, dwelling: Dwelling): DwellingProfiles {
  const key = `${building.egid}:${dwelling.ewid}`;
  let profiles = profileCache.get(key);
  if (!profiles) {
    profiles = {
      building,
      egid: building.egid,
      dwelling,
      key,
      fridge: makeFridgeProfile(hashSeed(building.egid, dwelling.ewid, "fridge")),
      lighting: makeLightingProfile(hashSeed(building.egid, dwelling.ewid, "lighting")),
      cooking: makeCookingProfile(hashSeed(building.egid, dwelling.ewid, "cooking")),
      plugLoad: makePlugLoadProfile(building.egid, dwelling),
      laundrySeed: laundrySeed(building.egid, dwelling),
      waterHeater: dwellingWaterHeaterProfile(building.egid, dwelling),
    };
    profileCache.set(key, profiles);
  }
  return profiles;
}

/** `sampleCount` evenly-spaced timestamps covering the last `windowMs` up to `nowMs`. */
export function historyTimeSteps(nowMs: number, windowMs: number, sampleCount: number): number[] {
  const fromMs = nowMs - windowMs;
  const stepMs = windowMs / (sampleCount - 1);
  return Array.from({ length: sampleCount }, (_, i) => fromMs + i * stepMs);
}

export interface DwellingSeries {
  fridgeW: number[];
  lightingW: number[];
  cookingW: number[];
  laundryW: number[];
  plugLoadW: number[];
  evW: number[];
}

export function sampleDwellingSeries(building: Building, dwelling: Dwelling, times: number[], tariff: Tariff): DwellingSeries {
  const p = getDwellingProfiles(building, dwelling);
  return {
    fridgeW: times.map((t) => fridgePowerW(p.fridge, t)),
    lightingW: times.map((t) => lightingPowerW(p.lighting, t)),
    cookingW: times.map((t) => cookingPowerW(p.cooking, t)),
    laundryW: times.map((t) => laundryPowerWFrom(p.laundrySeed, t, dynamicTariff.onDynamicKey(p.key, t))),
    plugLoadW: times.map((t) => plugLoadPowerW(p.plugLoad, t)),
    evW: times.map((t) => mobilityChargingPowerW(p.egid, p.dwelling, t, tariff)),
  };
}

interface DwellingCategoryTotals {
  fridgeW: number[];
  lightingW: number[];
  cookingW: number[];
  laundryW: number[];
  plugLoadW: number[];
  evW: number[];
}

/** Every dwelling device, broken out by category rather than pre-summed — the
 * per-category split is what both the net-total series (sum every field) and the
 * daily-energy breakdown (integrate each field separately, see energy.ts) are built
 * from, so there's one place that walks (dwelling x timestep) rather than two. */
function dwellingCategoryTotals(profileSets: DwellingProfiles[], times: number[], tariff: Tariff): DwellingCategoryTotals {
  const fridgeW: number[] = [];
  const lightingW: number[] = [];
  const cookingW: number[] = [];
  const laundryW: number[] = [];
  const plugLoadW: number[] = [];
  const evW: number[] = [];
  for (const t of times) {
    let fridge = 0;
    let lighting = 0;
    let cooking = 0;
    let laundry = 0;
    let plugLoad = 0;
    let ev = 0;
    for (const p of profileSets) {
      if (!existsAt(p.building, t)) continue;
      fridge += fridgePowerW(p.fridge, t);
      lighting += lightingPowerW(p.lighting, t);
      cooking += cookingPowerW(p.cooking, t);
      laundry += laundryPowerWFrom(p.laundrySeed, t, dynamicTariff.onDynamicKey(p.key, t));
      plugLoad += plugLoadPowerW(p.plugLoad, t);
      ev += mobilityChargingPowerW(p.egid, p.dwelling, t, tariff);
    }
    fridgeW.push(fridge);
    lightingW.push(lighting);
    cookingW.push(cooking);
    laundryW.push(laundry);
    plugLoadW.push(plugLoad);
    evW.push(ev);
  }
  return { fridgeW, lightingW, cookingW, laundryW, plugLoadW, evW };
}

// Homes per piece when one instant's household totals are worked out in pieces.
const DWELLINGS_PER_RUN = 10_000;

/** dwellingCategoryTotals at one instant, in runs of DWELLINGS_PER_RUN homes: each run carries on
 * the same sums, in the same order, so the totals come out exactly the same as in one go. */
function dwellingCategoryTotalsInRuns(profileSets: DwellingProfiles[], t: number, tariff: Tariff): { steps: (() => void)[]; result: () => DwellingCategoryTotals } {
  const sum = { fridge: 0, lighting: 0, cooking: 0, laundry: 0, plugLoad: 0, ev: 0 };
  const steps: (() => void)[] = [];
  for (let from = 0; from < Math.max(1, profileSets.length); from += DWELLINGS_PER_RUN) {
    steps.push(() => {
      const to = Math.min(profileSets.length, from + DWELLINGS_PER_RUN);
      for (let i = from; i < to; i++) {
        const p = profileSets[i];
        if (!existsAt(p.building, t)) continue;
        sum.fridge += fridgePowerW(p.fridge, t);
        sum.lighting += lightingPowerW(p.lighting, t);
        sum.cooking += cookingPowerW(p.cooking, t);
        sum.laundry += laundryPowerWFrom(p.laundrySeed, t, dynamicTariff.onDynamicKey(p.key, t));
        sum.plugLoad += plugLoadPowerW(p.plugLoad, t);
        sum.ev += mobilityChargingPowerW(p.egid, p.dwelling, t, tariff);
      }
    });
  }
  const result = (): DwellingCategoryTotals => ({
    fridgeW: [sum.fridge],
    lightingW: [sum.lighting],
    cookingW: [sum.cooking],
    laundryW: [sum.laundry],
    plugLoadW: [sum.plugLoad],
    evW: [sum.ev],
  });
  return { steps, result };
}

/** Heat pump and cooling split apart but still evaluated together, since both are gated
 * by the same daily/instantaneous temperature reading — weather is the same for
 * every building at a given instant, so it's evaluated once per timestep here
 * rather than once per building (or once per device) per timestep. Cooling comes in two
 * parts: the homes' (`acW`) and the businesses' (`businessCoolingW`). */
function climateControlCategorySeries(buildings: Building[], times: number[]): { heatPumpW: number[]; acW: number[]; businessCoolingW: number[] } {
  const heatPumpW: number[] = [];
  const acW: number[] = [];
  const businessCoolingW: number[] = [];
  for (const t of times) {
    const dailyMeanC = dailyMeanTempC(t);
    const outsideTempC = weatherAt(t).tempC;
    const cooling = coolingWeatherAt(t, dailyMeanC, outsideTempC);
    let heatPump = 0;
    let homes = 0;
    let business = 0;
    for (const building of buildings) {
      if (!existsAt(building, t)) continue;
      heatPump += heatPumpPowerWWithWeather(building, dailyMeanC, outsideTempC, t);
      const split = coolingPowerSplitW(building, cooling, t);
      homes += split.homesW;
      business += split.businessW;
    }
    heatPumpW.push(heatPump);
    acW.push(homes);
    businessCoolingW.push(business);
  }
  return { heatPumpW, acW, businessCoolingW };
}

/** Electric water heating for every dwelling in a currently-electrically-water-
 * heated building, summed per timestep. Checked fresh at every timestep rather
 * than once up front — since a stock-renewal heat-pump install can switch a
 * building's hot water from unmodeled (no line at all) to electric partway
 * through a sampling window, the same reason climateControlCategorySeries
 * already re-checks heat pump ownership per timestep instead of once. Dwelling
 * profiles still come from the shared cache (getDwellingProfiles), so this
 * doesn't redo the seeded-RNG setup per sample, only the (cheap, cached)
 * ownership check. */
function waterHeatingCategorySeries(buildings: Building[], times: number[]): number[] {
  return times.map((t) => {
    let sum = 0;
    for (const building of buildings) {
      if (!existsAt(building, t) || !hasElectricWaterHeating(building, t)) continue;
      for (const dwelling of building.dwellings) {
        sum += waterHeaterPowerW(getDwellingProfiles(building, dwelling).waterHeater, t);
      }
    }
    return sum;
  });
}

const commercialProfileCache = new Map<string, CommercialProfile | null>();

function getCommercialProfile(building: Building): CommercialProfile | null {
  let profile = commercialProfileCache.get(building.egid);
  if (profile === undefined) {
    profile = makeCommercialProfile(building);
    commercialProfileCache.set(building.egid, profile);
  }
  return profile;
}

// The profile lists for a whole building array, kept per array (the stock hands out a new one
// whenever it changes) — so a caller sampling a few instants at a time, like the rolling 24h
// chart, doesn't pay for walking ~10k dwellings through the keyed caches on every call.
const municipalityProfileSets = new WeakMap<Building[], DwellingProfiles[]>();
const municipalityCommercialProfiles = new WeakMap<Building[], { building: Building; profile: CommercialProfile }[]>();

function dwellingProfileSets(buildings: Building[]): DwellingProfiles[] {
  let sets = municipalityProfileSets.get(buildings);
  if (!sets) {
    sets = [];
    for (const building of buildings) {
      for (const dwelling of building.dwellings) sets.push(getDwellingProfiles(building, dwelling));
    }
    municipalityProfileSets.set(buildings, sets);
  }
  return sets;
}

function commercialProfiles(buildings: Building[]): { building: Building; profile: CommercialProfile }[] {
  let profiles = municipalityCommercialProfiles.get(buildings);
  if (!profiles) {
    profiles = [];
    for (const building of buildings) {
      const profile = getCommercialProfile(building);
      if (profile) profiles.push({ building, profile });
    }
    municipalityCommercialProfiles.set(buildings, profiles);
  }
  return profiles;
}

/** Non-residential/commercial load for every recognized-category building, profiles
 * resolved through the cache above rather than rebuilt (the per-building random
 * intensity multiplier) on every one of the 96 samples. */
function commercialCategorySeries(buildings: Building[], times: number[]): number[] {
  const profiles = commercialProfiles(buildings);
  return times.map((t) => profiles.reduce((sum, p) => sum + (existsAt(p.building, t) ? commercialPowerWFromProfile(p.profile, t) : 0), 0));
}

/** Snow cover changes on a day+ timescale, so one value for the whole (24h) chart
 * window is a fine approximation — computing it fresh per sample would mean redoing
 * nearly the same 30-day lookback 96 times over for almost no accuracy gain. */
function pvSeries(plants: PowerPlant[], times: number[]): number[] {
  const snowCoverCm = snowDepthCm(times[times.length - 1]);
  return times.map((t) => {
    const irradiance = irradianceWm2(t, snowCoverCm); // the same sun on every roof
    return plants.reduce((sum, plant) => sum + pvPowerWAt(plant, t, irradiance), 0);
  });
}

/** Just the PV contribution for one building's own roof — for a dedicated "solar
 * generation" chart, distinct from the net total (which folds PV in as a credit). */
export function sampleBuildingPvSeries(building: Building, times: number[], plants: PowerPlant[]): number[] {
  return pvSeries(
    plants.filter((p) => p.egid === building.egid),
    times,
  );
}

/** Every plant in the municipality, summed — for a dedicated "solar generation" chart. */
export function sampleMunicipalityPvSeries(plants: PowerPlant[], times: number[]): number[] {
  return pvSeries(plants, times);
}

/** Every consumption/generation category, kept apart rather than pre-summed —
 * consumed both by the net-total series below (sum every field, solar subtracted)
 * and by energy.ts's daily-energy breakdown (integrate each field on its own).
 * `solarW` is generation, positive-signed (unlike pvSeries' raw negative-as-credit
 * convention) since the breakdown displays it as its own bar, not folded into a sum. */
export interface CategorySeries {
  fridgeW: number[];
  lightingW: number[];
  cookingW: number[];
  laundryW: number[];
  plugLoadW: number[];
  evW: number[];
  heatPumpW: number[];
  acW: number[];
  waterHeatingW: number[];
  commercialW: number[];
  solarW: number[];
}

export function sampleBuildingCategorySeries(building: Building, times: number[], tariff: Tariff, plants: PowerPlant[]): CategorySeries {
  const profileSets = building.dwellings.map((d) => getDwellingProfiles(building, d));
  const dwellingTotals = dwellingCategoryTotals(profileSets, times, tariff);
  // A business's cooling is its own use, billed to it (billing.ts shares only the homes' among the flats).
  const { heatPumpW, acW, businessCoolingW } = climateControlCategorySeries([building], times);
  const waterHeatingW = waterHeatingCategorySeries([building], times);
  const commercialW = commercialCategorySeries([building], times).map((w, i) => w + businessCoolingW[i]);
  // Its businesses' vans and lorries, and its staff's cars charging at work.
  dwellingTotals.evW = dwellingTotals.evW.map((w, i) => w + fleets.depotPowerW(building, times[i]) + workChargingPowerW(building, times[i]));
  const solarW = pvSeries(
    plants.filter((p) => p.egid === building.egid),
    times,
  ).map((w) => -w);
  return { ...dwellingTotals, heatPumpW, acW, waterHeatingW, commercialW, solarW };
}

/** A single dwelling's own category series — just the six per-dwelling devices;
 * heat pump/AC/water heating/commercial/solar are building-wide systems shared
 * across every dwelling in the building, not something one dwelling on its own
 * can be said to "have", so those five always read zero here rather than
 * attributing a shared system to whichever dwelling happens to be selected. */
export function sampleDwellingCategorySeries(building: Building, dwelling: Dwelling, times: number[], tariff: Tariff): CategorySeries {
  const dwellingTotals = dwellingCategoryTotals([getDwellingProfiles(building, dwelling)], times, tariff);
  const zeros = times.map(() => 0);
  return {
    ...dwellingTotals,
    heatPumpW: zeros,
    acW: zeros,
    waterHeatingW: zeros,
    commercialW: zeros,
    solarW: zeros,
  };
}

export function sampleMunicipalityCategorySeries(
  buildings: Building[],
  times: number[],
  tariff: Tariff,
  plants: PowerPlant[],
): CategorySeries {
  const { steps, result } = municipalityCategorySteps(buildings, times, tariff, plants);
  for (const step of steps) step();
  return result();
}

/** sampleMunicipalityCategorySeries as separate passes over the town — the homes, the vehicles
 * charging away from home, heating and cooling, water heating, the businesses, solar — run in this
 * order, so a caller can pause between them: in a large town one sample of everything is a tenth
 * of a second of work, too long to do between two frames. The result is the same either way. */
export function municipalityCategorySteps(
  buildings: Building[],
  times: number[],
  tariff: Tariff,
  plants: PowerPlant[],
): { steps: (() => void)[]; result: () => CategorySeries } {
  let dwellingTotals: DwellingCategoryTotals;
  let climate: ReturnType<typeof climateControlCategorySeries>;
  let waterHeatingW: number[];
  let commercialW: number[];
  let solarW: number[];
  // One instant (a sample): the homes in runs, a piece each; several: in one go.
  const homes = times.length === 1 ? dwellingCategoryTotalsInRuns(dwellingProfileSets(buildings), times[0], tariff) : null;
  const steps = [
    ...(homes ? [...homes.steps, () => (dwellingTotals = homes.result())] : [() => (dwellingTotals = dwellingCategoryTotals(dwellingProfileSets(buildings), times, tariff))]),
    // Vehicles charged at public chargers draw there, not at home, businesses' at their depots and
    // staff cars at work — all of it the town's EV charging.
    () =>
      (dwellingTotals.evW = dwellingTotals.evW.map(
        (w, i) => w + publicCharging.totalLoadW(times[i]) + fleets.totalDepotPowerW(buildings, times[i]) + totalWorkChargingPowerW(buildings, times[i]),
      )),
    () => (climate = climateControlCategorySeries(buildings, times)),
    () => (waterHeatingW = waterHeatingCategorySeries(buildings, times)),
    () => (commercialW = commercialCategorySeries(buildings, times)),
    () => (solarW = pvSeries(plants, times).map((w) => -w)),
  ];
  const result = (): CategorySeries => {
    // The town's cooling counts together, homes' and businesses'.
    const acW = climate.acW.map((w, i) => w + climate.businessCoolingW[i]);
    return { ...dwellingTotals, heatPumpW: climate.heatPumpW, acW, waterHeatingW, commercialW, solarW };
  };
  return { steps, result };
}

/** Net power draw from a category breakdown: every consumption category summed,
 * less solar generation (a credit). */
export function netTotalFromCategorySeries(series: CategorySeries): number[] {
  const len = series.fridgeW.length;
  const total = new Array<number>(len).fill(0);
  for (let i = 0; i < len; i++) {
    total[i] =
      series.fridgeW[i] +
      series.lightingW[i] +
      series.cookingW[i] +
      series.laundryW[i] +
      series.plugLoadW[i] +
      series.evW[i] +
      series.heatPumpW[i] +
      series.acW[i] +
      series.waterHeatingW[i] +
      series.commercialW[i] -
      series.solarW[i];
  }
  return total;
}

/** What the households and heat pumps on the dynamic tariff draw, summed — the part of the town's
 * consumption billed at the dynamic price (finances.ts). `times` must lie within one calendar
 * year: who is on it is decided once a year. */
export function sampleDynamicConsumptionW(buildings: Building[], times: number[], tariff: Tariff): number[] {
  if (times.length === 0) return [];
  const uptake = dynamicTariff.uptakeAt(times[0]);
  if (uptake.dwellings.size === 0 && uptake.heatPumps.size === 0) return times.map(() => 0);
  const households = dwellingProfileSets(buildings).filter((p) => uptake.dwellings.has(p.key));
  const d = dwellingCategoryTotals(households, times, tariff);
  const { heatPumpW } = climateControlCategorySeries(
    buildings.filter((b) => uptake.heatPumps.has(b.egid)),
    times,
  );
  return times.map((_, i) => d.fridgeW[i] + d.lightingW[i] + d.cookingW[i] + d.laundryW[i] + d.plugLoadW[i] + d.evW[i] + heatPumpW[i]);
}

export function sampleBuildingSeries(building: Building, times: number[], tariff: Tariff, plants: PowerPlant[]): number[] {
  return netTotalFromCategorySeries(sampleBuildingCategorySeries(building, times, tariff, plants));
}

export function sampleMunicipalitySeries(buildings: Building[], times: number[], tariff: Tariff, plants: PowerPlant[]): number[] {
  return netTotalFromCategorySeries(sampleMunicipalityCategorySeries(buildings, times, tariff, plants));
}
