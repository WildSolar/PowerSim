/**
 * PV generation for real rooftop solar installations (the BFE/Pronovo registry —
 * data.powerPlants). No stochastic ownership here either, same as heat pumps: which
 * buildings have solar, and how big, is already known from real data.
 *
 * Model: standard solar-geometry approximations (declination, hour angle -> solar
 * elevation) give a clear-sky irradiance proportional to sin(elevation), attenuated
 * by weather.ts's cloudiness. A plant's output scales its nameplate (STC) capacity
 * by the ratio of current irradiance to the ~1000 W/m2 STC reference — ignoring
 * panel temperature derating, inverter losses, tilt/orientation, and shading, all of
 * which are real but second-order next to "is it day, is it summer, is it cloudy."
 * Pure function of (plant, simTime) like everything else here, so it composes with
 * history sampling for free.
 */

import type { PowerPlant } from "../data/types";
import { toDateMs, dayOfYear } from "./calendar";
import { weatherAt } from "./weather";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SCHLIEREN_LATITUDE_DEG = 47.4;
const PEAK_IRRADIANCE_WM2 = 1000; // STC reference
const CLOUD_ATTENUATION = 0.8; // fraction of clear-sky irradiance lost at full overcast

function solarDeclinationDeg(doy: number): number {
  return 23.45 * Math.sin((2 * Math.PI * (284 + doy)) / 365);
}

function solarElevationDeg(dateMs: number): number {
  const doy = dayOfYear(dateMs);
  const hourOfDay = (dateMs % DAY_MS) / HOUR_MS; // dateMs is always a large positive real epoch ms
  const latRad = (SCHLIEREN_LATITUDE_DEG * Math.PI) / 180;
  const declRad = (solarDeclinationDeg(doy) * Math.PI) / 180;
  const hourAngleRad = ((15 * (hourOfDay - 12)) * Math.PI) / 180;
  const sinElevation = Math.sin(latRad) * Math.sin(declRad) + Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  return (Math.asin(Math.min(1, Math.max(-1, sinElevation))) * 180) / Math.PI;
}

/** Irradiance in W/m2 at the given simulated time, weather (cloudiness) included. */
export function irradianceWm2(simTimeMs: number): number {
  const dateMs = toDateMs(simTimeMs);
  const elevationDeg = solarElevationDeg(dateMs);
  if (elevationDeg <= 0) return 0;
  const clearSky = PEAK_IRRADIANCE_WM2 * Math.sin((elevationDeg * Math.PI) / 180);
  const cloudiness = weatherAt(simTimeMs).cloudiness;
  return clearSky * (1 - cloudiness * CLOUD_ATTENUATION);
}

/** Generation in W — negative-signed, i.e. a credit against consumption, since this
 * feeds directly into the same "total power" sums as every consuming device. */
export function pvPowerW(plant: PowerPlant, simTimeMs: number): number {
  if (plant.technology !== "Photovoltaic" || !plant.capacityKw) return 0;
  const irradiance = irradianceWm2(simTimeMs);
  return -(plant.capacityKw * 1000 * (irradiance / PEAK_IRRADIANCE_WM2));
}

/** Sum of every plant on a given building's roof (almost always 0 or 1 plant). */
export function pvPowerForBuildingW(egid: string, plants: PowerPlant[], simTimeMs: number): number {
  let total = 0;
  for (const plant of plants) {
    if (plant.egid === egid) total += pvPowerW(plant, simTimeMs);
  }
  return total;
}
