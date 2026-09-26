/**
 * Insulation retrofits: an owner periodically reconsiders the building envelope (facade,
 * windows, roof) and either keeps it as it is or upgrades it to a better energy class.
 * Binds renewal.ts's generic engine to that category, exactly as heatingRenewal.ts does
 * for heating — so it gets the same four factors (availability, financial comparison,
 * an uncertainty band, a hidden progressive/conservative bias), decision logging, and
 * the same "decided at commit time, then frozen" behaviour.
 *
 * The financial comparison: every option pays the maintenance an envelope needs anyway;
 * an upgrade adds a premium (the class's cost minus the current class's), less the
 * federal building-program grant and any municipal top-up, spread over the class's
 * lifetime, and is weighed against what a year of heating would cost at the resulting
 * U-value — with the building's own heating system at the then-current prices. That is
 * why a retrofit is marginal on an oil-heated house and pointless on a heat-pumped one.
 *
 * A building's class is derived from its U-value (energyClass.ts), so the "initial"
 * class of an existing building is whatever its era and quality already imply. A retrofit
 * sets the U-value to its target class's figure, times a per-building workmanship factor.
 */

import {
  ENERGY_CLASS_CATALOG,
  ENERGY_CLASS_ORDER,
  FALLBACK_ENVELOPE_AREA_M2,
  MAINTENANCE_RP_PER_M2,
  MAX_MUNICIPAL_SUBSIDY_SHARE,
  RETROFIT_BASE_UNCERTAINTY_FRACTION,
  RETROFIT_BIAS_MAGNITUDE_RP_PER_YEAR,
  RETROFIT_EXTRA_UNCERTAINTY_FRACTION,
  RETROFIT_QUALITY_FACTOR_RANGE,
  RETROFIT_UNCERTAINTY_DECAY_DWELLINGS,
  RETROFIT_WEIBULL_SHAPE,
} from "../config/retrofit";
import type { Building } from "../data/types";
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";
import { toDateMs } from "./calendar";
import { retrofitRules } from "./constructionRules";
import { classForUValue, energyClassRank, type EnergyClassId } from "./energyClass";
import { annualHeatingCostRp } from "./heatingRenewal";
import { policyStore } from "./policy";
import { peekRenewalChain, renewalEventsUpTo, systemAt, type RenewalCandidate, type RenewalEvent, type RenewalParams } from "./renewal";
import { hashSeed, mulberry32 } from "./rng";
import { originalUValue } from "./spaceHeating";
import { priceFactor } from "./costTrends";

const initialClassCache = new Map<string, EnergyClassId>();

/** The class a building starts in: whatever its original U-value implies. */
function initialClass(building: Building): EnergyClassId {
  let id = initialClassCache.get(building.egid);
  if (!id) {
    id = classForUValue(originalUValue(building));
    initialClassCache.set(building.egid, id);
  }
  return id;
}

function retrofitQualityFactor(building: Building): number {
  const [min, max] = RETROFIT_QUALITY_FACTOR_RANGE;
  return min + mulberry32(hashSeed(building.egid, "retrofit-quality"))() * (max - min);
}

/** The U-value the building has in the given class: its own original one in its starting
 * class, otherwise the class target adjusted by workmanship. */
function uValueOfClass(building: Building, id: EnergyClassId): number {
  if (id === initialClass(building)) return originalUValue(building);
  return ENERGY_CLASS_CATALOG[id].targetUValue * retrofitQualityFactor(building);
}

function uncertaintyFraction(building: Building): number {
  const n = Math.max(1, building.dwellings.length);
  return RETROFIT_BASE_UNCERTAINTY_FRACTION + RETROFIT_EXTRA_UNCERTAINTY_FRACTION * Math.exp(-(n - 1) / RETROFIT_UNCERTAINTY_DECAY_DWELLINGS);
}

function biasStrengthRp(building: Building): number {
  const u = mulberry32(hashSeed(building.egid, "retrofit-bias"))();
  return (u - 0.5) * 2 * RETROFIT_BIAS_MAGNITUDE_RP_PER_YEAR;
}

