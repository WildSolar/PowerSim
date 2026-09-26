/**
 * Every tunable number behind solar adoption's three questions (what gets
 * installed, sized against a building's own footprint; what it costs; when
 * a building seriously considers it) — sim/solarSystems.ts and
 * sim/solarAdoption.ts hold the formulas/decision engine, this file holds
 * every number that goes into them.
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
 * question, the same honest-uncertainty caveat the grid-carbon curve
 * (config/emissions.ts) carries.
 *
 * Install cost: Swiss residential/commercial PV pricing (2025-2026, several
 * Swiss installer/advisory sources) shows a clear size discount — roughly
 * CHF 3'000/kWp at 7kWp down to roughly CHF 2'000/kWp at 25kWp — fit here as
 * a simple power-law.
 *
 * Federal subsidy: Switzerland's Einmalvergütung (EIV) already pays roughly
 * CHF 360/kWp for 2-30kWp installations (Pronovo, 2025) — baked in here as
 * an always-on baseline as heatingSystems.ts's cantonal grants are, separate
 * from the player's own municipal top-up (config/policy.ts).
 */

import type { CurvePoint } from "./curve";

export const GRID_KWH_PER_M2_AT_STC = 1; // 1000 W/m2 STC reference / 1000 W per kW — module efficiency is already a fraction, so kWp/m2 = efficiency

// Interpolated via config/curve.ts; add/move/extend points here to recalibrate.
export const MODULE_EFFICIENCY_CURVE: CurvePoint[] = [
  { x: 2010, y: 0.14 },
  { x: 2015, y: 0.165 },
  { x: 2020, y: 0.195 },
  { x: 2025, y: 0.22 }, // sourced — ITRPV/Fraunhofer ISE
  { x: 2030, y: 0.23 }, // sourced — ITRPV/Fraunhofer ISE
  { x: 2035, y: 0.26 }, // this project's interpolation toward tandem-cell adoption
  { x: 2040, y: 0.29 }, // this project's interpolation — see module doc's uncertainty caveat
];

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
export const MEDIAN_USABLE_FRACTION = 0.4;
export const USABLE_FRACTION_LOG_SPREAD = 3; // +-1.5 "octaves" -> roughly an 8x spread top-to-bottom
export const MIN_USABLE_FRACTION = 0.05;
export const MAX_USABLE_FRACTION = 1.3;

// Install cost curve: CHF 3'000/kWp @ 7kWp -> CHF 2'000/kWp @ 25kWp, fit as
// costPerKwp = A * capacityKw^-EXPONENT, floored for large commercial roofs
// (where fixed costs like scaffolding/connection stop shrinking per kWp).
export const INSTALL_COST_CURVE_A_RP_PER_KWP = 556_600; // ~CHF 5'566, the fit constant (not itself a real price point)
export const INSTALL_COST_CURVE_EXPONENT = 0.32;
export const INSTALL_COST_FLOOR_RP_PER_KWP = 130_000; // CHF 1'300/kWp

// Federal Einmalvergütung (EIV): ~CHF 360/kWp, applies up to a 30kWp bracket
// in reality (KLEIV); simplified here to a flat rate on the first 30kWp
// rather than also modeling GREIV's separate >100kWp program.
export const FEDERAL_SUBSIDY_RP_PER_KWP = 36_000;
export const FEDERAL_SUBSIDY_MAX_KWP = 30;

export const PANEL_LIFETIME_MEAN_YEARS = 28; // typical warrantied/practical PV panel service life
export const AGE_EXCLUSION_YEARS = 200; // heritage-protection stand-in — see solarAdoption.ts

// --- solarAdoption.ts: the "when" hazard-rate engine ---

export const BASE_ANNUAL_HAZARD = 0.02; // 2%/year spontaneous "have I thought about this" baseline
export const MAX_ANNUAL_HAZARD = 0.95; // clamp — never a near-certainty even with every boost stacked
// Cheaper panels bring more owners to look into solar at all (a shorter payback travels by word of
// mouth and installers' marketing): the yearly chance scales with (today's price / the price then)
// to this power — a quarter cheaper, a good half again as many owners considering it. A placeholder.
export const SOLAR_PRICE_HAZARD_ELASTICITY = 1.5;
export const RENEWAL_BOOST_MULTIPLIER = 3; // a recent heating renewal roughly triples that year's chance
export const RENEWAL_BOOST_YEARS = 3;
export const NEIGHBOR_RADIUS_M = 250;
export const NEIGHBOR_BOOST_PER_ADOPTER = 0.15; // +15% relative hazard per adopted neighbor within radius
export const NEIGHBOR_BOOST_CAP = 2.5; // neighbor effect alone can at most 2.5x the hazard

// --- solarAdoption.ts: the "if" four-factor decision ---

export const SOLAR_UNCERTAINTY_FRACTION = 0.12; // flat, no size proxy — same judgment call as mobility's vehicle-type choice
export const SOLAR_BIAS_MAGNITUDE_RP_PER_YEAR = 40_000; // CHF 400/yr at full lean
