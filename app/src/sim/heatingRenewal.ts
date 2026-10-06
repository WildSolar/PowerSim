/**
 * Binds renewal.ts's generic engine to space heating specifically: maps a
 * building's real GWR-observed system to one of our five candidate system ids,
 * estimates each candidate's annualized cost for *this* building (its own
 * envelope area and a representative year of weather — see annualHeatingEstimate),
 * and exposes what's actually installed at a given moment plus the player-facing
 * event log.
 *
 * The four decision factors from the design discussion, as implemented here:
 *  - Availability: every system is available except district heating, which
 *    needs a pipe in a street the building fronts on (districtHeat.ts) — a
 *    building already on it keeps its connection either way.
 *  - Financial: annualizedCostRp = (install cost - subsidy) / lifetime +
 *    running cost, a straight-line (no discount rate) comparison — install
 *    costs scale with the building's own envelope area, running costs with its
 *    own thermal demand, both judgment-call figures (see heatingSystems.ts).
 *  - Uncertainty: a per-building indifference band, shrinking with dwelling
 *    count — a single house won't chase a marginally cheaper option, a big
 *    apartment block will.
 *  - Bias: a small per-building seeded trait (progressive/conservative), never
 *    surfaced to the player, nudging close calls toward or away from renewable
 *    options — see renewal.ts's module doc for why this doesn't retroactively
 *    rewrite past decisions when the player changes the tariff.
 */

import type { Building } from "../data/types";
import {
  HEATING_BASE_UNCERTAINTY_FRACTION,
  HEATING_BIAS_MAGNITUDE_RP_PER_YEAR,
  HEATING_EXTRA_UNCERTAINTY_FRACTION,
  HEATING_REFERENCE_ENVELOPE_AREA_M2,
  HEATING_UNCERTAINTY_DECAY_DWELLINGS,
  HEATING_WEIBULL_SHAPE,
} from "../config/heating";
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";
import { districtHeat } from "./districtHeat";
import { policyStore } from "./policy";
import { municipalHeatingSubsidyRp } from "./subsidies";
import {
  fuelEfficiency,
  HEATING_SYSTEM_CATALOG,
  HEATING_SYSTEM_ORDER,
  OIL_ENERGY_KWH_PER_LITER,
  type HeatingSystemId,
} from "./heatingSystems";
import { impliesHeatPump } from "./heatPumpSources";
import { hashSeed, mulberry32 } from "./rng";
import { peekRenewalChain, renewalEventsUpTo, systemAt, type RenewalCandidate, type RenewalEvent, type RenewalParams } from "./renewal";
import { buildingThermalProfile, copAt, spaceHeatingThermalDemandW } from "./spaceHeating";
import { tariffStore } from "./tariffStore";
import type { Tariff } from "./tariff";
import { dailyMeanTempC } from "./weather";
import { priceFactor } from "./costTrends";
import { zoning } from "./zoning";
import { gridDrawBlockedAt } from "./gridLimits";
import { heatPumpSiting } from "./heatPumpSiting";
import { EARLY_SWITCH } from "../config/earlySwitch";
import { earlyCandidates, earlySwitchChance } from "./earlySwitch";

const DAY_MS = 24 * 60 * 60_000;
const ANNUAL_SAMPLE_DAYS = 365;

function isGroundSourceReservoir(source: string | null): boolean {
  return (
    source === "Erdwärmesonde" ||
    source === "Erdwärme (generisch)" ||
    source === "Erdregister" ||
    source === "Wasser (Grundwasser, Oberflächenwasser, Abwasser)"
  );
}

/** The system GWR shows this building as having right now — the anchor every
 * renewal chain starts from. Null for a source we don't price/model (wood,
 * solar thermal, unspecified, ...), same boundary billing.ts already draws:
 * those buildings simply keep their static GWR-recorded system forever, no
 * renewal chain runs for them. */
