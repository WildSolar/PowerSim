/**
 * Effect channels: the named dials the simulation reads. A measure (measures.ts) never
 * touches the engine directly — it contributes a patch to some channels, and every module
 * that cares (renewal decisions, solar adoption, construction rules, the stock...) reads
 * the resolved values. Measures enacted by the player and measures imposed by the canton
 * or federal government feed the very same channels, so the engine cannot tell who acted.
 *
 * Each channel says how contributions from several measures combine: subsidies add up,
 * a ban anywhere is a ban, multipliers multiply.
 */

import type { EnergyClassId } from "./energyClass";
import { energyClassRank } from "./energyClass";

export interface Channels {
  // Solar
  solarOutreachLevel: number; // 0-100: how hard the municipality promotes solar (raises the adoption hazard)
  solarSubsidyRpPerKwp: number; // municipal top-up per kWp
  solarSubsidyFixedRp: number; // municipal top-up per installation
  municipalSolarBuildingsPerYear: number; // public buildings the municipality itself puts solar on each year

  // Heating, mobility, retrofits
  heatPumpSubsidyRp: number; // flat municipal grant per heat pump installed
  evSubsidyRp: number; // flat municipal grant per electric car bought
  retrofitSubsidyRpPerM2: number; // municipal top-up per m2 of envelope on an upgrade
  retrofitMinClass: EnergyClassId | "none"; // an envelope renovation must reach at least this class
  fossilHeatingInstallBanned: boolean; // no new gas or oil heating when a system is replaced
  iceCarPurchaseBanned: boolean; // no new petrol or diesel cars

  // Decisions in general
  uncertaintyMultiplier: number; // scales the indifference band of every investment decision (information campaigns shrink it)

  // New buildings and growth
  newBuildSolarMandatePct: number; // 0-100: share of a new roof's usable capacity it must carry
  newBuildSolarMandateMinFootprintM2: number; // buildings with a smaller footprint are exempt from the mandate
  newBuildInsulationLevel: number; // 0-100: 0 = code standard, 100 = passive-house-grade envelope
  newBuildFossilHeatingAllowed: boolean; // the building code forbids fossil heating in new builds by default
  growthMultiplier: number; // scales the historic growth rate
  renewalRateMultiplier: number; // scales how often old buildings are replaced
}

export const CHANNEL_DEFAULTS: Channels = {
  solarOutreachLevel: 0,
  solarSubsidyRpPerKwp: 0,
  solarSubsidyFixedRp: 0,
  municipalSolarBuildingsPerYear: 0,
  heatPumpSubsidyRp: 0,
  evSubsidyRp: 0,
  retrofitSubsidyRpPerM2: 0,
  retrofitMinClass: "none",
  fossilHeatingInstallBanned: false,
  iceCarPurchaseBanned: false,
  uncertaintyMultiplier: 1,
  newBuildSolarMandatePct: 0,
  newBuildSolarMandateMinFootprintM2: 0,
  newBuildInsulationLevel: 0,
  newBuildFossilHeatingAllowed: false,
  growthMultiplier: 1,
  renewalRateMultiplier: 1,
};

type Combiner<T> = (values: T[]) => T;

const sum: Combiner<number> = (v) => v.reduce((a, b) => a + b, 0);
const max: Combiner<number> = (v) => Math.max(...v);
const product: Combiner<number> = (v) => v.reduce((a, b) => a * b, 1);
const latest = <T>(v: T[]): T => v[v.length - 1];
const any: Combiner<boolean> = (v) => v.some(Boolean);
const strictestClass: Combiner<EnergyClassId | "none"> = (v) =>
  v.reduce((best, c) => (c !== "none" && (best === "none" || energyClassRank(c) > energyClassRank(best)) ? c : best), "none" as EnergyClassId | "none");

const COMBINERS: { [K in keyof Channels]: Combiner<Channels[K]> } = {
  solarOutreachLevel: max,
  solarSubsidyRpPerKwp: sum,
  solarSubsidyFixedRp: sum,
  municipalSolarBuildingsPerYear: sum,
  heatPumpSubsidyRp: sum,
  evSubsidyRp: sum,
  retrofitSubsidyRpPerM2: sum,
  retrofitMinClass: strictestClass,
  fossilHeatingInstallBanned: any,
  iceCarPurchaseBanned: any,
  uncertaintyMultiplier: product,
  newBuildSolarMandatePct: max,
  newBuildSolarMandateMinFootprintM2: latest,
  newBuildInsulationLevel: max,
  newBuildFossilHeatingAllowed: any,
  growthMultiplier: product,
  renewalRateMultiplier: product,
};

/** Resolves the defaults plus every measure's patch (in the order given) into one set of channels. */
export function combineChannels(patches: Partial<Channels>[]): Channels {
  const resolved = { ...CHANNEL_DEFAULTS } as Record<string, unknown>;
  for (const key of Object.keys(CHANNEL_DEFAULTS) as (keyof Channels)[]) {
    const contributions = patches.filter((p) => p[key] !== undefined).map((p) => p[key]);
    if (contributions.length === 0) continue;
    const combine = COMBINERS[key] as Combiner<unknown>;
    // The default takes part too, so e.g. a multiplier starts from 1 and a sum from 0.
    resolved[key] = combine([CHANNEL_DEFAULTS[key], ...contributions]);
  }
  return resolved as unknown as Channels;
}
