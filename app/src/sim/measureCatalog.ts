/**
 * Every measure the player can enact. A definition says what the options are, what it
 * costs, how long it takes to bite, and which channels it writes to — see measureTypes.ts.
 * All the numbers here (cost scales, lead times, effect sizes) are judgment calls for the
 * player to balance against, not real prices; edit them here.
 */

import type { MeasureDef } from "./measureTypes";

const CHF = 100; // Rappen per franc

function num(params: Record<string, unknown>, key: string): number {
  return params[key] as number;
}

export const MEASURE_CATALOG: MeasureDef[] = [
  // --- Subsidies --------------------------------------------------------------------------
  {
    id: "solar-subsidy",
    category: "subsidy",
    title: "Solar subsidy",
    summary:
      "A municipal top-up on the federal one-off payment every installation already gets: per kWp installed, plus an optional fixed bonus per installation. Paid when a building actually adopts.",
    params: [
      { kind: "slider", key: "perKwp", label: "Per kWp", min: 0, max: 2000, step: 50, unit: "CHF/kWp", default: 300 },
      { kind: "slider", key: "fixed", label: "Fixed bonus", min: 0, max: 10000, step: 250, unit: "CHF each", default: 0 },
    ],
    leadTimeMonths: 1,
    effects: (p) => ({ solarSubsidyRpPerKwp: num(p, "perKwp") * CHF, solarSubsidyFixedRp: num(p, "fixed") * CHF }),
    approval: () => ({ homeowners: 0.5, tenants: 0.1, business: 0.2, climate: 0.6 }),
  },
  {
    id: "heat-pump-grant",
    category: "subsidy",
    title: "Heat pump grant",
    summary: "A flat municipal grant, on top of the cantonal one, whenever a building replaces its heating with a heat pump.",
    params: [{ kind: "slider", key: "amount", label: "Grant", min: 0, max: 20000, step: 500, unit: "CHF each", default: 5000 }],
    leadTimeMonths: 1,
    effects: (p) => ({ heatPumpSubsidyRp: num(p, "amount") * CHF }),
    approval: () => ({ homeowners: 0.6, tenants: 0.1, business: 0.1, climate: 0.6 }),
  },
  {
    id: "ev-grant",
    category: "subsidy",
    title: "Electric car grant",
    summary: "A flat municipal grant whenever a household buys an electric car.",
    params: [{ kind: "slider", key: "amount", label: "Grant", min: 0, max: 10000, step: 500, unit: "CHF each", default: 3000 }],
    leadTimeMonths: 1,
    effects: (p) => ({ evSubsidyRp: num(p, "amount") * CHF }),
    approval: () => ({ drivers: 0.5, homeowners: 0.2, climate: 0.5 }),
  },
  {
    id: "retrofit-topup",
    category: "subsidy",
    title: "Insulation retrofit top-up",
    summary: "A municipal top-up, per m² of building envelope, on the federal building-program grant when an owner upgrades the insulation.",
    params: [{ kind: "slider", key: "perM2", label: "Top-up", min: 0, max: 200, step: 5, unit: "CHF/m²", default: 40 }],
    leadTimeMonths: 2,
    effects: (p) => ({ retrofitSubsidyRpPerM2: num(p, "perM2") * CHF }),
    approval: () => ({ homeowners: 0.6, tenants: 0.2, climate: 0.5 }),
  },

  // --- Infrastructure -----------------------------------------------------------------------
  {
    id: "municipal-solar",
    category: "infrastructure",
    title: "Solar on public buildings",
    summary:
      "The municipality puts solar on its own schools, halls and other public buildings, a few each year. The panels cost the treasury their price (less the federal payment) and generate from then on.",
    params: [{ kind: "slider", key: "perYear", label: "Buildings per year", min: 0, max: 20, step: 1, unit: "per year", default: 3 }],
    leadTimeMonths: 6,
    effects: (p) => ({ municipalSolarBuildingsPerYear: num(p, "perYear") }),
    approval: () => ({ climate: 0.6, tenants: 0.1, homeowners: 0.1, business: -0.1 }),
  },

  // --- Information ----------------------------------------------------------------------------
  {
    id: "solar-outreach",
    category: "information",
    title: "Solar information campaign",
    summary: "Info events and campaigns that make owners seriously consider solar more often — up to about three times as often at full effort. A running cost, in proportion to the effort.",
    params: [{ kind: "slider", key: "level", label: "Effort", min: 0, max: 100, step: 5, unit: "%", default: 50 }],
    leadTimeMonths: 3,
    effects: (p) => ({ solarOutreachLevel: num(p, "level") }),
    annualCostRp: (p, ctx) => (num(p, "level") / 100) * ctx.residents * 6 * CHF,
    approval: () => ({ climate: 0.3, homeowners: 0.1 }),
  },
  {
    id: "energy-consulting",
    category: "information",
    title: "Energy consulting",
    summary:
      "Independent advice for owners and households. It narrows the uncertainty every investment decision (boiler, insulation, vehicle, solar) is made under, so people act on clear savings more readily and stop chasing marginal ones.",
    params: [
      {
        kind: "choice",
        key: "scope",
        label: "Scope",
        options: [
          { value: "basic", label: "Free first consultation" },
          { value: "extensive", label: "Extensive, on-site advice" },
        ],
        default: "basic",
      },
    ],
    leadTimeMonths: 6,
    effects: (p) => ({ uncertaintyMultiplier: p.scope === "extensive" ? 0.6 : 0.85 }),
    oneOffCostRp: () => 50_000 * CHF,
    annualCostRp: (p, ctx) => ctx.residents * (p.scope === "extensive" ? 14 : 4) * CHF,
    approval: () => ({ homeowners: 0.3, tenants: 0.2, business: 0.2, climate: 0.3 }),
  },

  // --- Laws ------------------------------------------------------------------------------------
  {
    id: "solar-mandate",
    category: "law",
    title: "Solar mandate for new buildings",
    summary:
      "New buildings must carry a share of their roof's usable solar capacity, on top of the building code's own minimum. You can exempt small buildings. Applies to permits from the day it takes effect.",
    params: [
      { kind: "slider", key: "share", label: "Share of usable roof", min: 0, max: 100, step: 10, unit: "%", default: 60 },
      { kind: "slider", key: "minFootprint", label: "Only buildings over", min: 0, max: 1000, step: 50, unit: "m² footprint", default: 0 },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ newBuildSolarMandatePct: num(p, "share"), newBuildSolarMandateMinFootprintM2: num(p, "minFootprint") }),
    approval: (p) => {
      const share = num(p, "share") / 100;
      return { homeowners: -0.1 - 0.4 * share, business: -0.05 - 0.25 * share, climate: 0.3 + 0.4 * share };
    },
    referendum: "optional",
  },
  {
    id: "insulation-standard",
    category: "law",
    title: "Insulation standard for new buildings",
    summary: "A stricter envelope standard for new buildings than the building code, up to passive-house grade. Heat demand falls; construction gets no cheaper, but the heating bill does.",
    params: [{ kind: "slider", key: "level", label: "Standard", min: 0, max: 100, step: 10, unit: "% toward passive house", default: 50 }],
    leadTimeMonths: 12,
    effects: (p) => ({ newBuildInsulationLevel: num(p, "level") }),
    approval: (p) => {
      const level = num(p, "level") / 100;
      return { homeowners: -0.1 - 0.3 * level, tenants: -0.05 - 0.15 * level, business: -0.1 - 0.2 * level, climate: 0.3 + 0.4 * level };
    },
    referendum: "optional",
  },
  {
    id: "retrofit-minimum",
    category: "law",
    title: "Minimum standard for renovations",
    summary:
      "An owner who renovates the building envelope must bring it to at least this class — no half-measures. Owners can still leave the envelope alone, so it can slow renovation as well as deepen it.",
    params: [
      {
        kind: "choice",
        key: "minClass",
        label: "Minimum class",
        options: [
          { value: "standard", label: "Current standard" },
          { value: "minergie", label: "Minergie" },
        ],
        default: "standard",
      },
    ],
    leadTimeMonths: 12,
    effects: (p) => ({ retrofitMinClass: p.minClass as "standard" | "minergie" }),
    approval: (p) => ({ homeowners: p.minClass === "minergie" ? -0.7 : -0.5, tenants: -0.3, business: -0.1, climate: 0.4 }),
    referendum: "optional",
  },
  {
    id: "fossil-heating-ban",
    category: "law",
    title: "Ban on new fossil heating",
    summary: "When a building replaces its heating, it may no longer install a gas or oil system. Existing systems run until they wear out.",
    params: [],
    leadTimeMonths: 24,
    effects: () => ({ fossilHeatingInstallBanned: true }),
    approval: () => ({ homeowners: -0.5, tenants: -0.1, business: -0.2, climate: 0.8 }),
    referendum: "mandatory",
  },
  {
    id: "ice-car-ban",
    category: "law",
    title: "Ban on new petrol and diesel cars",
    summary: "Households may no longer buy a new petrol or diesel car. Existing cars stay on the road until they are replaced.",
    params: [],
    leadTimeMonths: 36,
    effects: () => ({ iceCarPurchaseBanned: true }),
    approval: () => ({ drivers: -0.8, homeowners: -0.2, tenants: -0.2, business: -0.4, climate: 0.8 }),
    referendum: "mandatory",
  },
];

export const MEASURE_BY_ID = new Map(MEASURE_CATALOG.map((m) => [m.id, m]));
