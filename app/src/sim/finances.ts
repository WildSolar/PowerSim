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
 * change once computed, so they're cached by year forever. Each month is
 * priced at that month's prices: the year's published tariff sheet and the
 * month's market price for wholesale power (tariffStore.ts).
 */

import type { Building, PowerPlant } from "../data/types";
import { consumptionSeriesW, electricityCostRp, flatCostRp } from "./billing";
import { toDateMs, toSimTimeMs } from "./calendar";
import { energyKWh } from "./energy";
import { allocationApprovalFactor, approval } from "./approval";
import { GREEN_POWER_PREMIUM_RP_PER_KWH } from "../config/policy";
import { existsAt } from "./lifetime";
import { policyStore } from "./policy";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { PAYOUT_CATEGORIES, treasury, type PayoutsByCategory } from "./treasury";
import { monthElectricity, monthHeatingTechnology } from "./yearReport";
import { DH_NETWORK_UPKEEP_CHF_PER_M_YEAR, DH_SOURCE_HEAT_PRICE_RP_PER_KWH } from "../config/districtHeat";
import { UTILITY_PROFIT_RETAINED_SHARE } from "../config/treasury";
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
  profitTransferRp: number; // the utility's profit handed to the municipality's general account (all but the department's share)
  zoningLevyRp: number; // value-capture levy on projects that gained from a zoning change (zoning.ts)
  borrowedRp: number; // money borrowed this year (debt.ts) — cash in, not income
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

/** One month of the municipal utility: what it sold and bought, and its networks' upkeep. */
export interface UtilityMonth {
  consumerRevenueRp: number;
  feedInPaidRp: number;
  wholesaleCostRp: number;
  gridMaintenanceCostRp: number;
  districtHeatRevenueRp: number;
  districtHeatPurchaseRp: number;
  districtHeatUpkeepRp: number;
  publicChargingRevenueRp: number;
  publicChargingUpkeepRp: number;
}

const UTILITY_KEYS: (keyof UtilityMonth)[] = [
  "consumerRevenueRp",
  "feedInPaidRp",
  "wholesaleCostRp",
  "gridMaintenanceCostRp",
  "districtHeatRevenueRp",
  "districtHeatPurchaseRp",
  "districtHeatUpkeepRp",
  "publicChargingRevenueRp",
  "publicChargingUpkeepRp",
];

/** The utility's profit (or loss) in a month. */
export function utilityProfitRp(m: UtilityMonth): number {
  return (
    m.consumerRevenueRp +
    m.districtHeatRevenueRp +
    m.publicChargingRevenueRp -
    m.feedInPaidRp -
    m.wholesaleCostRp -
    m.gridMaintenanceCostRp -
    m.districtHeatPurchaseRp -
    m.districtHeatUpkeepRp -
    m.publicChargingUpkeepRp
  );
}

/** What the department keeps of the utility's profit so far: a quarter of a profit (the rest goes
 * to the town's general account), all of a loss. */
export function departmentShareRp(profitRp: number): number {
  return profitRp - Math.max(0, profitRp) * (1 - UTILITY_PROFIT_RETAINED_SHARE);
}

/** Settled months, by year * 12 + month: once a month is over and sampled, its accounts are final. */
const utilityMonths = new Map<number, UtilityMonth>();
const utilityInFlight = new Map<number, Promise<UtilityMonth>>();

/** A month of the utility's accounts (from the month's samples, yearReport.ts), settled once and kept. */
export function settleUtilityMonth(buildings: Building[], realPlants: PowerPlant[], year: number, month: number): Promise<UtilityMonth> {
  const key = year * 12 + month;
  const settled = utilityMonths.get(key);
  if (settled) return Promise.resolve(settled);
  let inFlight = utilityInFlight.get(key);
  if (!inFlight) {
    inFlight = computeUtilityMonth(buildings, realPlants, year, month)
      .then((m) => {
        utilityMonths.set(key, m);
        treasury.notifyBooked(); // the live balance takes it in
        return m;
      })
      .finally(() => utilityInFlight.delete(key));
    utilityInFlight.set(key, inFlight);
  }
  return inFlight;
}

