/**
 * Dev-only scenario runner for balancing: plays a municipality forward month by month with a chosen
 * set of measures enacted at chosen years, without the UI or the clock, and reports how things turned
 * out at the years you ask about. Exposed as window.__scenario in development (see App.tsx).
 *
 * Every scenario needs a fresh page load: the simulation's decision chains and caches are module-level
 * and remember everything.
 */

import type { MunicipalityDataset } from "../data/types";
import { approval } from "../sim/approval";
import { toDateMs } from "../sim/calendar";
import { computeEmissionsForYear } from "../sim/emissions";
import { currentHeatingSystemId } from "../sim/heatingRenewal";
import { existsAt } from "../sim/lifetime";
import { measures } from "../sim/measures";
import { currentMobilityMode, currentVehicleType, mobilitySlotCount } from "../sim/mobility";
import { energyClassAt } from "../sim/retrofit";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";
import { stock } from "../sim/stock";
import { streets } from "../sim/streets";
import { districtHeat } from "../sim/districtHeat";
import { publicCharging } from "../sim/publicCharging";
import { fleets } from "../sim/fleet";
import { tariffStore } from "../sim/tariffStore";
import { setCostTrendsEnabled } from "../sim/costTrends";
import { bookInitialPublicCharging } from "../sim/mobility";
import { PAYOUT_CATEGORIES, treasury } from "../sim/treasury";
import type { Difficulty } from "../config/difficulty";

const MONTH_MS = (365.25 * 24 * 60 * 60_000) / 12;

export interface ScenarioSpec {
  difficulty?: Difficulty;
  /** Measures to enact, and in which calendar year (1 January; 2026 = at the start). */
  enact: { id: string; params?: Record<string, number | boolean | string>; year?: number }[];
  /** Calendar years to report on (each read as of 1 January). */
  reportYears: number[];
  /** Municipal public chargers to build, and in which calendar year (1 January). */
  chargers?: { kind: "ac" | "dc" | "fleet"; lon: number; lat: number; points?: number; year?: number }[];
  /** False: every technology keeps today's price (costTrends.ts), to measure what the trends do. */
  costTrends?: boolean;
  /** Tariff changes at the start (e.g. the municipal public charging prices). */
  tariff?: Record<string, number>;
  /** Run the approval model too (votes and game over included). Off by default: the physical effect of
   * a measure is easier to judge without a referendum striking it down. */
  withApproval?: boolean;
  /** Also compute the year's emissions (slow: a few seconds per year). */
  withEmissions?: boolean;
}

export interface ScenarioRow {
  year: number;
  buildings: number;
  heating: Record<string, number>;
  heatPumpShare: number;
  carSlots: { evShare: number };
  /** Public charging: open sites and points, cars relying on them against their room, sites private
   * operators opened, and households that wanted an electric car last year but found no charger. */
  charging: { sites: number; points: number; users: number; capacity: number; operatorSites: number; unmetLastYear: number; vehicles: Record<string, number> };
  fleet: { vans: number; vansElectric: number; trucks: number; trucksElectric: number };
  modeShare: Record<string, number>;
  energyClass: Record<string, number>;
  solarKwp: number;
  spentChf: Record<string, number>;
  spentTotalChf: number;
  approval?: number;
  gameOver?: string;
  log?: string[];
  emissionsKt?: number;
  emissionsBreakdownKt?: Record<string, number>;
}

function shares(counts: Record<string, number>): Record<string, number> {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Math.round((v / total) * 1000) / 1000]));
}

function snapshot(dataset: MunicipalityDataset, year: number, atMs: number): ScenarioRow {
  const buildings = stock.getAll().filter((b) => existsAt(b, atMs));
  const heating: Record<string, number> = {};
  const modes: Record<string, number> = {};
  const classes: Record<string, number> = {};
  let carSlots = 0;
  let evSlots = 0;
  for (const b of buildings) {
    const h = currentHeatingSystemId(b, atMs) ?? "other";
    heating[h] = (heating[h] ?? 0) + 1;
    const c = energyClassAt(b, atMs);
    classes[c] = (classes[c] ?? 0) + 1;
    for (const d of b.dwellings) {
      const slots = mobilitySlotCount(b.egid, d);
      for (let s = 0; s < slots; s++) {
        const mode = currentMobilityMode(b.egid, d.ewid, s, atMs);
        modes[mode] = (modes[mode] ?? 0) + 1;
        if (mode === "car") {
          carSlots++;
          if (currentVehicleType(b.egid, d.ewid, s, mode, atMs) === "carEV") evSlots++;
        }
      }
    }
  }
  const plants = effectivePowerPlantsAt(stock.getAll(), dataset.powerPlants, atMs);
  const solarKwp = plants.filter((p) => p.technology === "Photovoltaic" && (p.activeToMs === undefined || p.activeToMs > atMs)).reduce((s, p) => s + (p.capacityKw ?? 0), 0);
  const paid = treasury.paidOut(-1e15, atMs);
  const spentChf = Object.fromEntries(PAYOUT_CATEGORIES.map((c) => [c, Math.round(paid[c] / 100)]));
  const heatPumps = (heating.airHeatPump ?? 0) + (heating.groundHeatPump ?? 0);
  return {
    year,
    buildings: buildings.length,
    heating,
    heatPumpShare: Math.round((heatPumps / (buildings.length || 1)) * 1000) / 1000,
    carSlots: { evShare: Math.round((evSlots / (carSlots || 1)) * 1000) / 1000 },
    charging: {
      ...(({ sites, points, users, capacity, vehicles }) => ({ sites, points, users: Math.round(users), capacity, vehicles }))(publicCharging.townUsage(atMs)),
      operatorSites: publicCharging.getSites().filter((s) => s.id.startsWith("operator-")).length,
      unmetLastYear: publicCharging.unmetDemandCount(atMs - 12 * MONTH_MS, atMs),
    },
    fleet: fleets.census(stock.getAll(), atMs),
    modeShare: shares(modes),
    energyClass: classes,
    solarKwp: Math.round(solarKwp),
    spentChf,
    spentTotalChf: Object.values(spentChf).reduce((a, b) => a + b, 0),
    approval: approval.getGameOver() || undefined ? undefined : Math.round(approval.getApproval() * 10) / 10,
    gameOver: approval.getGameOver()?.headline,
  };
}

