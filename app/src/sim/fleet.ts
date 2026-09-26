/**
 * Businesses' vans and lorries. How many goods vehicles the municipality has, and how many of them
 * are electric, is real (the BFS vehicle register, per municipality); which buildings they belong
 * to isn't, so the town's total is spread over the buildings by floor area and use (warehouses and
 * industry run the most, offices few, a flat above a shop a few — config/fleet.ts), each building
 * getting a seeded whole number of them, each vehicle a van or a lorry, with or without its own
 * place to charge.
 *
 * Each vehicle wears out on its own schedule and is replaced by the same four-factor decision as a
 * household's car (renewal.ts): purchase price, running cost, a business's (narrower) indifference
 * band and a (smaller) seeded leaning. An electric van or lorry with a depot charges there
 * overnight, at the off-peak price, once a charger is installed there (a wallbox for a van, a costly
 * high-power one for a lorry) — unless a public charger nearby is the better deal, a lorry charging
 * park say; one without a depot has to rely on a public charger with room in reach
 * (publicCharging.ts) — a van on-street, at a fast-charging hub or a lorry charging park, a lorry
 * only at a hub or a park — and without one, electric isn't an option. Lorries pay the heavy vehicle fee (LSVA) on diesel, from
 * which electric ones are exempt through 2030. A federal ban on new petrol and diesel cars applies
 * to vans too, not to lorries.
 *
 * The electric vehicles on the road at the start all have a depot (almost all of today's do), so
 * none needs booking at a public charger.
 */

import type { Building, MunicipalityDataset } from "../data/types";
import {
  DEPOT_CHARGER_COST_RP,
  DEPOT_POWER_KW,
  DEPOT_SHARE_BY_CLASS,
  DEPOT_SHARE_OTHER,
  DEPOT_SHARE_TRUCK_MIN,
  FALLBACK_GOODS_VEHICLES,
  FALLBACK_GOODS_VEHICLES_ELECTRIC,
  FLEET_BIAS_FRACTION,
  FLEET_CATALOG,
  FLEET_CHOICES,
  FLEET_DENSITY_BY_CLASS,
  FLEET_DENSITY_MIXED_USE,
  FLEET_UNCERTAINTY_FRACTION,
  FLEET_WEIBULL_SHAPE,
  INITIAL_TRUCK_EV_SHARE,
  LSVA_EV_EXEMPT_THROUGH_YEAR,
  LSVA_RP_PER_KM,
  MIXED_USE_CATEGORIES,
  TRUCK_SHARE_BY_CLASS,
  TRUCK_SHARE_OTHER,
  type FleetVehicleClass,
  type FleetVehicleId,
} from "../config/fleet";
import type { ChargingKind } from "../config/charging";
import { toDateMs } from "./calendar";
import { totalFloorAreaM2 } from "./commercial";
import { existsAt } from "./lifetime";
import { policyStore } from "./policy";
import { publicCharging, type ChargingNeed } from "./publicCharging";
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
import { firstRandom, hashSeed, hashSeedFrom } from "./rng";
import type { Tariff } from "./tariff";
import { tariffStore } from "./tariffStore";
import { priceFactor } from "./costTrends";

const DAY_MS = 24 * 3_600_000;

export interface FleetVehicle {
  egid: string;
  index: number;
  vehicleClass: FleetVehicleClass;
  depot: boolean;
  key: string;
  /** The vehicle's renewal chain, held once it exists (the hot path skips the keyed lookup). */
  entry?: RenewalChainEntry<FleetVehicleId>;
  /** Its public charger bookings (publicCharging.ts), fetched on first use. */
  assignments?: ReturnType<typeof publicCharging.assignmentsFor>;
}

function isMixedUse(b: Building): boolean {
  return b.category !== null && MIXED_USE_CATEGORIES.includes(b.category);
}

/** Relative vehicles per 1,000 m² of floor area for a building (0: none). */
function density(b: Building): number {
  const byClass = b.buildingClass ? FLEET_DENSITY_BY_CLASS[b.buildingClass] : undefined;
  if (byClass !== undefined) return byClass;
  return isMixedUse(b) ? FLEET_DENSITY_MIXED_USE : 0;
}

function expectedVehicles(b: Building): number {
  const d = density(b);
  if (d === 0) return 0;
  return (d * (totalFloorAreaM2(b) ?? 0)) / 1000;
}