async function computeUtilityMonth(buildings: Building[], realPlants: PowerPlant[], year: number, month: number): Promise<UtilityMonth> {
  // The year's sheet (one per year); wholesale power at the month's market price.
  const tariff: Tariff = tariffStore.at(toSimTimeMs(Date.UTC(year, month, 15)));
  const greenShare = policyStore.get().greenPowerShare / 100;
  const { times, series, dynamicW } = await monthElectricity(buildings, realPlants, year, month);
  const consumptionW = consumptionSeriesW(series);
  const grossKWh = energyKWh(times, consumptionW);
  const netKWh = grossKWh - energyKWh(times, series.solarW);

  // District heat: the heat delivered (the report's heating-technology pass), and the pipes' upkeep.
  const districtHeatKWh = (await monthHeatingTechnology(buildings, year, month)).districtHeatingSpaceKWh;
  const pipedM = districtHeat.pipedLengthM(toSimTimeMs(Date.UTC(year, month, 15)));

  // The municipality's own public chargers sell at their own price. Their energy is part of the
  // town's metered consumption above, billed there at the household tariff — taken back out of
  // that line so it isn't counted twice.
  const charging = publicCharging.municipalMonth(year, month);
  return {
    consumerRevenueRp: electricityCostRp(times, consumptionW, tariff, dynamicW) - charging.kWh * ((tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2),
    feedInPaidRp: flatCostRp(times, series.solarW, tariff.feedInPriceRpKWh),
    wholesaleCostRp: netKWh * (tariff.wholesalePriceRpKWh + GREEN_POWER_PREMIUM_RP_PER_KWH * greenShare),
    gridMaintenanceCostRp: grossKWh * tariff.gridMaintenanceRpKWh,
    districtHeatRevenueRp: districtHeatKWh * tariff.districtHeatingPriceRpKWh,
    districtHeatPurchaseRp: districtHeatKWh * DH_SOURCE_HEAT_PRICE_RP_PER_KWH,
    districtHeatUpkeepRp: (pipedM * DH_NETWORK_UPKEEP_CHF_PER_M_YEAR * 100) / 12,
    publicChargingRevenueRp: charging.revenueRp,
    publicChargingUpkeepRp: charging.upkeepRp,
  };
}

/** The utility's settled months of a year up to `atMs`, in order from January (stopping at the
 * first not yet settled), summed. */
export function settledUtilitySoFar(year: number, atMs: number): { months: number; profitRp: number } {
  let months = 0;
  let profitRp = 0;
  for (let m = 0; m < 12; m++) {
    if (toSimTimeMs(Date.UTC(year, m + 1, 1)) > atMs) break;
    const settled = utilityMonths.get(year * 12 + m);
    if (!settled) break;
    months++;
    profitRp += utilityProfitRp(settled);
  }
  return { months, profitRp };
}

/** The government's allocation paid so far in a year: a twelfth at the start of each month. */
export function allocationSoFarRp(allocationRp: number, year: number, atMs: number): number {
  const d = new Date(toDateMs(atMs));
  const months = d.getUTCFullYear() < year ? 0 : d.getUTCFullYear() > year ? 12 : d.getUTCMonth() + 1;
  return (allocationRp * months) / 12;
}

async function computeFinances(buildings: Building[], realPlants: PowerPlant[], year: number): Promise<MunicipalFinances> {
  // The year's twelve settled months, added up.
  const utility = Object.fromEntries(UTILITY_KEYS.map((k) => [k, 0])) as unknown as UtilityMonth;
  for (let month = 0; month < 12; month++) {
    const m = await settleUtilityMonth(buildings, realPlants, year, month);
    for (const k of UTILITY_KEYS) utility[k] += m[k];
  }
  const {
    consumerRevenueRp,
    feedInPaidRp,
    wholesaleCostRp,
    gridMaintenanceCostRp,
    districtHeatRevenueRp,
    districtHeatPurchaseRp,
    districtHeatUpkeepRp,
    publicChargingRevenueRp,
    publicChargingUpkeepRp,
  } = utility;

  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));

  // Every household decision due this year has to have committed (and paid out) before the year is summed.
  treasury.settleThrough(yearEndMs);
  const spendingRp = treasury.paidOut(yearStartMs, yearEndMs);
  const spendingTotalRp = PAYOUT_CATEGORIES.reduce((sum, c) => sum + spendingRp[c], 0);
  const zoningLevyRp = treasury.received(yearStartMs, yearEndMs, "zoningLevy");
  const borrowedRp = treasury.received(yearStartMs, yearEndMs, "borrowing");
  const dwellingsAtYearStart = buildings.reduce((sum, b) => sum + (existsAt(b, yearStartMs) ? b.dwellings.length : 0), 0);
  const governmentAllocationRp = treasury.allocationRp(dwellingsAtYearStart, allocationApprovalFactor(approval.atYearStart(year)));
  // The utility's profit, most of which goes to the town's general account.
  const profitRp = utilityProfitRp(utility);
  const profitTransferRp = profitRp - departmentShareRp(profitRp);
  const netIncomeRp =
    consumerRevenueRp +
    districtHeatRevenueRp +
    publicChargingRevenueRp +
    zoningLevyRp +
    borrowedRp +
    governmentAllocationRp -
    feedInPaidRp -
    wholesaleCostRp -
    gridMaintenanceCostRp -
    districtHeatPurchaseRp -
    districtHeatUpkeepRp -
    publicChargingUpkeepRp -
    profitTransferRp -
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
    profitTransferRp,
    zoningLevyRp,
    borrowedRp,
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

