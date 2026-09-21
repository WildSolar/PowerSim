/**
 * Binds modeRenewal.ts (the mode tier) and renewal.ts (the vehicle-type tier
 * — reused exactly as heatingRenewal.ts uses it) into one per-dwelling
 * mobility model. A dwelling gets one or two independent "slots" (see
 * mobilitySlotCount) — a simplification standing in for "more than one
 * person in the household, each with their own primary way of getting
 * around," not literally "a second car." Each slot has its own:
 *  - mode chain: car / bike / other, reassigned by a "life event" at a
 *    weighted-random draw from the current modal split (modeRenewal.ts) —
 *    getting a child or a new job changes what a person needs, not what's
 *    cheapest, so there's no cost comparison here.
 *  - vehicle-type chain(s): within car mode, EV vs ICE; within bike mode,
 *    e-bike vs standard — reassigned only when that vehicle wears out, via
 *    renewal.ts's own four-factor decision (availability/financial/
 *    uncertainty/bias), a genuine cost comparison the same way heating's is.
 *
 * A slot's car and bike vehicle-type chains each run on their own
 * independent clock for the slot's entire life, not just while the mode
 * currently matches — see vehicleChainFor's own doc for why, and
 * mobilityRenewalLog for how that stays invisible to the player.
 */

import type { Dwelling } from "../data/types";
import {
  MOBILITY_TWO_SLOT_BASE_PROBABILITY,
  MOBILITY_TWO_SLOT_MAX_PROBABILITY,
  MOBILITY_TWO_SLOT_MIN_PROBABILITY,
  MOBILITY_TWO_SLOT_REFERENCE_ROOMS,
  MOBILITY_TWO_SLOT_ROOM_SLOPE,
  MODE_LIFETIME_MEAN_YEARS,
  MODE_WEIBULL_SHAPE,
  VEHICLE_BIAS_MAGNITUDE_RP_PER_YEAR,
  VEHICLE_UNCERTAINTY_FRACTION,
  VEHICLE_WEIBULL_SHAPE,
} from "../config/mobility";
import { evChargingPowerW, evDailySession, isResponsive, type EvSession } from "./ev";
import {
  ANNUAL_BIKE_KM,
  ANNUAL_CAR_KM,
  BIKE_VEHICLE_ORDER,
  CAR_VEHICLE_ORDER,
  EBIKE_KWH_PER_100KM,
  EV_CAR_KWH_PER_100KM,
  ICE_CAR_L_PER_100KM,
  INITIAL_EBIKE_SHARE,
  INITIAL_EV_FLEET_SHARE,
  MOBILITY_MODE_CATALOG,
  VEHICLE_TYPE_CATALOG,
  type MobilityMode,
  type VehicleTypeId,
} from "./mobilitySystems";
import { modeAt, modeEventsUpTo, type ModeEvent } from "./modeRenewal";
import type { Building } from "../data/types";
import { policyStore } from "./policy";
import { municipalVehicleSubsidyRp } from "./subsidies";
import { hashSeed, mulberry32 } from "./rng";
import { peekRenewalChain, renewalEventsUpTo, systemAt, type RenewalCandidate, type RenewalEvent, type RenewalParams } from "./renewal";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";

// --- slot count --------------------------------------------------------------

/** 1 or 2 independent mobility slots per dwelling, biased toward two for
 * larger dwellings via room count (the closest proxy GWR gives us to
 * occupant count). Calibrated (see mobilityRenewal's own commit) against
 * BFS's real per-municipality passenger-car register so the *resulting*
 * average cars/dwelling lands close to Schlieren's actual ~1.04 — the modal
 * split alone can't fix that ratio, since it's a share of trips, not a count
 * of vehicles per household. */
function twoSlotProbability(dwelling: Dwelling): number {
  const rooms = dwelling.roomCount ?? MOBILITY_TWO_SLOT_REFERENCE_ROOMS;
  const raw = MOBILITY_TWO_SLOT_BASE_PROBABILITY + MOBILITY_TWO_SLOT_ROOM_SLOPE * (rooms - MOBILITY_TWO_SLOT_REFERENCE_ROOMS);
  return Math.min(MOBILITY_TWO_SLOT_MAX_PROBABILITY, Math.max(MOBILITY_TWO_SLOT_MIN_PROBABILITY, raw));
}