function dailyKWh(id: FleetVehicleId): number {
  const spec = FLEET_CATALOG[id];
  return ((spec.annualKm / 100) * spec.kWhPer100Km) / 365;
}

function electricOf(vehicleClass: FleetVehicleClass): FleetVehicleId {
  return vehicleClass === "van" ? "vanEV" : "truckEV";
}

function publicNeed(vehicleClass: FleetVehicleClass): ChargingNeed {
  return {
    vehicle: vehicleClass,
    kWhPerDay: dailyKWh(electricOf(vehicleClass)),
    kinds: vehicleClass === "van" ? ["ac", "dc", "fleet"] : ["dc", "fleet"],
  };
}

/** How an electric vehicle bought now would charge: at the business's own yard (`chargerRp`: the
 * depot charger still to be installed, 0 if there already is one), at a public site, or nowhere. */
type FleetAccess =
  | { kind: "depot"; chargerRp: number }
  | { kind: "public"; siteId: string; priceRpPerKWh: number; hassleRp: number }
  | { kind: "none" };

function yearOf(simTimeMs: number): number {
  return new Date(toDateMs(simTimeMs)).getUTCFullYear();
}

function depotRunningRp(kWhPerYear: number, chargerRp: number, lifetimeYears: number, tariff: Tariff): number {
  return kWhPerYear * tariff.offPeakPriceRpKWh + chargerRp / lifetimeYears;
}

function candidatesFor(
  vehicleClass: FleetVehicleClass,
  tariff: Tariff,
  access: FleetAccess,
  atMs: number,
  onElectricChosen: (atMs: number) => void,
): RenewalCandidate<FleetVehicleId>[] {
  // Without a charger to rely on, electric is out — its cost is still worked out as if one were
  // close by, so the decision records whether it was wanted.
  const hypothetical = publicCharging.hypotheticalOptionCostRp(vehicleClass === "van" ? "ac" : "fleet");
  const lsvaApplies = (electric: boolean) => vehicleClass === "truck" && (!electric || yearOf(atMs) > LSVA_EV_EXEMPT_THROUGH_YEAR);
  return FLEET_CHOICES[vehicleClass].map((id) => {
    const spec = FLEET_CATALOG[id];
    const kWh = (spec.annualKm / 100) * spec.kWhPer100Km;
    let runningRp: number;
    if (!spec.electric) runningRp = (spec.annualKm / 100) * spec.litersPer100Km * tariff.petrolPriceRpPerLiter;
    else if (access.kind === "depot") runningRp = depotRunningRp(kWh, access.chargerRp, spec.lifetimeMeanYears, tariff);
    else {
      const option = access.kind === "public" ? access : hypothetical;
      runningRp = kWh * option.priceRpPerKWh + option.hassleRp;
    }
    if (lsvaApplies(spec.electric)) runningRp += spec.annualKm * LSVA_RP_PER_KM;
    const available = spec.electric ? access.kind !== "none" : vehicleClass === "truck" || !policyStore.get().iceCarPurchaseBanned;
    return {
      id,
      available,
      annualizedCostRp: (spec.purchaseCostRp * priceFactor(id, atMs)) / spec.lifetimeMeanYears + runningRp,
      lifetimeMeanYears: spec.lifetimeMeanYears,
      greenness: spec.greenness,
      onChosen: spec.electric ? onElectricChosen : undefined,
    };
  });
}

class Fleets {
  private scale = 0; // vehicles per unit of expectedVehicles
  private initialEvShareAtDepot: Record<FleetVehicleClass, number> = { van: 0, truck: 0 };
  private byEgid = new Map<string, FleetVehicle[]>();
  /** Every vehicle of a building list, flattened once per list (the stock hands out a new array
   * whenever it changes) — municipality-wide sampling walks this instead of every building. */
  private flat = new WeakMap<Building[], { v: FleetVehicle; b: Building }[]>();
  private lookupBuilding: (egid: string) => Building | undefined = () => undefined;

