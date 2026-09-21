/**
 * What a measure is. Every measure — a subsidy, a piece of municipal infrastructure, an
 * information campaign, a law — is one MeasureDef: some options the player sets, what it
 * costs, how long it takes to take effect, and which effect channels it writes to
 * (channels.ts). Adding a measure means adding a definition; nothing else in the game needs
 * to know it exists.
 */

import type { Channels } from "./channels";
import type { PayoutCategory } from "./treasury";

export type MeasureCategory = "subsidy" | "infrastructure" | "information" | "law";

export const MEASURE_CATEGORY_LABEL: Record<MeasureCategory, string> = {
  subsidy: "Subsidies",
  infrastructure: "Infrastructure",
  information: "Information",
  law: "Laws",
};

export type ParamValue = number | boolean | string;
export type MeasureParams = Record<string, ParamValue>;

export type ParamSpec =
  | { kind: "slider"; key: string; label: string; min: number; max: number; step: number; unit: string; default: number }
  | { kind: "toggle"; key: string; label: string; default: boolean }
  | { kind: "choice"; key: string; label: string; options: { value: string; label: string }[]; default: string };

/** What a cost formula may depend on. */
export interface MeasureCostContext {
  residents: number;
}

export interface MeasureDef {
  id: string;
  category: MeasureCategory;
  title: string;
  /** One or two sentences for the player: what it does and what drives it. */
  summary: string;
  params: ParamSpec[];
  /** Months between enacting (or changing) the measure and it taking effect. */
  leadTimeMonths: number;
  /** What the measure does to the simulation. */
  effects(params: MeasureParams): Partial<Channels>;
  /** A one-off cost, paid when the measure is enacted or changed. */
  oneOffCostRp?(params: MeasureParams, ctx: MeasureCostContext): number;
  /** A running cost, paid monthly while the measure is in effect. */
  annualCostRp?(params: MeasureParams, ctx: MeasureCostContext): number;
  /** Which ledger line the costs above belong on (default: programs). */
  costCategory?: PayoutCategory;
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