export function initialHeatingSystemId(building: Building): HeatingSystemId | null {
  const isHeatPump =
    building.heatingGenerator === "Wärmepumpe für ein Gebäude" ||
    building.heatingGenerator === "Wärmepumpe für mehrere Gebäude" ||
    impliesHeatPump(building.heatingEnergySource);
  if (isHeatPump) return isGroundSourceReservoir(building.heatingEnergySource) ? "groundHeatPump" : "airHeatPump";
  if (building.heatingEnergySource === "Gas") return "gasBoiler";
  if (building.heatingEnergySource === "Heizöl") return "oilBoiler";
  if (building.heatingEnergySource?.startsWith("Fernwärme")) return "districtHeating";
  return null;
}

interface AnnualHeatingEstimate {
  thermalKWh: number;
  airHeatPumpElectricKWh: number;
  groundHeatPumpElectricKWh: number;
}

/** A representative year's thermal demand (and what each heat-pump kind would
 * consume to meet it), sampled daily from weather.ts's deterministic seasonal
 * curve anchored at `atMs` — the same physics the live simulation uses
 * (spaceHeating.ts), just integrated over a full year up front instead of
 * per-frame, since a renewal decision needs one annual figure to compare
 * against, not a live reading. */
function annualHeatingEstimate(building: Building, atMs: number, uValueOverride?: number): AnnualHeatingEstimate {
  // One snapshot of the envelope as of the decision moment, not re-read for every day of the year
  // ahead: a later retrofit is not something this decision knows about (and looking it up would
  // tie two decision chains together).
  // (Read as of just *before* the decision moment: a retrofit decision at the same instant reads
  // the heating system the same way, and each looking strictly earlier is what keeps the two
  // chains from waiting on each other forever.)
  const uValue = uValueOverride ?? buildingThermalProfile(building, atMs - 1).uValueWPerM2K;
  let thermalKWh = 0;
  let airHeatPumpElectricKWh = 0;
  let groundHeatPumpElectricKWh = 0;
  for (let i = 0; i < ANNUAL_SAMPLE_DAYS; i++) {
    const t = atMs + i * DAY_MS;
    const dailyMeanC = dailyMeanTempC(t);
    const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, dailyMeanC, t, uValue);
    const dayThermalKWh = (thermalW * 24) / 1000;
    thermalKWh += dayThermalKWh;
    airHeatPumpElectricKWh += dayThermalKWh / copAt(dailyMeanC, "air");
    groundHeatPumpElectricKWh += dayThermalKWh / copAt(dailyMeanC, "ground");
  }
  return { thermalKWh, airHeatPumpElectricKWh, groundHeatPumpElectricKWh };
}

/** A year's space heating demand (kWh of heat) for this building as of `atMs`. */
export function annualHeatDemandKWh(building: Building, atMs: number): number {
  return annualHeatingEstimate(building, atMs).thermalKWh;
}

function sizeScale(building: Building): number {
  const area = buildingEnvelopeAreaM2(building) ?? HEATING_REFERENCE_ENVELOPE_AREA_M2;
  return Math.min(4, Math.max(0.4, area / HEATING_REFERENCE_ENVELOPE_AREA_M2));
}

function runningCostRpFor(id: HeatingSystemId, estimate: AnnualHeatingEstimate, tariff: Tariff, avgElecRpKWh: number): number {
  if (id === "airHeatPump") return estimate.airHeatPumpElectricKWh * avgElecRpKWh;
  if (id === "groundHeatPump") return estimate.groundHeatPumpElectricKWh * avgElecRpKWh;
  const consumedKWh = estimate.thermalKWh / fuelEfficiency(id);
  if (id === "oilBoiler") return (consumedKWh / OIL_ENERGY_KWH_PER_LITER) * tariff.oilPriceRpPerLiter;
  if (id === "gasBoiler") return consumedKWh * tariff.gasPriceRpKWh;
  return consumedKWh * tariff.districtHeatingPriceRpKWh;
}

function isHeatPump(id: HeatingSystemId): boolean {
  return id === "airHeatPump" || id === "groundHeatPump";
}

