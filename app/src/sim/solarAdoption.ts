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
import { pvPowerW } from "./pv";
import { isOffPeakHour, type Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";

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
  origin?: "mandate" | "voluntary";
}

const adoptionByEgid = new Map<string, SolarAdoptionRecord>();
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

/** A candidate installation's annual savings for this specific building —
 * avoided electricity cost for whatever it would self-consume, plus export
 * revenue at the feed-in rate for the rest, both priced the same way a real
 * bill is (billing.ts's own per-interval TOU logic, reimplemented here
 * against a candidate production series rather than a real one). Sampled at
 * useBillSummary.ts's own density (24/month) — coarse enough that the
 * self-consumption/export split is an approximation, not a precise
 * simulation, a known limitation worth being upfront about (see the wiki). */
function candidateAnnualSavingsRp(building: Building, candidateCapacityKw: number, yearStartMs: number, tariff: Tariff): number {
  const times = historyTimeSteps(yearStartMs + YEAR_MS, YEAR_MS, ANNUAL_SAMPLES);
  const consumptionW = consumptionSeriesW(sampleBuildingCategorySeries(building, times, tariff, []));
  const candidatePlant: PowerPlant = {
    plantId: `solar-candidate:${building.egid}`,
    lon: 0,
    lat: 0,
    capacityKw: candidateCapacityKw,
    technology: "Photovoltaic",
    commissioningDate: null,
    egid: building.egid,
  };

  let avoidedCostRp = 0;
  let exportRevenueRp = 0;
  for (let i = 1; i < times.length; i++) {
    const dtHours = (times[i] - times[i - 1]) / HOUR_MS;
    const prod0 = -pvPowerW(candidatePlant, times[i - 1]);
    const prod1 = -pvPowerW(candidatePlant, times[i]);
    const selfCons0 = Math.min(consumptionW[i - 1], prod0);
    const selfCons1 = Math.min(consumptionW[i], prod1);
    const exp0 = prod0 - selfCons0;
    const exp1 = prod1 - selfCons1;
    const avgSelfConsKWh = ((selfCons0 + selfCons1) / 2) * (dtHours / 1000);
    const avgExportKWh = ((exp0 + exp1) / 2) * (dtHours / 1000);
    const midMs = (times[i] + times[i - 1]) / 2;
    const rate = isOffPeakHour(tariff, hourOfDayAt(midMs)) ? tariff.offPeakPriceRpKWh : tariff.peakPriceRpKWh;
    avoidedCostRp += avgSelfConsKWh * rate;
    exportRevenueRp += avgExportKWh * tariff.feedInPriceRpKWh;
  }
  return avoidedCostRp + exportRevenueRp;
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
  tariff: Tariff,
  policy: Policy,
  hazardContext: HazardContext,
): SolarAdoptionRecord | null {
  const usableDraw = mulberry32(hashSeed(building.egid, "solar-usable-fraction"))();
  const usableFraction = usableRoofFractionFromDraw(usableDraw);
  const capacityKw = (building.footprintAreaM2 ?? 0) * usableFraction * kwpPerM2At(year);
  if (capacityKw <= 0) return null;

  const installCostRp = capacityKw * installCostRpPerKwp(capacityKw);
  const federalRp = federalSubsidyRp(capacityKw);
  const municipalRp = Math.max(0, Math.min(capacityKw * policy.solarSubsidyRpPerKwp, installCostRp - federalRp));
  const subsidyRp = federalRp + municipalRp;

  const annualSavingsRp = candidateAnnualSavingsRp(building, capacityKw, yearStartMs, tariff);

  const candidates: RenewalCandidate<"none" | "solar">[] = [
    { id: "none", available: true, annualizedCostRp: 0, lifetimeMeanYears: PANEL_LIFETIME_MEAN_YEARS, greenness: 0 },
    {
      id: "solar",
      available: true,
      annualizedCostRp: (installCostRp - subsidyRp) / PANEL_LIFETIME_MEAN_YEARS - annualSavingsRp,
      lifetimeMeanYears: PANEL_LIFETIME_MEAN_YEARS,
      greenness: 1,
    },
  ];
  const biasRp = solarBiasStrengthRp(building.egid);
  const { chosen } = chooseNext(candidates, "none", SOLAR_UNCERTAINTY_FRACTION, biasRp);

  logCandidateDecision({
    atMs: yearStartMs,
    kind: "solar",
    egid: building.egid,
    entityKey: `${building.egid}:solar`,
    incumbent: "none",
    chosen,
    reasonKind: chosen === "solar" ? "financial" : "inKind",
    candidates: candidateLogEntries(candidates, biasRp, (id) => (id === "solar" ? "Install solar" : "Stay without")),
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
      annualSavingsRp,
    },
  });

  if (chosen !== "solar") return null;

  const dayOffset = Math.floor(mulberry32(hashSeed(building.egid, "solar-install-day", String(year)))() * 365);
  return { installedAtMs: yearStartMs + dayOffset * DAY_MS, capacityKw, installCostRp, federalSubsidyRp: federalRp, municipalSubsidyRp: municipalRp, annualSavingsRp };
}

