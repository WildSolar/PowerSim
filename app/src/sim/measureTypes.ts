/**
 * What a measure is. Every measure — a subsidy, a piece of municipal infrastructure, an
 * information campaign, a law — is one MeasureDef: some options the player sets, what it
 * costs, how long it takes to take effect, and which effect channels it writes to
 * (channels.ts). Adding a measure means adding a definition; nothing else in the game needs
 * to know it exists.
 */

import type { Bloc } from "../config/approval";
import type { Channels } from "./channels";
import type { PayoutCategory } from "./treasury";
import type { SubsidyCategory } from "./additionality";

export type MeasureCategory = "subsidy" | "infrastructure" | "information" | "law";

export const MEASURE_CATEGORY_LABEL: Record<MeasureCategory, string> = {
  subsidy: "Subsidies",
  infrastructure: "Infrastructure",
  information: "Information",
  law: "Laws",
};

/** What a measure is about — how the town hall groups them. */
export type MeasureTopic = "heating" | "buildings" | "mobility" | "grid" | "advice" | "advisors" | "removal";

export const MEASURE_TOPIC_ORDER: MeasureTopic[] = ["heating", "buildings", "mobility", "grid", "advice", "advisors", "removal"];

export const MEASURE_TOPIC_LABEL: Record<MeasureTopic, string> = {
  heating: "Heating",
  buildings: "Buildings & solar",
  mobility: "Mobility",
  grid: "Grid & power",
  advice: "Advice & campaigns",
  advisors: "Advisors",
  removal: "Carbon removal",
};

/** A single measure's kind, for a tag on its card. */
export const MEASURE_CATEGORY_SINGULAR: Record<MeasureCategory, string> = {
  subsidy: "Subsidy",
  infrastructure: "Infrastructure",
  information: "Information",
  law: "Law",
};

export type ParamValue = number | boolean | string;
export type MeasureParams = Record<string, ParamValue>;

export type ParamSpec =
  | { kind: "slider"; key: string; label: string; min: number; max: number; step: number; unit: string; default: number; isYear?: boolean }
  | { kind: "toggle"; key: string; label: string; default: boolean }
  | { kind: "choice"; key: string; label: string; options: { value: string; label: string }[]; default: string };

/** What a cost formula may depend on. */
export interface MeasureCostContext {
  residents: number;
}

/** A measure that builds something over years, instead of acting at once: while it is in force the
 * department pays its share of the credit month by month, and the effect grows with what is built.
 * What is built stays if the measure ends. */
export interface MeasureBuildOut {
  /** How long building up to its target takes, whatever the target. */
  years: number;
  /** How much of the full build-out these settings aim for, 0-1. */
  target(params: MeasureParams): number;
  /** The whole credit for the full build-out, whoever pays it. */
  fullCreditRp(ctx: MeasureCostContext): number;
  /** The share of the credit the department carries. */
  departmentShare: number;
  /** The department's upkeep a year for all of it built, in proportion to what is built. */
  upkeepRp(ctx: MeasureCostContext): number;
  /** What this much of it built (0-1) does to the simulation, from the first stretch on. */
  effects(built: number): Partial<Channels>;
}

/** When a measure goes to a public vote. */
export type MeasureReferendum = "mandatory" | "optional";

export interface MeasureDef {
  id: string;
  category: MeasureCategory;
  topic: MeasureTopic;
  title: string;
  /** One or two sentences for the player: what it does and what drives it. */
  summary: string;
  params: ParamSpec[];
  /** Months between enacting (or changing) the measure and it taking effect. */
  leadTimeMonths: number;
  /** What the measure does to the simulation. */
  effects(params: MeasureParams): Partial<Channels>;
  /** A one-off cost, paid when the measure is enacted; a change pays only what it adds. */
  oneOffCostRp?(params: MeasureParams, ctx: MeasureCostContext): number;
  /** A running cost, paid monthly while the measure is in effect. */
  annualCostRp?(params: MeasureParams, ctx: MeasureCostContext): number;
  /** Which ledger line the costs above belong on (default: programs). */
  costCategory?: PayoutCategory;
  /** How each voter bloc feels about the measure at these settings, -1 (bitterly opposed) to +1 (delighted).
   * Blocs not listed don't care. Hidden from the player. */
  approval?(params: MeasureParams): Partial<Record<Bloc, number>>;
  /** How strongly the measure acts at these settings against its defaults (1): a grant's amount, a
   * programme's reach, a law's stringency. At 0 it does nothing, and setting it there repeals it.
   * The blocs' feelings follow it (approval.ts), unless `approvalFollowsSettings`. */
  strength?(params: MeasureParams): number;
  /** Its approval already depends on the settings: strength doesn't scale it again. */
  approvalFollowsSettings?: boolean;
  /** A subsidy programme: which kind of household decision it pays for — what its uptake counts
   * and an evaluation study looks at (studies.ts). */
  subsidyCategory?: SubsidyCategory;
  /** Built over years rather than switched on (its credit goes on the `costCategory` line). */
  buildOut?: MeasureBuildOut;
  /** Whether the measure goes to a public vote: always, or only when contested; a credit may depend
   * on its size. */
  referendum?: MeasureReferendum | ((params: MeasureParams) => MeasureReferendum | undefined);
}

export function referendumOf(def: MeasureDef, params: MeasureParams): MeasureReferendum | undefined {
  return typeof def.referendum === "function" ? def.referendum(params) : def.referendum;
}

export function defaultParams(def: MeasureDef): MeasureParams {
  return Object.fromEntries(def.params.map((p) => [p.key, p.default]));
}

/** Clamps every value into its spec (and fills in anything missing). */
export function sanitizeParams(def: MeasureDef, raw: MeasureParams): MeasureParams {
  const clean: MeasureParams = {};
  for (const spec of def.params) {
    const value = raw[spec.key];
    if (spec.kind === "slider") {
      const n = typeof value === "number" && Number.isFinite(value) ? value : spec.default;
      clean[spec.key] = Math.min(spec.max, Math.max(spec.min, n));
    } else if (spec.kind === "toggle") {
      clean[spec.key] = typeof value === "boolean" ? value : spec.default;
    } else {
      clean[spec.key] = spec.options.some((o) => o.value === value) ? (value as string) : spec.default;
    }
  }
  return clean;
}