// A pure function of (egid, dwelling), queried at every sample of every
// timestep for every dwelling (municipality-wide sampling re-resolves
// mobility per timestep, the same reasoning heating's own per-timestep
// resolution already established) — cached like buildingGeometry.ts's
// envelope-area cache rather than redrawing the same seeded value every call.
const slotCountCache = new Map<string, 1 | 2>();

export function mobilitySlotCount(egid: string, dwelling: Dwelling): 1 | 2 {
  const key = `${egid}:${dwelling.ewid}`;
  const cached = slotCountCache.get(key);
  if (cached !== undefined) return cached;
  const u = mulberry32(hashSeed(egid, dwelling.ewid, "mobility-slot-count"))();
  const count = u < twoSlotProbability(dwelling) ? 2 : 1;
  slotCountCache.set(key, count);
  return count;
}

// --- mode tier ---------------------------------------------------------------

// However much infrastructure and restriction the municipality adds, the car keeps at least this share.
const MIN_CAR_SHARE = 0.15;

/** The modal split a household's next life event draws from: the survey baseline, with whatever the
 * municipality has done (bike lanes, better transit, parking rules) moving trips off the car. */
function modeTargetShares(): Record<MobilityMode, number> {
  const p = policyStore.get();
  const car = MOBILITY_MODE_CATALOG.car.targetShare;
  const wanted = (p.modeShiftToBikePts + p.modeShiftToOtherPts) / 100;
  const moved = Math.min(wanted, Math.max(0, car - MIN_CAR_SHARE));
  const scale = wanted > 0 ? moved / wanted : 0;
  return {
    car: car - moved,
    bike: MOBILITY_MODE_CATALOG.bike.targetShare + (p.modeShiftToBikePts / 100) * scale,
    other: MOBILITY_MODE_CATALOG.other.targetShare + (p.modeShiftToOtherPts / 100) * scale,
  };
}

function modeEntityKey(egid: string, ewid: string, slotIndex: number): string {
  return `${egid}:${ewid}:mobility-mode:${slotIndex}`;
}

function modeChainFor(egid: string, ewid: string, slotIndex: number, simTimeMs: number): ModeEvent<MobilityMode>[] {
  return modeEventsUpTo(
    {
      entityKey: modeEntityKey(egid, ewid, slotIndex),
      egid,
      labelFor: (id) => MOBILITY_MODE_CATALOG[id].label,
      weibullShape: MODE_WEIBULL_SHAPE,
      lifetimeMeanYears: MODE_LIFETIME_MEAN_YEARS,
      targetShares: modeTargetShares,
    },
    simTimeMs,
  );
}

export function currentMobilityMode(egid: string, ewid: string, slotIndex: number, simTimeMs: number): MobilityMode {
  return modeAt(modeChainFor(egid, ewid, slotIndex, simTimeMs), simTimeMs);
}

// --- vehicle-type tier ---------------------------------------------------------

function avgElecRpKWh(tariff: Tariff): number {
  return (tariff.offPeakPriceRpKWh + tariff.peakPriceRpKWh) / 2;
}

