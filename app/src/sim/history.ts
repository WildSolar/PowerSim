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

import type { Building, Dwelling, PowerPlant } from "../data/types";
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
  type CookingProfile,
  type FridgeProfile,
  type LightingProfile,
  type PlugLoadProfile,
} from "./devices";
import { acPowerWWithWeather } from "./ac";
import { commercialPowerWFromProfile, makeCommercialProfile, type CommercialProfile } from "./commercial";
import { buildingEvTraits, evPowerWFromTraits, type EvTraits } from "./ev";
import { heatPumpPowerWWithWeather } from "./heatPump";
import { pvPowerW } from "./pv";
import { hashSeed } from "./rng";
import { snowDepthCm } from "./snow";
import type { Tariff } from "./tariff";
import { dwellingWaterHeaterProfile, hasElectricWaterHeating, waterHeaterPowerW, type WaterHeaterProfile } from "./waterHeating";
import { dailyMeanTempC, weatherAt } from "./weather";

interface DwellingProfiles {
  egid: string;
  dwelling: Dwelling;
  fridge: FridgeProfile;
  lighting: LightingProfile;
  cooking: CookingProfile;
  plugLoad: PlugLoadProfile;
  waterHeater: WaterHeaterProfile;
  ev: EvTraits;
}

export const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
export const HISTORY_SAMPLE_COUNT = 96;
export const HISTORY_REFRESH_MS = 3000;

/** Coarser than HISTORY_SAMPLE_COUNT, for the municipality-wide chart only: that
 * one sums ~11k dwellings per sample rather than a handful, so it's by far the
 * most expensive history query in the app (measured ~1s per refresh at 96 samples
 * on a mid-range machine) — and the aggregate curve is already smooth at that
 * scale (thousands of independent duty cycles average out), so halving the sample
 * count buys back real time without a visible change in the chart's shape. */
export const MUNICIPALITY_HISTORY_SAMPLE_COUNT = 48;

const profileCache = new Map<string, DwellingProfiles>();

