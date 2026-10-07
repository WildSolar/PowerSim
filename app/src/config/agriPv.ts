// Agri-PV (sim/agriPv.ts): solar over farmland that stays farmed, on fields the municipality zones
// for it, built by businesses that buy the power. Informed placeholders.

// Designating fields: the planning work, like a zoning change (config/zoning.ts), and its procedure.
export const AGRI_PV_PLANNING_COST_CHF = 40_000;
export const AGRI_PV_PLANNING_COST_CHF_PER_HA = 3_000;
export const AGRI_PV_LEAD_MONTHS = 24;

// How people take farmland being zoned for solar, at full scale (this much land designated; less
// land, proportionally less, down to a floor): landscape and food production against, the climate-
// minded and business for. Prime cropland (Fruchtfolgefläche) stirs half again as much opposition.
export const AGRI_PV_STANCES = { homeowners: -0.7, tenants: -0.3, drivers: -0.1, business: 0.15, climate: 0.4 } as const;
export const AGRI_PV_FULL_SCALE_HA = 20;
export const AGRI_PV_MIN_SCALE = 0.3;
export const AGRI_PV_PRIME_FACTOR = 1.5;
// While zones are in force, this share of the stance stays as a lasting pull.
export const AGRI_PV_LASTING_SHARE = 0.4;

// Acceptance (0-1) takes the edge off the opposition, both to new zones and to those in force. It
// grows while the Agri-PV dialogue runs, a little with every field built (people see one), up to a
// limit — some will always mind.
export const AGRI_PV_ACCEPTANCE_PER_YEAR_DIALOGUE = 0.15;
export const AGRI_PV_ACCEPTANCE_PER_FIELD = 0.03;
export const AGRI_PV_ACCEPTANCE_MAX = 0.8;

// The installations: panels high above the crops or in vertical rows between them.
export const AGRI_PV_KWP_PER_HA = 500;
// Build cost per kWp: CHF 1,000 for a 0.5 MWp field, falling with size to CHF 600 for 10 MWp.
export const AGRI_PV_CAPEX_CHF_PER_KWP_AT_500KWP = 1_000;
export const AGRI_PV_CAPEX_SCALE_EXPONENT = 0.17;
export const AGRI_PV_CAPEX_FLOOR_CHF_PER_KWP = 600;
// What the farmer gets for the land under the panels, a year.
export const AGRI_PV_RENT_CHF_PER_HA_YEAR = 3_000;
export const AGRI_PV_UPKEEP_CHF_PER_KWP_YEAR = 15;
export const AGRI_PV_LIFETIME_YEARS = 25;
export const AGRI_PV_BUILD_MONTHS = 12;
export const AGRI_PV_MIN_KWP = 200;

// Who invests: businesses that use a lot of electricity, through a power purchase agreement (PPA):
// they take the field's power as it comes, instead of buying that energy from the utility (they
// still pay for the grid). Each looks into it now and then, at the zoned field nearest to them.
export const AGRI_PV_MIN_FOOTPRINT_M2 = 1_000;
export const AGRI_PV_MIN_CONSUMER_MWH = 300;
export const AGRI_PV_CONSIDER_PER_YEAR = 0.15;
// A PPA is sized to cover at most this share of the business's yearly use.
export const AGRI_PV_PPA_COVER_SHARE = 0.6;
// How much the numbers are guessed at (a share of the yearly cost, as for every investment decision).
export const AGRI_PV_UNCERTAINTY_FRACTION = 0.25;