function carCandidatesAt(tariff: Tariff, incumbent: VehicleTypeId): RenewalCandidate<VehicleTypeId>[] {
  return CAR_VEHICLE_ORDER.map((id) => {
    const spec = VEHICLE_TYPE_CATALOG[id];
    const beforeMunicipalRp = Math.max(0, spec.baseInstallCostRp - spec.subsidyRp);
    const scrappageRp = id === "carEV" && incumbent === "carICE" ? policyStore.get().iceScrappageBonusRp : 0;
    const municipalRp = Math.min(municipalVehicleSubsidyRp(id) + scrappageRp, beforeMunicipalRp);
    const installCostRp = beforeMunicipalRp - municipalRp;
    const runningCostRp =
      id === "carEV"
        ? (ANNUAL_CAR_KM / 100) * EV_CAR_KWH_PER_100KM * avgElecRpKWh(tariff)
        : (ANNUAL_CAR_KM / 100) * ICE_CAR_L_PER_100KM * tariff.petrolPriceRpPerLiter;
    return {
      id,
      available: !(id === "carICE" && policyStore.get().iceCarPurchaseBanned),
      annualizedCostRp: installCostRp / spec.lifetimeMeanYears + runningCostRp,
      lifetimeMeanYears: spec.lifetimeMeanYears,
      municipalSubsidyRp: municipalRp,
      greenness: spec.greenness,
    };
  });
}

function bikeCandidatesAt(tariff: Tariff): RenewalCandidate<VehicleTypeId>[] {
  return BIKE_VEHICLE_ORDER.map((id) => {
    const spec = VEHICLE_TYPE_CATALOG[id];
    const installCostRp = Math.max(0, spec.baseInstallCostRp - spec.subsidyRp);
    const runningCostRp = id === "bikeElectric" ? (ANNUAL_BIKE_KM / 100) * EBIKE_KWH_PER_100KM * avgElecRpKWh(tariff) : 0;
    return {
      id,
      available: true,
      annualizedCostRp: installCostRp / spec.lifetimeMeanYears + runningCostRp,
      lifetimeMeanYears: spec.lifetimeMeanYears,
      greenness: spec.greenness,
    };
  });
}

function vehicleEntityKey(egid: string, ewid: string, slotIndex: number, kind: "car" | "bike"): string {
  return `${egid}:${ewid}:mobility-vehicle-${kind}:${slotIndex}`;
}

function biasStrengthRp(egid: string, ewid: string, slotIndex: number, kind: "car" | "bike"): number {
  const u = mulberry32(hashSeed(egid, ewid, "mobility-vehicle-bias", kind, String(slotIndex)))();
  return (u - 0.5) * 2 * VEHICLE_BIAS_MAGNITUDE_RP_PER_YEAR;
}

/** No per-dwelling real ownership data exists to anchor an initial vehicle
 * type the way heating anchors to GWR's real snapshot, so it's a
 * weighted-random draw — cars toward the real, local BFS fleet EV share,
 * bikes toward a judgment-call e-bike share (see mobilitySystems.ts). */
function initialVehicleType(egid: string, ewid: string, slotIndex: number, kind: "car" | "bike"): VehicleTypeId {
  const u = mulberry32(hashSeed(egid, ewid, "mobility-vehicle-initial", kind, String(slotIndex)))();
  if (kind === "car") return u < INITIAL_EV_FLEET_SHARE ? "carEV" : "carICE";
  return u < INITIAL_EBIKE_SHARE ? "bikeElectric" : "bikeStandard";
}

/** A slot's car (or bike) ages on its own independent clock for the slot's
 * *entire* life, not just while the mode currently says "car" (or "bike") —
 * avoids needing to pause and resume a renewal chain across mode changes: a
 * life event moving a slot from car to bike and back years later just
 * resumes whatever the car chain's own clock had already reached in the
 * meantime. This never shows up as an inconsistency to the player because
 * it's only ever queried (currentVehicleType) while the mode actually
 * matches, and mobilityRenewalLog only narrates a vehicle renewal that
 * happened while its mode was the active one. */
