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
 *
 * The climate isn't fixed: it warms slowly over the years (about twice the global pace, as
 * Switzerland does), and in summer, now and then, a heatwave builds — a week or two of clear,
 * hot days, more often as the years go on. Summer afternoons also swing further from the night
 * than winter's do. Air conditioning (ac.ts) follows the heat.
 */

import { toDateMs, toSimTimeMs, dayOfYear } from "./calendar";
import { valueNoise } from "./valueNoise";

const DAY_MS = 24 * 60 * 60_000;
const HOUR_MS = 3_600_000;

const MEAN_ANNUAL_TEMP_C = 10;
const SEASONAL_AMPLITUDE_C = 9; // -> roughly 1C winter trough, 19C summer peak
const SEASONAL_PEAK_DAY_OF_YEAR = 202; // ~21 Jul: thermal lag past the solstice
const DIURNAL_AMPLITUDE_C = 4;
const DIURNAL_PEAK_HOUR = 15;

// Summer days swing wider between night and afternoon than winter's (clear skies, long sun).
const SUMMER_EXTRA_DIURNAL_C = 3;

// Warming: from this year, about +0.35 °C a decade — roughly twice the global pace, as in Switzerland.
const WARMING_FROM_YEAR = 2026;
const WARMING_C_PER_YEAR = 0.035;
const SUMMER_WARMING_C_PER_YEAR = 0.05; // summers warm faster still

// Heatwaves: a slow summer channel that, where it peaks above the threshold, adds a spell of clear,
// hot days. The threshold falls as the climate warms, so spells come more often.
const HEATWAVE_PERIOD_MS = 8 * DAY_MS;
const HEATWAVE_MAX_C = 8;
const HEATWAVE_THRESHOLD = 0.45;
const HEATWAVE_THRESHOLD_DROP_PER_YEAR = 0.012;
const HEATWAVE_GROWTH_C_PER_YEAR = 0.08; // and they get hotter
const HEATWAVE_CLEARING = 0.4; // how much a full heatwave clears the sky
// A day hotter than this in the afternoon is a "hot day" (Hitzetag), as MeteoSwiss counts them.
export const HOT_DAY_C = 30;

const WEATHER_SYSTEM_PERIOD_MS = 5 * DAY_MS; // a passing high/low pressure system
const DAILY_WOBBLE_PERIOD_MS = 1.3 * DAY_MS;
const PRECIP_ROLL_PERIOD_MS = 6 * HOUR_MS;

function seasonalTempC(dateMs: number): number {
  const phase = (2 * Math.PI * (dayOfYear(dateMs) - SEASONAL_PEAK_DAY_OF_YEAR)) / 365.25;
  return MEAN_ANNUAL_TEMP_C + SEASONAL_AMPLITUDE_C * Math.cos(phase);
}

/** How deep into summer a date is: 1 at the warmest point of the year, 0 from the equinoxes through winter. */
function summerWeight(dateMs: number): number {
  const c = Math.cos((2 * Math.PI * (dayOfYear(dateMs) - SEASONAL_PEAK_DAY_OF_YEAR)) / 365.25);
  return c > 0 ? c * c : 0;
}

function diurnalTempC(dateMs: number): number {
  const hourOfDay = (dateMs % DAY_MS) / HOUR_MS; // dateMs is always a large positive real epoch ms, `%` is safe
  const amplitude = DIURNAL_AMPLITUDE_C + SUMMER_EXTRA_DIURNAL_C * summerWeight(dateMs);
  return amplitude * Math.cos((2 * Math.PI * (hourOfDay - DIURNAL_PEAK_HOUR)) / 24);
}

/** Years of warming at `dateMs` (none before WARMING_FROM_YEAR). */
function warmingYears(dateMs: number): number {
  return Math.max(0, (dateMs - Date.UTC(WARMING_FROM_YEAR, 0, 1)) / (365.25 * DAY_MS));
}

