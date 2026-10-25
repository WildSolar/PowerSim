/**
 * PV generation for real rooftop solar installations (the BFE/Pronovo registry —
 * data.powerPlants). No stochastic ownership here either, same as heat pumps: which
 * buildings have solar, and how big, is already known from real data.
 *
 * Model: standard solar-geometry approximations (declination, hour angle -> solar
 * elevation) give a clear-sky irradiance proportional to sin(elevation). weather.ts's
 * cloudiness sets the *smooth, day-scale* attenuation (a persistently overcast week
 * transmits less on average than a clear one) — but real cloud cover isn't a dimmer
 * switch, it's individual clouds passing in front of the sun, so a second, much
 * faster noise channel ("passing clouds", ~10min timescale) makes irradiance actually
 * flicker on a cloudy day, scaled by how much cloud there is to flicker (negligible
 * on a clear day, since there's nothing passing in front of the sun to begin with).
 * Snow cover (snow.ts) can additionally block generation outright, persisting after
 * a snowfall until a sustained thaw clears it — unlike cloud cover, this doesn't
 * clear the instant the sky does — except on panels it can't stay on (vertical rows, and
 * tracking rows that turn steep to shed it: config/pvProfiles.ts).
 *
 * Arrays face the sun differently (config/pvProfiles.ts): every roof gets one of a basket of
 * orientations, drawn per building, and Agri-PV fields their system's. What reaches a panel is the
 * light straight from the sun on its plane, plus the sky's diffuse light and the ground's reflection;
 * the share that comes diffuse rises with the cloud. Scaled so that the roofs together make as much
 * over a year as before (as if every panel lay flat): the orientations spread the town's output
 * over the day, softening its midday peak, without changing how much it makes. Weather and snow are both shared by every plant in
 * the municipality — it's entirely reasonable for panels a few km apart to see the
 * same sky at the same moment — so callers evaluating many plants at once (see
 * history.ts) should compute snow cover once and pass it in rather than let every
 * plant recompute the same 30-day lookback. Everything ignores panel temperature
 * derating, inverter losses, tilt/orientation, and shading — real but second-order
 * next to "is it day, is it summer, is a cloud (or snowdrift) over the panel right
 * now." Pure function of (plant, simTime), so it composes with history sampling for
 * free.
 */

import { windPowerW } from "./windPower";
import type { PowerPlant } from "../data/types";
import { toDateMs, dayOfYear } from "./calendar";
import { snowDepthCm, snowPvBlockingFactor } from "./snow";
import { valueNoise } from "./valueNoise";
import { weatherAt } from "./weather";
import { policyStore } from "./policy";
import { PV_ALBEDO, PV_BIFACIALITY, PV_DIFFUSE_SHARE_CLEAR, PV_PROFILES, type PvMount } from "../config/pvProfiles";
import { firstRandom, hashSeed } from "./rng";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;
const SCHLIEREN_LATITUDE_DEG = 47.4;
export const PEAK_IRRADIANCE_WM2 = 1000; // STC reference
const CLOUD_ATTENUATION = 0.8; // fraction of clear-sky irradiance lost at full overcast, on average
const PASSING_CLOUD_PERIOD_MS = 11 * MINUTE_MS;
const PASSING_CLOUD_STRENGTH = 0.5; // how hard passing clouds can swing transmittance, scaled by cloudiness

function solarDeclinationDeg(doy: number): number {
  return 23.45 * Math.sin((2 * Math.PI * (284 + doy)) / 365);
}

export function solarElevationDeg(dateMs: number): number {
  const doy = dayOfYear(dateMs);
  const hourOfDay = (dateMs % DAY_MS) / HOUR_MS; // dateMs is always a large positive real epoch ms
  const latRad = (SCHLIEREN_LATITUDE_DEG * Math.PI) / 180;
  const declRad = (solarDeclinationDeg(doy) * Math.PI) / 180;
  const hourAngleRad = ((15 * (hourOfDay - 12)) * Math.PI) / 180;
  const sinElevation = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  return (Math.asin(Math.min(1, Math.max(-1, sinElevation))) * 180) / Math.PI;
}

