/**
 * How each kind of Agri-PV installation (config/agriPv.ts) makes its power over a year, for the
 * field's card: its average summer and winter day, how much it makes per kWp, how much of it in
 * winter, the grid's CO₂ it displaces and what its hours are worth on the market against the
 * month's average. Worked out from the year's own weather (snow on the panels included, where it
 * stays), an hour at a time; the same for every field of a kind, so once per year and kept. Nothing
 * to save.
 */

import { AGRI_PV_SYSTEMS, type AgriPvSystem } from "../config/agriPv";
import { PV_PROFILES } from "../config/pvProfiles";
import { toSimTimeMs } from "./calendar";
import { dayAheadPriceRpKWh } from "./dynamicTariff";
import { gridCarbonIntensityGPerKWhAt } from "./gridCarbon";
import { irradianceWm2, profileShareAt } from "./pv";
import { snowDepthCm } from "./snow";

const HOUR_MS = 3_600_000;

export interface AgriPvKindYear {
  /** What 1 kWp makes in the year (kWh). */
  kWhPerKwp: number;
  /** The share of it made from November to February. */
  winterShare: number;
  /** The grid's carbon intensity at the hours it makes its power, on average (g/kWh). */
  co2GPerKWh: number;
  /** What its power is worth on the market against the month's average hour (1: as much). */
  valueFactor: number;
  /** The average day in June and July, and in December and January: its output each hour, as a
   * share of its rating. */
  summerDay: number[];
  winterDay: number[];
}

const SYSTEMS = Object.keys(AGRI_PV_SYSTEMS) as AgriPvSystem[];
const PROFILE = new Map(SYSTEMS.map((s) => [s, PV_PROFILES.findIndex((p) => p.id === s)]));
const byYear = new Map<number, Record<AgriPvSystem, AgriPvKindYear>>();

/** Every kind's year in `year`. */
export function agriPvKindYear(year: number): Record<AgriPvSystem, AgriPvKindYear> {
  let out = byYear.get(year);
  if (out) return out;
  const acc = Object.fromEntries(
    SYSTEMS.map((s) => [s, { kWh: 0, winter: 0, co2: 0, value: 0, summer: new Array<number>(24).fill(0), winterDay: new Array<number>(24).fill(0) }]),
  ) as Record<AgriPvSystem, { kWh: number; winter: number; co2: number; value: number; summer: number[]; winterDay: number[] }>;
  let summerDays = 0;
  let winterDays = 0;
  for (let month = 0; month < 12; month++) {
    const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const start = toSimTimeMs(Date.UTC(year, month, 1));
    // The month's average hour on the market, as the utility's accounts weigh it (finances.ts).
    const prices: number[] = [];
    for (let h = 0; h < days * 24; h++) prices.push(dayAheadPriceRpKWh(start + (h + 0.5) * HOUR_MS));
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const summer = month === 5 || month === 6;
    const winter = month === 11 || month === 0;
    const winterMonth = month <= 1 || month >= 10;
    if (summer) summerDays += days;
    if (winter) winterDays += days;
    for (let d = 0; d < days; d++) {
      const snow = snowDepthCm(start + (d + 0.5) * 24 * HOUR_MS);
      for (let h = 0; h < 24; h++) {
        const t = start + (d * 24 + h + 0.5) * HOUR_MS;
        const light = irradianceWm2(t, snow);
        const g = gridCarbonIntensityGPerKWhAt(t);
        const price = mean > 0 ? prices[d * 24 + h] / mean : 1;
        for (const s of SYSTEMS) {
          const share = profileShareAt(PROFILE.get(s)!, t, light);
          if (share <= 0) continue;
          const a = acc[s];
          a.kWh += share;
          a.co2 += share * g;
          a.value += share * price;
          if (winterMonth) a.winter += share;
          if (summer) a.summer[h] += share;
          if (winter) a.winterDay[h] += share;
        }
      }
    }
  }
  out = Object.fromEntries(
    SYSTEMS.map((s) => {
      const a = acc[s];
      return [
        s,
        {
          kWhPerKwp: a.kWh,
          winterShare: a.kWh > 0 ? a.winter / a.kWh : 0,
          co2GPerKWh: a.kWh > 0 ? a.co2 / a.kWh : 0,
          valueFactor: a.kWh > 0 ? a.value / a.kWh : 1,
          summerDay: a.summer.map((v) => v / summerDays),
          winterDay: a.winterDay.map((v) => v / winterDays),
        },
      ];
    }),
  ) as Record<AgriPvSystem, AgriPvKindYear>;
  byYear.set(year, out);
  return out;
}