function candidatesAt(building: Building, atMs: number, incumbent: EnergyClassId): RenewalCandidate<EnergyClassId>[] {
  const rules = retrofitRules(policyStore.get(), new Date(toDateMs(atMs)).getUTCFullYear());
  const area = buildingEnvelopeAreaM2(building) ?? FALLBACK_ENVELOPE_AREA_M2;
  const incumbentSpec = ENERGY_CLASS_CATALOG[incumbent];
  const incumbentRank = energyClassRank(incumbent);
  const minRank = rules.minClass === null ? 0 : energyClassRank(rules.minClass);
  const workFactor = priceFactor("insulation", atMs); // building work gets dearer over time

  return ENERGY_CLASS_ORDER.map((id) => {
    const spec = ENERGY_CLASS_CATALOG[id];
    const rank = energyClassRank(id);
    const isUpgrade = rank > incumbentRank;
    // No half-measures once the rules set a minimum: renovate to it, or leave the envelope alone.
    const available = rank >= incumbentRank && (!isUpgrade || rank >= minRank);

    const premiumRp = isUpgrade ? (spec.cumulativeCostRpPerM2 - incumbentSpec.cumulativeCostRpPerM2) * area * workFactor : 0;
    const programRp = isUpgrade ? Math.max(0, spec.programSubsidyRpPerM2 - incumbentSpec.programSubsidyRpPerM2) * area : 0;
    const municipalRp = isUpgrade ? Math.min(rules.municipalSubsidyRpPerM2 * area, MAX_MUNICIPAL_SUBSIDY_SHARE * Math.max(0, premiumRp - programRp)) : 0;
    const upfrontRp = MAINTENANCE_RP_PER_M2 * area * workFactor + premiumRp - programRp - municipalRp;

    return {
      id,
      available,
      annualizedCostRp: upfrontRp / spec.reconsiderMeanYears + annualHeatingCostRp(building, atMs, uValueOfClass(building, id)),
      lifetimeMeanYears: spec.reconsiderMeanYears,
      municipalSubsidyRp: municipalRp,
      greenness: spec.greenness,
    };
  });
}

function chainFor(building: Building, simTimeMs: number): RenewalEvent<EnergyClassId>[] {
  const entityKey = `${building.egid}:retrofit`;
  const cached = peekRenewalChain<EnergyClassId>(entityKey, simTimeMs);
  if (cached) return cached;
  const params: RenewalParams<EnergyClassId> = {
    entityKey,
    egid: building.egid,
    kind: "retrofit",
    labelFor: (id) => ENERGY_CLASS_CATALOG[id].label,
    initialSystem: initialClass(building),
    initialInstalledAtMs: building.builtAtMs,
    conditionalFirstLifetime: true,
    weibullShape: RETROFIT_WEIBULL_SHAPE,
    uncertaintyFraction: uncertaintyFraction(building),
    biasStrengthRp: biasStrengthRp(building),
    lifetimeMeanYearsFor: (id) => ENERGY_CLASS_CATALOG[id].reconsiderMeanYears,
    candidatesAt: (atMs, incumbent) => candidatesAt(building, atMs, incumbent),
  };
  return renewalEventsUpTo(params, simTimeMs);
}

/** The building's energy class at `simTimeMs`. */
export function energyClassAt(building: Building, simTimeMs: number): EnergyClassId {
  return systemAt(chainFor(building, simTimeMs), simTimeMs);
}

/** The U-value the building has after its insulation retrofit(s) at `simTimeMs` — null while
 * it has not been retrofitted, in which case its original U-value applies. */
export function retrofitUValueAt(building: Building, simTimeMs: number): number | null {
  const current = systemAt(chainFor(building, simTimeMs), simTimeMs);
  return current === initialClass(building) ? null : uValueOfClass(building, current);
}

export interface RetrofitRecord {
  installedAtMs: number;
  from: EnergyClassId;
  to: EnergyClassId;
  municipalSubsidyRp: number;
}

/** Actual class changes in `[fromMs, toMs)` — an in-kind reconsideration (nothing done)
 * is not a retrofit and never appears. */
export function retrofitsInRange(building: Building, fromMs: number, toMs: number): RetrofitRecord[] {
  return chainFor(building, toMs)
    .filter((e) => e.reasonKind !== "initial" && e.system !== e.previousSystem && e.installedAtMs >= fromMs && e.installedAtMs < toMs)
    .map((e) => ({
      installedAtMs: e.installedAtMs,
      from: e.previousSystem as EnergyClassId,
      to: e.system,
      municipalSubsidyRp: e.municipalSubsidyRp ?? 0,
    }));
}

export interface RetrofitLogEntry {
  installedAtMs: number;
  note: string;
}

/** Every retrofit this building has had by `simTimeMs`, oldest first, as player-facing lines. */
export function retrofitLog(building: Building, simTimeMs: number): RetrofitLogEntry[] {
  return chainFor(building, simTimeMs)
    .filter((e) => e.reasonKind !== "initial" && e.system !== e.previousSystem && e.installedAtMs <= simTimeMs)
    .map((e) => {
      const from = ENERGY_CLASS_CATALOG[e.previousSystem as EnergyClassId].label;
      const to = ENERGY_CLASS_CATALOG[e.system].label;
      const why =
        e.reasonKind === "forcedByAvailability"
          ? "The building rules ruled out a smaller upgrade."
          : "It paid off in lower heating costs over the lifetime of the work.";
      return { installedAtMs: e.installedAtMs, note: `The envelope was renovated: ${from} → ${to}. ${why}` };
    });
}