/** Whether the site allows a new heat pump of this kind (heatPumpSiting.ts): the ground for a
 * ground-source one, the neighbours' quiet for an air one. Other systems: always. */
export function siteAllowsHeating(building: Building, id: HeatingSystemId, atMs: number, newBuild: boolean): boolean {
  if (id === "groundHeatPump") return heatPumpSiting.groundSource(building, atMs).kind !== "none";
  if (id === "airHeatPump") return heatPumpSiting.airNoise(building, atMs, newBuild).step !== "notPermitted";
  return true;
}

function candidatesAt(
  building: Building,
  atMs: number,
  incumbent: HeatingSystemId,
  withMunicipalSubsidy = true,
  newBuild = false,
  early = false,
): RenewalCandidate<HeatingSystemId>[] {
  const tariff = tariffStore.at(atMs);
  const estimate = annualHeatingEstimate(building, atMs);
  const scale = sizeScale(building);
  const fossilBanned = policyStore.get().fossilHeatingInstallBanned || zoning.fossilHeatingBannedAt(building, atMs);
  const gridBlocked = gridDrawBlockedAt(building, atMs);
  const avgElecRpKWh = (tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2;

  const candidates = HEATING_SYSTEM_ORDER.map((id) => {
    const spec = HEATING_SYSTEM_CATALOG[id];
    // Keeping the same system can be much cheaper than installing it new (see replacementInstallCostRp).
    const keeps = id === incumbent && !newBuild;
    let installRp = (keeps ? (spec.replacementInstallCostRp ?? spec.baseInstallCostRp) : spec.baseInstallCostRp) * priceFactor(id, atMs);
    // A new heat pump has to fit its site (heatPumpSiting.ts); one replacing its like keeps its
    // boreholes or wells, or its permitted outdoor spot.
    let sited = true;
    let siteRunningRp = 0;
    if (id === "groundHeatPump" && !keeps) {
      const source = heatPumpSiting.groundSource(building, atMs);
      sited = source.kind !== "none";
      if (source.kind !== "none") installRp *= source.costFactor;
      if (source.kind === "groundwater") siteRunningRp = source.annualFeeRp;
    } else if (id === "airHeatPump" && !keeps) {
      const noise = heatPumpSiting.airNoise(building, atMs, newBuild);
      sited = noise.step !== "notPermitted";
      installRp += noise.extraCostRp;
    }
    const beforeMunicipalRp = Math.max(0, installRp * scale - spec.subsidyRp);
    const municipalRp = withMunicipalSubsidy ? Math.min(municipalHeatingSubsidyRp(id, early), beforeMunicipalRp) : 0;
    const installCostRp = beforeMunicipalRp - municipalRp;
    return {
      id,
      municipalSubsidyRp: municipalRp,
      // District heating needs a pipe in the street; one already connected keeps its connection. A
      // new heat pump needs room on the grid (a building replacing one keeps its connection).
      available:
        (id === "districtHeating" ? incumbent === "districtHeating" || districtHeat.servesAt(building.streetSegments, atMs) : true) &&
        !(fossilBanned && (id === "gasBoiler" || id === "oilBoiler")) &&
        !(isHeatPump(id) && !isHeatPump(incumbent) && gridBlocked) &&
        sited,
      annualizedCostRp: installCostRp / spec.lifetimeMeanYears + runningCostRpFor(id, estimate, tariff, avgElecRpKWh) + siteRunningRp,
      lifetimeMeanYears: spec.lifetimeMeanYears,
      greenness: spec.greenness,
    } as RenewalCandidate<HeatingSystemId>;
  });

  // A fossil heating ban gives way when nothing else is possible — no heat pump can go here (the
  // ground, the neighbours' quiet or a full grid rules them out) and no district heating reaches
  // the building: the owner may install gas or oil as an exception, as the cantonal energy law
  // allows when a renewable system isn't technically feasible.
  const fossil = (id: HeatingSystemId) => id === "gasBoiler" || id === "oilBoiler";
  if (fossilBanned && !candidates.some((c) => c.available && !fossil(c.id))) {
    const why = heatPumpBlockers(building, atMs, incumbent, gridBlocked, newBuild);
    for (const c of candidates) {
      if (fossil(c.id)) {
        c.available = true;
        c.exception = `no heat pump could go here (${why}) and no district heating reaches it`;
      }
    }
  }
  return candidates;
}

/** Why neither heat pump is possible for this building — for the fossil ban's exception note. */
function heatPumpBlockers(building: Building, atMs: number, incumbent: HeatingSystemId, gridBlocked: boolean, newBuild: boolean): string {
  // A full grid rules out both, whatever the site would allow.
  if (gridBlocked && !isHeatPump(incumbent)) return "the local grid can't take a new heat pump until it's reinforced";
  const reasons: string[] = [];
  const ground = heatPumpSiting.groundSource(building, atMs);
  if (ground.kind === "none") reasons.push(`ground: ${ground.reason}`);
  if (heatPumpSiting.airNoise(building, atMs, newBuild).step === "notPermitted") reasons.push("air: too loud for the neighbours even indoors");
  return reasons.join("; ") || "the site rules them out";
}

function uncertaintyFraction(building: Building): number {
  const n = Math.max(1, building.dwellings.length);
  return HEATING_BASE_UNCERTAINTY_FRACTION + HEATING_EXTRA_UNCERTAINTY_FRACTION * Math.exp(-(n - 1) / HEATING_UNCERTAINTY_DECAY_DWELLINGS);
}

function biasStrengthRp(building: Building): number {
  const u = mulberry32(hashSeed(building.egid, "heating-renewal-bias"))();
  return (u - 0.5) * 2 * HEATING_BIAS_MAGNITUDE_RP_PER_YEAR;
}

function chainFor(building: Building, simTimeMs: number): RenewalEvent<HeatingSystemId>[] | null {
  const cached = peekRenewalChain<HeatingSystemId>(`${building.egid}:heating`, simTimeMs);
  if (cached) return cached;
  const initial = initialHeatingSystemId(building);
  if (initial === null) return null;
  const params: RenewalParams<HeatingSystemId> = {
    entityKey: `${building.egid}:heating`,
    egid: building.egid,
    kind: "heating",
    labelFor: (id) => HEATING_SYSTEM_CATALOG[id].label,
    initialSystem: initial,
    initialInstalledAtMs: building.builtAtMs,
    conditionalFirstLifetime: true,
    weibullShape: HEATING_WEIBULL_SHAPE,
    uncertaintyFraction: uncertaintyFraction(building),
    biasStrengthRp: biasStrengthRp(building),
    lifetimeMeanYearsFor: (id) => HEATING_SYSTEM_CATALOG[id].lifetimeMeanYears,
    candidatesAt: (atMs, incumbent) => candidatesAt(building, atMs, incumbent),
    early: {
      eligible: (system) => system === "oilBoiler" || system === "gasBoiler",
      minAgeYears: EARLY_SWITCH.heating.minAgeYears,
      chanceAt: (atMs) => {
        const priceRp = HEATING_SYSTEM_CATALOG.airHeatPump.baseInstallCostRp * priceFactor("airHeatPump", atMs) * sizeScale(building);
        return earlySwitchChance(EARLY_SWITCH.heating, municipalHeatingSubsidyRp("airHeatPump", true), priceRp);
      },
      candidatesAt: (atMs, incumbent, ageYears) => {
        const tariff = tariffStore.at(atMs);
        const keep = runningCostRpFor(incumbent, annualHeatingEstimate(building, atMs), tariff, (tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2);
        return earlyCandidates(candidatesAt(building, atMs, incumbent, true, false, true), incumbent, keep, ageYears, EARLY_SWITCH.heating);
      },
    },
  };
  return renewalEventsUpTo(params, simTimeMs);
}

/** What a year of space heating would cost this building at `atMs` prices if its envelope had
 * the given U-value, heated by whatever system it has then (gas if that is not one we price).
 * Retrofit decisions weigh this against the cost of the work. */
export function annualHeatingCostRp(building: Building, atMs: number, uValueWPerM2K: number): number {
  const tariff = tariffStore.at(atMs);
  const estimate = annualHeatingEstimate(building, atMs, uValueWPerM2K);
  const avgElecRpKWh = (tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2;
  return runningCostRpFor(currentHeatingSystemId(building, atMs - 1) ?? "gasBoiler", estimate, tariff, avgElecRpKWh);
}

export interface NewBuildHeatingCandidate {
  id: HeatingSystemId;
  label: string;
  available: boolean;
  annualizedCostRp: number;
  effectiveCostRp: number;
  greenness: number;
  weight: number;
}

/** Picks the heating system for a building that doesn't have one yet (a replacement
 * or new build at permit time). Uses the same annualized-cost comparison and hidden
 * progressive/conservative bias as a renewal, but with no incumbent to stay with:
 * among the systems the building code allows (and that are physically available),
 * the choice is a weighted draw that favors the cheaper ones — mostly the winner,
 * sometimes not, "by chance" as the design calls for. `available` is decided by the
 * caller (rules + district-heat reach), overriding the renewal engine's own stub. */
export function chooseNewBuildHeating(
  building: Building,
  atMs: number,
  isAvailable: (id: HeatingSystemId) => boolean,
  draw: number,
  temperatureFraction: number,
): { chosen: HeatingSystemId; candidates: NewBuildHeatingCandidate[]; biasStrengthRp: number } {
  const bias = biasStrengthRp(building);
  const base = candidatesAt(building, atMs, "airHeatPump", false, true); // a new build gets no renovation grant
  const scored = base.map((c) => ({
    ...c,
    available: isAvailable(c.id) && siteAllowsHeating(building, c.id, atMs, true),
    effectiveCostRp: c.annualizedCostRp - bias * c.greenness,
  }));
  const available = scored.filter((c) => c.available);
  const pool = available.length > 0 ? available : scored.filter((c) => c.id === "airHeatPump");
  const cheapest = Math.min(...pool.map((c) => c.effectiveCostRp));
  const width = Math.max(1, temperatureFraction * Math.abs(cheapest));
  const weights = pool.map((c) => Math.exp(-(c.effectiveCostRp - cheapest) / width));
  const total = weights.reduce((a, b) => a + b, 0);

  let pick = draw * total;
  let chosen = pool[pool.length - 1].id;
  for (let i = 0; i < pool.length; i++) {
    pick -= weights[i];
    if (pick <= 0) {
      chosen = pool[i].id;
      break;
    }
  }

  const weightById = new Map(pool.map((c, i) => [c.id, weights[i] / total]));
  return {
    chosen,
    biasStrengthRp: bias,
    candidates: scored.map((c) => ({
      id: c.id,
      label: HEATING_SYSTEM_CATALOG[c.id].label,
      available: c.available,
      annualizedCostRp: c.annualizedCostRp,
      effectiveCostRp: c.effectiveCostRp,
      greenness: c.greenness,
      weight: weightById.get(c.id) ?? 0,
    })),
  };
}

/** The heating system actually in force at `simTimeMs` — null for a building
 * whose real (GWR) source we don't model at all (see initialHeatingSystemId),
 * which never changes and never enters a renewal chain. */
export function currentHeatingSystemId(building: Building, simTimeMs: number): HeatingSystemId | null {
  const chain = chainFor(building, simTimeMs);
  return chain ? systemAt(chain, simTimeMs) : null;
}

/** Whether this building's space heating has actually been replaced by
 * `simTimeMs`, as opposed to still being whatever GWR originally recorded —
 * waterHeating.ts uses this to decide whether a heat-pump renewal should be
 * treated as having brought hot water production along with it. */
export function heatingHasBeenRenewed(building: Building, simTimeMs: number): boolean {
  const chain = chainFor(building, simTimeMs);
  return !!chain && chain.length > 1;
}

export interface HeatingRenewalLogEntry {
  installedAtMs: number;
  note: string;
}

function articleLabel(id: HeatingSystemId): string {
  if (id === "districtHeating") return "district heating";
  const label = HEATING_SYSTEM_CATALOG[id].label.toLowerCase();
  return (/^[aeiou]/i.test(label) ? "an " : "a ") + label;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Why a heat pump the owner would have preferred wasn't possible here, if it's down to the site. */
function siteReason(building: Building, id: HeatingSystemId, atMs: number): string {
  if (id === "groundHeatPump") {
    const source = heatPumpSiting.groundSource(building, atMs);
    return source.kind === "none" ? ` (${source.reason})` : "";
  }
  if (id === "airHeatPump") {
    const noise = heatPumpSiting.airNoise(building, atMs);
    return noise.step === "notPermitted" ? " (its outdoor unit would be too loud for the neighbours, even installed indoors)" : "";
  }
  return "";
}

function renewalNote(event: RenewalEvent<HeatingSystemId>, building?: Building): string {
  const oldLabel = HEATING_SYSTEM_CATALOG[event.previousSystem as HeatingSystemId].label.toLowerCase();
  const base = `The old ${oldLabel} had reached the end of its service life.`;

  if (event.reasonKind === "early") {
    const grant = event.municipalSubsidyRp ? ", with the municipality's grant" : "";
    return `The old ${oldLabel} still worked, but the owner replaced it early with ${articleLabel(event.system)}${grant} — cheaper to run, and repairs on the old one were adding up.`;
  }
  if (event.exception) {
    return `${base} The fossil heating ban gave way: ${event.exception}, so ${articleLabel(event.system)} was allowed as an exception.`;
  }
  if (event.reasonKind === "inKind") {
    const again = event.system === "districtHeating" ? "district heating" : `another ${HEATING_SYSTEM_CATALOG[event.system].label.toLowerCase()}`;
    return `${base} It was replaced with ${again} — no clearly better alternative was found.`;
  }
  if (event.reasonKind === "forcedByAvailability" && event.bestOverallId) {
    const why = building ? siteReason(building, event.bestOverallId, event.installedAtMs) : "";
    return `${base} Since ${articleLabel(event.bestOverallId)} was not available${why}, ${articleLabel(event.system)} was installed instead.`;
  }
  return `${base} ${capitalize(articleLabel(event.system))} was installed — cheaper to run over its lifetime.`;
}

/** Every real renewal this building has had so far, oldest first, as
 * player-facing log entries — the synthetic "initial" event (what GWR
 * observed, not something that "happened" in the game) is never included. */
export function heatingRenewalLog(building: Building, simTimeMs: number): HeatingRenewalLogEntry[] {
  const chain = chainFor(building, simTimeMs);
  if (!chain) return [];
  return chain.filter((e) => e.reasonKind !== "initial").map((e) => ({ installedAtMs: e.installedAtMs, note: renewalNote(e, building) }));
}

export interface HeatingRenewalRecord {
  installedAtMs: number;
  previousSystem: HeatingSystemId;
  system: HeatingSystemId;
  /** The owner's first choice, when it wasn't available. */
  preferred: HeatingSystemId | null;
  /** Allowed only as an exception to a fossil heating ban (why). */
  exception?: string;
}

/** Structured (not narrative) renewals in `[fromMs, toMs)` — yearReport.ts
 * uses this to tally how many buildings switched from which system to which
 * over a calendar year, reusing the same cached chain heatingRenewalLog does. */
export function heatingRenewalsInRange(building: Building, fromMs: number, toMs: number): HeatingRenewalRecord[] {
  const chain = chainFor(building, toMs);
  if (!chain) return [];
  return chain
    .filter((e) => e.reasonKind !== "initial" && e.installedAtMs >= fromMs && e.installedAtMs < toMs)
    .map((e) => ({
      installedAtMs: e.installedAtMs,
      previousSystem: e.previousSystem as HeatingSystemId,
      system: e.system,
      preferred: e.reasonKind === "forcedByAvailability" ? e.bestOverallId : null,
      ...(e.exception ? { exception: e.exception } : {}),
    }));
}
