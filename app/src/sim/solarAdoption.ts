/**
 * Whether, when, and how big a new (non-real, player-triggered) rooftop
 * solar installation appears on a building that doesn't already have real
 * Pronovo-registered PV — the dynamic counterpart to pv.ts's static real
 * data. Three questions, matching the design discussion:
 *
 *  - What gets installed: a building's own usable-roof capacity — footprint
 *    area times a seeded usable-roof fraction (highly building-specific in
 *    real life, so randomly drawn here, expected value kept plausible —
 *    see solarSystems.ts) times whatever module efficiency is current the
 *    year it's installed.
 *  - When: NOT a fixed-lifetime wear-out cycle like renewal.ts (heating,
 *    mobility) — the vast majority of buildings have never made this
 *    decision at all, so there's no "it broke, replace it" moment forcing
 *    the question. Modeled instead as an annual hazard-rate check per
 *    still-undecided building, combining a low spontaneous baseline, a
 *    temporary boost for a few years after a heating renewal (a heat-pump
 *    switch is a natural moment to reconsider solar too), a neighborhood
 *    effect (more nearby installs, more likely to seriously consider it),
 *    and a player-controlled outreach multiplier (policy.ts).
 *  - If: reuses renewal.ts's own four-factor comparison (chooseNext) as a
 *    binary "stay without / install" choice — annualized cost is the
 *    installation's own (install cost - subsidies)/lifetime minus the
 *    avoided electricity cost + export revenue it would actually earn this
 *    building, same shape as every other stock-renewal decision.
 *
 * Architecture: dataset.powerPlants is real, static, loaded data and is
 * never mutated (same principle billing.ts/pv.ts already document for heat
 * pumps). A new adoption is a *simulated* per-building decision, computed
 * the same way heating/mobility renewals are — pure, seeded, cached forever
 * once committed. Two functions turn this cache into a real+adopted
 * PowerPlant[] a caller can drop in anywhere dataset.powerPlants was used
 * (pv.ts itself needs no changes — see each function's own doc for which to
 * use): effectivePowerPlants() for a *completed* year's own accounting
 * (emissions.ts, finances.ts, the Year in Review report), effectivePowerPlantsAt()
 * for live "right now" state (a building/dwelling panel, the map, City
 * stats) — the distinction matters because a year's adoptions are all
 * decided in one batch (below) but individually dated across that whole
 * year, so "as of right now" and "as of the end of this year" are genuinely
 * different questions.
 *
 * Unlike a per-entity renewal chain, this can't be computed independently
 * per building — the neighborhood effect means one building's outcome
 * depends on every other building's adoption history. So the whole
 * municipality is advanced one calendar year at a time (ensureAdvancedThrough),
 * cached by a single watermark year, extended incrementally exactly like
 * every other year-keyed cache in this codebase — and, like those, using
 * whatever tariff/policy is current the moment a given year is actually
 * processed, then frozen forever (tariffStore.ts's own "retroactive but
 * never rewritten" simplification). This means every adoption for a whole
 * year — including ones dated many months out — is *decided* the instant
 * that year is first queried, but effectivePowerPlantsAt still only ever
 * *reveals* one once its own installedAtMs is actually reached (the same
 * "not yet committed, don't show it" principle renewal.ts's own chains use).
 * solarAdoptionLog() reads the cache directly without buildings/realPlants,
 * and is only safe to call after one of the two functions above has already
 * advanced the relevant year earlier in the same render — true in practice
 * since every caller of solarAdoptionLog reaches it through
 * useLivePowerPlants.ts, which calls effectivePowerPlantsAt first.
 */

