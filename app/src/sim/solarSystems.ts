/**
 * Constants and small pure formulas behind solarAdoption.ts's three questions
 * (what gets installed, sized against a building's own footprint; what it
 * costs; what a panel converts sunlight at) — kept separate from the
 * decision engine itself the same way heatingSystems.ts/mobilitySystems.ts
 * separate their catalogs from heatingRenewal.ts/mobility.ts.
 *
 * Module efficiency milestones: industrial crystalline-silicon module
 * efficiency has been climbing for years and is projected to keep doing so —
 * ITRPV/Fraunhofer ISE's 2025 roadmap put average module efficiency at ~22%
 * in 2025, ~23% by 2030 (standard silicon is nearing its practical ceiling).
 * Beyond that, tandem (perovskite-on-silicon) cells are the roadmap's own bet
 * for the next real jump — commercially promising ~27-30% through the
 * early-to-mid 2030s if they scale as expected. The 2035/2040 points below
 * are this project's own interpolation of that expectation, not a directly
 * sourced figure — flagged because unlike the 2025/2030 points, whether
 * tandem cells actually scale on that timeline is a genuinely open industry
 * question, the same honest-uncertainty caveat gridCarbon.ts's own
 * projection carries.
 *
 * Install cost: Swiss residential/commercial PV pricing (2025-2026, several
 * Swiss installer/advisory sources) shows a clear size discount — roughly
 * CHF 3'000/kWp at 7kWp down to roughly CHF 2'000/kWp at 25kWp — fit here as
 * a simple power-law rather than the flat number first floated, per the
 * design discussion's own "if you have enough info you can implement that"
 * on the size/cost correlation.
 *
 * Federal subsidy: Switzerland's Einmalvergütung (EIV) already pays roughly
 * CHF 360/kWp for 2-30kWp installations (Pronovo, 2025) — baked in here as
 * an always-on baseline as heatingSystems.ts's cantonal grants are, separate
 * from the player's own municipal top-up (policy.ts).
 */

const GRID_KWH_PER_M2_AT_STC = 1; // 1000 W/m2 STC reference / 1000 W per kW — module efficiency is already a fraction, so kWp/m2 = efficiency

interface ModuleEfficiencyMilestone {
  year: number;
  fraction: number; // module efficiency as a fraction of incident irradiance, e.g. 0.22 = 22%
}

const MODULE_EFFICIENCY_MILESTONES: ModuleEfficiencyMilestone[] = [
  { year: 2010, fraction: 0.14 },
  { year: 2015, fraction: 0.165 },
  { year: 2020, fraction: 0.195 },
  { year: 2025, fraction: 0.22 }, // sourced — ITRPV/Fraunhofer ISE
  { year: 2030, fraction: 0.23 }, // sourced — ITRPV/Fraunhofer ISE
  { year: 2035, fraction: 0.26 }, // this project's interpolation toward tandem-cell adoption
  { year: 2040, fraction: 0.29 }, // this project's interpolation — see module doc's uncertainty caveat
];

/** Module efficiency for a panel installed in `year` — interpolated between
 * milestones, held flat beyond either end, same shape as gridCarbon.ts's own
 * year-keyed curve. A panel keeps whatever efficiency it was installed with
 * for its whole life (no retrofitting), so this is only ever evaluated once,
 * at adoption time. */
export function moduleEfficiencyFractionAt(year: number): number {
  const points = MODULE_EFFICIENCY_MILESTONES;
  if (year <= points[0].year) return points[0].fraction;
  if (year >= points[points.length - 1].year) return points[points.length - 1].fraction;
  for (let i = 1; i < points.length; i++) {
    if (year <= points[i].year) {
      const a = points[i - 1];
      const b = points[i];
      const t = (year - a.year) / (b.year - a.year);
      return a.fraction + (b.fraction - a.fraction) * t;
    }
  }
  return points[points.length - 1].fraction;
}

/** kWp per m2 of footprint a panel installed in `year` can extract from fully
 * usable roof — module efficiency directly, since 1000 W/m2 STC times an
 * efficiency fraction times 1 m2 is exactly that many kWp. */
export function kwpPerM2At(year: number): number {
  return moduleEfficiencyFractionAt(year) * GRID_KWH_PER_M2_AT_STC;
}

// Usable-roof-fraction distribution — see solarAdoption.ts for how this is
// drawn per building. A log-scale spread centered on MEDIAN_USABLE_FRACTION:
// chimneys, dormers, shading, orientation and setbacks eat a real (and
// real-world-variable) chunk of every roof, and a pitched roof's actual
// surface can exceed its footprint's plan-view area, which is why this is
// allowed to run above 100% rather than being capped there. Informed by
// (not precisely fit to) the real installed plants' own capacity/footprint
// spread — a sample of 37 plants across mixed panel vintages is too noisy to
// fit exactly, so this keeps the expected value plausible rather than
// chasing precision the data doesn't support.
const MEDIAN_USABLE_FRACTION = 0.4;
const USABLE_FRACTION_LOG_SPREAD = 3; // +-1.5 "octaves" -> roughly an 8x spread top-to-bottom
const MIN_USABLE_FRACTION = 0.05;
const MAX_USABLE_FRACTION = 1.3;

export function usableRoofFractionFromDraw(u: number): number {
  const fraction = MEDIAN_USABLE_FRACTION * Math.pow(2, (u - 0.5) * USABLE_FRACTION_LOG_SPREAD);
  return Math.min(MAX_USABLE_FRACTION, Math.max(MIN_USABLE_FRACTION, fraction));
}

// Install cost curve: CHF 3'000/kWp @ 7kWp -> CHF 2'000/kWp @ 25kWp, fit as
// costPerKwp = A * capacityKw^-EXPONENT, floored for large commercial roofs
// (where fixed costs like scaffolding/connection stop shrinking per kWp).
const INSTALL_COST_CURVE_A_RP_PER_KWP = 556_600; // ~CHF 5'566, the fit constant (not itself a real price point)
const INSTALL_COST_CURVE_EXPONENT = 0.32;
const INSTALL_COST_FLOOR_RP_PER_KWP = 130_000; // CHF 1'300/kWp

export function installCostRpPerKwp(capacityKw: number): number {
  const raw = INSTALL_COST_CURVE_A_RP_PER_KWP * Math.pow(Math.max(capacityKw, 1), -INSTALL_COST_CURVE_EXPONENT);
  return Math.max(INSTALL_COST_FLOOR_RP_PER_KWP, raw);
}

// Federal Einmalvergütung (EIV): ~CHF 360/kWp, applies up to a 30kWp bracket
// in reality (KLEIV); simplified here to a flat rate on the first 30kWp
// rather than also modeling GREIV's separate >100kWp program.
const FEDERAL_SUBSIDY_RP_PER_KWP = 36_000;
const FEDERAL_SUBSIDY_MAX_KWP = 30;

export function federalSubsidyRp(capacityKw: number): number {
  return Math.min(capacityKw, FEDERAL_SUBSIDY_MAX_KWP) * FEDERAL_SUBSIDY_RP_PER_KWP;
}

export const PANEL_LIFETIME_MEAN_YEARS = 28; // typical warrantied/practical PV panel service life

export const AGE_EXCLUSION_YEARS = 200; // heritage-protection stand-in — see solarAdoption.ts