function vehicleChainFor(egid: string, ewid: string, slotIndex: number, kind: "car" | "bike", simTimeMs: number): RenewalEvent<VehicleTypeId>[] {
  const cached = peekRenewalChain<VehicleTypeId>(vehicleEntityKey(egid, ewid, slotIndex, kind), simTimeMs);
  if (cached) return cached;
  const params: RenewalParams<VehicleTypeId> = {
    entityKey: vehicleEntityKey(egid, ewid, slotIndex, kind),
    egid,
    kind: kind === "car" ? "mobility-vehicle-car" : "mobility-vehicle-bike",
    labelFor: (id) => VEHICLE_TYPE_CATALOG[id].label,
    initialSystem: initialVehicleType(egid, ewid, slotIndex, kind),
    conditionalFirstLifetime: true,
    weibullShape: VEHICLE_WEIBULL_SHAPE,
    uncertaintyFraction: VEHICLE_UNCERTAINTY_FRACTION,
    biasStrengthRp: biasStrengthRp(egid, ewid, slotIndex, kind),
    lifetimeMeanYearsFor: (id) => VEHICLE_TYPE_CATALOG[id].lifetimeMeanYears,
    candidatesAt: (_atMs, incumbent) => (kind === "car" ? carCandidatesAt(tariffStore.get(), incumbent) : bikeCandidatesAt(tariffStore.get())),
  };
  return renewalEventsUpTo(params, simTimeMs);
}

/** Settles every vehicle purchase of a building's dwellings that has fallen due by `simTimeMs`
 * (both the car and the bike chain of every slot, which age independently of the current mode),
 * so each records its subsidy payout close to when it happened. */
export function commitVehicleDecisions(building: Building, simTimeMs: number): void {
  for (const dwelling of building.dwellings) {
    const slots = mobilitySlotCount(building.egid, dwelling);
    for (let slot = 0; slot < slots; slot++) {
      vehicleChainFor(building.egid, dwelling.ewid, slot, "car", simTimeMs);
      vehicleChainFor(building.egid, dwelling.ewid, slot, "bike", simTimeMs);
    }
  }
}

export function currentVehicleType(egid: string, ewid: string, slotIndex: number, mode: MobilityMode, simTimeMs: number): VehicleTypeId | null {
  if (mode !== "car" && mode !== "bike") return null;
  return systemAt(vehicleChainFor(egid, ewid, slotIndex, mode, simTimeMs), simTimeMs);
}

// --- charging power ------------------------------------------------------------

/** Every currently-EV car slot's charging session, summed. Bikes draw no
 * modeled power — an e-bike's draw is negligible next to a car's, and
 * wasn't worth the added complexity (see mobilitySystems.ts). */
export function mobilityChargingPowerW(egid: string, dwelling: Dwelling, simTimeMs: number, tariff: Tariff): number {
  const slotCount = mobilitySlotCount(egid, dwelling);
  let totalW = 0;
  for (let slot = 0; slot < slotCount; slot++) {
    const mode = currentMobilityMode(egid, dwelling.ewid, slot, simTimeMs);
    if (mode !== "car") continue;
    if (currentVehicleType(egid, dwelling.ewid, slot, mode, simTimeMs) !== "carEV") continue;
    totalW += evChargingPowerW(egid, `${dwelling.ewid}:${slot}`, simTimeMs, tariff);
  }
  return totalW;
}

/** Tonight's charging session for one slot, for the UI's "plugged in until…"
 * readout — caller should already know (via mobilitySlotSummaries) that this
 * slot is currently car+EV before asking. */
export function evSessionForSlot(egid: string, dwelling: Dwelling, slotIndex: number, dayIndex: number, tariff: Tariff): EvSession {
  const sessionKey = `${dwelling.ewid}:${slotIndex}`;
  return evDailySession(egid, sessionKey, dayIndex, isResponsive(egid, sessionKey), tariff);
}

/** One slot's own charging draw — zero unless it's currently car+EV. For a
 * UI showing each slot individually rather than the dwelling-wide total
 * (mobilityChargingPowerW). */
export function slotChargingPowerW(
  egid: string,
  dwelling: Dwelling,
  slotIndex: number,
  mode: MobilityMode,
  vehicleType: VehicleTypeId | null,
  simTimeMs: number,
  tariff: Tariff,
): number {
  if (mode !== "car" || vehicleType !== "carEV") return 0;
  return evChargingPowerW(egid, `${dwelling.ewid}:${slotIndex}`, simTimeMs, tariff);
}

// --- UI summary ------------------------------------------------------------

