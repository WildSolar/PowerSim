/**
 * Air conditioning — a building-level device like the heat pump (one shared system
 * serving the whole envelope), but unlike heat pump/PV, real ownership data doesn't
 * exist: AC is barely present in Switzerland today, so who has it is a seeded random
 * draw, biased toward newer and larger buildings (recent construction more likely to
 * have been designed for it; larger buildings more likely to justify installing it).
 * A flat, low base probability reflects today's low adoption — growth over time
 * (the "sharp uptick" AC is heading for) isn't modelled yet; this is a static
 * snapshot, the same simplification EV responsiveness makes until stock-renewal
 * adoption dynamics exist.
 *
 * Power model deliberately mirrors heatPump.ts: demand scales with the building's
 * envelope area times how far outside temperature sits *above* a comfort setpoint
 * (instead of below), gated by the day's characteristic temperature so cooling only
 * engages once a day is genuinely warm, not for one hot afternoon in an otherwise
 * mild week. Unlike the heat pump, efficiency (COP) is held constant rather than
 * temperature-dependent, and output is capped at a flat capacity ceiling — a stand-in
 * for the real regulatory maximum-capacity limits on AC installations in Switzerland,
 * which is a natural future policy lever (loosen/tighten the cap) once policy levers
 * exist, not something to build out now.
 */

import type { Building } from "../data/types";
import { buildingEnvelopeAreaM2 } from "./buildingGeometry";
import { hashSeed, mulberry32 } from "./rng";
import { dailyMeanTempC, weatherAt } from "./weather";

const COOLING_THRESHOLD_C = 19; // day's characteristic temp above this -> cooling season "on" for the day
const COMFORT_TEMP_C = 24;
const U_VALUE_W_PER_M2K = 0.5; // lower than heating's — AC typically conditions less of a building than central heating does
const COP = 3.0; // held constant (unlike the heat pump's temp-dependent COP) — a deliberately simpler, linear model
const MAX_ELECTRICAL_W = 8000; // placeholder for real regulatory capacity caps

const BASE_OWNERSHIP_PROB = 0.03;
const MAX_OWNERSHIP_BOOST = 0.35;
const RECENCY_REFERENCE_YEAR_OLD = 1980;
const RECENCY_REFERENCE_YEAR_NEW = 2024;
const SIZE_REFERENCE_AREA_SMALL_M2 = 200;
const SIZE_REFERENCE_AREA_LARGE_M2 = 1500;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Higher for newer, larger buildings — see module docs. */
export function acOwnershipProbability(building: Building): number {
  const year = building.constructionYear ?? RECENCY_REFERENCE_YEAR_OLD;
  const recencyFactor = clamp01((year - RECENCY_REFERENCE_YEAR_OLD) / (RECENCY_REFERENCE_YEAR_NEW - RECENCY_REFERENCE_YEAR_OLD));
  const envelopeAreaM2 = buildingEnvelopeAreaM2(building) ?? SIZE_REFERENCE_AREA_SMALL_M2;
  const sizeFactor = clamp01((envelopeAreaM2 - SIZE_REFERENCE_AREA_SMALL_M2) / (SIZE_REFERENCE_AREA_LARGE_M2 - SIZE_REFERENCE_AREA_SMALL_M2));
  return BASE_OWNERSHIP_PROB + MAX_OWNERSHIP_BOOST * (0.5 * recencyFactor + 0.5 * sizeFactor);
}

export function hasAC(building: Building): boolean {
  return mulberry32(hashSeed(building.egid, "ac-ownership"))() < acOwnershipProbability(building);
}

/** Takes weather already evaluated by the caller — see heatPump.ts's equivalent for why. */
export function acPowerWWithWeather(building: Building, dailyMeanC: number, outsideTempC: number): number {
  if (!hasAC(building)) return 0;
  const envelopeAreaM2 = buildingEnvelopeAreaM2(building);
  if (envelopeAreaM2 === null) return 0;
  if (dailyMeanC <= COOLING_THRESHOLD_C) return 0;

  const deltaTC = Math.max(0, outsideTempC - COMFORT_TEMP_C);
  const coolingPowerW = U_VALUE_W_PER_M2K * envelopeAreaM2 * deltaTC;
  return Math.min(MAX_ELECTRICAL_W, coolingPowerW / COP);
}

export function acPowerW(building: Building, simTimeMs: number): number {
  return acPowerWWithWeather(building, dailyMeanTempC(simTimeMs), weatherAt(simTimeMs).tempC);
}
