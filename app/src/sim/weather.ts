/**
 * A "feels realistic" weather model, not a physical one: a smooth seasonal
 * temperature curve (keyed off the real calendar date from calendar.ts) plus a
 * diurnal day/night wobble, with short-term "weather" layered on top via value
 * noise — smoothly-interpolated random anchors rather than white noise, so a warm
 * or cloudy spell persists for a few days like a real weather system instead of
 * flickering every sample. Everything is still a pure function of simTime (see
 * devices.ts's header for why that matters): nothing is simulated step-by-step or
 * remembered, so this composes with the history-sampling machinery for free and
 * needs no special-casing for negative simTime (a history window looking back past
 * t=0) the way devices.ts's fridge originally did.
 *
 * Drives the live weather indicator and heat pump load (heatPump.ts); PV generation
 * (also depending on temperature/cloudiness) is a natural next consumer.
 */

import { toDateMs, dayOfYear } from "./calendar";
import { valueNoise } from "./valueNoise";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 3_600_000;

const MEAN_ANNUAL_TEMP_C = 10;
const SEASONAL_AMPLITUDE_C = 9; // -> roughly 1C winter trough, 19C summer peak
const SEASONAL_PEAK_DAY_OF_YEAR = 202; // ~21 Jul: thermal lag past the solstice
const DIURNAL_AMPLITUDE_C = 4;
const DIURNAL_PEAK_HOUR = 15;

const WEATHER_SYSTEM_PERIOD_MS = 5 * DAY_MS; // a passing high/low pressure system
const DAILY_WOBBLE_PERIOD_MS = 1.3 * DAY_MS;
const PRECIP_ROLL_PERIOD_MS = 6 * HOUR_MS;

function seasonalTempC(dateMs: number): number {
  const phase = (2 * Math.PI * (dayOfYear(dateMs) - SEASONAL_PEAK_DAY_OF_YEAR)) / 365.25;
  return MEAN_ANNUAL_TEMP_C + SEASONAL_AMPLITUDE_C * Math.cos(phase);
}

function diurnalTempC(dateMs: number): number {
  const hourOfDay = (dateMs % DAY_MS) / HOUR_MS; // dateMs is always a large positive real epoch ms, `%` is safe
  return DIURNAL_AMPLITUDE_C * Math.cos((2 * Math.PI * (hourOfDay - DIURNAL_PEAK_HOUR)) / 24);
}

function tempAnomalyC(dateMs: number): number {
  const systemNoise = valueNoise("temp-system", dateMs, WEATHER_SYSTEM_PERIOD_MS);
  const dailyNoise = valueNoise("temp-daily", dateMs, DAILY_WOBBLE_PERIOD_MS);
  return systemNoise * 5 + dailyNoise * 2;
}

/** The day's characteristic temperature — seasonal baseline plus the slower-moving
 * "weather system" anomaly, deliberately excluding the diurnal day/night wobble
 * (which averages out over a full day). Used to decide whether a day is cold enough
 * to need heating at all, as distinct from how hard a heat pump runs at any one
 * instant within that day (which does use the full instantaneous temperature,
 * diurnal swing included — see heatPump.ts). */
export function dailyMeanTempC(simTimeMs: number): number {
  const dateMs = toDateMs(simTimeMs);
  return seasonalTempC(dateMs) + tempAnomalyC(dateMs);
}

export type WeatherCondition = "clear" | "partly-cloudy" | "cloudy" | "overcast" | "rain" | "snow";

export interface Weather {
  tempC: number;
  cloudiness: number; // 0 (clear sky) - 1 (fully overcast)
  condition: WeatherCondition;
}

export function weatherAt(simTimeMs: number): Weather {
  const dateMs = toDateMs(simTimeMs);
  const base = seasonalTempC(dateMs) + diurnalTempC(dateMs) + tempAnomalyC(dateMs);

  const cloudSystemNoise = valueNoise("cloud-system", dateMs, WEATHER_SYSTEM_PERIOD_MS);
  const cloudDailyNoise = valueNoise("cloud-daily", dateMs, DAILY_WOBBLE_PERIOD_MS * 0.6);
  const cloudiness = Math.min(1, Math.max(0, (cloudSystemNoise * 0.7 + cloudDailyNoise * 0.3 + 1) / 2));

  const tempC = base - cloudiness * 2; // overcast days run a little cooler

  let condition: WeatherCondition;
  if (cloudiness < 0.3) {
    condition = "clear";
  } else if (cloudiness < 0.55) {
    condition = "partly-cloudy";
  } else if (cloudiness < 0.8) {
    condition = "cloudy";
  } else {
    const precipRoll = valueNoise("precip", dateMs, PRECIP_ROLL_PERIOD_MS);
    const precipThreshold = 1 - ((cloudiness - 0.8) / 0.2) * 0.7; // heavier overcast -> more likely to tip into precipitation
    const isPrecipitating = precipRoll > precipThreshold;
    condition = isPrecipitating ? (tempC <= 0 ? "snow" : "rain") : "overcast";
  }

  return { tempC, cloudiness, condition };
}
