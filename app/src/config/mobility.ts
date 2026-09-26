/**
 * Every tunable number behind mobility: the mode catalog (target modal
 * split) and vehicle-type catalog (install cost, subsidy, lifetime —
 * sim/mobilitySystems.ts re-exports these), consumption assumptions behind
 * each vehicle type's running cost, initial-ownership shares, the slot-count
 * formula, and both renewal-decision engines' own parameters
 * (sim/mobility.ts: the mode tier's weighted-random reassignment, the
 * vehicle-type tier's four-factor cost comparison).
 */

export type MobilityMode = "car" | "bike" | "other";

export interface MobilityModeSpec {
  mode: MobilityMode;
  label: string;
  icon: string;
  color: string;
  /** This mode's target share of the current modal split — mobility.ts's
   * mode tier draws toward this at every life-event reassignment, so the
   * aggregate split stays close to it rather than drifting. A future policy
   * lever (e.g. municipality-funded fast chargers or bike lanes) would
   * adjust these, not implemented yet. */
  targetShare: number;
}

// Switzerland-wide 2021 Mikrozensus Mobilität und Verkehr (BFS/ARE) modal
// split by daily distance (MIV ≈ 69%, ÖV just under 20%, FVV the ~11%
// remainder) — a national figure so the game works for any municipality; it
// overstates car use for cities (Kanton Zürich alone is 62/10/28) and understates it
// for rural areas. No municipality-level modal-split survey exists, and no
// registry exists for bike/PT use the way it does for cars (see
// MOBILITY_TWO_SLOT_* below for slot-count calibration against BFS's real,
// municipality-level passenger-car register instead, which anchors car
// *ownership* precisely even though this modal split anchors car *mode
// share* only approximately). MIV (motorised individual transport) maps
// directly onto "car"; FVV (foot + bike, incl. e-bikes) onto "bike"; ÖV
// (public transport) plus the remaining "other" (taxi/coach) bucket combine
// into this game's single "other" mode.
export const MOBILITY_MODE_CATALOG: Record<MobilityMode, MobilityModeSpec> = {
  car: { mode: "car", label: "Car", icon: "🚗", color: "#eb6834", targetShare: 0.69 },
  bike: { mode: "bike", label: "Bicycle", icon: "🚲", color: "#1baf7a", targetShare: 0.11 },
  other: { mode: "other", label: "Public transit / other", icon: "🚌", color: "#2a78d6", targetShare: 0.2 },
};

export type VehicleTypeId = "carEV" | "carICE" | "bikeElectric" | "bikeStandard";

export interface VehicleTypeSpec {
  id: VehicleTypeId;
  mode: Extract<MobilityMode, "car" | "bike">;
  label: string;
  icon: string;
  lifetimeMeanYears: number;
  baseInstallCostRp: number; // purchase price — flat, unlike heating's building-size scaling
  subsidyRp: number;
  greenness: number;
  color: string;
}

export const VEHICLE_TYPE_CATALOG: Record<VehicleTypeId, VehicleTypeSpec> = {
  carEV: {
    id: "carEV",
    mode: "car",
    label: "Electric car",
    icon: "🔋",
    lifetimeMeanYears: 14,
    baseInstallCostRp: 42_000_00,
    subsidyRp: 2_000_00,
    greenness: 1,
    color: "#1baf7a",
  },
  carICE: {
    id: "carICE",
    mode: "car",
    label: "Petrol/diesel car",
    icon: "⛽",
    lifetimeMeanYears: 14,
    baseInstallCostRp: 35_000_00,
    subsidyRp: 0,
    greenness: -1,
    color: "#b23a2e",
  },
  bikeElectric: {
    id: "bikeElectric",
    mode: "bike",
    label: "E-bike",
    icon: "🔋",
    lifetimeMeanYears: 8,
    baseInstallCostRp: 3_000_00,
    subsidyRp: 0,
    greenness: -0.3,
    color: "#0f8fc0",
  },
  bikeStandard: {
    id: "bikeStandard",
    mode: "bike",
    label: "Standard bike",
    icon: "🚲",
    lifetimeMeanYears: 10,
    baseInstallCostRp: 800_00,
    subsidyRp: 0,
    greenness: 0.3,
    color: "#4a3aa7",
  },
};

