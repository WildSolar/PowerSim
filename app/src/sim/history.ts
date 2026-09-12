/**
 * Historical time series, sampled by re-evaluating the same pure device functions
 * at earlier points in simulated time — there's no recorded/logged history to
 * maintain, because fridge/lighting/EV power was never anything but a function of
 * (seed, simTime[, tariff]) in the first place (see devices.ts, ev.ts). A dwelling's
 * device *profiles* and EV traits (derived once from its seed) are cached across
 * calls since they don't depend on simTime — only their evaluation at a given t does
 * — which keeps municipality-wide sampling (~11k dwellings) cheap to repeat on every
 * chart refresh.
 */

import type { Building, Dwelling } from "../data/types";
import {
  fridgePowerW,
  lightingPowerW,
  makeFridgeProfile,
  makeLightingProfile,
  type FridgeProfile,
  type LightingProfile,
} from "./devices";
import { buildingEvTraits, evPowerWFromTraits, type EvTraits } from "./ev";
import { hashSeed } from "./rng";
import type { Tariff } from "./tariff";

interface DwellingProfiles {
  egid: string;
  dwelling: Dwelling;
  fridge: FridgeProfile;
  lighting: LightingProfile;
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
  evW: number[];
}

export function sampleDwellingSeries(building: Building, dwelling: Dwelling, times: number[], tariff: Tariff): DwellingSeries {
  const p = getDwellingProfiles(building, dwelling);
  return {
    fridgeW: times.map((t) => fridgePowerW(p.fridge, t)),
    lightingW: times.map((t) => lightingPowerW(p.lighting, t)),
    evW: times.map((t) => evPowerWFromTraits(p.egid, p.dwelling, p.ev, t, tariff)),
  };
}

function sumAcrossDwellings(profileSets: DwellingProfiles[], times: number[], tariff: Tariff): number[] {
  return times.map((t) => {
    let total = 0;
    for (const p of profileSets) {
      total += fridgePowerW(p.fridge, t) + lightingPowerW(p.lighting, t) + evPowerWFromTraits(p.egid, p.dwelling, p.ev, t, tariff);
    }
    return total;
  });
}

export function sampleBuildingSeries(building: Building, times: number[], tariff: Tariff): number[] {
  const profileSets = building.dwellings.map((d) => getDwellingProfiles(building, d));
  return sumAcrossDwellings(profileSets, times, tariff);
}

export function sampleMunicipalitySeries(buildings: Building[], times: number[], tariff: Tariff): number[] {
  const profileSets: DwellingProfiles[] = [];
  for (const building of buildings) {
    for (const dwelling of building.dwellings) {
      profileSets.push(getDwellingProfiles(building, dwelling));
    }
  }
  return sumAcrossDwellings(profileSets, times, tariff);
}