/** Global horizontal irradiance in W/m2 at the given simulated time: clear-sky solar
 * geometry attenuated by weather (cloudiness + passing-cloud flicker). This is a
 * sky/meteorological quantity — unlike irradianceWm2 below, it deliberately excludes
 * snow sitting on a panel, which blocks light reaching that specific panel rather
 * than changing how much reaches the ground at all. Used for the live "insolation"
 * readout as well as being the input every PV plant's own generation derives from. */
export function ghiWm2(simTimeMs: number): number {
  return skyAt(simTimeMs).ghi;
}

/** The sky at an instant: global horizontal irradiance, the weather's transmittance (0-1), and the
 * sun's direction (east, north, up; a unit vector), or null below the horizon. */
type Sky = { ghi: number; transmittance: number; sun: [number, number, number] | null };

// The last instant asked for, by date: every array in town asks about the same moment.
let lastSkyDateMs = Number.NaN;
let lastSky: Sky | null = null;

function skyAt(simTimeMs: number): Sky {
  const dateMs = toDateMs(simTimeMs);
  if (dateMs === lastSkyDateMs && lastSky) return lastSky;
  const sky = skyAtDate(simTimeMs, dateMs);
  lastSkyDateMs = dateMs;
  lastSky = sky;
  return sky;
}

function skyAtDate(simTimeMs: number, dateMs: number): Sky {
  const sun = sunVector(dateMs);
  if (sun[2] <= 0) return { ghi: 0, transmittance: 1, sun: null };
  const clearSky = PEAK_IRRADIANCE_WM2 * sun[2];

  const cloudiness = weatherAt(simTimeMs).cloudiness;
  const smoothTransmittance = 1 - cloudiness * CLOUD_ATTENUATION;
  // Flicker amplitude scales with cloudiness: ~0 on a clear day (nothing to pass in
  // front of the sun), up to +/-PASSING_CLOUD_STRENGTH once fully overcast.
  const flicker = valueNoise("pv-passing-cloud", dateMs, PASSING_CLOUD_PERIOD_MS) * cloudiness * PASSING_CLOUD_STRENGTH;
  const transmittance = Math.min(1, Math.max(0, smoothTransmittance + flicker));

  return { ghi: clearSky * transmittance, transmittance, sun };
}

/** The sun's direction at `dateMs` as a unit vector (east, north, up). */
function sunVector(dateMs: number): [number, number, number] {
  const doy = dayOfYear(dateMs);
  const hourOfDay = (dateMs % DAY_MS) / HOUR_MS;
  const lat = (SCHLIEREN_LATITUDE_DEG * Math.PI) / 180;
  const decl = (solarDeclinationDeg(doy) * Math.PI) / 180;
  const hourAngle = (15 * (hourOfDay - 12) * Math.PI) / 180; // positive in the afternoon
  return [
    -Math.cos(decl) * Math.sin(hourAngle),
    Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(hourAngle),
    Math.sin(decl) * Math.sin(lat) + Math.cos(decl) * Math.cos(lat) * Math.cos(hourAngle),
  ];
}

// --- how arrays face the sun ---

const DEG = Math.PI / 180;

/** A panel's normal (east, north, up) at a tilt facing a compass direction. */
function normal(tiltDeg: number, azimuthDeg: number): [number, number, number] {
  return [Math.sin(tiltDeg * DEG) * Math.sin(azimuthDeg * DEG), Math.sin(tiltDeg * DEG) * Math.cos(azimuthDeg * DEG), Math.cos(tiltDeg * DEG)];
}

/** Light on a plane with normal `n` (W/m2): straight from the sun, the sky's diffuse light it sees,
 * and the ground's reflection. */