// Annual distance and consumption assumptions behind each vehicle type's
// running cost (mobility.ts) — ballpark Swiss averages, all judgment calls
// the same way heatingSystems.ts's figures are.
export const ANNUAL_CAR_KM = 12_000;
export const ICE_CAR_L_PER_100KM = 6.5;
export const EV_CAR_KWH_PER_100KM = 18;
export const ANNUAL_BIKE_KM = 1_500;
export const EBIKE_KWH_PER_100KM = 1; // a small battery, charged often — running cost is near-negligible either way

// Real Schlieren BFS vehicle-register EV-capable (BEV + plug-in hybrid)
// share of the 2024 passenger-car fleet — (540 BEV + 249 petrol-PHEV + 36
// diesel-PHEV) / 10,214 total — used only to seed each car slot's *initial*
// vehicle type (a weighted-random draw, since GWR-style per-dwelling
// ownership data doesn't exist for cars the way it does for heating), not
// the renewal decision itself, which is cost-driven like heating's. Source:
// BFS px-x-1103020100_111 ("Bestand der Strassenfahrzeuge nach Gemeinde"),
// queried directly for Gemeinde 247, Fahrzeuggruppe "Personenwagen", 2024.
export const INITIAL_EV_FLEET_SHARE = 0.0808;
// Today's electric cars belong overwhelmingly to households that can charge at home, so the draw
// is split by that (sim/publicCharging.ts): with Schlieren's ~38% of households charging at home,
// 0.38 × 0.17 + 0.62 × 0.025 ≈ the fleet share above.
export const INITIAL_EV_SHARE_WITH_HOME_CHARGING = 0.17;
export const INITIAL_EV_SHARE_WITHOUT_HOME_CHARGING = 0.025;
// No equivalent bike-stock register exists — a judgment call reflecting
// e-bikes' real, fast-growing but still-minority share of the Swiss fleet.
export const INITIAL_EBIKE_SHARE = 0.25;

// --- mobility.ts: slot-count formula ---

// 1 or 2 independent mobility slots per dwelling, biased toward two for
// larger dwellings via room count — twoSlotProbability(rooms) =
// clamp(MOBILITY_TWO_SLOT_BASE + MOBILITY_TWO_SLOT_ROOM_SLOPE * (rooms -
// MOBILITY_TWO_SLOT_REFERENCE_ROOMS), MIN, MAX). Calibrated against BFS's
// real per-municipality passenger-car register so the *resulting* average
// cars/dwelling lands close to Schlieren's actual ~1.04 — the modal split
// alone can't fix that ratio, since it's a share of trips, not a count of
// vehicles per household.
export const MOBILITY_TWO_SLOT_BASE_PROBABILITY = 0.7;
export const MOBILITY_TWO_SLOT_ROOM_SLOPE = 0.12;
export const MOBILITY_TWO_SLOT_REFERENCE_ROOMS = 3.5; // fallback room count when a dwelling's own isn't on record, and the formula's own pivot point
export const MOBILITY_TWO_SLOT_MIN_PROBABILITY = 0.1;
export const MOBILITY_TWO_SLOT_MAX_PROBABILITY = 0.92;

// --- mobility.ts: mode-tier renewal (life-event reassignment) ---

export const MODE_WEIBULL_SHAPE = 1.8; // life events are less "wear-out"-shaped than equipment failure — a bit flatter than heating's 2.5
export const MODE_LIFETIME_MEAN_YEARS = 7; // "expected time of around 5-10 years"

// --- mobility.ts: vehicle-type-tier renewal (four-factor cost comparison) ---

export const VEHICLE_WEIBULL_SHAPE = 2.2;
export const VEHICLE_UNCERTAINTY_FRACTION = 0.15; // flat — no obvious per-household "size" proxy the way a building's dwelling count works for heating
export const VEHICLE_BIAS_MAGNITUDE_RP_PER_YEAR = 60_000; // CHF 600/yr at full lean
