/**
 * The local DSO's own money ledger — separate from what a consumer's bill
 * shows (billing.ts): what the municipality actually keeps after buying
 * wholesale electricity and maintaining the grid. This is the "money" half
 * of the two-currency gameplay design (the other being emissions.ts's CO2
 * tracking toward net zero) — the resource future policy/infrastructure
 * spending will draw down.
 *
 * Electricity, plus district heating: the municipal utility also runs the
 * district heating network (districtHeat.ts) — it sells the heat at the
 * tariff's district heating price, buys it from the network's source, and
 * pays for the pipes' upkeep. Gas, oil and petrol/diesel are paid straight to
 * their own external suppliers, never through the municipal utility, so they
 * don't appear here even though they're billed to the consumer (see billing.ts). Cantonal
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
import { allocationApprovalFactor, approval } from "./approval";
import { GREEN_POWER_PREMIUM_RP_PER_KWH } from "../config/policy";
import { existsAt } from "./lifetime";
import { policyStore } from "./policy";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { PAYOUT_CATEGORIES, treasury, type PayoutsByCategory } from "./treasury";
import { computeHeatingTechnologyBreakdown, yearElectricity } from "./yearReport";
import { DH_NETWORK_UPKEEP_CHF_PER_M_YEAR, DH_SOURCE_HEAT_PRICE_RP_PER_KWH } from "../config/districtHeat";
import { districtHeat } from "./districtHeat";
import { publicCharging } from "./publicCharging";

export interface MunicipalFinances {
  year: number;
  consumerRevenueRp: number; // what consumers paid for grid electricity, time-of-use priced — the same rates billing.ts bills them at
  feedInPaidRp: number; // paid out to solar owners (real or adopted) for exported generation
  wholesaleCostRp: number; // paid upstream for the net electricity actually drawn from the wider grid (consumption minus all local solar)
  gridMaintenanceCostRp: number; // wires/upkeep cost, scaled to gross electricity delivered to consumers
  districtHeatRevenueRp: number; // district heat sold to connected buildings, at the tariff's district heating price
  districtHeatPurchaseRp: number; // that heat, bought from the network's source
  districtHeatUpkeepRp: number; // running the pipes, per metre of piped street
  publicChargingRevenueRp: number; // sold at the municipality's own public chargers, at the tariff's public charging prices
  publicChargingUpkeepRp: number; // keeping those chargers running
  governmentAllocationRp: number; // this year's allocation from the overall government (a placeholder framing, see config/treasury.ts)
  spendingRp: PayoutsByCategory; // the municipality's own top-ups, per kind, paid out as decisions happened this year — never the federal/cantonal grants
  spendingTotalRp: number;
  netIncomeRp: number; // every revenue line above (incl. the allocation) less every cost line and spendingTotalRp
}

const financesCache = new Map<number, MunicipalFinances>();
const financesInFlight = new Map<number, Promise<MunicipalFinances>>();

/** Every completed calendar year's municipal electricity finances, computed
 * once and cached forever after — see module doc. Read off yearReport.ts's
 * shared per-year electricity pass, and shared while in flight too: the
 * year-end report and the live treasury readout ask for the same year at
 * about the same moment. Wholesale cost is priced on *net* electricity (solar
 * directly offsets what must be bought upstream); grid maintenance is priced
 * on *gross* consumption (every consumed kWh moves through the local wires
 * regardless of how much solar also flowed the other way). */