import type { Building, PowerPlant } from "../data/types";
import {
  BASE_ANNUAL_HAZARD,
  SOLAR_PRICE_HAZARD_ELASTICITY,
  MAX_ANNUAL_HAZARD,
  NEIGHBOR_BOOST_CAP,
  NEIGHBOR_BOOST_PER_ADOPTER,
  NEIGHBOR_RADIUS_M,
  RENEWAL_BOOST_MULTIPLIER,
  RENEWAL_BOOST_YEARS,
  SOLAR_BIAS_MAGNITUDE_RP_PER_YEAR,
  SOLAR_UNCERTAINTY_FRACTION,
} from "../config/solar";
import { NEW_BUILD_VOLUNTARY_SOLAR_SHARE } from "../config/stock";
import { consumptionSeriesW, hourOfDayAt } from "./billing";
import { toDateMs, toSimTimeMs } from "./calendar";
import { logCandidateDecision } from "./decisionLog";
import { LocalProjection, PointGrid } from "./localGeo";
import { buildingGroup } from "./buildingGroup";
import { existsAt } from "./lifetime";
import type { ConstructionRules } from "./constructionRules";
import { heatingRenewalsInRange } from "./heatingRenewal";
import { historyTimeSteps, sampleBuildingCategorySeries } from "./history";
import type { Policy } from "./policy";
import { outreachHazardMultiplier, policyStore } from "./policy";
import { hashSeed, mulberry32 } from "./rng";
import { candidateLogEntries, chooseNext, type RenewalCandidate } from "./renewal";
import {
  AGE_EXCLUSION_YEARS,
  federalSubsidyRp,
  installCostRpPerKwp,
  kwpPerM2At,
  PANEL_LIFETIME_MEAN_YEARS,
  usableRoofFractionFromDraw,
} from "./solarSystems";
import { irradianceWm2, PEAK_IRRADIANCE_WM2 } from "./pv";
import { isOffPeakHour, type Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { treasury } from "./treasury";
import { priceFactorInYear } from "./costTrends";
import { recordSubsidisedDecision } from "./additionality";
import { gridFeedInBlockedAt, SMALL_SOLAR_KWP } from "./gridLimits";
import {
  BATTERY_RETROFIT_ANNUAL_HAZARD,
  GRID_FRIENDLY_FEED_IN_CAP,
  HOME_BATTERY_CHF_PER_KWH,
  HOME_BATTERY_CYCLES_PER_YEAR,
  HOME_BATTERY_FIXED_CHF,
  HOME_BATTERY_KW_PER_KWH,
  HOME_BATTERY_KWH_PER_KWP,
  HOME_BATTERY_LIFETIME_YEARS,
  HOME_BATTERY_PREFERENCE_CHF_PER_YEAR,
  HOME_BATTERY_PREFERENCE_SPREAD_CHF_PER_YEAR,
  HOME_BATTERY_ROUND_TRIP,
  NEW_BUILD_BATTERY_SHARE,
  REGISTERED_SYSTEM_BATTERY_SHARE,
} from "../config/homeBattery";
import { interpolateCurve } from "../config/curve";
import { priceFactor } from "./costTrends";

const DAY_MS = 24 * 60 * 60_000;
const YEAR_MS = 365.25 * DAY_MS;
const HOUR_MS = 3_600_000;
const ANNUAL_SAMPLES = 288; // 24/month — same density useBillSummary.ts uses for a single building's own annual estimate

export interface SolarAdoptionRecord {
  installedAtMs: number;
  capacityKw: number;
  installCostRp: number;
  federalSubsidyRp: number;
  municipalSubsidyRp: number;
  annualSavingsRp: number;
  /** A new building's array, fixed at permit time by the construction rules rather than an owner's choice. */
  origin?: "mandate" | "voluntary" | "municipal";
}

const adoptionByEgid = new Map<string, SolarAdoptionRecord>();

/** A home battery bought (or added) by a building's owner, or put in by the municipality — the
 * registered systems' seeded batteries aren't in here (registeredBattery). */
export interface BatteryRecord {
  installedAtMs: number;
  kwh: number;
  kw: number;
  /** Grid-friendly operation (sim/homeBattery.ts), or null. */
  feedInCap: number | null;
  costRp: number;
  municipalSubsidyRp: number;
  origin: "with-solar" | "retrofit" | "new-build" | "municipal";
  /** Its array could only connect with it: the area's summer feed-in was over capacity. */
  gridCondition: boolean;
}

const batteryByEgid = new Map<string, BatteryRecord>();

/** A home battery sized for an array (config/homeBattery.ts). */
function batteryFor(capacityKw: number, feedInCap: number | null): { kwh: number; kw: number; feedInCap: number | null } {
  const kwh = Math.max(5, Math.round(capacityKw * HOME_BATTERY_KWH_PER_KWP));
  return { kwh, kw: kwh * HOME_BATTERY_KW_PER_KWH, feedInCap };
}

/** What a home battery of `kwh` costs installed at `atMs`. */
export function homeBatteryCostRp(kwh: number, atMs: number): number {
  return (HOME_BATTERY_FIXED_CHF + HOME_BATTERY_CHF_PER_KWH * kwh) * 100 * priceFactor("homeBattery", atMs);
}

/** A registered system's battery: the register doesn't record storage, so small systems get one by
 * chance, likelier the more recently they were commissioned (config/homeBattery.ts). */
const registeredBatteryCache = new WeakMap<PowerPlant, { kwh: number; kw: number; feedInCap: null } | null>();

function registeredBattery(plant: PowerPlant): { kwh: number; kw: number; feedInCap: null } | null {
  let battery = registeredBatteryCache.get(plant);
  if (battery === undefined) {
    battery = drawRegisteredBattery(plant);
    registeredBatteryCache.set(plant, battery);
  }
  return battery;
}

function drawRegisteredBattery(plant: PowerPlant): { kwh: number; kw: number; feedInCap: null } | null {
  if (plant.technology !== "Photovoltaic" || !plant.capacityKw || plant.capacityKw > SMALL_SOLAR_KWP) return null;
  const year = plant.commissioningDate ? Number(plant.commissioningDate.slice(0, 4)) : NaN;
  if (!Number.isFinite(year)) return null;
  if (mulberry32(hashSeed(plant.plantId, "registered-battery"))() >= interpolateCurve(REGISTERED_SYSTEM_BATTERY_SHARE, year)) return null;
  return { ...batteryFor(plant.capacityKw, null), feedInCap: null };
}

/** An owner's leaning towards a battery, beyond its savings (Rp a year). */
function batteryPreferenceRp(egid: string): number {
  const u = mulberry32(hashSeed(egid, "battery-preference"))();
  return (HOME_BATTERY_PREFERENCE_CHF_PER_YEAR + HOME_BATTERY_PREFERENCE_SPREAD_CHF_PER_YEAR * (2 * u - 1)) * 100;
}
let watermarkYear: number | null = null;
let neighborListCache: Map<string, string[]> | null = null;
let realPvEgidsCache: Set<string> | null = null;

function realPvEgids(realPlants: PowerPlant[]): Set<string> {
  if (!realPvEgidsCache) {
    realPvEgidsCache = new Set(realPlants.filter((p) => p.technology === "Photovoltaic" && p.egid).map((p) => p.egid as string));
  }
  return realPvEgidsCache;
}

let neighborListFor: Building[] | null = null;

/** Buildings within NEIGHBOR_RADIUS_M of each other, via a spatial grid rather than
 * an all-pairs scan (which does not scale to a 48k-building city). Rebuilt whenever
 * the stock changes (a new array identity, see stock.ts), so new buildings count
 * as neighbours too. */
function neighborList(buildings: Building[]): Map<string, string[]> {
  if (neighborListCache && neighborListFor === buildings) return neighborListCache;
  const projection = new LocalProjection(buildings[0]?.lon ?? 0, buildings[0]?.lat ?? 0);
  const grid = new PointGrid(NEIGHBOR_RADIUS_M);
  const list = new Map<string, string[]>();
  for (const b of buildings) {
    const [x, y] = projection.toXY(b.lon, b.lat);
    grid.insert(b.egid, x, y);
    list.set(b.egid, []);
  }
  for (const b of buildings) {
    const [x, y] = projection.toXY(b.lon, b.lat);
    for (const id of grid.query(x, y, NEIGHBOR_RADIUS_M)) if (id !== b.egid) list.get(b.egid)!.push(id);
  }
  neighborListCache = list;
  neighborListFor = buildings;
  return list;
}

function isEligible(building: Building, realPlants: PowerPlant[], year: number): boolean {
  if (building.footprintAreaM2 == null || building.footprintAreaM2 <= 0) return false;
  if (!existsAt(building, toSimTimeMs(Date.UTC(year, 0, 1)))) return false; // not yet built (or already demolished) at the start of the year
  if (building.constructionYear != null && year - building.constructionYear > AGE_EXCLUSION_YEARS) return false;
  if (realPvEgids(realPlants).has(building.egid)) return false;
  return true;
}

function countAdoptedNeighbors(egid: string, buildings: Building[], realPlants: PowerPlant[], yearStartMs: number): number {
  const neighbors = neighborList(buildings).get(egid) ?? [];
  const realEgids = realPvEgids(realPlants);
  let count = 0;
  for (const n of neighbors) {
    const adopted = adoptionByEgid.get(n);
    if (realEgids.has(n) || (adopted && adopted.installedAtMs < yearStartMs)) count++;
  }
  return count;
}

function hadRecentHeatingRenewal(building: Building, yearStartMs: number): boolean {
  return heatingRenewalsInRange(building, yearStartMs - RENEWAL_BOOST_YEARS * YEAR_MS, yearStartMs).length > 0;
}

function solarBiasStrengthRp(egid: string): number {
  const u = mulberry32(hashSeed(egid, "solar-bias"))();
  return (u - 0.5) * 2 * SOLAR_BIAS_MAGNITUDE_RP_PER_YEAR;
}

/** The sample instants of a year's savings estimate and the sunlight a panel would get at each —
 * the same for every roof in town, so worked out once per year's batch rather than once per
 * candidate (each instant's snow cover alone is a month of weather lookback). */
interface YearSunlight {
  times: number[];
  irradianceWm2: number[];
}

function yearSunlight(yearStartMs: number): YearSunlight {
  const times = historyTimeSteps(yearStartMs + YEAR_MS, YEAR_MS, ANNUAL_SAMPLES);
  return { times, irradianceWm2: times.map((t) => irradianceWm2(t)) };
}

/** A candidate installation's annual savings for this specific building —
 * avoided electricity cost for whatever it would self-consume, plus export
 * revenue at the feed-in rate for the rest, both priced the same way a real
 * bill is (billing.ts's own per-interval TOU logic, reimplemented here
 * against a candidate production series rather than a real one). Sampled at
 * useBillSummary.ts's own density (24/month) — coarse enough that the
 * self-consumption/export split is an approximation, not a precise
 * simulation, a known limitation worth being upfront about (see the wiki). */
function candidateEconomics(building: Building, candidateCapacityKw: number, sunlight: YearSunlight, tariff: Tariff): SolarEconomics {
  const { times, irradianceWm2: irradiance } = sunlight;
  const consumptionW = consumptionSeriesW(sampleBuildingCategorySeries(building, times, tariff, []));
  // What pv.ts's pvPowerW would give for a panel of this size, as a positive production figure.
  const ratedW = candidateCapacityKw * 1000;
  const productionW = (i: number) => ratedW * (irradiance[i] / PEAK_IRRADIANCE_WM2);
  const law = policyStore.get().feedInLimitPct / 100;
  const gridCap = Math.min(law, GRID_FRIENDLY_FEED_IN_CAP);

  const e: SolarEconomics = {
    selfUseRp: 0,
    exportKWh: 0,
    overGenLawKWh: 0,
    overFeedLawKWh: 0,
    overFeedGridKWh: 0,
    peakRpKWh: tariff.peakPriceRpKWh,
    feedInRpKWh: tariff.feedInPriceRpKWh,
  };
  const mean = (f: (j: number) => number, i: number, dtHours: number) => ((f(i - 1) + f(i)) / 2) * (dtHours / 1000);
  const selfUse = (j: number) => Math.min(consumptionW[j], productionW(j));
  const exported = (j: number) => productionW(j) - selfUse(j);
  for (let i = 1; i < times.length; i++) {
    const dtHours = (times[i] - times[i - 1]) / HOUR_MS;
    const midMs = (times[i] + times[i - 1]) / 2;
    const rate = isOffPeakHour(tariff, hourOfDayAt(midMs)) ? tariff.offPeakPriceRpKWh : tariff.peakPriceRpKWh;
    e.selfUseRp += mean(selfUse, i, dtHours) * rate;
    e.exportKWh += mean(exported, i, dtHours);
    e.overGenLawKWh += mean((j) => Math.max(0, productionW(j) - law * ratedW), i, dtHours);
    e.overFeedLawKWh += mean((j) => Math.max(0, exported(j) - law * ratedW), i, dtHours);
    e.overFeedGridKWh += mean((j) => Math.max(0, exported(j) - gridCap * ratedW), i, dtHours);
  }
  return e;
}

/** A year of an array's output, sorted by where it goes — what each way of running it earns
 * (annualValueRp). The export and the energy over each feed-in cap are before any battery. */
interface SolarEconomics {
  selfUseRp: number;
  exportKWh: number;
  /** Generation over the law's feed-in limit — curtailed without a battery. */
  overGenLawKWh: number;
  /** Feed-in over the law's limit, and over the grid-friendly cap. */
  overFeedLawKWh: number;
  overFeedGridKWh: number;
  peakRpKWh: number;
  feedInRpKWh: number;
}

type SolarOption = "solar" | "battery" | "batteryGrid";

/** What an array earns a year (Rp): the electricity it saves buying plus what it sells. A battery
 * moves some of the surplus into the evening — worth the full price rather than the feed-in price —
 * as many full cycles as it gets in a year allow; run grid-friendly it takes the midday peak first,
 * and some of that is curtailed on the sunniest days. */
function annualValueRp(e: SolarEconomics, option: SolarOption, batteryKwh: number): number {
  if (option === "solar") return e.selfUseRp + Math.max(0, e.exportKWh - e.overGenLawKWh) * e.feedInRpKWh;
  const stored = Math.min(batteryKwh * HOME_BATTERY_CYCLES_PER_YEAR, 0.6 * e.exportKWh);
  const curtailed = option === "battery" ? e.overFeedLawKWh : 0.35 * e.overFeedGridKWh;
  return e.selfUseRp + stored * HOME_BATTERY_ROUND_TRIP * e.peakRpKWh + Math.max(0, e.exportKWh - stored - curtailed) * e.feedInRpKWh;
}

/** What the municipality pays towards a battery of `kwh` costing `costRp`, run grid-friendly or not. */
function batterySubsidyRp(policy: Policy, kwh: number, costRp: number, gridFriendly: boolean): number {
  if (policy.homeBatterySubsidyGridFriendly && !gridFriendly) return 0;
  return Math.min(costRp, kwh * policy.homeBatterySubsidyRpPerKwh);
}

interface HazardContext {
  hazard: number;
  draw: number;
  neighborAdopters: number;
  renewalBoosted: boolean;
}

function evaluateAdoption(
  building: Building,
  year: number,
  yearStartMs: number,
  sunlight: YearSunlight,
  tariff: Tariff,
  policy: Policy,
  hazardContext: HazardContext,
): SolarAdoptionRecord | null {
  const usableDraw = mulberry32(hashSeed(building.egid, "solar-usable-fraction"))();
  const usableFraction = usableRoofFractionFromDraw(usableDraw);
  const capacityKw = (building.footprintAreaM2 ?? 0) * usableFraction * kwpPerM2At(year);
  if (capacityKw <= 0) return null;
  // A large array can't connect plainly while its area's summer feed-in is over the grid's capacity —
  // only with a battery run grid-friendly, which keeps its feed-in to half its rating.
  const gridBlocked = capacityKw > SMALL_SOLAR_KWP && gridFeedInBlockedAt(building, yearStartMs);

  const installCostRp = capacityKw * installCostRpPerKwp(capacityKw, priceFactorInYear("solar", year));
  const federalRp = federalSubsidyRp(capacityKw);
  const municipalRp = Math.max(0, Math.min(capacityKw * policy.solarSubsidyRpPerKwp + policy.solarSubsidyFixedRp, installCostRp - federalRp));
  const subsidyRp = federalRp + municipalRp;

  const economics = candidateEconomics(building, capacityKw, sunlight, tariff);
  const battery = batteryFor(capacityKw, null);
  const batteryCostRp = homeBatteryCostRp(battery.kwh, toSimTimeMs(Date.UTC(year, 6, 1)));
  const batterySubsidy = { battery: batterySubsidyRp(policy, battery.kwh, batteryCostRp, false), batteryGrid: batterySubsidyRp(policy, battery.kwh, batteryCostRp, true) };
  // Grid-friendly operation is on offer when the grid requires it, or the subsidy pays only for it.
  const offerGridFriendly = gridBlocked || (policy.homeBatterySubsidyGridFriendly && policy.homeBatterySubsidyRpPerKwh > 0);
  const preferenceRp = batteryPreferenceRp(building.egid);
  const panelsRp = (installCostRp - subsidyRp) / PANEL_LIFETIME_MEAN_YEARS;

  type Choice = "none" | SolarOption;
  const option = (id: SolarOption, available: boolean): RenewalCandidate<Choice> => {
    const withBattery = id !== "solar";
    const batteryRp = withBattery ? (batteryCostRp - batterySubsidy[id]) / HOME_BATTERY_LIFETIME_YEARS - preferenceRp : 0;
    return {
      id,
      available,
      annualizedCostRp: panelsRp + batteryRp - annualValueRp(economics, id, battery.kwh),
      lifetimeMeanYears: PANEL_LIFETIME_MEAN_YEARS,
      greenness: 1,
    };
  };
  const candidates: RenewalCandidate<Choice>[] = [
    { id: "none", available: true, annualizedCostRp: 0, lifetimeMeanYears: PANEL_LIFETIME_MEAN_YEARS, greenness: 0 },
    option("solar", !gridBlocked),
    option("battery", !gridBlocked),
    ...(offerGridFriendly ? [option("batteryGrid", true)] : []),
  ];
  const biasRp = solarBiasStrengthRp(building.egid);
  const uncertainty = SOLAR_UNCERTAINTY_FRACTION * policy.uncertaintyMultiplier;
  const choose = (cs: RenewalCandidate<Choice>[]) => chooseNext(cs, "none", uncertainty, biasRp + policy.progressiveNudgeRp).chosen;
  const chosen = choose(candidates);
  const chosenBatterySubsidyRp = chosen === "battery" || chosen === "batteryGrid" ? batterySubsidy[chosen] : 0;
  // The ground truth for evaluation studies: the same decision without each municipal payment.
  const additional =
    chosen !== "none" && municipalRp > 0
      ? choose(candidates.map((c) => (c.id === "none" ? c : { ...c, annualizedCostRp: c.annualizedCostRp + municipalRp / PANEL_LIFETIME_MEAN_YEARS }))) === "none"
      : false;
  const batteryAdditional =
    chosenBatterySubsidyRp > 0
      ? !["battery", "batteryGrid"].includes(
          choose(
            candidates.map((c) =>
              c.id === "battery" || c.id === "batteryGrid" ? { ...c, annualizedCostRp: c.annualizedCostRp + batterySubsidy[c.id] / HOME_BATTERY_LIFETIME_YEARS } : c,
            ),
          ),
        )
      : false;

  logCandidateDecision({
    atMs: yearStartMs,
    kind: "solar",
    egid: building.egid,
    entityKey: `${building.egid}:solar`,
    incumbent: "none",
    chosen,
    reasonKind: chosen === "none" ? "inKind" : gridBlocked && chosen === "batteryGrid" ? "forcedByAvailability" : "financial",
    candidates: candidateLogEntries(candidates, biasRp, (id) => SOLAR_OPTION_LABEL[id]),
    uncertaintyFraction: SOLAR_UNCERTAINTY_FRACTION,
    biasStrengthRp: biasRp,
    extra: {
      hazard: hazardContext.hazard,
      hazardDraw: hazardContext.draw,
      neighborAdopters: hazardContext.neighborAdopters,
      renewalBoosted: hazardContext.renewalBoosted,
      capacityKw,
      installCostRp,
      federalSubsidyRp: federalRp,
      municipalSubsidyRp: municipalRp,
      batteryKwh: battery.kwh,
      batteryCostRp,
      batteryPreferenceRp: preferenceRp,
      gridBlocked,
    },
  });

  if (chosen === "none") return null;

  const dayOffset = Math.floor(mulberry32(hashSeed(building.egid, "solar-install-day", String(year)))() * 365);
  const installedAtMs = yearStartMs + dayOffset * DAY_MS;
  if (municipalRp > 0) recordSubsidisedDecision({ atMs: installedAtMs, category: "solar", subsidyRp: municipalRp, additional });
  if (chosen !== "solar") {
    batteryByEgid.set(building.egid, {
      installedAtMs,
      ...batteryFor(capacityKw, chosen === "batteryGrid" ? GRID_FRIENDLY_FEED_IN_CAP : null),
      costRp: batteryCostRp,
      municipalSubsidyRp: chosenBatterySubsidyRp,
      origin: "with-solar",
      gridCondition: gridBlocked,
    });
    if (chosenBatterySubsidyRp > 0) {
      treasury.recordPayout("solar", installedAtMs, chosenBatterySubsidyRp, building.egid);
      recordSubsidisedDecision({ atMs: installedAtMs, category: "battery", subsidyRp: chosenBatterySubsidyRp, additional: batteryAdditional });
    }
  }
  return {
    installedAtMs,
    capacityKw,
    installCostRp,
    federalSubsidyRp: federalRp,
    municipalSubsidyRp: municipalRp,
    annualSavingsRp: annualValueRp(economics, chosen, battery.kwh),
  };
}

const SOLAR_OPTION_LABEL: Record<"none" | SolarOption, string> = {
  none: "Stay without",
  solar: "Install solar",
  battery: "Solar with a battery",
  batteryGrid: "Solar with a grid-friendly battery",
};

/** An owner with solar and no battery looks into adding one (a few a year): worth it against the
 * extra evening use of the array's own electricity, the price, any subsidy and their leaning. */
function considerBatteryRetrofit(building: Building, capacityKw: number, year: number, yearStartMs: number, sunlight: YearSunlight, tariff: Tariff, policy: Policy): void {
  const economics = candidateEconomics(building, capacityKw, sunlight, tariff);
  const battery = batteryFor(capacityKw, null);
  const costRp = homeBatteryCostRp(battery.kwh, toSimTimeMs(Date.UTC(year, 6, 1)));
  const subsidy = { battery: batterySubsidyRp(policy, battery.kwh, costRp, false), batteryGrid: batterySubsidyRp(policy, battery.kwh, costRp, true) };
  const preferenceRp = batteryPreferenceRp(building.egid);
  const withoutRp = annualValueRp(economics, "solar", battery.kwh);
  type Choice = "none" | "battery" | "batteryGrid";
  const option = (id: "battery" | "batteryGrid"): RenewalCandidate<Choice> => ({
    id,
    available: true,
    annualizedCostRp: (costRp - subsidy[id]) / HOME_BATTERY_LIFETIME_YEARS - preferenceRp - (annualValueRp(economics, id, battery.kwh) - withoutRp),
    lifetimeMeanYears: HOME_BATTERY_LIFETIME_YEARS,
    greenness: 0.5,
  });
  const candidates: RenewalCandidate<Choice>[] = [
    { id: "none", available: true, annualizedCostRp: 0, lifetimeMeanYears: HOME_BATTERY_LIFETIME_YEARS, greenness: 0 },
    option("battery"),
    ...(policy.homeBatterySubsidyGridFriendly && policy.homeBatterySubsidyRpPerKwh > 0 ? [option("batteryGrid")] : []),
  ];
  const biasRp = solarBiasStrengthRp(building.egid);
  const uncertainty = SOLAR_UNCERTAINTY_FRACTION * policy.uncertaintyMultiplier;
  const choose = (cs: RenewalCandidate<Choice>[]) => chooseNext(cs, "none", uncertainty, biasRp + policy.progressiveNudgeRp).chosen;
  const chosen = choose(candidates);
  logCandidateDecision({
    atMs: yearStartMs,
    kind: "solar",
    egid: building.egid,
    entityKey: `${building.egid}:battery`,
    incumbent: "none",
    chosen,
    reasonKind: chosen === "none" ? "inKind" : "financial",
    candidates: candidateLogEntries(candidates, biasRp, (id) => (id === "none" ? "Stay without a battery" : id === "battery" ? "Add a battery" : "Add a grid-friendly battery")),
    uncertaintyFraction: SOLAR_UNCERTAINTY_FRACTION,
    biasStrengthRp: biasRp,
    extra: { capacityKw, batteryKwh: battery.kwh, batteryCostRp: costRp, batteryPreferenceRp: preferenceRp },
  });
  if (chosen === "none") return;
  const installedAtMs = yearStartMs + Math.floor(mulberry32(hashSeed(building.egid, "battery-install-day", String(year)))() * 365) * DAY_MS;
  const subsidyRp = subsidy[chosen];
  batteryByEgid.set(building.egid, {
    installedAtMs,
    ...batteryFor(capacityKw, chosen === "batteryGrid" ? GRID_FRIENDLY_FEED_IN_CAP : null),
    costRp,
    municipalSubsidyRp: subsidyRp,
    origin: "retrofit",
    gridCondition: false,
  });
  if (subsidyRp > 0) {
    treasury.recordPayout("solar", installedAtMs, subsidyRp, building.egid);
    const additional = choose(candidates.map((c) => (c.id === "none" ? c : { ...c, annualizedCostRp: c.annualizedCostRp + subsidy[c.id] / HOME_BATTERY_LIFETIME_YEARS }))) === "none";
    recordSubsidisedDecision({ atMs: installedAtMs, category: "battery", subsidyRp, additional });
  }
}

const MUNICIPAL_SOLAR_MIN_FOOTPRINT_M2 = 200;

/** The public buildings the "Solar on public buildings" measure can still put panels on at `atMs`:
 * standing, with a roof big enough, and no solar yet (nor any on order). */
export function municipalSolarCandidates(buildings: Building[], realPlants: PowerPlant[], atMs: number): Building[] {
  const realEgids = realPvEgids(realPlants);
  return buildings.filter(
    (b) =>
      buildingGroup(b) === "public" &&
      (b.footprintAreaM2 ?? 0) >= MUNICIPAL_SOLAR_MIN_FOOTPRINT_M2 &&
      existsAt(b, atMs) &&
      !adoptionByEgid.has(b.egid) &&
      !realEgids.has(b.egid),
  );
}

/** The battery the municipality's array on `building` needs: a grid-friendly one when the area's
 * summer feed-in is over capacity and the array is large, otherwise none. */
function municipalBatteryFor(building: Building, capacityKw: number, atMs: number): { kwh: number; kw: number; feedInCap: number | null } | null {
  return capacityKw > SMALL_SOLAR_KWP && gridFeedInBlockedAt(building, atMs) ? batteryFor(capacityKw, GRID_FRIENDLY_FEED_IN_CAP) : null;
}

/** The municipality puts solar on some of its own (public) buildings this year — a measure, not an
 * owner's decision: full usable roof, paid for by the treasury (less the federal payment every
 * installation gets), generating from the install date. */
function installMunicipalSolar(buildings: Building[], realPlants: PowerPlant[], year: number, yearStartMs: number): void {
  const perYear = policyStore.get().municipalSolarBuildingsPerYear;
  if (perYear <= 0) return;
  const whole = Math.floor(perYear);
  const count = whole + (mulberry32(hashSeed("municipal-solar-count", String(year)))() < perYear - whole ? 1 : 0);
  const candidates = municipalSolarCandidates(buildings, realPlants, yearStartMs).sort(
    (a, b) => hashSeed(a.egid, "municipal-solar", String(year)) - hashSeed(b.egid, "municipal-solar", String(year)),
  );
  for (const building of candidates.slice(0, count)) {
    const usable = usableRoofFractionFromDraw(mulberry32(hashSeed(building.egid, "solar-usable-fraction"))());
    const capacityKw = (building.footprintAreaM2 ?? 0) * usable * kwpPerM2At(year);
    if (capacityKw <= 0) continue;
    const installCostRp = capacityKw * installCostRpPerKwp(capacityKw, priceFactorInYear("solar", year));
    const federalRp = federalSubsidyRp(capacityKw);
    const dayOffset = Math.floor(mulberry32(hashSeed(building.egid, "municipal-solar-day", String(year)))() * 365);
    const installedAtMs = yearStartMs + dayOffset * DAY_MS;
    const battery = municipalBatteryFor(building, capacityKw, yearStartMs);
    if (battery) {
      const costRp = homeBatteryCostRp(battery.kwh, installedAtMs);
      batteryByEgid.set(building.egid, { installedAtMs, ...battery, costRp, municipalSubsidyRp: 0, origin: "municipal", gridCondition: true });
      treasury.recordPayout("infrastructure", installedAtMs, costRp, building.egid);
    }
    adoptionByEgid.set(building.egid, {
      installedAtMs,
      capacityKw,
      installCostRp,
      federalSubsidyRp: federalRp,
      municipalSubsidyRp: 0,
      annualSavingsRp: 0,
      origin: "municipal",
    });
    treasury.recordPayout("infrastructure", installedAtMs, Math.max(0, installCostRp - federalRp), building.egid);
  }
}

const MUNICIPAL_SOLAR_INSTALL_MONTHS = 3;

/** What putting solar on one public building at `atMs` would mean: its full usable roof, and what
 * the treasury pays for it (the price less the federal payment). Null if it has solar already (or
 * has it coming) or no roof to speak of. */
export function municipalSolarQuote(building: Building, realPlants: PowerPlant[], atMs: number): { capacityKw: number; costRp: number; batteryKwh: number | null } | null {
  if (adoptionByEgid.has(building.egid) || realPvEgids(realPlants).has(building.egid)) return null;
  const year = new Date(toDateMs(atMs)).getUTCFullYear();
  const usable = usableRoofFractionFromDraw(mulberry32(hashSeed(building.egid, "solar-usable-fraction"))());
  const capacityKw = (building.footprintAreaM2 ?? 0) * usable * kwpPerM2At(year);
  if (capacityKw <= 0) return null;
  const installCostRp = capacityKw * installCostRpPerKwp(capacityKw, priceFactorInYear("solar", year));
  // In a full area, a large array connects only with a grid-friendly battery.
  const battery = municipalBatteryFor(building, capacityKw, atMs);
  const batteryRp = battery ? homeBatteryCostRp(battery.kwh, atMs) : 0;
  return { capacityKw, costRp: Math.max(0, installCostRp - federalSubsidyRp(capacityKw)) + batteryRp, batteryKwh: battery?.kwh ?? null };
}

/** The municipality orders solar for one of its buildings now (the Public buildings layer): paid
 * today, generating once installed a few months on — the same as the measure does, but chosen. */
export function installMunicipalSolarNow(building: Building, realPlants: PowerPlant[], atMs: number): boolean {
  const quote = municipalSolarQuote(building, realPlants, atMs);
  if (!quote) return false;
  const year = new Date(toDateMs(atMs)).getUTCFullYear();
  const installCostRp = quote.capacityKw * installCostRpPerKwp(quote.capacityKw, priceFactorInYear("solar", year));
  const installedAtMs = atMs + MUNICIPAL_SOLAR_INSTALL_MONTHS * (YEAR_MS / 12);
  const battery = municipalBatteryFor(building, quote.capacityKw, atMs);
  if (battery) {
    batteryByEgid.set(building.egid, { installedAtMs, ...battery, costRp: homeBatteryCostRp(battery.kwh, atMs), municipalSubsidyRp: 0, origin: "municipal", gridCondition: true });
  }
  adoptionByEgid.set(building.egid, {
    installedAtMs,
    capacityKw: quote.capacityKw,
    installCostRp,
    federalSubsidyRp: federalSubsidyRp(quote.capacityKw),
    municipalSubsidyRp: 0,
    annualSavingsRp: 0,
    origin: "municipal",
  });
  treasury.recordPayout("infrastructure", atMs, quote.costRp, building.egid);
  return true;
}

/** A building's solar: its capacity, and when it was or will be installed (a register plant has
 * been there all along). Null without. */
export function solarStatusOf(building: Building, realPlants: PowerPlant[]): { capacityKw: number; installedAtMs: number } | null {
  if (realPvEgids(realPlants).has(building.egid)) {
    const kw = realPlants.filter((p) => p.egid === building.egid && p.technology === "Photovoltaic").reduce((sum, p) => sum + (p.capacityKw ?? 0), 0);
    return { capacityKw: kw, installedAtMs: Number.NEGATIVE_INFINITY };
  }
  const record = adoptionByEgid.get(building.egid);
  return record ? { capacityKw: record.capacityKw, installedAtMs: record.installedAtMs } : null;
}

function processYear(buildings: Building[], realPlants: PowerPlant[], year: number): void {
  const policy = policyStore.get();
  const tariff = tariffStore.get();
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  installMunicipalSolar(buildings, realPlants, year, yearStartMs);

  let sunlight: YearSunlight | undefined;
  const priceMultiplier = Math.pow(1 / priceFactorInYear("solar", year), SOLAR_PRICE_HAZARD_ELASTICITY);
  for (const building of buildings) {
    if (adoptionByEgid.has(building.egid)) continue;
    if (!isEligible(building, realPlants, year)) continue;

    const neighborAdopters = countAdoptedNeighbors(building.egid, buildings, realPlants, yearStartMs);
    const renewalBoosted = hadRecentHeatingRenewal(building, yearStartMs);
    const renewalBoost = renewalBoosted ? RENEWAL_BOOST_MULTIPLIER : 1;
    const neighborMultiplier = 1 + Math.min(NEIGHBOR_BOOST_CAP - 1, neighborAdopters * NEIGHBOR_BOOST_PER_ADOPTER);
    const hazard = Math.min(MAX_ANNUAL_HAZARD, BASE_ANNUAL_HAZARD * renewalBoost * neighborMultiplier * outreachHazardMultiplier(policy) * priceMultiplier);

    const draw = mulberry32(hashSeed(building.egid, "solar-hazard", String(year)))();
    if (draw >= hazard) continue;

    sunlight ??= yearSunlight(yearStartMs);
    const decision = evaluateAdoption(building, year, yearStartMs, sunlight, tariff, policy, { hazard, draw, neighborAdopters, renewalBoosted });
    if (decision) {
      adoptionByEgid.set(building.egid, decision);
      treasury.recordPayout("solar", decision.installedAtMs, decision.municipalSubsidyRp, building.egid);
    }
  }

  // Owners of a system without a battery who look into adding one.
  const registered = registeredCapacityByEgid(realPlants);
  for (const building of buildings) {
    if (batteryByEgid.has(building.egid) || !existsAt(building, yearStartMs)) continue;
    const adopted = adoptionByEgid.get(building.egid);
    const capacityKw = adopted && adopted.installedAtMs < yearStartMs ? adopted.capacityKw : (registered.get(building.egid)?.kw ?? 0);
    if (capacityKw <= 0 || registered.get(building.egid)?.hasBattery) continue;
    const draw = mulberry32(hashSeed(building.egid, "battery-retrofit", String(year)))();
    if (draw >= BATTERY_RETROFIT_ANNUAL_HAZARD * outreachHazardMultiplier(policy)) continue;
    sunlight ??= yearSunlight(yearStartMs);
    considerBatteryRetrofit(building, capacityKw, year, yearStartMs, sunlight, tariff, policy);
  }
}

let registeredCapacityCache: { plants: PowerPlant[]; byEgid: Map<string, { kw: number; hasBattery: boolean }> } | null = null;

/** Each building's registered solar capacity, and whether it has a battery by the register's seeded
 * share. */
function registeredCapacityByEgid(realPlants: PowerPlant[]): Map<string, { kw: number; hasBattery: boolean }> {
  if (registeredCapacityCache?.plants === realPlants) return registeredCapacityCache.byEgid;
  const byEgid = new Map<string, { kw: number; hasBattery: boolean }>();
  for (const p of realPlants) {
    if (p.technology !== "Photovoltaic" || !p.egid || !p.capacityKw) continue;
    const entry = byEgid.get(p.egid) ?? { kw: 0, hasBattery: false };
    entry.kw += p.capacityKw;
    entry.hasBattery ||= registeredBattery(p) !== null;
    byEgid.set(p.egid, entry);
  }
  registeredCapacityCache = { plants: realPlants, byEgid };
  return byEgid;
}

function ensureAdvancedThrough(buildings: Building[], realPlants: PowerPlant[], targetYear: number): void {
  if (watermarkYear === null) watermarkYear = targetYear - 1;
  for (let year = watermarkYear + 1; year <= targetYear; year++) {
    processYear(buildings, realPlants, year);
    watermarkYear = year;
  }
}

const buildingLookupCache = new WeakMap<Building[], Map<string, Building>>();

function buildingLookup(buildings: Building[]): Map<string, Building> {
  let lookup = buildingLookupCache.get(buildings);
  if (!lookup) {
    lookup = new Map(buildings.map((b) => [b.egid, b]));
    buildingLookupCache.set(buildings, lookup);
  }
  return lookup;
}

/** Real registry plants, each closed off at its building demolition (a plant is
 * a physical thing on that roof: it goes when the roof does), and with its battery — the register's
 * seeded one, or one added since (in service before `cutoffMs`), on the building's first plant.
 * Only the plants that need either are copied. */
function realPlantsWithDemolitions(buildings: Building[], realPlants: PowerPlant[], cutoffMs: number): PowerPlant[] {
  const lookup = buildingLookup(buildings);
  const batteryPlaced = new Set<string>();
  return realPlants.map((plant) => {
    const demolishedAtMs = plant.egid ? lookup.get(plant.egid)?.demolishedAtMs : undefined;
    let battery: PowerPlant["battery"] | null = registeredBattery(plant);
    if (!battery && plant.egid && plant.technology === "Photovoltaic" && !batteryPlaced.has(plant.egid)) {
      const record = batteryByEgid.get(plant.egid);
      if (record && record.installedAtMs < cutoffMs) {
        battery = { kwh: record.kwh, kw: record.kw, feedInCap: record.feedInCap };
        batteryPlaced.add(plant.egid);
      }
    }
    if (demolishedAtMs === undefined && !battery) return plant;
    return { ...plant, ...(demolishedAtMs !== undefined ? { activeToMs: demolishedAtMs } : {}), ...(battery ? { battery } : {}) };
  });
}

function synthesizedPlants(buildings: Building[], cutoffMs: number): PowerPlant[] {
  const lookup = buildingLookup(buildings);
  const synthesized: PowerPlant[] = [];
  for (const [egid, record] of adoptionByEgid) {
    if (record.installedAtMs >= cutoffMs) continue;
    const battery = batteryByEgid.get(egid);
    synthesized.push({
      ...(battery && battery.installedAtMs < cutoffMs ? { battery: { kwh: battery.kwh, kw: battery.kw, feedInCap: battery.feedInCap } } : {}),
      plantId: `solar-adopted:${egid}`,
      // Position is unused: generation (pv.ts) keys off capacity/technology only,
      // and the map keys solar coloring off egid, not a plant's own lon/lat.
      lon: 0,
      lat: 0,
      capacityKw: record.capacityKw,
      technology: "Photovoltaic",
      commissioningDate: null,
      egid,
      activeToMs: lookup.get(egid)?.demolishedAtMs,
    });
  }
  return synthesized;
}

/** Real Pronovo plants plus every adoption already committed by the end of
 * `year` — for a *completed* year's own accounting (emissions.ts, finances.ts,
 * the Year in Review report's own tally): everything decided during that
 * calendar year counts as installed for the whole year it was decided in.
 * NOT for live "right now" state — see effectivePowerPlantsAt below for why
 * that needs a different cutoff. Safe to call repeatedly; advancing the
 * schedule is idempotent. */
export function effectivePowerPlants(buildings: Building[], realPlants: PowerPlant[], year: number): PowerPlant[] {
  ensureAdvancedThrough(buildings, realPlants, year);
  const cutoffMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  return [...realPlantsWithDemolitions(buildings, realPlants, cutoffMs), ...synthesizedPlants(buildings, cutoffMs)];
}

/** Real Pronovo plants plus every adoption already reached as of the exact
 * simulated instant `simTimeMs` — for live state (a building/dwelling panel,
 * the map's live layers, City stats). Processing a year's adoptions happens
 * in one batch the moment that year is first queried (see module doc), which
 * can commit an install date many months in the *future* relative to
 * `simTimeMs` (an install randomly drawn for October, decided the moment
 * January 1 is reached) — effectivePowerPlants' whole-year cutoff would
 * wrongly show that generating from New Year's Day. This filters by the
 * precise instant instead, the same "not yet reached, don't reveal it"
 * principle renewal.ts's own chains already use. */
export function effectivePowerPlantsAt(buildings: Building[], realPlants: PowerPlant[], simTimeMs: number): PowerPlant[] {
  const year = new Date(toDateMs(simTimeMs)).getUTCFullYear();
  ensureAdvancedThrough(buildings, realPlants, year);
  return [...realPlantsWithDemolitions(buildings, realPlants, simTimeMs), ...synthesizedPlants(buildings, simTimeMs)];
}

/** A new or replacement building rooftop array, decided at permit time: the
 * building code (and any solar mandate policy) sets a floor, and otherwise the owner
 * either covers the whole usable roof or installs nothing beyond the minimum, by
 * chance. Installed the day the building is finished. Never touches the municipal
 * subsidy ledger (the federal one-off subsidy still applies). */
export function registerNewBuildSolar(building: Building, builtAtMs: number, rules: ConstructionRules, voluntaryDraw: number): void {
  const year = new Date(toDateMs(builtAtMs)).getUTCFullYear();
  const usableFraction = usableRoofFractionFromDraw(mulberry32(hashSeed(building.egid, "solar-usable-fraction"))());
  const usableCapacityKw = (building.footprintAreaM2 ?? 0) * usableFraction * kwpPerM2At(year);
  if (usableCapacityKw <= 0) return;

  const codeKw = ((building.energyReferenceAreaM2 ?? 0) * rules.minSolarWPerM2Ebf) / 1000;
  const mandatedFraction = (building.footprintAreaM2 ?? 0) >= rules.solarMandateMinFootprintM2 ? rules.solarMandateFraction : 0;
  const requiredKw = Math.min(usableCapacityKw, Math.max(codeKw, mandatedFraction * usableCapacityKw));
  const voluntary = voluntaryDraw < NEW_BUILD_VOLUNTARY_SOLAR_SHARE;
  // A voluntary array comes with a battery by chance; a large one in a full area takes a
  // grid-friendly battery (the price of connecting the whole roof, on a new building's budget). What
  // the building code requires always connects.
  const capacityKw = voluntary ? usableCapacityKw : requiredKw;
  const gridBlocked = voluntary && capacityKw > SMALL_SOLAR_KWP && gridFeedInBlockedAt(building, builtAtMs);
  const withBattery = gridBlocked || (voluntary && mulberry32(hashSeed(building.egid, "new-build-battery"))() < NEW_BUILD_BATTERY_SHARE);
  if (capacityKw > 0 && withBattery) {
    const battery = batteryFor(capacityKw, gridBlocked ? GRID_FRIENDLY_FEED_IN_CAP : null);
    batteryByEgid.set(building.egid, { installedAtMs: builtAtMs, ...battery, costRp: homeBatteryCostRp(battery.kwh, builtAtMs), municipalSubsidyRp: 0, origin: "new-build", gridCondition: gridBlocked });
  }

  logCandidateDecision({
    atMs: builtAtMs,
    kind: "construction",
    egid: building.egid,
    entityKey: `${building.egid}:new-build-solar`,
    incumbent: null,
    chosen: capacityKw > 0 ? "solar" : "none",
    reasonKind: voluntary ? "voluntary" : "mandate",
    candidates: [],
    extra: { usableCapacityKw, requiredKw, capacityKw, codeKw, mandateFraction: rules.solarMandateFraction },
  });
  if (capacityKw <= 0) return;

  adoptionByEgid.set(building.egid, {
    installedAtMs: builtAtMs,
    capacityKw,
    installCostRp: capacityKw * installCostRpPerKwp(capacityKw, priceFactorInYear("solar", year)),
    federalSubsidyRp: federalSubsidyRp(capacityKw),
    municipalSubsidyRp: 0,
    annualSavingsRp: 0,
    origin: voluntary ? "voluntary" : "mandate",
  });
}

export interface SolarAdoptionLogEntry {
  installedAtMs: number;
  note: string;
}

/** This building's own adoption, as a player-facing log entry — reads the
 * cache directly (see module doc for why that's safe here), so callers must
 * have already called effectivePowerPlants for at least this simulated
 * year somewhere earlier in the same render. Empty until adopted, and
 * forever after that one entry (no panel end-of-life renewal modeled yet —
 * a panel's ~28yr life is close to the whole game horizon). */
export function solarAdoptionLog(building: Building, simTimeMs: number): SolarAdoptionLogEntry[] {
  const entries = solarOnlyLog(building, simTimeMs);
  const battery = batteryByEgid.get(building.egid);
  if (battery && battery.installedAtMs <= simTimeMs) entries.push({ installedAtMs: battery.installedAtMs, note: batteryNote(battery) });
  return entries.sort((a, b) => a.installedAtMs - b.installedAtMs);
}

function batteryNote(b: BatteryRecord): string {
  const size = `${b.kwh.toFixed(0)} kWh`;
  const run = b.feedInCap !== null ? `, run grid-friendly (feed-in held to ${Math.round(b.feedInCap * 100)}% of the panels' rating)` : "";
  const subsidy = b.municipalSubsidyRp > 0 ? ", with the municipality's battery subsidy" : "";
  if (b.origin === "municipal") return `The municipality added a ${size} battery${run}: without it the grid here couldn't take the array's feed-in.`;
  if (b.gridCondition) return `A ${size} battery came with the panels${run} — the grid operator's condition for connecting the array in a full area${subsidy}.`;
  if (b.origin === "retrofit") return `A ${size} battery was added to the solar system${run}${subsidy}.`;
  if (b.origin === "new-build") return `A ${size} battery came with the new building's panels${run}.`;
  return `A ${size} battery came with the panels${run}${subsidy}.`;
}

function solarOnlyLog(building: Building, simTimeMs: number): SolarAdoptionLogEntry[] {
  const record = adoptionByEgid.get(building.egid);
  if (!record || record.installedAtMs > simTimeMs) return [];
  if (record.origin === "municipal") {
    return [{ installedAtMs: record.installedAtMs, note: `The municipality put solar panels on this public building: ${record.capacityKw.toFixed(1)} kWp, paid from the treasury.` }];
  }
  if (record.origin) {
    const why = record.origin === "mandate" ? "the minimum the building rules required" : "the whole usable roof, beyond what the rules required";
    return [{ installedAtMs: record.installedAtMs, note: `Solar panels came with the new building: ${record.capacityKw.toFixed(1)} kWp, ${why}.` }];
  }
  const totalSubsidyRp = record.federalSubsidyRp + record.municipalSubsidyRp;
  const subsidyNote = totalSubsidyRp > 0 ? ` after ${subsidyNoteFragment(record)}` : "";
  const note = `Solar panels were installed on the roof — ${record.capacityKw.toFixed(1)} kWp, a decision that penciled out against the electricity it would save and export${subsidyNote}.`;
  return [{ installedAtMs: record.installedAtMs, note }];
}

function subsidyNoteFragment(record: SolarAdoptionRecord): string {
  const parts: string[] = [];
  if (record.federalSubsidyRp > 0) parts.push("the federal one-time subsidy");
  if (record.municipalSubsidyRp > 0) parts.push("the municipality's own top-up");
  return `${parts.join(" and ")}`;
}

export interface SolarAdoptionYearTally {
  count: number;
  totalCapacityKw: number;
  /** Home batteries put in this year: with new systems, and added to existing ones. */
  batteriesWithSolar: number;
  batteriesAdded: number;
}

/** How many buildings adopted solar, and how much capacity, within the
 * given calendar year — yearReport.ts's own per-year renewal tallies. */
export function solarAdoptionTallyForYear(buildings: Building[], realPlants: PowerPlant[], year: number): SolarAdoptionYearTally {
  ensureAdvancedThrough(buildings, realPlants, year);
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  let count = 0;
  let totalCapacityKw = 0;
  for (const record of adoptionByEgid.values()) {
    if (record.installedAtMs >= yearStartMs && record.installedAtMs < yearEndMs) {
      count++;
      totalCapacityKw += record.capacityKw;
    }
  }
  let batteriesWithSolar = 0;
  let batteriesAdded = 0;
  for (const b of batteryByEgid.values()) {
    if (b.installedAtMs < yearStartMs || b.installedAtMs >= yearEndMs) continue;
    if (b.origin === "retrofit") batteriesAdded++;
    else batteriesWithSolar++;
  }
  return { count, totalCapacityKw, batteriesWithSolar, batteriesAdded };
}