function processYear(buildings: Building[], realPlants: PowerPlant[], year: number): void {
  const policy = policyStore.get();
  const tariff = tariffStore.get();
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));

  for (const building of buildings) {
    if (adoptionByEgid.has(building.egid)) continue;
    if (!isEligible(building, realPlants, year)) continue;

    const neighborAdopters = countAdoptedNeighbors(building.egid, buildings, realPlants, yearStartMs);
    const renewalBoosted = hadRecentHeatingRenewal(building, yearStartMs);
    const renewalBoost = renewalBoosted ? RENEWAL_BOOST_MULTIPLIER : 1;
    const neighborMultiplier = 1 + Math.min(NEIGHBOR_BOOST_CAP - 1, neighborAdopters * NEIGHBOR_BOOST_PER_ADOPTER);
    const hazard = Math.min(MAX_ANNUAL_HAZARD, BASE_ANNUAL_HAZARD * renewalBoost * neighborMultiplier * outreachHazardMultiplier(policy));

    const draw = mulberry32(hashSeed(building.egid, "solar-hazard", String(year)))();
    if (draw >= hazard) continue;

    const decision = evaluateAdoption(building, year, yearStartMs, tariff, policy, { hazard, draw, neighborAdopters, renewalBoosted });
    if (decision) adoptionByEgid.set(building.egid, decision);
  }
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
 * a physical thing on that roof: it goes when the roof does). Only the few plants
 * of demolished buildings are copied. */
function realPlantsWithDemolitions(buildings: Building[], realPlants: PowerPlant[]): PowerPlant[] {
  const lookup = buildingLookup(buildings);
  return realPlants.map((plant) => {
    const demolishedAtMs = plant.egid ? lookup.get(plant.egid)?.demolishedAtMs : undefined;
    return demolishedAtMs === undefined ? plant : { ...plant, activeToMs: demolishedAtMs };
  });
}

function synthesizedPlants(buildings: Building[], cutoffMs: number): PowerPlant[] {
  const lookup = buildingLookup(buildings);
  const synthesized: PowerPlant[] = [];
  for (const [egid, record] of adoptionByEgid) {
    if (record.installedAtMs >= cutoffMs) continue;
    synthesized.push({
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
  return [...realPlantsWithDemolitions(buildings, realPlants), ...synthesizedPlants(buildings, cutoffMs)];
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
  return [...realPlantsWithDemolitions(buildings, realPlants), ...synthesizedPlants(buildings, simTimeMs)];
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
  const requiredKw = Math.min(usableCapacityKw, Math.max(codeKw, rules.solarMandateFraction * usableCapacityKw));
  const voluntary = voluntaryDraw < NEW_BUILD_VOLUNTARY_SOLAR_SHARE;
  const capacityKw = voluntary ? usableCapacityKw : requiredKw;

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
    installCostRp: capacityKw * installCostRpPerKwp(capacityKw),
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
  const record = adoptionByEgid.get(building.egid);
  if (!record || record.installedAtMs > simTimeMs) return [];
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

/** Municipal-treasury cost this calendar year — the player's own top-up
 * subsidy only, never the federal Einmalvergütung baseline (a program the
 * municipality doesn't fund or control — see solarSystems.ts). Used by
 * finances.ts. */
export function municipalSolarSubsidiesPaidInYear(buildings: Building[], realPlants: PowerPlant[], year: number): number {
  ensureAdvancedThrough(buildings, realPlants, year);
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  let total = 0;
  for (const record of adoptionByEgid.values()) {
    if (record.installedAtMs >= yearStartMs && record.installedAtMs < yearEndMs) total += record.municipalSubsidyRp;
  }
  return total;
}

export interface SolarAdoptionYearTally {
  count: number;
  totalCapacityKw: number;
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
  return { count, totalCapacityKw };
}