export function computeMunicipalFinancesForYear(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<MunicipalFinances> {
  const cached = financesCache.get(year);
  if (cached) return Promise.resolve(cached);
  let inFlight = financesInFlight.get(year);
  if (!inFlight) {
    inFlight = computeFinances(buildings, realPlants, year).finally(() => financesInFlight.delete(year));
    financesInFlight.set(year, inFlight);
  }
  return inFlight;
}

async function computeFinances(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<MunicipalFinances> {
  const tariff: Tariff = tariffStore.get();
  let consumerRevenueRp = 0;
  let feedInPaidRp = 0;
  let grossConsumptionKWh = 0;
  let netElectricityKWh = 0;

  for (const { times, series } of await yearElectricity(buildings, realPlants, year)) {
    const consumptionW = consumptionSeriesW(series);
    consumerRevenueRp += electricityCostRp(times, consumptionW, tariff);
    feedInPaidRp += flatCostRp(times, series.solarW, tariff.feedInPriceRpKWh);
    grossConsumptionKWh += energyKWh(times, consumptionW);
    netElectricityKWh += energyKWh(times, consumptionW) - energyKWh(times, series.solarW);
  }

  const greenShare = policyStore.get().greenPowerShare / 100;
  const wholesaleCostRp = netElectricityKWh * (tariff.wholesalePriceRpKWh + GREEN_POWER_PREMIUM_RP_PER_KWH * greenShare);
  const gridMaintenanceCostRp = grossConsumptionKWh * tariff.gridMaintenanceRpKWh;

  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));

  // District heat: the heat delivered (the report's own heating-technology pass), and the pipes'
  // upkeep for however much of the year each stretch was in service (sampled monthly).
  const districtHeatKWh = (await computeHeatingTechnologyBreakdown(buildings, year)).districtHeatingSpaceKWh;
  const districtHeatRevenueRp = districtHeatKWh * tariff.districtHeatingPriceRpKWh;
  const districtHeatPurchaseRp = districtHeatKWh * DH_SOURCE_HEAT_PRICE_RP_PER_KWH;
  let pipedMetreYears = 0;
  for (let month = 0; month < 12; month++) pipedMetreYears += districtHeat.pipedLengthM(toSimTimeMs(Date.UTC(year, month, 15))) / 12;
  const districtHeatUpkeepRp = pipedMetreYears * DH_NETWORK_UPKEEP_CHF_PER_M_YEAR * 100;

  // The municipality's own public chargers sell at their own price. Their energy is part of the
  // town's metered consumption above, billed there at the household tariff — taken back out of
  // that line so it isn't counted twice.
  const charging = publicCharging.municipalYear(year);
  consumerRevenueRp -= charging.kWh * ((tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2);
  const publicChargingRevenueRp = charging.revenueRp;
  const publicChargingUpkeepRp = charging.upkeepRp;

  // Every household decision due this year has to have committed (and paid out) before the year is summed.
  treasury.settleThrough(yearEndMs);
  const spendingRp = treasury.paidOut(yearStartMs, yearEndMs);
  const spendingTotalRp = PAYOUT_CATEGORIES.reduce((sum, c) => sum + spendingRp[c], 0);
  const dwellingsAtYearStart = buildings.reduce((sum, b) => sum + (existsAt(b, yearStartMs) ? b.dwellings.length : 0), 0);
  const governmentAllocationRp = treasury.allocationRp(dwellingsAtYearStart, allocationApprovalFactor(approval.atYearStart(year)));
  const netIncomeRp =
    consumerRevenueRp +
    districtHeatRevenueRp +
    publicChargingRevenueRp +
    governmentAllocationRp -
    feedInPaidRp -
    wholesaleCostRp -
    gridMaintenanceCostRp -
    districtHeatPurchaseRp -
    districtHeatUpkeepRp -
    publicChargingUpkeepRp -
    spendingTotalRp;

  const result: MunicipalFinances = {
    year,
    consumerRevenueRp,
    feedInPaidRp,
    wholesaleCostRp,
    gridMaintenanceCostRp,
    districtHeatRevenueRp,
    districtHeatPurchaseRp,
    districtHeatUpkeepRp,
    publicChargingRevenueRp,
    publicChargingUpkeepRp,
    governmentAllocationRp,
    spendingRp,
    spendingTotalRp,
    netIncomeRp,
  };
  financesCache.set(year, result);
  treasury.notifyBooked(); // live readouts waiting on this year can refresh
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
  let balanceRp = treasury.openingBalanceRp();
  for (let year = baselineYear; year <= throughYear; year++) {
    if (isCancelled()) return balanceRp;
    const finances = await computeMunicipalFinancesForYear(buildings, plants, year);
    balanceRp += finances.netIncomeRp;
  }
  return balanceRp;
}

/** The same balance, but only if every year through `throughYear` is already booked — no computing. */
export function cachedCumulativeBalanceRp(throughYear: number, baselineYear: number): number | null {
  let balanceRp = treasury.openingBalanceRp();
  for (let year = baselineYear; year <= throughYear; year++) {
    const finances = financesCache.get(year);
    if (!finances) return null;
    balanceRp += finances.netIncomeRp;
  }
  return balanceRp;
}