/** A year's income before any discretionary spending: what the utility earns (electricity, district
 * heat, public charging, less what they cost to run), the levies, and the government's allocation —
 * what debt is measured against (debt.ts). */
export function operatingIncomeRp(f: MunicipalFinances): number {
  return (
    f.consumerRevenueRp +
    f.districtHeatRevenueRp +
    f.publicChargingRevenueRp +
    f.zoningLevyRp +
    f.governmentAllocationRp -
    f.feedInPaidRp -
    f.wholesaleCostRp -
    f.gridMaintenanceCostRp -
    f.districtHeatPurchaseRp -
    f.districtHeatUpkeepRp -
    f.publicChargingUpkeepRp -
    f.profitTransferRp
  );
}

/** What the department kept of the utility's profit in a booked year (all of a loss). */
export function departmentUtilityShareRp(f: MunicipalFinances): number {
  const profit = utilityProfitRp(f);
  return profit - f.profitTransferRp;
}

/** The latest year whose accounts are booked, if any. */
export function latestBookedFinances(): MunicipalFinances | null {
  let latest: MunicipalFinances | null = null;
  for (const f of financesCache.values()) if (!latest || f.year > latest.year) latest = f;
  return latest;
}

/** The treasury's balance at `atMs` — last year's closing balance (when booked), plus this year's
 * allocation so far (monthly), the department's share of the utility's settled months, less what
 * has been paid out, plus what has come in. Null while last year's accounts are still being
 * settled. The same sum the live treasury readout shows. */
export function liveBalanceRp(buildings: Building[], atMs: number, baselineYear: number): number | null {
  const year = new Date(toDateMs(atMs)).getUTCFullYear();
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const opening = year <= baselineYear ? treasury.openingBalanceRp() : cachedCumulativeBalanceRp(year - 1, baselineYear);
  if (opening === null) return null;
  const dwellings = buildings.reduce((sum, b) => sum + (existsAt(b, yearStartMs) ? b.dwellings.length : 0), 0);
  const allocation = treasury.allocationRp(dwellings, allocationApprovalFactor(approval.atYearStart(year)));
  const utility = departmentShareRp(settledUtilitySoFar(year, atMs).profitRp);
  return opening + allocationSoFarRp(allocation, year, atMs) + utility - treasury.paidOutTotal(yearStartMs, atMs) + treasury.received(yearStartMs, atMs);
}

/** Every booked year's accounts, oldest first. */
export function bookedFinances(): MunicipalFinances[] {
  return [...financesCache.values()].sort((a, b) => a.year - b.year);
}

// --- saving (saveGame.ts) ---

/** The booked years, and the utility's settled months of the year still open: the accounts as
 * they were settled. */
export function snapshotFinances(): { years: Map<number, MunicipalFinances>; utilityMonths: Map<number, UtilityMonth> } {
  const lastBooked = Math.max(-Infinity, ...financesCache.keys());
  return { years: financesCache, utilityMonths: new Map([...utilityMonths].filter(([key]) => Math.floor(key / 12) > lastBooked)) };
}

export function restoreFinances(saved: ReturnType<typeof snapshotFinances>): void {
  financesCache.clear();
  financesInFlight.clear();
  utilityMonths.clear();
  utilityInFlight.clear();
  for (const [year, f] of saved.years) financesCache.set(year, f);
  for (const [key, m] of saved.utilityMonths) utilityMonths.set(key, m);
}
