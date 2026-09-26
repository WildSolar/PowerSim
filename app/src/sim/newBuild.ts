/**
 * Everything that makes up a new or replacement building beyond its footprint:
 * what group it belongs to, how big it is, and its heating, insulation, and
 * rooftop solar — all decided once, at permit time, under the construction rules
 * then in force (constructionRules.ts) and then frozen, exactly like a stock-
 * renewal decision. stock.ts decides *when and where*; this decides *what*.
 */

import { baseUValueForYear } from "./spaceHeating";
import { CODE_SOLAR_W_PER_M2_EBF, EBF_FRACTION_OF_GFA, HEATING_CHOICE_TEMPERATURE, NEW_BUILD_QUALITY_FACTOR_RANGE } from "../config/stock";
import type { Building } from "../data/types";
import type { ConstructionRules } from "./constructionRules";
import { buildingGroup } from "./buildingGroup";
import { logCandidateDecision } from "./decisionLog";
import { chooseNewBuildHeating } from "./heatingRenewal";
import type { HeatingSystemId } from "./heatingSystems";
import { registerNewBuildSolar } from "./solarAdoption";

export { buildingGroup };
export { CODE_SOLAR_W_PER_M2_EBF };

export function gfaOf(building: Building): number {
  return (building.footprintAreaM2 ?? 0) * Math.max(1, building.floorCount ?? 2);
}

interface HeatingStrings {
  heatingGenerator: string;
  heatingEnergySource: string;
  hotWaterGenerator: string;
  hotWaterEnergySource: string;
}

// The same GWR vocabulary the rest of the sim keys off (heatingRenewal.ts's
// initialHeatingSystemId, waterHeating.ts) — a new building is just a building whose
// GWR record says this.
const HEATING_STRINGS: Record<HeatingSystemId, HeatingStrings> = {
  airHeatPump: { heatingGenerator: "Wärmepumpe für ein Gebäude", heatingEnergySource: "Luft", hotWaterGenerator: "Wärmepumpe", hotWaterEnergySource: "Luft" },
  groundHeatPump: {
    heatingGenerator: "Wärmepumpe für ein Gebäude",
    heatingEnergySource: "Erdwärmesonde",
    hotWaterGenerator: "Wärmepumpe",
    hotWaterEnergySource: "Erdwärmesonde",
  },
  districtHeating: {
    heatingGenerator: "Wärmetauscher (einschliesslich für Fernwärme) für ein Gebäude",
    heatingEnergySource: "Fernwärme (generisch)",
    hotWaterGenerator: "Wärmetauscher (einschliesslich für Fernwärme)",
    hotWaterEnergySource: "Fernwärme (generisch)",
  },
  gasBoiler: {
    heatingGenerator: "Heizkessel kondensierend für ein Gebäude",
    heatingEnergySource: "Gas",
    hotWaterGenerator: "Heizkessel kondensierend",
    hotWaterEnergySource: "Gas",
  },
  oilBoiler: {
    heatingGenerator: "Heizkessel (generisch) für ein Gebäude",
    heatingEnergySource: "Heizöl",
    hotWaterGenerator: "Heizkessel (generisch)",
    hotWaterEnergySource: "Heizöl",
  },
};

export interface AttributeContext {
  rules: ConstructionRules;
  /** When the permit is decided — tariffs and rules are those of this moment. */
  permitAtMs: number;
  builtAtMs: number;
  /** Whether a street the building fronts on has district heating pipes (districtHeat.ts). */
  districtHeatingOnStreet: boolean;
  /** Independent uniform(0,1) draws for this building's own random attributes. */
  draws: { quality: number; heating: number; solar: number };
}

/** Fills in a draft building's construction-dependent attributes. The draft must
 * already have its footprint, floors, dwellings and construction year — the heating
 * cost comparison prices against its envelope and dwelling count. */
export function applyNewBuildAttributes(building: Building, ctx: AttributeContext): void {
  building.energyReferenceAreaM2 = (building.footprintAreaM2 ?? 0) * Math.max(1, building.floorCount ?? 1) * EBF_FRACTION_OF_GFA;

  const [qMin, qMax] = NEW_BUILD_QUALITY_FACTOR_RANGE;
  const codeUValue = baseUValueForYear(building.constructionYear);
  building.uValueWPerM2K = codeUValue * (qMin + ctx.draws.quality * (qMax - qMin)) * ctx.rules.uValueFactor;

  const isAvailable = (id: HeatingSystemId) => ctx.rules.allowedHeating.has(id) && (id !== "districtHeating" || ctx.districtHeatingOnStreet);
  const choice = chooseNewBuildHeating(building, ctx.permitAtMs, isAvailable, ctx.draws.heating, HEATING_CHOICE_TEMPERATURE);
  Object.assign(building, HEATING_STRINGS[choice.chosen]);

  logCandidateDecision({
    atMs: ctx.permitAtMs,
    kind: "construction",
    egid: building.egid,
    entityKey: `${building.egid}:new-build-heating`,
    incumbent: null,
    chosen: choice.chosen,
    reasonKind: "weighted",
    candidates: choice.candidates.map((c) => ({
      id: c.id,
      label: c.label,
      available: c.available,
      annualizedCostRp: c.annualizedCostRp,
      effectiveCostRp: c.effectiveCostRp,
      weight: c.weight,
      greenness: c.greenness,
    })),
    biasStrengthRp: choice.biasStrengthRp,
    extra: { districtHeatingOnStreet: ctx.districtHeatingOnStreet, uValueWPerM2K: building.uValueWPerM2K, floors: building.floorCount ?? 0, dwellings: building.dwellings.length },
  });

  registerNewBuildSolar(building, ctx.builtAtMs, ctx.rules, ctx.draws.solar);
}
