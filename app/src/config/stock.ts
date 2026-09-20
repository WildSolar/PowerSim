/**
 * Every tunable number behind town growth and building renewal (sim/stock.ts,
 * sim/newBuild.ts). Rates are calibrated per municipality from its own GWR
 * construction/demolition history where available; the constants here are the
 * clamps around that calibration and the shape of everything else.
 */

import type { SiteZone } from "../data/types";

// --- Renewal: when an existing building is replaced ---

export const MIN_RENEWAL_AGE_YEARS = 30; // no renewal hazard at all before this age
export const RENEWAL_WEIBULL_SHAPE = 3; // increasing hazard once past the minimum age — the older, the likelier
export const FALLBACK_BUILDING_AGE_YEARS = 45; // no construction year on record
export const RENEWAL_RATE_HISTORY_YEARS = 8; // recent demolition history, not the whole window — the rate has been rising
export const RENEWAL_RATE_FLOOR = 0.004; // share of floor space replaced per year, clamps around the historic figure
export const RENEWAL_RATE_CAP = 0.015;
export const RENEWAL_CALIBRATION_HORIZON_YEARS = 30;

// A renewal trigger pulls in adjacent buildings of the same construction year (one project: a housing estate).
export const CLUSTER_ADJACENT_GAP_M = 6;
export const CLUSTER_JOIN_PROBABILITY = 0.8;
export const CLUSTER_MAX_BUILDINGS = 12;

export const REPLACEMENT_UPLIFT_MIN = 1.2; // a replacement holds 20-30% more dwellings / floor space
export const REPLACEMENT_UPLIFT_MAX = 1.3;
export const HEIGHT_CAP_RADIUS_M = 120; // new floors are capped at the tallest neighbour in this radius, plus...
export const HEIGHT_CAP_EXTRA_FLOORS = 1;
export const HEIGHT_CAP_MIN_FLOORS = 3;

// --- Growth: new buildings on vacant sites ---

export const GROWTH_RATE_DEFAULT = 0.01; // no history available
export const GROWTH_RATE_FLOOR = 0.003;
export const GROWTH_RATE_CAP = 0.02;
// Arrival rate is steered toward the growth target: a shortfall (or surplus) so far speeds (slows) new
// arrivals, bounded so one bad stretch can't stall or flood the pipeline.
export const GROWTH_CORRECTION_MIN = 0.3;
export const GROWTH_CORRECTION_MAX = 3;

export const SITE_PLACEMENT_ATTEMPTS = 60;
export const SITE_SIZE_SHRINK_STEPS = 4; // retry smaller (x0.85 each) before giving up on a site
export const SITE_NEW_BUILDING_MARGIN_M = 6; // clear gap kept between two new buildings on one site
export const SITE_EXHAUSTED_AFTER_FAILURES = 2;
export const NEW_BUILDING_SIZE_JITTER = 0.15;

// --- Construction timeline ---

export const PERMIT_DELAY_MONTHS: [number, number] = [3, 6]; // decision -> groundbreaking / demolition
export const CONSTRUCTION_MONTHS_BASE = 10;
export const CONSTRUCTION_MONTHS_PER_1000_M2_GFA = 2.5;
export const CONSTRUCTION_MONTHS_RANGE: [number, number] = [12, 30];

// --- Attributes of a new or replacement building ---

export const EBF_FRACTION_OF_GFA = 0.8; // energy reference area / (footprint x floors), median in GWR
export const NEW_BUILD_QUALITY_FACTOR_RANGE: [number, number] = [0.9, 1.05]; // workmanship spread on the code U-value
export const CODE_SOLAR_W_PER_M2_EBF = 10; // building-code minimum own PV generation
export const NEW_BUILD_VOLUNTARY_SOLAR_SHARE = 0.55; // chance of a full-roof array beyond the code minimum
export const HEATING_CHOICE_TEMPERATURE = 0.3; // softmax width, as a fraction of the cheapest system's annual cost
export const DISTRICT_HEATING_REACH_M = 70; // a new building can only join district heat within this of an existing customer
export const GFA_PER_APARTMENT_FALLBACK_M2 = 110;

/** Which building groups a new building on a site of each zone can be, with weights. */
export type BuildingGroup = "houseSingle" | "apartments" | "commercial" | "industrial" | "public";

export const ZONE_GROUP_WEIGHTS: Record<SiteZone, Partial<Record<BuildingGroup, number>>> = {
  residential: { houseSingle: 0.35, apartments: 0.65 },
  work: { industrial: 0.55, commercial: 0.45 },
  mixed: { apartments: 0.55, commercial: 0.35, houseSingle: 0.1 },
  centre: { apartments: 0.4, commercial: 0.6 },
  public: { public: 1 },
};
// A small residential site takes a house, a large one takes apartments.
export const SMALL_RESIDENTIAL_SITE_M2 = 900;