export async function runScenario(spec: ScenarioSpec, onProgress?: (msg: string) => void): Promise<ScenarioRow[]> {
  const dataset = (await (await fetch("/data/schlieren.json")).json()) as MunicipalityDataset;
  const difficulty = spec.difficulty ?? "normal";
  measures.init(difficulty);
  if (spec.withApproval) approval.init(difficulty, `approval:${dataset.bfsNumber}`);
  streets.init(dataset);
  districtHeat.init(dataset);
  publicCharging.init(dataset, 0);
  publicCharging.setBuildingLookup((egid) => stock.lookup(egid));
  fleets.init(dataset, (egid) => stock.lookup(egid)); // before the stock: it commits their decisions
  stock.init(dataset);
  bookInitialPublicCharging(stock.getAll()); // after the stock: it needs every building

  const startYear = new Date(toDateMs(0)).getUTCFullYear();
  const lastYear = Math.max(...spec.reportYears);
  const rows: ScenarioRow[] = [];
  const pending = [...spec.enact];
  let t = 0;

  const enactDue = (year: number, atMs: number) => {
    for (const e of pending.filter((p) => (p.year ?? startYear) <= year)) {
      measures.enact(e.id, e.params ?? {}, atMs);
      pending.splice(pending.indexOf(e), 1);
    }
  };
  const pendingChargers = [...(spec.chargers ?? [])];
  const buildDue = (year: number, atMs: number) => {
    for (const c of pendingChargers.filter((p) => (p.year ?? startYear) <= year)) {
      publicCharging.build(c.kind, c.lon, c.lat, atMs, c.points);
      pendingChargers.splice(pendingChargers.indexOf(c), 1);
    }
  };
  if (spec.tariff) tariffStore.set(spec.tariff);
  setCostTrendsEnabled(spec.costTrends ?? true);
  enactDue(startYear, 0);
  buildDue(startYear, 0);

  for (;;) {
    const previous = new Date(toDateMs(t));
    t += MONTH_MS;
    const now = new Date(toDateMs(t));
    const year = now.getUTCFullYear();
    measures.advance(t);
    if (spec.withApproval) approval.advance(t);
    stock.advance(t);
    publicCharging.advance(t);
    enactDue(year, t);
    buildDue(year, t);

    const newYear = now.getUTCFullYear() !== previous.getUTCFullYear();
    // Solar adoption settles a year's round the first time that year is asked about — in the game the
    // map and the year-end report ask every year; here nothing would until the next report year.
    if (newYear) effectivePowerPlantsAt(stock.getAll(), dataset.powerPlants, t);
    if (newYear && spec.reportYears.includes(year)) {
      const row = snapshot(dataset, year, t);
      if (spec.withEmissions) {
        onProgress?.(`emissions ${year - 1}`);
        const e = await computeEmissionsForYear(stock.getAll(), dataset.powerPlants, year - 1);
        row.emissionsKt = Math.round(e.totalKgCO2 / 1000);
        row.emissionsBreakdownKt = {
          electricity: Math.round(e.electricityKgCO2 / 1000),
          gas: Math.round(e.gasKgCO2 / 1000),
          oil: Math.round(e.oilKgCO2 / 1000),
          district: Math.round(e.districtHeatingKgCO2 / 1000),
          mobility: Math.round(e.mobilityKgCO2 / 1000),
        };
      }
      rows.push(row);
      onProgress?.(`done ${year}`);
    }
    if (newYear && year >= lastYear) break;
    if (spec.withApproval && approval.getGameOver()) break;
  }
  if (rows.length > 0) {
    rows[rows.length - 1].log = [...measures.getHistory(), ...approval.getLog()].sort((a, b) => a.atMs - b.atMs).map((l) => `${new Date(toDateMs(l.atMs)).getUTCFullYear()}: ${l.text}`);
  }
  return rows;
}
