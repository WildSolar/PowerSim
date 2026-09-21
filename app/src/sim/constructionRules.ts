/**
 * The single place every rule governing what a new or replacement building may be
 * (and how much of it gets built) is decided — the hook the policy layer plugs into.
 * A building code sets the baseline; the player's policy tightens it. stock.ts and
 * newBuild.ts read only this, never the raw Policy, so adding a lever later means
 * adding a field here and consuming it where the attribute is drawn.
 *
 * Rules are evaluated when a project's permit is decided, not when it finishes —
 * so a policy change takes effect on the next projects and reaches the skyline
 * over the following construction period, like the real thing.
 */

import { CODE_SOLAR_W_PER_M2_EBF } from "../config/stock";
import type { EnergyClassId } from "./energyClass";
import type { HeatingSystemId } from "./heatingSystems";
import type { Policy } from "./policy";

export interface ConstructionRules {
  /** Heating systems a new building may choose from (district heating is further
   * limited to where a network exists — see newBuild.ts). */
  allowedHeating: ReadonlySet<HeatingSystemId>;
  /** Own PV generation a new roof must at least carry, in W per m2 of energy reference area. */
  minSolarWPerM2Ebf: number;
  /** Share (0-1) of a roof's usable PV capacity the mandate requires. */
  solarMandateFraction: number;
  /** Buildings with a smaller footprint are exempt from the mandate (the code minimum still applies). */
  solarMandateMinFootprintM2: number;
  /** Multiplier on the code-standard U-value; below 1 = better insulated than code. */
  uValueFactor: number;
  /** Multipliers on the historic growth rate and renewal rate. */
  growthMultiplier: number;
  renewalRateMultiplier: number;
}

export interface RetrofitRules {
  /** Municipal top-up per m2 of envelope on an upgrade. */
  municipalSubsidyRpPerM2: number;
  /** The lowest class an envelope renovation may end at, or null for no minimum. */
  minClass: EnergyClassId | null;
}

/** The rules for retrofits of existing buildings — the same hook, read by sim/retrofit.ts. */
export function retrofitRules(policy: Policy, _year: number): RetrofitRules {
  return {
    municipalSubsidyRpPerM2: policy.retrofitSubsidyRpPerM2,
    minClass: policy.retrofitMinClass === "none" ? null : policy.retrofitMinClass,
  };
}

const CLEAN_HEATING: HeatingSystemId[] = ["airHeatPump", "groundHeatPump", "districtHeating"];
const ALL_HEATING: HeatingSystemId[] = [...CLEAN_HEATING, "gasBoiler", "oilBoiler"];

const PASSIVE_HOUSE_U_VALUE_REDUCTION = 0.35; // insulation level 100 -> U-value 35% below code

export function constructionRules(policy: Policy, _year: number): ConstructionRules {
  return {
    allowedHeating: new Set(policy.newBuildFossilHeatingAllowed ? ALL_HEATING : CLEAN_HEATING),
    minSolarWPerM2Ebf: CODE_SOLAR_W_PER_M2_EBF,
    solarMandateFraction: policy.newBuildSolarMandatePct / 100,
    solarMandateMinFootprintM2: policy.newBuildSolarMandateMinFootprintM2,
    uValueFactor: 1 - (policy.newBuildInsulationLevel / 100) * PASSIVE_HOUSE_U_VALUE_REDUCTION,
    growthMultiplier: policy.growthMultiplier,
    renewalRateMultiplier: policy.renewalRateMultiplier,
  };
}