function onPlane(n: [number, number, number], sun: [number, number, number], dni: number, diffuse: number, ghi: number): number {
  const cos = n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2];
  return dni * Math.max(0, cos) + (diffuse * (1 + n[2])) / 2 + (ghi * PV_ALBEDO * (1 - n[2])) / 2;
}

/** Light on an array of `mount` relative to the horizontal (before scaling). */
function mountLight(mount: PvMount, sun: [number, number, number], dni: number, diffuse: number, ghi: number): number {
  switch (mount.kind) {
    case "fixed":
      return onPlane(normal(mount.tiltDeg, mount.azimuthDeg), sun, dni, diffuse, ghi);
    case "eastWest":
      return (onPlane(normal(mount.tiltDeg, 90), sun, dni, diffuse, ghi) + onPlane(normal(mount.tiltDeg, 270), sun, dni, diffuse, ghi)) / 2;
    case "vertical": {
      // Both faces work: rated on the front, the back adds what bifaciality makes of its light.
      const east = onPlane(normal(90, 90), sun, dni, diffuse, ghi);
      const west = onPlane(normal(90, 270), sun, dni, diffuse, ghi);
      return ((east + west) * (1 + PV_BIFACIALITY)) / 2;
    }
    case "tracking": {
      // Turned about a north–south axis to face the sun, within its range.
      const angle = Math.max(-mount.maxAngleDeg * DEG, Math.min(mount.maxAngleDeg * DEG, Math.atan2(sun[0], sun[2])));
      return onPlane([Math.sin(angle), 0, Math.cos(angle)], sun, dni, diffuse, ghi);
    }
  }
}

/** Each profile's output per kWp relative to a flat panel (light on its plane over the light on the
 * ground, times the scaling), at one instant — worked out once per instant for all plants. */
function profileFactors(simTimeMs: number): Float64Array {
  if (simTimeMs === factorsAt) return factors;
  factorsAt = simTimeMs;
  const { ghi, transmittance, sun } = skyAt(simTimeMs);
  factorsGhi = ghi;
  if (!sun || ghi <= 0) {
    factors.fill(0);
    return factors;
  }
  const scale = profileScale();
  const diffuseShare = PV_DIFFUSE_SHARE_CLEAR + (1 - PV_DIFFUSE_SHARE_CLEAR) * Math.min(1, Math.max(0, (1 - transmittance) / CLOUD_ATTENUATION));
  const diffuse = ghi * diffuseShare;
  const dni = Math.min(PEAK_IRRADIANCE_WM2, (ghi - diffuse) / Math.max(0.05, sun[2]));
  for (let i = 0; i < PV_PROFILES.length; i++) factors[i] = Math.min(3, (scale * mountLight(PV_PROFILES[i].mount, sun, dni, diffuse, ghi)) / ghi);
  return factors;
}

const factors = new Float64Array(PV_PROFILES.length);
let factorsAt = Number.NaN;
let factorsGhi = 0;
const SHEDS_SNOW = PV_PROFILES.map((p) => p.shedsSnow === true);

/** The light on the ground a profile's panels work with at `simTimeMs`: `irradiance` (snow on the
 * panels already taken off) — or, on panels snow can't stay on, the sky's own. */
function panelLight(profile: number, simTimeMs: number, irradiance: number): number {
  if (!SHEDS_SNOW[profile]) return irradiance;
  profileFactors(simTimeMs);
  return factorsGhi;
}
let scaleMemo: number | null = null;
const yearFactors = new Map<string, number>();

/** What a profile makes over a year relative to a flat panel (the roofs together: 1). */
export function profileYearFactor(id: string): number {
  profileScale();
  return yearFactors.get(id) ?? 1;
}

/** The scaling: what a flat panel makes over a year over what the roof basket makes (each
 * orientation as common as its weight), so the roofs together make what they did lying flat. */
