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
 * clear the instant the sky does. Weather and snow are both shared by every plant in
 * the municipality — it's entirely reasonable for panels a few km apart to see the
 * same sky at the same moment — so callers evaluating many plants at once (see
 * history.ts) should compute snow cover once and pass it in rather than let every
 * plant recompute the same 30-day lookback. Everything ignores panel temperature
 * derating, inverter losses, tilt/orientation, and shading — real but second-order
 * next to "is it day, is it summer, is a cloud (or snowdrift) over the panel right
 * now." Pure function of (plant, simTime), so it composes with history sampling for
 * free.
 */

import type { PowerPlant } from "../data/types";
import { toDateMs, dayOfYear } from "./calendar";
import { snowDepthCm, snowPvBlockingFactor } from "./snow";
import { valueNoise } from "./valueNoise";
import { weatherAt } from "./weather";

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
  const dateMs = toDateMs(simTimeMs);
  const elevationDeg = solarElevationDeg(dateMs);
  if (elevationDeg <= 0) return 0;
  const clearSky = PEAK_IRRADIANCE_WM2 * Math.sin((elevationDeg * Math.PI) / 180);

  const cloudiness = weatherAt(simTimeMs).cloudiness;
  const smoothTransmittance = 1 - cloudiness * CLOUD_ATTENUATION;
  // Flicker amplitude scales with cloudiness: ~0 on a clear day (nothing to pass in
  // front of the sun), up to +/-PASSING_CLOUD_STRENGTH once fully overcast.
  const flicker = valueNoise("pv-passing-cloud", dateMs, PASSING_CLOUD_PERIOD_MS) * cloudiness * PASSING_CLOUD_STRENGTH;
  const weatherTransmittance = Math.min(1, Math.max(0, smoothTransmittance + flicker));

  return clearSky * weatherTransmittance;
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
  if (plant.technology !== "Photovoltaic" || !plant.capacityKw) return 0;
  if (plant.activeToMs !== undefined && simTimeMs >= plant.activeToMs) return 0; // its building has been demolished
  return pvPowerWAt(plant, simTimeMs, irradianceWm2(simTimeMs, snowCoverCm));
}

/** pvPowerW for a caller summing many plants at one instant: the irradiance is the same for
 * every roof, so it's worked out once (irradianceWm2) and passed in. */
export function pvPowerWAt(plant: PowerPlant, simTimeMs: number, irradiance: number): number {
  if (plant.technology !== "Photovoltaic" || !plant.capacityKw) return 0;
  if (plant.activeToMs !== undefined && simTimeMs >= plant.activeToMs) return 0; // its building has been demolished
  return -(plant.capacityKw * 1000 * (irradiance / PEAK_IRRADIANCE_WM2));
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
