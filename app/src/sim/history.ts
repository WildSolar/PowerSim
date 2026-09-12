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
import { buildingEvTraits, evPowerWFromTraits, type EvTraits } from "./ev";
import { heatPumpPowerWWithWeather } from "./heatPump";
import { pvPowerW } from "./pv";
import { hashSeed } from "./rng";
import { snowDepthCm } from "./snow";
import type { Tariff } from "./tariff";
import { waterHeatingPowerW } from "./waterHeating";
import { dailyMeanTempC, weatherAt } from "./weather";

interface DwellingProfiles {
  egid: string;
  dwelling: Dwelling;
  fridge: FridgeProfile;
  lighting: LightingProfile;
  cooking: CookingProfile;
  plugLoad: PlugLoadProfile;
  ev: EvTraits;
}

export const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
export const HISTORY_SAMPLE_COUNT = 96;
export const HISTORY_REFRESH_MS = 3000;

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

function sumAcrossDwellings(profileSets: DwellingProfiles[], times: number[], tariff: Tariff): number[] {
  return times.map((t) => {
    let total = 0;
    for (const p of profileSets) {
      total +=
        fridgePowerW(p.fridge, t) +
        lightingPowerW(p.lighting, t) +
        cookingPowerW(p.cooking, t) +
        laundryPowerW(p.egid, p.dwelling, t) +
        plugLoadPowerW(p.plugLoad, t) +
        evPowerWFromTraits(p.egid, p.dwelling, p.ev, t, tariff);
    }
    return total;
  });
}

/** Heat pump + AC together, since both are gated by the same daily/instantaneous
 * temperature reading — weather is the same for every building at a given instant,
 * so it's evaluated once per timestep here rather than once per building (or once
 * per device) per timestep. */
function climateControlSeries(buildings: Building[], times: number[]): number[] {
  return times.map((t) => {
    const dailyMeanC = dailyMeanTempC(t);
    const outsideTempC = weatherAt(t).tempC;
    let total = 0;
    for (const building of buildings) {
      total += heatPumpPowerWWithWeather(building, dailyMeanC, outsideTempC) + acPowerWWithWeather(building, dailyMeanC, outsideTempC);
    }
    return total;
  });
}

/** Electric water heating together for every building in one pass — unlike climate
 * control it isn't weather-gated, so there's no shared per-timestep value to hoist,
 * but batching still avoids re-filtering `buildings` once per series consumer. */
function waterHeatingSeries(buildings: Building[], times: number[]): number[] {
  return times.map((t) => buildings.reduce((sum, b) => sum + waterHeatingPowerW(b, t), 0));
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

export function sampleBuildingSeries(building: Building, times: number[], tariff: Tariff, plants: PowerPlant[]): number[] {
  const profileSets = building.dwellings.map((d) => getDwellingProfiles(building, d));
  const dwellingTotals = sumAcrossDwellings(profileSets, times, tariff);
  const climateTotals = climateControlSeries([building], times);
  const waterHeatingTotals = waterHeatingSeries([building], times);
  const pvTotals = pvSeries(
    plants.filter((p) => p.egid === building.egid),
    times,
  );
  return dwellingTotals.map((v, i) => v + climateTotals[i] + waterHeatingTotals[i] + pvTotals[i]);
}

export function sampleMunicipalitySeries(buildings: Building[], times: number[], tariff: Tariff, plants: PowerPlant[]): number[] {
  const profileSets: DwellingProfiles[] = [];
  for (const building of buildings) {
    for (const dwelling of building.dwellings) {
      profileSets.push(getDwellingProfiles(building, dwelling));
    }
  }
  const dwellingTotals = sumAcrossDwellings(profileSets, times, tariff);
  const climateTotals = climateControlSeries(buildings, times);
  const waterHeatingTotals = waterHeatingSeries(buildings, times);
  const pvTotals = pvSeries(plants, times);
  return dwellingTotals.map((v, i) => v + climateTotals[i] + waterHeatingTotals[i] + pvTotals[i]);
}
