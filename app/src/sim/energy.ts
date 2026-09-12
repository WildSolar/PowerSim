/**
 * Daily energy (kWh) per category, derived from the same power series that already
 * drive the history charts — no separate/finer sampling pass, no recorded log.
 * A single power series is integrated over time via the trapezoidal rule; summed
 * across thousands of independent per-dwelling duty cycles the municipality-level
 * aggregate is already smooth at the chart's normal 96-sample resolution, so that
 * resolution integrates accurately too. A single building's noisier curve inherits
 * whatever resolution its own chart uses, so the two stay consistent with each other.
 */

import type { CategorySeries } from "./history";

export function energyKWh(times: number[], powerW: number[]): number {
  let whSum = 0;
  for (let i = 1; i < times.length; i++) {
    const dtHours = (times[i] - times[i - 1]) / 3_600_000;
    whSum += ((powerW[i] + powerW[i - 1]) / 2) * dtHours;
  }
  return whSum / 1000;
}

export interface CategoryEnergyKWh {
  fridge: number;
  lighting: number;
  cooking: number;
  laundry: number;
  plugLoad: number;
  ev: number;
  heatPump: number;
  ac: number;
  waterHeating: number;
  solar: number; // generation, positive-signed
}

export function categoryEnergyFromSeries(times: number[], series: CategorySeries): CategoryEnergyKWh {
  return {
    fridge: energyKWh(times, series.fridgeW),
    lighting: energyKWh(times, series.lightingW),
    cooking: energyKWh(times, series.cookingW),
    laundry: energyKWh(times, series.laundryW),
    plugLoad: energyKWh(times, series.plugLoadW),
    ev: energyKWh(times, series.evW),
    heatPump: energyKWh(times, series.heatPumpW),
    ac: energyKWh(times, series.acW),
    waterHeating: energyKWh(times, series.waterHeatingW),
    solar: energyKWh(times, series.solarW),
  };
}