export interface MobilitySlotSummary {
  slotIndex: number;
  mode: MobilityMode;
  modeLabel: string;
  modeIcon: string;
  vehicleType: VehicleTypeId | null;
  vehicleLabel: string | null;
  vehicleIcon: string | null;
}

export function mobilitySlotSummaries(egid: string, dwelling: Dwelling, simTimeMs: number): MobilitySlotSummary[] {
  const slotCount = mobilitySlotCount(egid, dwelling);
  const summaries: MobilitySlotSummary[] = [];
  for (let slot = 0; slot < slotCount; slot++) {
    const mode = currentMobilityMode(egid, dwelling.ewid, slot, simTimeMs);
    const vehicleType = currentVehicleType(egid, dwelling.ewid, slot, mode, simTimeMs);
    summaries.push({
      slotIndex: slot,
      mode,
      modeLabel: MOBILITY_MODE_CATALOG[mode].label,
      modeIcon: MOBILITY_MODE_CATALOG[mode].icon,
      vehicleType,
      vehicleLabel: vehicleType ? VEHICLE_TYPE_CATALOG[vehicleType].label : null,
      vehicleIcon: vehicleType ? VEHICLE_TYPE_CATALOG[vehicleType].icon : null,
    });
  }
  return summaries;
}

// --- history log ------------------------------------------------------------

export interface MobilityRenewalLogEntry {
  installedAtMs: number;
  note: string;
}

function articleLabel(label: string): string {
  return (/^[aeiou]/i.test(label) ? "an " : "a ") + label;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function modeChangeNote(event: ModeEvent<MobilityMode>): string {
  const oldLabel = MOBILITY_MODE_CATALOG[event.previousChoice as MobilityMode].label.toLowerCase();
  const newLabel = MOBILITY_MODE_CATALOG[event.choice].label.toLowerCase();
  if (event.choice === event.previousChoice) {
    return `A change in circumstances prompted a rethink of how to get around — the household stuck with ${oldLabel}.`;
  }
  return `A change in circumstances — a new job, a child, a move — led the household to switch from ${oldLabel} to ${newLabel}.`;
}

function vehicleChangeNote(event: RenewalEvent<VehicleTypeId>): string {
  const oldSpec = VEHICLE_TYPE_CATALOG[event.previousSystem as VehicleTypeId];
  const newSpec = VEHICLE_TYPE_CATALOG[event.system];
  const base = `The old ${oldSpec.label.toLowerCase()} had reached the end of its life.`;
  if (event.reasonKind === "inKind") {
    return `${base} It was replaced with another ${newSpec.label.toLowerCase()} — no clearly better alternative was found.`;
  }
  return `${base} ${capitalize(articleLabel(newSpec.label.toLowerCase()))} was chosen instead — cheaper to run over its lifetime.`;
}

/** Every mode change and (only while that mode was actually active — see
 * vehicleChainFor's doc) vehicle-type change across all of this dwelling's
 * mobility slots, oldest first. */
export function mobilityRenewalLog(egid: string, dwelling: Dwelling, simTimeMs: number): MobilityRenewalLogEntry[] {
  const slotCount = mobilitySlotCount(egid, dwelling);
  const entries: MobilityRenewalLogEntry[] = [];

  for (let slot = 0; slot < slotCount; slot++) {
    const modeChain = modeChainFor(egid, dwelling.ewid, slot, simTimeMs);
    for (const event of modeChain) {
      if (event.previousChoice === null) continue; // synthetic initial event
      entries.push({ installedAtMs: event.installedAtMs, note: modeChangeNote(event) });
    }

    for (const kind of ["car", "bike"] as const) {
      const vehicleChain = vehicleChainFor(egid, dwelling.ewid, slot, kind, simTimeMs);
      for (const event of vehicleChain) {
        if (event.reasonKind === "initial") continue;
        if (modeAt(modeChain, event.installedAtMs) !== kind) continue;
        entries.push({ installedAtMs: event.installedAtMs, note: vehicleChangeNote(event) });
      }
    }
  }

  entries.sort((a, b) => a.installedAtMs - b.installedAtMs);
  return entries;
}