  /** Spreads the registered goods vehicles over the buildings standing at the start, and works out
   * how likely a vehicle with a depot is to be electric at the start so the town's electric count
   * matches the register. Before the stock is loaded. */
  init(dataset: MunicipalityDataset, lookupBuilding: (egid: string) => Building | undefined): void {
    this.byEgid = new Map();
    this.lookupBuilding = lookupBuilding;
    const register = dataset.vehicleRegister;
    const total = register?.goodsVehicles ?? FALLBACK_GOODS_VEHICLES;
    const electric = register?.goodsVehiclesElectric ?? FALLBACK_GOODS_VEHICLES_ELECTRIC;
    const expected = dataset.buildings.reduce((sum, b) => sum + expectedVehicles(b), 0);
    this.scale = expected > 0 ? total / expected : 0;

    const counts = { van: 0, truck: 0, vanDepot: 0, truckDepot: 0 };
    for (const b of dataset.buildings) {
      for (const v of this.vehiclesOf(b)) {
        counts[v.vehicleClass]++;
        if (v.depot) counts[v.vehicleClass === "van" ? "vanDepot" : "truckDepot"]++;
      }
    }
    const truckElectric = counts.truck * INITIAL_TRUCK_EV_SHARE;
    const vanElectric = Math.max(0, electric - truckElectric);
    this.initialEvShareAtDepot = {
      van: counts.vanDepot > 0 ? Math.min(1, vanElectric / counts.vanDepot) : 0,
      truck: counts.truckDepot > 0 ? Math.min(1, truckElectric / counts.truckDepot) : 0,
    };
  }

  /** A building's vans and lorries (seeded, the same every time it's asked). */
  vehiclesOf(b: Building): FleetVehicle[] {
    let list = this.byEgid.get(b.egid);
    if (list) return list;
    list = [];
    const expected = expectedVehicles(b) * this.scale;
    if (expected > 0) {
      const count = Math.floor(expected) + (firstRandom(hashSeed(b.egid, "fleet-count")) < expected - Math.floor(expected) ? 1 : 0);
      const cls = b.buildingClass ?? "";
      const truckShare = TRUCK_SHARE_BY_CLASS[cls] ?? TRUCK_SHARE_OTHER;
      const depotShare = DEPOT_SHARE_BY_CLASS[cls] ?? DEPOT_SHARE_OTHER;
      for (let i = 0; i < count; i++) {
        const vehicleClass: FleetVehicleClass = firstRandom(hashSeed(b.egid, "fleet-class", String(i))) < truckShare ? "truck" : "van";
        const depotChance = vehicleClass === "truck" ? Math.max(depotShare, DEPOT_SHARE_TRUCK_MIN) : depotShare;
        const depot = firstRandom(hashSeed(b.egid, "fleet-depot", String(i))) < depotChance;
        list.push({ egid: b.egid, index: i, vehicleClass, depot, key: `${b.egid}:fleet:${i}` });
      }
    }
    this.byEgid.set(b.egid, list);
    return list;
  }

  private initialType(v: FleetVehicle): FleetVehicleId {
    const share = v.depot ? this.initialEvShareAtDepot[v.vehicleClass] : 0;
    const u = firstRandom(hashSeed(v.key, "fleet-initial"));
    return u < share ? electricOf(v.vehicleClass) : FLEET_CHOICES[v.vehicleClass][1];
  }

  private biasRp(v: FleetVehicle): number {
    const diesel = FLEET_CATALOG[FLEET_CHOICES[v.vehicleClass][1]];
    const yearlyRp = diesel.purchaseCostRp / diesel.lifetimeMeanYears;
    return (firstRandom(hashSeed(v.key, "fleet-bias")) - 0.5) * 2 * FLEET_BIAS_FRACTION * yearlyRp;
  }

  /** Whether the vehicle relies on a public charger at `simTimeMs`. */
  private chargesPubliclyAt(v: FleetVehicle, simTimeMs: number): boolean {
    v.assignments ??= publicCharging.assignmentsFor(v.key);
    return v.assignments.length > 0 && publicCharging.chargesPubliclyAt(v.assignments, simTimeMs);
  }

  /** How an electric replacement bought at `atMs` would charge. A business with a yard weighs a
   * charger of its own (nothing more to install if its outgoing electric vehicle charged there)
   * against the best public site with room — a lorry charging park can beat a CHF 80,000 depot
   * charger; one without a yard has only the public sites. */
  private accessAt(v: FleetVehicle, b: Building, atMs: number, incumbent: FleetVehicleId): FleetAccess {
    const option = publicCharging.bestOption(b.lon, b.lat, atMs, publicNeed(v.vehicleClass));
    const publicAccess: FleetAccess | null = option
      ? { kind: "public", siteId: option.site.id, priceRpPerKWh: option.priceRpPerKWh, hassleRp: option.hassleRp }
      : null;
    if (!v.depot) return publicAccess ?? { kind: "none" };
    const hasCharger = FLEET_CATALOG[incumbent].electric && !this.chargesPubliclyAt(v, atMs);
    const depot: FleetAccess = { kind: "depot", chargerRp: hasCharger ? 0 : DEPOT_CHARGER_COST_RP[v.vehicleClass] * priceFactor("depotCharger", atMs) };
    if (!option) return depot;
    const spec = FLEET_CATALOG[electricOf(v.vehicleClass)];
    const kWh = (spec.annualKm / 100) * spec.kWhPer100Km;
    const publicRp = kWh * option.priceRpPerKWh + option.hassleRp;
    return publicRp < depotRunningRp(kWh, depot.chargerRp, spec.lifetimeMeanYears, tariffStore.get()) ? (publicAccess as FleetAccess) : depot;
  }

