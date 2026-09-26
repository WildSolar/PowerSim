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
import { evChargingPowerW, evChargingPowerWFrom, evDailySession, evSessionSeed, isResponsive, type EvSession } from "./ev";
import {
  ANNUAL_BIKE_KM,
  ANNUAL_CAR_KM,
  BIKE_VEHICLE_ORDER,
  CAR_VEHICLE_ORDER,
  EBIKE_KWH_PER_100KM,
  EV_CAR_KWH_PER_100KM,
  ICE_CAR_L_PER_100KM,
  INITIAL_EBIKE_SHARE,
  INITIAL_EV_SHARE_WITH_HOME_CHARGING,
  INITIAL_EV_SHARE_WITHOUT_HOME_CHARGING,
  MOBILITY_MODE_CATALOG,
  VEHICLE_TYPE_CATALOG,
  type MobilityMode,
  type VehicleTypeId,
} from "./mobilitySystems";
import { modeAt, modeChainEntry, modeEventsUpTo, type ModeChainEntry, type ModeEvent } from "./modeRenewal";
import type { Building } from "../data/types";
import { policyStore } from "./policy";
import { municipalVehicleSubsidyRp } from "./subsidies";
import { hashSeed, mulberry32 } from "./rng";
import {
  chooseNext,
  peekRenewalChain,
  renewalChainEntry,
  renewalEventsUpTo,
  systemAt,
  type RenewalCandidate,
  type RenewalChainEntry,
  type RenewalEvent,
  type RenewalParams,
} from "./renewal";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { publicCharging } from "./publicCharging";
import { existsAt } from "./lifetime";
import { priceFactor } from "./costTrends";

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

/** How a household would charge an electric car bought at `atMs`: at home, at the public charger
 * it could rely on (see publicCharging.ts), or not at all. */
type ChargingAccess = { kind: "home" } | { kind: "public"; siteId: string; priceRpPerKWh: number; hassleRp: number } | { kind: "none" };

function chargingAccessAt(egid: string, ewid: string, atMs: number): { access: ChargingAccess; lon: number; lat: number } | null {
  const building = publicCharging.lookupBuilding(egid);
  const dwelling = building?.dwellings.find((d) => d.ewid === ewid);
  if (!building || !dwelling) return null;
  if (publicCharging.homeChargingAt(building, dwelling)) return { access: { kind: "home" }, lon: building.lon, lat: building.lat };
  const option = publicCharging.bestOption(building.lon, building.lat, atMs);
  return {
    access: option ? { kind: "public", siteId: option.site.id, priceRpPerKWh: option.priceRpPerKWh, hassleRp: option.hassleRp } : { kind: "none" },
    lon: building.lon,
    lat: building.lat,
  };
}

function carCandidatesAt(tariff: Tariff, atMs: number, incumbent: VehicleTypeId, access: ChargingAccess, onElectricChosen: (atMs: number) => void): RenewalCandidate<VehicleTypeId>[] {
  const annualKWh = (ANNUAL_CAR_KM / 100) * EV_CAR_KWH_PER_100KM;
  // Without a charger to rely on, an electric car is out — but its cost is still worked out as if
  // an on-street charger were close by, so the decision records whether it was wanted.
  const publicCost = access.kind === "public" ? access : access.kind === "none" ? publicCharging.hypotheticalOptionCostRp() : null;
  return CAR_VEHICLE_ORDER.map((id) => {
    const spec = VEHICLE_TYPE_CATALOG[id];
    const beforeMunicipalRp = Math.max(0, spec.baseInstallCostRp * priceFactor(id, atMs) - spec.subsidyRp);
    const scrappageRp = id === "carEV" && incumbent === "carICE" ? policyStore.get().iceScrappageBonusRp : 0;
    const municipalRp = Math.min(municipalVehicleSubsidyRp(id) + scrappageRp, beforeMunicipalRp);
    const installCostRp = beforeMunicipalRp - municipalRp;
    const runningCostRp =
      id === "carEV"
        ? publicCost
          ? annualKWh * publicCost.priceRpPerKWh + publicCost.hassleRp
          : annualKWh * avgElecRpKWh(tariff)
        : (ANNUAL_CAR_KM / 100) * ICE_CAR_L_PER_100KM * tariff.petrolPriceRpPerLiter;
    return {
      id,
      available: id === "carEV" ? access.kind !== "none" : !policyStore.get().iceCarPurchaseBanned,
      annualizedCostRp: installCostRp / spec.lifetimeMeanYears + runningCostRp,
      lifetimeMeanYears: spec.lifetimeMeanYears,
      municipalSubsidyRp: municipalRp,
      greenness: spec.greenness,
      onChosen: id === "carEV" ? onElectricChosen : undefined,
    };
  });
}

