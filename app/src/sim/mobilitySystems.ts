/**
 * The catalog behind mobility.ts's two-tier choice — mirrors
 * heatingSystems.ts's own shape closely, since the *vehicle type* tier
 * reuses renewal.ts exactly the way heating does (see mobility.ts).
 *
 *  - A *mode* (car / bike / other — public transit, walking, ride-hail
 *    folded into one bucket per the design brief): reassigned by a "life
 *    event" (mobilityRenewal.ts's own lightweight engine, not renewal.ts) at
 *    a weighted-random draw from the current modal split — no cost
 *    comparison, since which mode a life event pushes you toward isn't
 *    really about price.
 *  - Within car or bike mode, a *vehicle type* (EV vs ICE; e-bike vs
 *    standard): reassigned only when the vehicle itself wears out, via
 *    renewal.ts's exact four-factor decision (availability/financial/
 *    uncertainty/bias) — a genuine cost comparison exists here, the same way
 *    it does for a boiler vs. a heat pump.
 */

export type MobilityMode = "car" | "bike" | "other";

export interface MobilityModeSpec {
  mode: MobilityMode;
  label: string;
  icon: string;
  color: string;
  /** This mode's target share of the current modal split — mobilityRenewal.ts
   * draws toward this at every life-event reassignment, so the aggregate
   * split stays close to it rather than drifting (see that module's doc). A
   * future policy lever (e.g. municipality-funded fast chargers or bike
   * lanes) would adjust these, not implemented yet. */
  targetShare: number;
}

// Kanton Zürich's 2021 Mikrozensus Mobilität und Verkehr (BFS/ARE) modal
// split by daily distance — the best available real proxy for "how Schlieren
// gets around": no municipality-level modal-split survey exists, and no
// registry exists for bike/PT use the way it does for cars (see
// mobilityRenewal.ts's own slot-count calibration against BFS's real,
// municipality-level passenger-car register instead, which anchors car
// *ownership* precisely even though this modal split anchors car *mode
// share* only approximately). MIV (motorised individual transport) maps
// directly onto "car"; FVV (foot + bike, incl. e-bikes) onto "bike"; ÖV
// (public transport) plus the remaining "other" (taxi/coach) bucket combine
// into this game's single "other" mode.
export const MOBILITY_MODE_ORDER: MobilityMode[] = ["car", "bike", "other"];

export const MOBILITY_MODE_CATALOG: Record<MobilityMode, MobilityModeSpec> = {
  car: { mode: "car", label: "Car", icon: "🚗", color: "#eb6834", targetShare: 0.62 },
  bike: { mode: "bike", label: "Bicycle", icon: "🚲", color: "#1baf7a", targetShare: 0.1 },
  other: { mode: "other", label: "Public transit / other", icon: "🚌", color: "#2a78d6", targetShare: 0.28 },
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

export const CAR_VEHICLE_ORDER: VehicleTypeId[] = ["carEV", "carICE"];
export const BIKE_VEHICLE_ORDER: VehicleTypeId[] = ["bikeElectric", "bikeStandard"];

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
// No equivalent bike-stock register exists — a judgment call reflecting
// e-bikes' real, fast-growing but still-minority share of the Swiss fleet.
export const INITIAL_EBIKE_SHARE = 0.25;