  /** Whether a vehicle without a depot that just went diesel would have gone electric with a
   * charger of its kind close by — demand a private operator (for vans) may meet. */
  private wouldGoElectricWithCharger(v: FleetVehicle, incumbent: FleetVehicleId, atMs: number): boolean {
    const kind: ChargingKind = v.vehicleClass === "van" ? "ac" : "fleet";
    const nearby = publicCharging.hypotheticalOptionCostRp(kind);
    const candidates = candidatesFor(v.vehicleClass, tariffStore.get(), { kind: "public", siteId: "", ...nearby }, atMs, () => {});
    return chooseNext(candidates, incumbent, FLEET_UNCERTAINTY_FRACTION, this.biasRp(v) + policyStore.get().progressiveNudgeRp).chosen !== FLEET_CHOICES[v.vehicleClass][1];
  }

  private chain(v: FleetVehicle, uptoMs: number): RenewalEvent<FleetVehicleId>[] {
    const cached = peekRenewalChain<FleetVehicleId>(v.key, uptoMs);
    if (cached) return cached;
    const params: RenewalParams<FleetVehicleId> = {
      entityKey: v.key,
      egid: v.egid,
      kind: v.vehicleClass === "van" ? "fleet-van" : "fleet-truck",
      labelFor: (id) => FLEET_CATALOG[id].label,
      initialSystem: this.initialType(v),
      conditionalFirstLifetime: true,
      weibullShape: FLEET_WEIBULL_SHAPE,
      uncertaintyFraction: FLEET_UNCERTAINTY_FRACTION,
      biasStrengthRp: this.biasRp(v),
      lifetimeMeanYearsFor: (id) => FLEET_CATALOG[id].lifetimeMeanYears,
      candidatesAt: (atMs, incumbent) => {
        const b = this.lookupBuilding(v.egid);
        const access: FleetAccess = b ? this.accessAt(v, b, atMs, incumbent) : { kind: "depot", chargerRp: 0 };
        return candidatesFor(v.vehicleClass, tariffStore.get(), access, atMs, (chosenAtMs) => {
          if (access.kind === "public") publicCharging.assign(v.key, null, access.siteId, chosenAtMs, publicNeed(v.vehicleClass));
        });
      },
      onCommit: (event) => {
        publicCharging.endAssignment(v.key, event.installedAtMs);
        if (v.depot || FLEET_CATALOG[event.system].electric || event.previousSystem === null) return;
        if (!this.wouldGoElectricWithCharger(v, event.previousSystem, event.installedAtMs)) return;
        const b = this.lookupBuilding(v.egid);
        if (b) publicCharging.logUnmetDemand(b.lon, b.lat, event.installedAtMs, v.vehicleClass === "van" ? "ac" : "fleet");
      },
    };
    const events = renewalEventsUpTo(params, uptoMs);
    v.entry ??= renewalChainEntry<FleetVehicleId>(v.key);
    return events;
  }

  /** The vehicle's type at `simTimeMs`. */
  typeAt(v: FleetVehicle, simTimeMs: number): FleetVehicleId {
    const entry = v.entry;
    if (entry && simTimeMs < entry.nextDueMs) return systemAt(entry.events, simTimeMs);
    return systemAt(this.chain(v, simTimeMs), simTimeMs);
  }

  /** The vehicle's replacements so far (for the building panel). */
  history(v: FleetVehicle, simTimeMs: number): RenewalEvent<FleetVehicleId>[] {
    return this.chain(v, simTimeMs).filter((e) => e.installedAtMs <= simTimeMs);
  }

  /** Settles every replacement of a building's vehicles fallen due by `simTimeMs` (stock.ts). */
  commit(b: Building, simTimeMs: number): void {
    for (const v of this.vehiclesOf(b)) this.typeAt(v, simTimeMs);
  }