function getDwellingProfiles(building: Building, dwelling: Dwelling): DwellingProfiles {
  const key = `${building.egid}:${dwelling.ewid}`;
  let profiles = profileCache.get(key);
  if (!profiles) {
    profiles = {
      egid: building.egid,
      dwelling,
      fridge: makeFridgeProfile(hashSeed(building.egid, dwelling.ewid, "fridge")),
      lighting: makeLightingProfile(hashSeed(building.egid, dwelling.ewid, "lighting")),
      cooking: makeCookingProfile(hashSeed(building.egid, dwelling.ewid, "cooking")),
      plugLoad: makePlugLoadProfile(building.egid, dwelling),
      waterHeater: dwellingWaterHeaterProfile(building.egid, dwelling),
      ev: buildingEvTraits(building, dwelling),
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
    laundryW: times.map((t) => laundryPowerW(p.egid, p.dwelling, t)),
    plugLoadW: times.map((t) => plugLoadPowerW(p.plugLoad, t)),
    evW: times.map((t) => evPowerWFromTraits(p.egid, p.dwelling, p.ev, t, tariff)),
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
      fridge += fridgePowerW(p.fridge, t);
      lighting += lightingPowerW(p.lighting, t);
      cooking += cookingPowerW(p.cooking, t);
      laundry += laundryPowerW(p.egid, p.dwelling, t);
      plugLoad += plugLoadPowerW(p.plugLoad, t);
      ev += evPowerWFromTraits(p.egid, p.dwelling, p.ev, t, tariff);
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

/** Heat pump and AC split apart but still evaluated together, since both are gated
 * by the same daily/instantaneous temperature reading — weather is the same for
 * every building at a given instant, so it's evaluated once per timestep here
 * rather than once per building (or once per device) per timestep. */
function climateControlCategorySeries(buildings: Building[], times: number[]): { heatPumpW: number[]; acW: number[] } {
  const heatPumpW: number[] = [];
  const acW: number[] = [];
  for (const t of times) {
    const dailyMeanC = dailyMeanTempC(t);
    const outsideTempC = weatherAt(t).tempC;
    let heatPump = 0;
    let ac = 0;
    for (const building of buildings) {
      heatPump += heatPumpPowerWWithWeather(building, dailyMeanC, outsideTempC);
      ac += acPowerWWithWeather(building, dailyMeanC, outsideTempC);
    }
    heatPumpW.push(heatPump);
    acW.push(ac);
  }
  return { heatPumpW, acW };
}

/** Electric water heating for every dwelling in an electrically-water-heated
 * building, summed per timestep. Takes the already-built (and cached, see
 * getDwellingProfiles) profile list rather than raw buildings — waterHeating.ts's
 * own building-level helper rebuilds each dwelling's profile from scratch on every
 * call, which is fine for a single live reading but was silently making this
 * 96-times-over history sampling redo the same seeded-RNG setup on every sample
 * instead of once. */
function waterHeatingCategorySeries(waterHeatedProfileSets: DwellingProfiles[], times: number[]): number[] {
  return times.map((t) => waterHeatedProfileSets.reduce((sum, p) => sum + waterHeaterPowerW(p.waterHeater, t), 0));
}

/** Every dwelling in buildings with an electric water heater, profiles already
 * resolved through the cache — the subset `waterHeatingCategorySeries` above sums
 * over. */
function waterHeatedDwellingProfiles(buildings: Building[]): DwellingProfiles[] {
  const profiles: DwellingProfiles[] = [];
  for (const building of buildings) {
    if (!hasElectricWaterHeating(building)) continue;
    for (const dwelling of building.dwellings) {
      profiles.push(getDwellingProfiles(building, dwelling));
    }
  }
  return profiles;
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

/** Non-residential/commercial load for every recognized-category building, profiles
 * resolved through the cache above rather than rebuilt (the per-building random
 * intensity multiplier) on every one of the 96 samples. */
function commercialCategorySeries(buildings: Building[], times: number[]): number[] {
  const profiles: CommercialProfile[] = [];
  for (const building of buildings) {
    const profile = getCommercialProfile(building);
    if (profile) profiles.push(profile);
  }
  return times.map((t) => profiles.reduce((sum, p) => sum + commercialPowerWFromProfile(p, t), 0));
}

/** Snow cover changes on a day+ timescale, so one value for the whole (24h) chart
 * window is a fine approximation — computing it fresh per sample would mean redoing
 * nearly the same 30-day lookback 96 times over for almost no accuracy gain. */
function pvSeries(plants: PowerPlant[], times: number[]): number[] {
  const snowCoverCm = snowDepthCm(times[times.length - 1]);
  return times.map((t) => plants.reduce((sum, plant) => sum + pvPowerW(plant, t, snowCoverCm), 0));
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
  const { heatPumpW, acW } = climateControlCategorySeries([building], times);
  const waterHeatingW = waterHeatingCategorySeries(waterHeatedDwellingProfiles([building]), times);
  const commercialW = commercialCategorySeries([building], times);
  const solarW = pvSeries(
    plants.filter((p) => p.egid === building.egid),
    times,
  ).map((w) => -w);
  return { ...dwellingTotals, heatPumpW, acW, waterHeatingW, commercialW, solarW };
}

export function sampleMunicipalityCategorySeries(
  buildings: Building[],
  times: number[],
  tariff: Tariff,
  plants: PowerPlant[],
): CategorySeries {
  const profileSets: DwellingProfiles[] = [];
  for (const building of buildings) {
    for (const dwelling of building.dwellings) {
      profileSets.push(getDwellingProfiles(building, dwelling));
    }
  }
  const dwellingTotals = dwellingCategoryTotals(profileSets, times, tariff);
  const { heatPumpW, acW } = climateControlCategorySeries(buildings, times);
  const waterHeatingW = waterHeatingCategorySeries(waterHeatedDwellingProfiles(buildings), times);
  const commercialW = commercialCategorySeries(buildings, times);
  const solarW = pvSeries(plants, times).map((w) => -w);
  return { ...dwellingTotals, heatPumpW, acW, waterHeatingW, commercialW, solarW };
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

export function sampleBuildingSeries(building: Building, times: number[], tariff: Tariff, plants: PowerPlant[]): number[] {
  return netTotalFromCategorySeries(sampleBuildingCategorySeries(building, times, tariff, plants));
}

export function sampleMunicipalitySeries(buildings: Building[], times: number[], tariff: Tariff, plants: PowerPlant[]): number[] {
  return netTotalFromCategorySeries(sampleMunicipalityCategorySeries(buildings, times, tariff, plants));
}
