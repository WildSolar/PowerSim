/**
 * The local DSO's own money ledger — separate from what a consumer's bill
 * shows (billing.ts): what the municipality actually keeps after buying
 * wholesale electricity and maintaining the grid. This is the "money" half
 * of the two-currency gameplay design (the other being emissions.ts's CO2
 * tracking toward net zero) — the resource future policy/infrastructure
 * spending will draw down.
 *
 * Deliberately electricity-only: heating fuel (gas/oil/district heat) and
 * mobility fuel (petrol/diesel) are paid straight to their own external
 * suppliers, never through the municipal utility, so they don't appear here
 * even though they're billed to the consumer (see billing.ts). Cantonal
 * heating/EV subsidies (heatingSystems.ts/mobilitySystems.ts) aren't paid by
 * the municipality either — they're an existing, player-uncontrolled program
 * baked into a household's own renewal decision, not (yet) a lever the
 * player pulls or a cost the player bears.
 *
 * Solar is the first real exception: solarAdoption.ts's municipal top-up
 * subsidy (policy.ts) *is* a player-controlled lever with a real cost, so it
 * shows up here as its own line — unlike the federal Einmalvergütung
 * baseline every installation also gets, which (like the cantonal heating
 * grants) isn't the municipality's money to begin with.
 *
 * `plants` here should always be the *real* static Pronovo list
 * (dataset.powerPlants) for solarAdoption.ts's own bookkeeping, and the
 * *effective* (real + adopted) list for everything electricity-metered
 * (consumption/revenue/feed-in) — see computeMunicipalFinancesForYear's own
 * parameters below.
 *
 * Same caching principle as emissions.ts: a completed year's finances never
 * change once computed, so they're cached by year forever. And the same
 * "retroactive tariff" simplification tariffStore.ts already documents for
 * every other consumer of the current tariff — a year's finances use
 * whichever tariff is current the first time that year is computed, then
 * are locked in; changing prices afterward only shapes future years, never
 * rewrites a year already booked.
 */

import type { Building, PowerPlant } from "../data/types";
import { consumptionSeriesW, electricityCostRp, flatCostRp } from "./billing";
import { toSimTimeMs } from "./calendar";
import { energyKWh } from "./energy";
import { historyTimeSteps, sampleMunicipalityCategorySeries } from "./history";
import { effectivePowerPlants, municipalSolarSubsidiesPaidInYear } from "./solarAdoption";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";

const COARSE_SAMPLES_PER_MONTH = 8; // matches yearReport.ts's own coarse density for smooth municipality-wide electricity quantities

export interface MunicipalFinances {
  year: number;
  consumerRevenueRp: number; // what consumers paid for grid electricity, time-of-use priced — the same rates billing.ts bills them at
  feedInPaidRp: number; // paid out to solar owners (real or adopted) for exported generation
  wholesaleCostRp: number; // paid upstream for the net electricity actually drawn from the wider grid (consumption minus all local solar)
  gridMaintenanceCostRp: number; // wires/upkeep cost, scaled to gross electricity delivered to consumers
  solarSubsidiesPaidRp: number; // the municipality's own top-up subsidy (policy.ts) for installations adopted this year — never the federal baseline
  netIncomeRp: number; // consumerRevenueRp - feedInPaidRp - wholesaleCostRp - gridMaintenanceCostRp - solarSubsidiesPaidRp
}

const ZERO_FINANCES: Omit<MunicipalFinances, "year"> = {
  consumerRevenueRp: 0,
  feedInPaidRp: 0,
  wholesaleCostRp: 0,
  gridMaintenanceCostRp: 0,
  solarSubsidiesPaidRp: 0,
  netIncomeRp: 0,
};

const financesCache = new Map<number, MunicipalFinances>();

/** Every completed calendar year's municipal electricity finances, computed
 * once and cached forever after — see module doc. Chunked monthly with a
 * yield in between, the same pattern (and the same coarse sample density)
 * yearReport.ts's own computeNetElectricityKWh uses, since consumer revenue
 * and net electricity are both smooth municipality-scale quantities.
 * Wholesale cost is priced on *net* electricity (solar directly offsets what
 * must be bought upstream); grid maintenance is priced on *gross* consumption
 * (every consumed kWh moves through the local wires regardless of how much
 * solar also flowed the other way). */
export async function computeMunicipalFinancesForYear(
  buildings: Building[],
  realPlants: PowerPlant[],
  year: number,
  isCancelled: () => boolean,
): Promise<MunicipalFinances> {
  const cached = financesCache.get(year);
  if (cached) return cached;

  const tariff: Tariff = tariffStore.get();
  const plants = effectivePowerPlants(buildings, realPlants, year);
  let consumerRevenueRp = 0;
  let feedInPaidRp = 0;
  let grossConsumptionKWh = 0;
  let netElectricityKWh = 0;

  for (let month = 0; month < 12; month++) {
    if (isCancelled()) return { year, ...ZERO_FINANCES };
    const monthStartMs = toSimTimeMs(Date.UTC(year, month, 1));
    const monthEndMs = toSimTimeMs(Date.UTC(year, month + 1, 1));
    const times = historyTimeSteps(monthEndMs, monthEndMs - monthStartMs, COARSE_SAMPLES_PER_MONTH);
    const series = sampleMunicipalityCategorySeries(buildings, times, tariff, plants);
    const consumptionW = consumptionSeriesW(series);
    consumerRevenueRp += electricityCostRp(times, consumptionW, tariff);
    feedInPaidRp += flatCostRp(times, series.solarW, tariff.feedInPriceRpKWh);
    grossConsumptionKWh += energyKWh(times, consumptionW);
    netElectricityKWh += energyKWh(times, consumptionW) - energyKWh(times, series.solarW);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const wholesaleCostRp = netElectricityKWh * tariff.wholesalePriceRpKWh;
  const gridMaintenanceCostRp = grossConsumptionKWh * tariff.gridMaintenanceRpKWh;
  const solarSubsidiesPaidRp = municipalSolarSubsidiesPaidInYear(buildings, realPlants, year);
  const netIncomeRp = consumerRevenueRp - feedInPaidRp - wholesaleCostRp - gridMaintenanceCostRp - solarSubsidiesPaidRp;

  const result: MunicipalFinances = {
    year,
    consumerRevenueRp,
    feedInPaidRp,
    wholesaleCostRp,
    gridMaintenanceCostRp,
    solarSubsidiesPaidRp,
    netIncomeRp,
  };
  financesCache.set(year, result);
  return result;
}

/** The municipality's running treasury balance from `baselineYear` through
 * `throughYear`, inclusive — the sum of every one of those years' net
 * income. Each year is itself cached forever (above), so once every year up
 * to some point has already been seen (the normal way play proceeds — the
 * clock always pauses at each year boundary), extending the balance to the
 * next year only costs that one new year; nothing earlier is ever
 * recomputed. */
export async function computeCumulativeBalanceRp(
  buildings: Building[],
  plants: PowerPlant[],
  throughYear: number,
  baselineYear: number,
  isCancelled: () => boolean,
): Promise<number> {
  let balanceRp = 0;
  for (let year = baselineYear; year <= throughYear; year++) {
    if (isCancelled()) return balanceRp;
    const finances = await computeMunicipalFinancesForYear(buildings, plants, year, isCancelled);
    balanceRp += finances.netIncomeRp;
  }
  return balanceRp;
}