  /** Where a vehicle charges at `simTimeMs`: at its depot, at a public site, or not at all (diesel). */
  chargingAt(v: FleetVehicle, simTimeMs: number): { kind: "depot" } | { kind: "public"; siteId: string } | null {
    if (!FLEET_CATALOG[this.typeAt(v, simTimeMs)].electric) return null;
    const list = publicCharging.assignmentsFor(v.key);
    for (let i = list.length - 1; i >= 0; i--) {
      const a = list[i];
      if (a.fromMs <= simTimeMs) {
        if (simTimeMs < a.toMs) return { kind: "public", siteId: a.siteId };
        break;
      }
    }
    return v.depot ? { kind: "depot" } : null;
  }

  /** A building's electric vehicles charging at its depot at `simTimeMs`. */
  depotPowerW(b: Building, simTimeMs: number): number {
    const list = this.vehiclesOf(b);
    if (list.length === 0) return 0;
    let total = 0;
    for (const v of list) {
      if (!v.depot) continue;
      const id = this.typeAt(v, simTimeMs);
      if (FLEET_CATALOG[id].electric && !this.chargesPubliclyAt(v, simTimeMs)) total += this.depotSessionW(v, id, simTimeMs);
    }
    return total;
  }

  private flatten(buildings: Building[]): { v: FleetVehicle; b: Building }[] {
    let list = this.flat.get(buildings);
    if (!list) {
      list = [];
      for (const b of buildings) for (const v of this.vehiclesOf(b)) list.push({ v, b });
      this.flat.set(buildings, list);
    }
    return list;
  }

  /** One electric vehicle's draw at its depot at `simTimeMs`: overnight, starting some time after
   * the working day, until the day's energy is in. */
  private depotSessionW(v: FleetVehicle, id: FleetVehicleId, simTimeMs: number): number {
    const powerKw = DEPOT_POWER_KW[v.vehicleClass];
    const hours = dailyKWh(id) / powerKw;
    // The session that started yesterday evening may still be running.
    for (const dayOffset of [0, -1]) {
      const day = Math.floor(simTimeMs / DAY_MS) + dayOffset;
      const startHour = 17 + firstRandom(hashSeedFrom(hashSeed(v.key, "depot"), String(day))) * 3;
      const startMs = day * DAY_MS + startHour * 3_600_000;
      if (simTimeMs >= startMs && simTimeMs < startMs + hours * 3_600_000) return powerKw * 1000;
    }
    return 0;
  }

  /** Every depot's charging draw across the given buildings at `simTimeMs`. */
  totalDepotPowerW(buildings: Building[], simTimeMs: number): number {
    let total = 0;
    for (const { v, b } of this.flatten(buildings)) {
      if (!v.depot) continue;
      const id = this.typeAt(v, simTimeMs);
      if (FLEET_CATALOG[id].electric && existsAt(b, simTimeMs) && !this.chargesPubliclyAt(v, simTimeMs)) total += this.depotSessionW(v, id, simTimeMs);
    }
    return total;
  }

  /** Diesel the given buildings' vehicles burn in a year at the rate they stand at `simTimeMs` (L). */
  dieselLitersPerYearAt(buildings: Building[], simTimeMs: number): number {
    let liters = 0;
    for (const { v, b } of this.flatten(buildings)) {
      const spec = FLEET_CATALOG[this.typeAt(v, simTimeMs)];
      if (spec.litersPer100Km > 0 && existsAt(b, simTimeMs)) liters += (spec.annualKm / 100) * spec.litersPer100Km;
    }
    return liters;
  }

  /** The town's vans and lorries at `simTimeMs`, and how many are electric. */
  census(buildings: Building[], simTimeMs: number): { vans: number; vansElectric: number; trucks: number; trucksElectric: number } {
    const c = { vans: 0, vansElectric: 0, trucks: 0, trucksElectric: 0 };
    for (const b of buildings) {
      if (!existsAt(b, simTimeMs)) continue;
      for (const v of this.vehiclesOf(b)) {
        const electric = FLEET_CATALOG[this.typeAt(v, simTimeMs)].electric;
        if (v.vehicleClass === "van") {
          c.vans++;
          if (electric) c.vansElectric++;
        } else {
          c.trucks++;
          if (electric) c.trucksElectric++;
        }
      }
    }
    return c;
  }
}

export const fleets = new Fleets();