function profileScale(): number {
  if (scaleMemo !== null) return scaleMemo;
  let flat = 0;
  let basket = 0;
  const each = PV_PROFILES.map(() => 0);
  const totalWeight = PV_PROFILES.reduce((s, p) => s + p.roofWeight, 0);
  const startMs = Date.UTC(2026, 0, 1);
  for (let h = 0; h < 365 * 24; h++) {
    const dateMs = startMs + (h + 0.5) * HOUR_MS;
    const sun = sunVector(dateMs);
    if (sun[2] <= 0) continue;
    // A typical sky: clear and overcast hours in about the Swiss proportion.
    for (const transmittance of [1, 0.6, 0.25]) {
      const ghi = PEAK_IRRADIANCE_WM2 * sun[2] * transmittance;
      const diffuse = ghi * (PV_DIFFUSE_SHARE_CLEAR + (1 - PV_DIFFUSE_SHARE_CLEAR) * Math.min(1, (1 - transmittance) / CLOUD_ATTENUATION));
      const dni = Math.min(PEAK_IRRADIANCE_WM2, (ghi - diffuse) / Math.max(0.05, sun[2]));
      flat += ghi;
      PV_PROFILES.forEach((p, i) => {
        const light = mountLight(p.mount, sun, dni, diffuse, ghi);
        each[i] += light;
        basket += (p.roofWeight / totalWeight) * light;
      });
    }
  }
  scaleMemo = basket > 0 ? flat / basket : 1;
  PV_PROFILES.forEach((p, i) => yearFactors.set(p.id, flat > 0 ? (scaleMemo! * each[i]) / flat : 1));
  return scaleMemo;
}

const PROFILE_INDEX = new Map(PV_PROFILES.map((p, i) => [p.id, i]));
const roofProfileByKey = new Map<string, number>();

/** The profile a roof's arrays follow: a seeded draw per building from the basket. */
export function roofProfileIndex(key: string): number {
  let i = roofProfileByKey.get(key);
  if (i === undefined) {
    const total = PV_PROFILES.reduce((s, p) => s + p.roofWeight, 0);
    let u = firstRandom(hashSeed(key, "pv-orientation")) * total;
    i = 0;
    for (let k = 0; k < PV_PROFILES.length; k++) {
      u -= PV_PROFILES[k].roofWeight;
      if (u < 0 && PV_PROFILES[k].roofWeight > 0) {
        i = k;
        break;
      }
    }
    roofProfileByKey.set(key, i);
  }
  return i;
}

/** The profile a plant follows: its own (an Agri-PV field's system), else its roof's. */
export function plantProfileIndex(plant: PowerPlant): number {
  if (plant.pvProfile) return PROFILE_INDEX.get(plant.pvProfile) ?? 0;
  return roofProfileIndex(plant.egid ?? plant.plantId);
}

/** What the arrays on a building's roof make over a year relative to a flat panel (its orientation:
 * a south roof a little more, an east or west one less). */
export function roofYearFactor(egid: string): number {
  return profileYearFactor(PV_PROFILES[roofProfileIndex(egid)].id);
}

/** How the arrays on a building face the sun, in words. */
export function roofOrientationLabel(egid: string): string {
  return PV_PROFILES[roofProfileIndex(egid)].label;
}

/** What 1 kW of panels of profile `profile` (roofProfileIndex, plantProfileIndex) makes at
 * `simTimeMs` given the irradiance on the ground (W/m2, snow on the panels already taken off) — as a
 * share of its rating. */
export function profileShareAt(profile: number, simTimeMs: number, irradiance: number): number {
  const light = panelLight(profile, simTimeMs, irradiance);
  return light > 0 ? (light / PEAK_IRRADIANCE_WM2) * profileFactors(simTimeMs)[profile] : 0;
}

/** What 1 kW of panels on `egid`'s roof makes at `simTimeMs` given the irradiance on the ground
 * (W/m2, snow on the panels already taken off) — as a share of its rating. */
export function roofPvShare(egid: string, simTimeMs: number, irradiance: number): number {
  return (irradiance / PEAK_IRRADIANCE_WM2) * profileFactors(simTimeMs)[roofProfileIndex(egid)];
}