function bikeCandidatesAt(tariff: Tariff, atMs: number): RenewalCandidate<VehicleTypeId>[] {
  return BIKE_VEHICLE_ORDER.map((id) => {
    const spec = VEHICLE_TYPE_CATALOG[id];
    const installCostRp = Math.max(0, spec.baseInstallCostRp * priceFactor(id, atMs) - spec.subsidyRp);
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
 * weighted-random draw — cars toward the real, local BFS fleet EV share
 * (far likelier where the household can charge at home, as today's electric
 * cars mostly are), bikes toward a judgment-call e-bike share (see
 * mobilitySystems.ts). */
function initialVehicleType(egid: string, ewid: string, slotIndex: number, kind: "car" | "bike"): VehicleTypeId {
  const u = mulberry32(hashSeed(egid, ewid, "mobility-vehicle-initial", kind, String(slotIndex)))();
  if (kind === "car") {
    const building = publicCharging.lookupBuilding(egid);
    const dwelling = building?.dwellings.find((d) => d.ewid === ewid);
    const atHome = !building || !dwelling || publicCharging.homeChargingAt(building, dwelling, { atStart: true });
    return u < (atHome ? INITIAL_EV_SHARE_WITH_HOME_CHARGING : INITIAL_EV_SHARE_WITHOUT_HOME_CHARGING) ? "carEV" : "carICE";
  }
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
  const key = vehicleEntityKey(egid, ewid, slotIndex, kind);
  const params: RenewalParams<VehicleTypeId> = {
    entityKey: key,
    egid,
    kind: kind === "car" ? "mobility-vehicle-car" : "mobility-vehicle-bike",
    labelFor: (id) => VEHICLE_TYPE_CATALOG[id].label,
    initialSystem: initialVehicleType(egid, ewid, slotIndex, kind),
    conditionalFirstLifetime: true,
    weibullShape: VEHICLE_WEIBULL_SHAPE,
    uncertaintyFraction: VEHICLE_UNCERTAINTY_FRACTION,
    biasStrengthRp: biasStrengthRp(egid, ewid, slotIndex, kind),
    lifetimeMeanYearsFor: (id) => VEHICLE_TYPE_CATALOG[id].lifetimeMeanYears,
    candidatesAt: (atMs, incumbent) => {
      if (kind === "bike") return bikeCandidatesAt(tariffStore.get(), atMs);
      const where = chargingAccessAt(egid, ewid, atMs);
      const access = where?.access ?? { kind: "home" };
      return carCandidatesAt(tariffStore.get(), atMs, incumbent, access, (chosenAtMs) => {
        if (access.kind === "public") publicCharging.assign(key, slotHandleFor(egid, ewid, slotIndex), access.siteId, chosenAtMs);
      });
    },
    // Replacing the car frees whatever charger the old one relied on; and a household that didn't
    // buy an electric car but would have with an on-street charger next door is demand a private
    // operator may meet.
    onCommit:
      kind === "car"
        ? (event) => {
            publicCharging.endAssignment(key, event.installedAtMs);
            if (event.system !== "carEV" && event.previousSystem !== null && wouldGoElectricWithCharger(egid, ewid, slotIndex, event.previousSystem, event.installedAtMs)) {
              const building = publicCharging.lookupBuilding(egid);
              if (building) publicCharging.logUnmetDemand(building.lon, building.lat, event.installedAtMs);
            }
          }
        : undefined,
  };
  return renewalEventsUpTo(params, simTimeMs);
}

/** Whether a household without home charging that just bought a car other than an electric one
 * would have gone electric with an empty on-street charger close by — the same decision, re-run with
 * that charger (publicCharging.hypotheticalOptionCostRp). */
function wouldGoElectricWithCharger(egid: string, ewid: string, slotIndex: number, incumbent: VehicleTypeId, atMs: number): boolean {
  const building = publicCharging.lookupBuilding(egid);
  const dwelling = building?.dwellings.find((d) => d.ewid === ewid);
  if (!building || !dwelling || publicCharging.homeChargingAt(building, dwelling)) return false;
  const nearby = publicCharging.hypotheticalOptionCostRp();
  const candidates = carCandidatesAt(tariffStore.get(), atMs, incumbent, { kind: "public", siteId: "", ...nearby }, () => {});
  const bias = biasStrengthRp(egid, ewid, slotIndex, "car") + policyStore.get().progressiveNudgeRp;
  return chooseNext(candidates, incumbent, VEHICLE_UNCERTAINTY_FRACTION, bias).chosen === "carEV";
}

/** Settles every vehicle purchase of a building's dwellings that has fallen due by `simTimeMs`
 * (both the car and the bike chain of every slot, which age independently of the current mode),
 * so each records its subsidy payout close to when it happened. */
export function commitVehicleDecisions(building: Building, simTimeMs: number): void {
  for (const dwelling of building.dwellings) {
    for (const h of slotHandles(building.egid, dwelling)) {
      handleVehicle(h, "car", simTimeMs);
      handleVehicle(h, "bike", simTimeMs);
    }
  }
}

export function currentVehicleType(egid: string, ewid: string, slotIndex: number, mode: MobilityMode, simTimeMs: number): VehicleTypeId | null {
  if (mode !== "car" && mode !== "bike") return null;
  return systemAt(vehicleChainFor(egid, ewid, slotIndex, mode, simTimeMs), simTimeMs);
}

// --- slot handles (the municipality-wide hot path) -------------------------------

/** One slot's chain keys, built once, and direct references to its chain entries once they exist.
 * Municipality-wide sampling asks every slot of every dwelling for its mode and vehicle at every
 * sample; going through the keyed caches meant building and hashing a long string key per lookup,
 * which was most of the cost of a sample. A handle resolves a slot with no string work at all as
 * long as its chains are complete up to the queried instant (the entries say until when). */
interface SlotHandle {
  egid: string;
  ewid: string;
  slotIndex: number;
  sessionKey: string; // ev.ts's per-car session key
  ev?: { seed: number; responsive: boolean }; // ev.ts's session seed and seeded trait, drawn on first use
  mode?: ModeChainEntry<MobilityMode>;
  car?: RenewalChainEntry<VehicleTypeId>;
  bike?: RenewalChainEntry<VehicleTypeId>;
  /** Its cars' public charger bookings (publicCharging.ts), fetched on first use. */
  publicCharging?: ReturnType<typeof publicCharging.assignmentsFor>;
}

/** The handle of a slot known only by ids (a decision closure) — through the dwelling it belongs to. */
function slotHandleFor(egid: string, ewid: string, slotIndex: number): SlotHandle | null {
  const dwelling = publicCharging.lookupBuilding(egid)?.dwellings.find((d) => d.ewid === ewid);
  return dwelling ? (slotHandles(egid, dwelling)[slotIndex] ?? null) : null;
}

/** The electric cars already on the road at game start whose households can't charge at home are
 * booked to the public charger each would pick, as far as there's room (building by building, in
 * the register's order) — so the real chargers start out with their users. One that finds no room
 * keeps its car (charging at work, say) but isn't counted at any charger. Run once, after the stock
 * is loaded and before the clock moves. */
export function bookInitialPublicCharging(buildings: Building[]): void {
  for (const building of buildings) {
    if (!existsAt(building, 0)) continue;
    for (const dwelling of building.dwellings) {
      if (publicCharging.homeChargingAt(building, dwelling)) continue;
      for (const h of slotHandles(building.egid, dwelling)) {
        if (initialVehicleType(building.egid, dwelling.ewid, h.slotIndex, "car") !== "carEV" || handleMode(h, 0) !== "car") continue;
        const option = publicCharging.bestOption(building.lon, building.lat, 0);
        if (option) publicCharging.assign(vehicleEntityKey(building.egid, dwelling.ewid, h.slotIndex, "car"), h, option.site.id, 0);
      }
    }
  }
}

// A publicly charged car only draws power while its household actually drives it.
publicCharging.setDrivingCheck((slot, atMs) => slot === null || handleMode(slot as SlotHandle, atMs) === "car");

const slotHandleCache = new WeakMap<Dwelling, SlotHandle[]>();

function slotHandles(egid: string, dwelling: Dwelling): SlotHandle[] {
  let handles = slotHandleCache.get(dwelling);
  if (!handles || handles[0].egid !== egid) {
    handles = Array.from({ length: mobilitySlotCount(egid, dwelling) }, (_, slotIndex) => ({
      egid,
      ewid: dwelling.ewid,
      slotIndex,
      sessionKey: `${dwelling.ewid}:${slotIndex}`,
    }));
    slotHandleCache.set(dwelling, handles);
  }
  return handles;
}

function handleMode(h: SlotHandle, simTimeMs: number): MobilityMode {
  const entry = h.mode;
  if (entry && simTimeMs < entry.nextDueMs) return modeAt(entry.events, simTimeMs);
  const events = modeChainFor(h.egid, h.ewid, h.slotIndex, simTimeMs);
  h.mode = modeChainEntry<MobilityMode>(modeEntityKey(h.egid, h.ewid, h.slotIndex));
  return modeAt(events, simTimeMs);
}

function handleVehicle(h: SlotHandle, kind: "car" | "bike", simTimeMs: number): VehicleTypeId {
  const entry = kind === "car" ? h.car : h.bike;
  if (entry && simTimeMs < entry.nextDueMs) return systemAt(entry.events, simTimeMs);
  const events = vehicleChainFor(h.egid, h.ewid, h.slotIndex, kind, simTimeMs);
  const fresh = renewalChainEntry<VehicleTypeId>(vehicleEntityKey(h.egid, h.ewid, h.slotIndex, kind));
  if (kind === "car") h.car = fresh;
  else h.bike = fresh;
  return systemAt(events, simTimeMs);
}

/** How many of a dwelling's slots use `vehicle` (in its own mode) at `simTimeMs`. */
export function slotsWithVehicleAt(egid: string, dwelling: Dwelling, vehicle: VehicleTypeId, simTimeMs: number): number {
  const kind = vehicle === "carEV" || vehicle === "carICE" ? "car" : "bike";
  let count = 0;
  for (const h of slotHandles(egid, dwelling)) {
    if (handleMode(h, simTimeMs) === kind && handleVehicle(h, kind, simTimeMs) === vehicle) count++;
  }
  return count;
}

// --- charging power ------------------------------------------------------------

/** Every currently-EV car slot's charging session, summed. Bikes draw no
 * modeled power — an e-bike's draw is negligible next to a car's, and
 * wasn't worth the added complexity (see mobilitySystems.ts). */
export function mobilityChargingPowerW(egid: string, dwelling: Dwelling, simTimeMs: number, tariff: Tariff): number {
  let totalW = 0;
  for (const h of slotHandles(egid, dwelling)) {
    if (handleMode(h, simTimeMs) !== "car" || handleVehicle(h, "car", simTimeMs) !== "carEV") continue;
    // A car relying on a public charger draws its power there, not at home (publicCharging.ts).
    h.publicCharging ??= publicCharging.assignmentsFor(vehicleEntityKey(egid, h.ewid, h.slotIndex, "car"));
    if (h.publicCharging.length > 0 && publicCharging.chargesPubliclyAt(h.publicCharging, simTimeMs)) continue;
    h.ev ??= { seed: evSessionSeed(egid, h.sessionKey), responsive: isResponsive(egid, h.sessionKey) };
    totalW += evChargingPowerWFrom(h.ev.seed, h.ev.responsive, simTimeMs, tariff);
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
