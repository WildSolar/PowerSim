/**
 * The catalog behind mobility.ts's two-tier choice — mirrors
 * heatingSystems.ts's own shape closely, since the *vehicle type* tier
 * reuses renewal.ts exactly the way heating does (see mobility.ts). Every
 * tunable number here (the catalogs, consumption assumptions, initial
 * shares) lives in config/mobility.ts — edit that file to recalibrate; this
 * one just re-exports it plus the structural bits (display order) that
 * aren't calibration knobs.
 *
 *  - A *mode* (car / bike / other — public transit, walking, ride-hail
 *    folded into one bucket per the design brief): reassigned by a "life
 *    event" (modeRenewal.ts, not renewal.ts) at a weighted-random draw from
 *    the current modal split — no cost comparison, since which mode a life
 *    event pushes you toward isn't really about price.
 *  - Within car or bike mode, a *vehicle type* (EV vs ICE; e-bike vs
 *    standard): reassigned only when the vehicle itself wears out, via
 *    renewal.ts's exact four-factor decision (availability/financial/
 *    uncertainty/bias) — a genuine cost comparison exists here, the same way
 *    it does for a boiler vs. a heat pump.
 */

export {
  MOBILITY_MODE_CATALOG,
  VEHICLE_TYPE_CATALOG,
  ANNUAL_CAR_KM,
  ICE_CAR_L_PER_100KM,
  EV_CAR_KWH_PER_100KM,
  ANNUAL_BIKE_KM,
  EBIKE_KWH_PER_100KM,
  INITIAL_EV_FLEET_SHARE,
  INITIAL_EBIKE_SHARE,
  type MobilityMode,
  type MobilityModeSpec,
  type VehicleTypeId,
  type VehicleTypeSpec,
} from "../config/mobility";
import type { MobilityMode, VehicleTypeId } from "../config/mobility";

export const MOBILITY_MODE_ORDER: MobilityMode[] = ["car", "bike", "other"];

export const CAR_VEHICLE_ORDER: VehicleTypeId[] = ["carEV", "carICE"];
export const BIKE_VEHICLE_ORDER: VehicleTypeId[] = ["bikeElectric", "bikeStandard"];