/** Irradiance actually reaching a panel, in W/m2 — ghiWm2 further blocked by any
 * snow sitting on the panel itself. `snowCoverCm` can be precomputed by the caller —
 * see module docs — and defaults to computing it fresh for a single ad-hoc call. */
export function irradianceWm2(simTimeMs: number, snowCoverCm?: number): number {
  const ghi = ghiWm2(simTimeMs);
  if (ghi <= 0) return 0;
  const snow = snowCoverCm ?? snowDepthCm(simTimeMs);
  return ghi * snowPvBlockingFactor(snow);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Fraction of full daylight, 0 (night) to 1 (day) — smoothstep over a +-6deg
 * elevation band around the horizon (roughly a 45-60min transition at Schlieren's
 * latitude) rather than flipping the instant the sun crosses it, so a "day/night"
 * indicator built on this can fade through sunrise/sunset instead of snapping. */
export function dayFraction(simTimeMs: number): number {
  const elevationDeg = solarElevationDeg(toDateMs(simTimeMs));
  const t = clamp01((elevationDeg + 6) / 12);
  return t * t * (3 - 2 * t);
}

/** Whether the sun is climbing (morning side of its arc) rather than sinking
 * (evening side) — the trend, not just the current elevation, is what tells a
 * transitional dayFraction apart as "sunrise" vs. "sunset". */
export function isSunRising(simTimeMs: number): boolean {
  const dateMs = toDateMs(simTimeMs);
  return solarElevationDeg(dateMs + 2 * MINUTE_MS) > solarElevationDeg(dateMs - 2 * MINUTE_MS);
}

/** Generation in W — negative-signed, i.e. a credit against consumption, since this
 * feeds directly into the same "total power" sums as every consuming device. */
export function pvPowerW(plant: PowerPlant, simTimeMs: number, snowCoverCm?: number): number {
  if (plant.technology === "Wind") return -windPowerW(plant, simTimeMs);
  if (plant.technology !== "Photovoltaic" || !plant.capacityKw) return 0;
  if (plant.activeToMs !== undefined && simTimeMs >= plant.activeToMs) return 0; // its building has been demolished
  return pvPowerWAt(plant, simTimeMs, irradianceWm2(simTimeMs, snowCoverCm));
}

/** pvPowerW for a caller summing many plants at one instant: the irradiance is the same for
 * every roof, so it's worked out once (irradianceWm2) and passed in. */
export function pvPowerWAt(plant: PowerPlant, simTimeMs: number, irradiance: number): number {
  // The town's wind turbines (wind.ts) are summed with its solar: local generation.
  if (plant.technology === "Wind") return -windPowerW(plant, simTimeMs);
  if (plant.technology !== "Photovoltaic" || !plant.capacityKw) return 0;
  if (plant.activeToMs !== undefined && simTimeMs >= plant.activeToMs) return 0; // its building has been demolished
  // A solar feed-in limit (the law) caps what the system delivers at a share of its rating — taken
  // on generation rather than on the net feed-in, a slightly conservative simplification. A system
  // with a battery generates in full: the battery takes what's over the limit, and homeBattery.ts
  // curtails the rest of the feed-in.
  const limit = plant.battery ? 1 : policyStore.get().feedInLimitPct / 100;
  const profile = plantProfileIndex(plant);
  const light = panelLight(profile, simTimeMs, irradiance);
  if (light <= 0) return 0;
  const share = (light / PEAK_IRRADIANCE_WM2) * profileFactors(simTimeMs)[profile];
  return -(plant.capacityKw * 1000 * Math.min(share, limit));
}

/** Sum of every plant on a given building's roof (almost always 0 or 1 plant). */
export function pvPowerForBuildingW(egid: string, plants: PowerPlant[], simTimeMs: number, snowCoverCm?: number): number {
  const snow = snowCoverCm ?? snowDepthCm(simTimeMs);
  let total = 0;
  for (const plant of plants) {
    if (plant.egid === egid) total += pvPowerW(plant, simTimeMs, snow);
  }
  return total;
}
