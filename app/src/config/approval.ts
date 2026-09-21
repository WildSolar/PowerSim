/**
 * Every tunable number behind public approval (sim/approval.ts). The player sees ONE approval
 * figure; behind it sit several voter blocs that react differently to each measure (the stances
 * are declared per measure, in sim/measureCatalog.ts). All figures are judgment calls.
 */

export type Bloc = "homeowners" | "tenants" | "drivers" | "business" | "climate";

export const BLOC_ORDER: Bloc[] = ["homeowners", "tenants", "drivers", "business", "climate"];

export const BLOC_LABEL: Record<Bloc, string> = {
  homeowners: "Homeowners",
  tenants: "Tenants",
  drivers: "Drivers and commuters",
  business: "Businesses",
  climate: "Climate-concerned residents",
};

/** Each bloc's weight in the overall approval figure and in a vote; sums to 1. */
export const BLOC_WEIGHT: Record<Bloc, number> = {
  homeowners: 0.28,
  tenants: 0.3,
  drivers: 0.17,
  business: 0.1,
  climate: 0.15,
};

// --- Level and movement (all approval values are 0-100) ---

export const BASE_APPROVAL = 60; // where every bloc rests when nothing contentious is in force
export const START_JITTER = 5; // each bloc starts within +-this of the base, by seed
export const MAX_SWING = 35; // a bloc's resting level moves at most this far from the base
export const STANCE_SATURATION = 0.6; // tanh steepness: piling up popular measures has diminishing returns
export const RELAXATION_MONTHS = 10; // how fast a bloc drifts toward its resting level

// --- Immediate reactions to a decision ---

export const ENACT_SHOCK_POINTS = 5; // a bloc moves this much (x stance) the day a measure is enacted
export const REPEAL_RECOVERY_FRACTION = 0.6; // repealing gives back this share of the enactment shock
export const REPEAL_PENALTY_POINTS = 1.5; // and looks indecisive: everyone loses this much

// --- Referendums ---

export const VOTE_DELAY_MONTHS = 6; // enactment -> vote
export const OPTIONAL_REFERENDUM_STANCE = -0.05; // a law whose net stance is below this gets challenged
export const VOTE_STANCE_SENSITIVITY = 0.9; // net stance -> yes share
export const VOTE_MOOD_SENSITIVITY = 0.25; // overall approval above/below 50 -> yes share
export const VOTE_NOISE_POINTS = 4; // campaign luck, +-percentage points
export const POLL_NOISE_POINTS = 4; // a poll's error, +-percentage points
export const VOTE_WON_POINTS = 2; // approval bonus for everyone when the voters back you
export const VOTE_LOST_POINTS = 4; // and the rebuke when they don't

// --- Fiscal responsibility ---
// Taxpayers accept spending up to the government's own yearly allocation for the energy department; beyond it
// (the utility's margin quietly covers the difference) they start to grumble. The penalty is on every bloc's
// resting level, growing from nothing at the allocation to the maximum at FISCAL_FULL_RATIO times it.
export const FISCAL_FULL_RATIO = 2.5;
export const FISCAL_MAX_PENALTY_POINTS = 18;
export const FISCAL_BLOC_WEIGHT: Record<Bloc, number> = {
  homeowners: 1.2,
  tenants: 0.7,
  drivers: 1,
  business: 1.4,
  climate: 0.5,
};

// --- Consequences ---

export const WARNING_APPROVAL = 40;
export const RECALL_APPROVAL = 25; // below this for RECALL_MONTHS in a row and the municipality recalls you
export const RECALL_MONTHS = 6;
export const ELECTION_FIRST_YEAR = 2030;
export const ELECTION_INTERVAL_YEARS = 4;
export const ELECTION_MONTH = 2; // March (0-based)
export const ELECTION_THRESHOLD = 45; // re-elected at or above this

/** The government's yearly allocation moves by this fraction of (approval - base) / 100: a well-regarded
 * department gets more to work with. */
export const ALLOCATION_APPROVAL_SENSITIVITY = 0.5;
