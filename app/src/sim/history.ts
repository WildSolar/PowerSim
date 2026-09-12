/**
 * Historical time series, sampled by re-evaluating the same pure device functions
 * at earlier points in simulated time — there's no recorded/logged history to
 * maintain, because fridge/lighting power was never anything but a function of
 * (seed, simTime) in the first place (see devices.ts). A dwelling's device
 * *profiles* (derived once from its seed) are cached across calls since they don't
 * depend on simTime — only their evaluation at a given t does — which keeps
 * municipality-wide sampling (~11k dwellings) cheap to repeat on every chart refresh.
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
import { hashSeed } from "./rng";

interface DwellingProfiles {
  fridge: FridgeProfile;
  lighting: LightingProfile;
}

export const HISTORY_WINDOW_MS = 24 * 60 * 60_000;
export const HISTORY_SAMPLE_COUNT = 96;
export const HISTORY_REFRESH_MS = 3000;

const profileCache = new Map<string, DwellingProfiles>();

function getDwellingProfiles(egid: string, dwelling: Dwelling): DwellingProfiles {
  const key = `${egid}:${dwelling.ewid}`;
  let profiles = profileCache.get(key);
  if (!profiles) {
    profiles = {
      fridge: makeFridgeProfile(hashSeed(egid, dwelling.ewid, "fridge")),
      lighting: makeLightingProfile(hashSeed(egid, dwelling.ewid, "lighting")),
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
}

export function sampleDwellingSeries(egid: string, dwelling: Dwelling, times: number[]): DwellingSeries {
  const { fridge, lighting } = getDwellingProfiles(egid, dwelling);
  return {
    fridgeW: times.map((t) => fridgePowerW(fridge, t)),
    lightingW: times.map((t) => lightingPowerW(lighting, t)),
  };
}

function sumAcrossDwellings(profileSets: DwellingProfiles[], times: number[]): number[] {
  return times.map((t) => {
    let total = 0;
    for (const p of profileSets) {
      total += fridgePowerW(p.fridge, t) + lightingPowerW(p.lighting, t);
    }
    return total;
  });
}

export function sampleBuildingSeries(building: Building, times: number[]): number[] {
  const profileSets = building.dwellings.map((d) => getDwellingProfiles(building.egid, d));
  return sumAcrossDwellings(profileSets, times);
}

export function sampleMunicipalitySeries(buildings: Building[], times: number[]): number[] {
  const profileSets: DwellingProfiles[] = [];
  for (const building of buildings) {
    for (const dwelling of building.dwellings) {
      profileSets.push(getDwellingProfiles(building.egid, dwelling));
    }
  }
  return sumAcrossDwellings(profileSets, times);
}
