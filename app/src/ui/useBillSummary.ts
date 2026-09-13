import type { Building, Dwelling, PowerPlant } from "../data/types";
import { addBills, buildingBillRp, dwellingBillRp, ZERO_BILL, type BillBreakdown } from "../sim/billing";
import { simClock } from "../sim/engine";
import {
  historyTimeSteps,
  sampleBuildingCategorySeries,
  sampleDwellingCategorySeries,
  HISTORY_WINDOW_MS,
  HISTORY_SAMPLE_COUNT,
  HISTORY_REFRESH_MS,
} from "../sim/history";
import { periodsForTier } from "../sim/historyLong";
import type { Tariff } from "../sim/tariff";
import { useHistorySeries } from "./useHistorySeries";

export interface BillSummary {
  day: BillBreakdown;
  month: BillBreakdown;
  year: BillBreakdown;
}

// Billing is always scoped to one building or one dwelling, never the whole
// municipality — cheap enough (unlike historyLong.ts's municipality-wide bars)
// to compute synchronously on every refresh rather than needing that module's
// cached/chunked machinery. 24 samples/month matches historyLong's own
// resolution for the existing "Historical energy" bars, so the two stay
// comparable.
const SAMPLES_PER_MONTH = 24;

/** month = the most recently completed calendar month's bill; year = the sum
 * of the last 12 completed months (computed once each, not the month bill
 * recomputed twice). */
function monthAndYearBills(billForTimes: (times: number[]) => BillBreakdown): { month: BillBreakdown; year: BillBreakdown } {
  const periods = periodsForTier("month", simClock.getSimTimeMs());
  let year = ZERO_BILL;
  let month = ZERO_BILL;
  for (const period of periods) {
    const times = historyTimeSteps(period.endMs, period.endMs - period.startMs, SAMPLES_PER_MONTH);
    const bill = billForTimes(times);
    year = addBills(year, bill);
    month = bill;
  }
  return { month, year };
}

function tariffEffectKey(tariff: Tariff): string {
  return [
    tariff.offPeakPriceRpKWh,
    tariff.peakPriceRpKWh,
    tariff.feedInPriceRpKWh,
    tariff.gasPriceRpKWh,
    tariff.districtHeatingPriceRpKWh,
  ].join(":");
}

export function useBuildingBillSummary(building: Building, plants: PowerPlant[], tariff: Tariff): BillSummary {
  return useHistorySeries(
    () => {
      const dayTimes = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      const day = buildingBillRp(building, sampleBuildingCategorySeries(building, dayTimes, tariff, plants), dayTimes, tariff);
      const { month, year } = monthAndYearBills((times) =>
        buildingBillRp(building, sampleBuildingCategorySeries(building, times, tariff, plants), times, tariff),
      );
      return { day, month, year };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${tariffEffectKey(tariff)}`,
  );
}

export function useDwellingBillSummary(building: Building, dwelling: Dwelling, plants: PowerPlant[], tariff: Tariff): BillSummary {
  return useHistorySeries(
    () => {
      const dayTimes = historyTimeSteps(simClock.getSimTimeMs(), HISTORY_WINDOW_MS, HISTORY_SAMPLE_COUNT);
      const dayBuildingSeries = sampleBuildingCategorySeries(building, dayTimes, tariff, plants);
      const day = dwellingBillRp(
        building,
        dwelling,
        sampleDwellingCategorySeries(building, dwelling, dayTimes, tariff),
        dayBuildingSeries,
        dayTimes,
        tariff,
      );
      const { month, year } = monthAndYearBills((times) => {
        const buildingSeries = sampleBuildingCategorySeries(building, times, tariff, plants);
        return dwellingBillRp(building, dwelling, sampleDwellingCategorySeries(building, dwelling, times, tariff), buildingSeries, times, tariff);
      });
      return { day, month, year };
    },
    HISTORY_REFRESH_MS,
    `${building.egid}:${dwelling.ewid}:${tariffEffectKey(tariff)}`,
  );
}