/** How strong a heatwave is at `dateMs`: 0 (none) to 1 (its peak). */
function heatwaveStrength(dateMs: number): number {
  const weight = summerWeight(dateMs);
  if (weight === 0) return 0;
  const threshold = HEATWAVE_THRESHOLD - HEATWAVE_THRESHOLD_DROP_PER_YEAR * warmingYears(dateMs);
  const n = valueNoise("heatwave", dateMs, HEATWAVE_PERIOD_MS);
  return n > threshold ? ((n - threshold) / (1 - threshold)) * weight : 0;
}

function tempAnomalyC(dateMs: number): number {
  const systemNoise = valueNoise("temp-system", dateMs, WEATHER_SYSTEM_PERIOD_MS);
  const dailyNoise = valueNoise("temp-daily", dateMs, DAILY_WOBBLE_PERIOD_MS);
  const years = warmingYears(dateMs);
  return systemNoise * 5 + dailyNoise * 2 + (WARMING_C_PER_YEAR + SUMMER_WARMING_C_PER_YEAR * summerWeight(dateMs)) * years + (HEATWAVE_MAX_C + HEATWAVE_GROWTH_C_PER_YEAR * years) * heatwaveStrength(dateMs);
}

// The same days are asked about building after building (a year ahead, from the same moment):
// remembered by date, which is all the weather depends on.
const dailyMeanCache = new Map<number, number>();

/** The day's characteristic temperature — seasonal baseline plus the slower-moving
 * "weather system" anomaly, deliberately excluding the diurnal day/night wobble
 * (which averages out over a full day). Used to decide whether a day is cold enough
 * to need heating at all, as distinct from how hard a heat pump runs at any one
 * instant within that day (which does use the full instantaneous temperature,
 * diurnal swing included — see heatPump.ts). */
export function dailyMeanTempC(simTimeMs: number): number {
  const dateMs = toDateMs(simTimeMs);
  let c = dailyMeanCache.get(dateMs);
  if (c === undefined) {
    if (dailyMeanCache.size >= 50_000) dailyMeanCache.clear();
    c = seasonalTempC(dateMs) + tempAnomalyC(dateMs);
    dailyMeanCache.set(dateMs, c);
  }
  return c;
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

  // Averaging two independent noise channels (the original 0.7/0.3 blend) pulls the
  // combined signal toward the middle — two roughly-independent values rarely land
  // near the same extreme at once — which made genuinely clear or genuinely overcast
  // stretches statistically rare (verified: ~4% overcast, 0% precipitation across a
  // simulated year). Leaning almost entirely on one channel keeps its full spread;
  // the second just adds minor day-to-day texture. A contrast stretch widens that
  // back toward the extremes, and a small upward bias matches a temperate central-
  // European climate (more grey than blue-sky on average) rather than a 50/50 split.
  const cloudSystemNoise = valueNoise("cloud-system", dateMs, WEATHER_SYSTEM_PERIOD_MS);
  const cloudDailyNoise = valueNoise("cloud-daily", dateMs, DAILY_WOBBLE_PERIOD_MS * 0.6);
  const rawCloudiness = (cloudSystemNoise * 0.85 + cloudDailyNoise * 0.15 + 1) / 2;
  // A heatwave is a settled high: clear skies.
  const stretched = 0.5 + (rawCloudiness - 0.5) * 1.4 + 0.08 - HEATWAVE_CLEARING * heatwaveStrength(dateMs);
  const cloudiness = Math.min(1, Math.max(0, stretched));

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

const hotDaysCache = new Map<number, number>();

/** The hot days of a year: days whose afternoon (15:00) is at HOT_DAY_C or above. */
export function hotDaysInYear(year: number): number {
  let n = hotDaysCache.get(year);
  if (n === undefined) {
    n = 0;
    for (let d = Date.UTC(year, 0, 1); d < Date.UTC(year + 1, 0, 1); d += DAY_MS) if (weatherAt(toSimTimeMs(d + DIURNAL_PEAK_HOUR * HOUR_MS)).tempC >= HOT_DAY_C) n++;
    hotDaysCache.set(year, n);
  }
  return n;
}
