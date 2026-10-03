// Where a heat pump may go (sim/heatPumpSiting.ts): the ground under the building, and the noise
// an outdoor unit makes at the neighbours' windows. Sources: canton Zurich's Wärmenutzungsatlas and
// AWEL's planning guide; the federal Noise Abatement Ordinance (LSV, Annex 6) as applied by the
// Cercle Bruit guidance 6.21 (Nov 2024). Costs and sound powers are informed placeholders.

export type HeatUseZone = "A" | "B" | "C" | "D" | "E" | "F";

export interface GroundRule {
  /** Boreholes (Erdwärmesonden) allowed. */
  boreholes: boolean;
  /** Boreholes need protective casing, a depth limit or other conditions: a surcharge. */
  boreholeConditions: boolean;
  /** Groundwater heat by concession, from this design heat load up (kW of heating); null: never. */
  groundwaterFromKw: number | null;
}

// The atlas's minimum groundwater systems are set as heat extracted from the water ("Kälteleistung"):
// 150 kW in a drinking-water aquifer, 50 kW elsewhere. A heat pump delivers about 1.3 times what it
// extracts, so as heating capacity: ~190 kW and ~65 kW.
export const GROUND_RULES: Record<HeatUseZone, GroundRule> = {
  A: { boreholes: false, boreholeConditions: false, groundwaterFromKw: null }, // protection zone
  B: { boreholes: false, boreholeConditions: false, groundwaterFromKw: 190 }, // drinking-water aquifer
  C: { boreholes: true, boreholeConditions: true, groundwaterFromKw: 65 },
  D: { boreholes: true, boreholeConditions: false, groundwaterFromKw: 65 },
  E: { boreholes: true, boreholeConditions: true, groundwaterFromKw: 190 }, // spring water
  F: { boreholes: true, boreholeConditions: false, groundwaterFromKw: null }, // no usable groundwater
};
// Boreholes keep this far from tunnels and galleries.
export const TUNNEL_CLEARANCE_M = 50;
// Casing, a depth limit (so more, shallower boreholes), extra supervision.
export const BOREHOLE_CONDITIONS_COST_FACTOR = 1.15;
// Wells and a return well instead of a borehole field: cheaper for the large systems that qualify.
export const GROUNDWATER_COST_FACTOR = 0.9;
// The water-rights concession's yearly fee, per kW of heating capacity.
export const GROUNDWATER_FEE_CHF_PER_KW_YEAR = 10;

// Noise: the rating level at the neighbour's open window,
//   Lr = LwA − 11 + Dc − 20·log10(distance) + K1 + K2,
// must stay under the night planning value of its noise sensitivity level (ES).
export const NIGHT_PLANNING_VALUE_DB = { II: 45, III: 50 } as const;
export const NOISE_K1_NIGHT_DB = 10; // heat pumps at night
export const NOISE_K2_TONAL_DB = 2; // slightly tonal
export const NOISE_DIRECTIVITY_DB = 6; // the unit stands against a wall
// A typical quiet modern outdoor unit for a house (~8 kW of heating) at 2 °C outside (the best
// are a few dB quieter, older designs louder); bigger systems are
// louder (several units, bigger fans), +10·log10 of the capacity ratio.
export const AIR_UNIT_SOUND_POWER_DB_AT_8KW = 54;
// Units keep getting quieter: this much a year from the start of the game, up to a limit.
export const SOUND_POWER_IMPROVEMENT_DB_PER_YEAR = 0.15;
export const SOUND_POWER_IMPROVEMENT_MAX_DB = 3;
// Where the unit goes: by the two nearest neighbours (beyond any the building is joined to), at
// least the legal 2 m from the boundary and at most this far.
export const NOISE_MIN_DISTANCE_M = 2;
export const NOISE_MAX_DISTANCE_M = 40;
export const NOISE_NEIGHBOUR_RADIUS_M = 60;
export const ATTACHED_GAP_M = 1; // closer than this: the buildings are joined
// Only buildings with rooms someone lives or works in count as neighbours: homes, and anything
// bigger than a shed or garage.
export const NOISE_SENSITIVE_MIN_FOOTPRINT_M2 = 60;

export type NoiseStep = "none" | "quietModel" | "soundHood" | "indoor" | "notPermitted";

// The ladder of measures, each good for up to `uptoDb` of reduction: what it costs on a typical
// house (scaled by the building's size like the heat pump itself), and in a new building, where an
// indoor unit is planned in from the start.
export const NOISE_LADDER: { step: Exclude<NoiseStep, "notPermitted">; uptoDb: number; costChf: number; newBuildCostChf: number; label: string }[] = [
  { step: "none", uptoDb: 0, costChf: 0, newBuildCostChf: 0, label: "no noise measures needed" },
  { step: "quietModel", uptoDb: 5, costChf: 2_500, newBuildCostChf: 2_500, label: "a quieter model and a careful spot" },
  { step: "soundHood", uptoDb: 10, costChf: 7_000, newBuildCostChf: 5_000, label: "a sound hood" },
  { step: "indoor", uptoDb: 20, costChf: 20_000, newBuildCostChf: 3_000, label: "installing it indoors, with air ducts" },
];
