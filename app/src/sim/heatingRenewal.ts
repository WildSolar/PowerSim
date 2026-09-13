/**
 * Binds renewal.ts's generic engine to space heating specifically: maps a
 * building's real GWR-observed system to one of our five candidate system ids,
 * estimates each candidate's annualized cost for *this* building (its own
 * envelope area and a representative year of weather — see annualHeatingEstimate),
 * and exposes what's actually installed at a given moment plus the player-facing
 * event log.
 *
 * The four decision factors from the design discussion, as implemented here:
 *  - Availability: every system is available except district heating for a
 *    building not already on it — a deliberate stub (no real network-topology
 *    data yet) that grandfathers existing district-heat buildings without
 *    letting new ones adopt it out of nowhere.
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
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";
import {
  fuelEfficiency,
  HEATING_SYSTEM_CATALOG,
  HEATING_SYSTEM_ORDER,
  OIL_ENERGY_KWH_PER_LITER,
  type HeatingSystemId,
} from "./heatingSystems";
import { impliesHeatPump } from "./heatPumpSources";
import { hashSeed, mulberry32 } from "./rng";
import { renewalEventsUpTo, systemAt, type RenewalCandidate, type RenewalEvent, type RenewalParams } from "./renewal";
import { copAt, spaceHeatingThermalDemandW } from "./spaceHeating";
import { tariffStore } from "./tariffStore";
import type { Tariff } from "./tariff";
import { dailyMeanTempC } from "./weather";

const DAY_MS = 24 * 60 * 60_000;
const ANNUAL_SAMPLE_DAYS = 365;
const WEIBULL_SHAPE = 2.5; // moderate wear-out hazard — most units fail somewhere near their mean lifetime, not uniformly spread

const REFERENCE_ENVELOPE_AREA_M2 = 250; // roughly a mid-size single-family house

const BASE_UNCERTAINTY_FRACTION = 0.04; // floor — even a large, professionally-managed building won't chase every last Rappen
const EXTRA_UNCERTAINTY_FRACTION = 0.21; // -> 25% band for a single dwelling
const UNCERTAINTY_DECAY_DWELLINGS = 6;

const BIAS_MAGNITUDE_RP_PER_YEAR = 80_000; // CHF 800/yr at full lean — real but not overwhelming next to a typical annualized heating cost

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
function annualHeatingEstimate(building: Building, atMs: number): AnnualHeatingEstimate {
  let thermalKWh = 0;
  let airHeatPumpElectricKWh = 0;
  let groundHeatPumpElectricKWh = 0;
  for (let i = 0; i < ANNUAL_SAMPLE_DAYS; i++) {
    const t = atMs + i * DAY_MS;
    const dailyMeanC = dailyMeanTempC(t);
    const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, dailyMeanC);
    const dayThermalKWh = (thermalW * 24) / 1000;
    thermalKWh += dayThermalKWh;
    airHeatPumpElectricKWh += dayThermalKWh / copAt(dailyMeanC, "air");
    groundHeatPumpElectricKWh += dayThermalKWh / copAt(dailyMeanC, "ground");
  }
  return { thermalKWh, airHeatPumpElectricKWh, groundHeatPumpElectricKWh };
}

function sizeScale(building: Building): number {
  const area = buildingEnvelopeAreaM2(building) ?? REFERENCE_ENVELOPE_AREA_M2;
  return Math.min(4, Math.max(0.4, area / REFERENCE_ENVELOPE_AREA_M2));
}

function runningCostRpFor(id: HeatingSystemId, estimate: AnnualHeatingEstimate, tariff: Tariff, avgElecRpKWh: number): number {
  if (id === "airHeatPump") return estimate.airHeatPumpElectricKWh * avgElecRpKWh;
  if (id === "groundHeatPump") return estimate.groundHeatPumpElectricKWh * avgElecRpKWh;
  const consumedKWh = estimate.thermalKWh / fuelEfficiency(id);
  if (id === "oilBoiler") return (consumedKWh / OIL_ENERGY_KWH_PER_LITER) * tariff.oilPriceRpPerLiter;
  if (id === "gasBoiler") return consumedKWh * tariff.gasPriceRpKWh;
  return consumedKWh * tariff.districtHeatingPriceRpKWh;
}

function candidatesAt(building: Building, atMs: number, incumbent: HeatingSystemId): RenewalCandidate<HeatingSystemId>[] {
  const tariff = tariffStore.get();
  const estimate = annualHeatingEstimate(building, atMs);
  const scale = sizeScale(building);
  const avgElecRpKWh = (tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2;

  return HEATING_SYSTEM_ORDER.map((id) => {
    const spec = HEATING_SYSTEM_CATALOG[id];
    const installCostRp = Math.max(0, spec.baseInstallCostRp * scale - spec.subsidyRp);
    return {
      id,
      available: id === "districtHeating" ? incumbent === "districtHeating" : true,
      annualizedCostRp: installCostRp / spec.lifetimeMeanYears + runningCostRpFor(id, estimate, tariff, avgElecRpKWh),
      lifetimeMeanYears: spec.lifetimeMeanYears,
      greenness: spec.greenness,
    };
  });
}

function uncertaintyFraction(building: Building): number {
  const n = Math.max(1, building.dwellings.length);
  return BASE_UNCERTAINTY_FRACTION + EXTRA_UNCERTAINTY_FRACTION * Math.exp(-(n - 1) / UNCERTAINTY_DECAY_DWELLINGS);
}

function biasStrengthRp(building: Building): number {
  const u = mulberry32(hashSeed(building.egid, "heating-renewal-bias"))();
  return (u - 0.5) * 2 * BIAS_MAGNITUDE_RP_PER_YEAR;
}

function chainFor(building: Building, simTimeMs: number): RenewalEvent<HeatingSystemId>[] | null {
  const initial = initialHeatingSystemId(building);
  if (initial === null) return null;
  const params: RenewalParams<HeatingSystemId> = {
    entityKey: `${building.egid}:heating`,
    initialSystem: initial,
    weibullShape: WEIBULL_SHAPE,
    uncertaintyFraction: uncertaintyFraction(building),
    biasStrengthRp: biasStrengthRp(building),
    lifetimeMeanYearsFor: (id) => HEATING_SYSTEM_CATALOG[id].lifetimeMeanYears,
    candidatesAt: (atMs, incumbent) => candidatesAt(building, atMs, incumbent),
  };
  return renewalEventsUpTo(params, simTimeMs);
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

function renewalNote(event: RenewalEvent<HeatingSystemId>): string {
  const oldLabel = HEATING_SYSTEM_CATALOG[event.previousSystem as HeatingSystemId].label.toLowerCase();
  const base = `The old ${oldLabel} had reached the end of its service life.`;

  if (event.reasonKind === "inKind") {
    const again = event.system === "districtHeating" ? "district heating" : `another ${HEATING_SYSTEM_CATALOG[event.system].label.toLowerCase()}`;
    return `${base} It was replaced with ${again} — no clearly better alternative was found.`;
  }
  if (event.reasonKind === "forcedByAvailability" && event.bestOverallId) {
    return `${base} Since ${articleLabel(event.bestOverallId)} was not available, ${articleLabel(event.system)} was installed instead.`;
  }
  return `${base} ${capitalize(articleLabel(event.system))} was installed — cheaper to run over its lifetime.`;
}

/** Every real renewal this building has had so far, oldest first, as
 * player-facing log entries — the synthetic "initial" event (what GWR
 * observed, not something that "happened" in the game) is never included. */
export function heatingRenewalLog(building: Building, simTimeMs: number): HeatingRenewalLogEntry[] {
  const chain = chainFor(building, simTimeMs);
  if (!chain) return [];
  return chain.filter((e) => e.reasonKind !== "initial").map((e) => ({ installedAtMs: e.installedAtMs, note: renewalNote(e) }));
}

export interface HeatingRenewalRecord {
  installedAtMs: number;
  previousSystem: HeatingSystemId;
  system: HeatingSystemId;
}

/** Structured (not narrative) renewals in `[fromMs, toMs)` — yearReport.ts
 * uses this to tally how many buildings switched from which system to which
 * over a calendar year, reusing the same cached chain heatingRenewalLog does. */
export function heatingRenewalsInRange(building: Building, fromMs: number, toMs: number): HeatingRenewalRecord[] {
  const chain = chainFor(building, toMs);
  if (!chain) return [];
  return chain
    .filter((e) => e.reasonKind !== "initial" && e.installedAtMs >= fromMs && e.installedAtMs < toMs)
    .map((e) => ({ installedAtMs: e.installedAtMs, previousSystem: e.previousSystem as HeatingSystemId, system: e.system }));
}
