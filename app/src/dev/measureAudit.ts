/**
 * Does each measure do what it says? Plays a municipality forward once with nothing enacted and once
 * per measure (at its default settings, and at its strongest), and reads out what the measure's text
 * promises: scripts/measure-audit.mjs runs them all and compares each with the do-nothing run.
 *
 * The grid is reinforced as it fills up, so a full transformer doesn't hide what a measure does.
 * Decisions are seeded, so two runs differ only by what the measure set off — but a change anywhere
 * ripples, so a tiny difference in an unrelated figure means nothing.
 */

import { energyClassAt } from "../sim/retrofit";
import { advisors, type AdvisorId } from "../sim/advisors";
import { agriPv } from "../sim/agriPv";
import { carParks } from "../sim/carParks";
import { fleets } from "../sim/fleet";
import { grid } from "../sim/grid";
import { currentHeatingSystemId } from "../sim/heatingRenewal";
import { sampleMunicipalityCategorySeries } from "../sim/history";
import { existsAt } from "../sim/lifetime";
import { pointsAt, publicCharging, workChargingShareAt } from "../sim/publicCharging";
import { effectivePowerPlantsAt } from "../sim/solarAdoption";
import { steepArraysKwp } from "../sim/solarAdoption";
import { stock } from "../sim/stock";
import { tariffStore } from "../sim/tariffStore";
import { totalWorkChargingPowerW } from "../sim/workCharging";
import { toDateMs } from "../sim/calendar";
import { dataUrl } from "../data/loadDataset";
import type { Difficulty } from "../config/difficulty";
import type { PowerPlant } from "../data/types";
import { runScenario, type ScenarioRow } from "./scenario";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
export const REPORT_YEARS = [2031, 2036, 2041];

/** A figure's path in a row ("solarKwp", "spentChf.solar"), the way it should move against the baseline's
 * ('>' up, '<' down), and optionally the year to read it in (the middle one if not given). */
export type Expectation = [path: string, op: ">" | "<", year?: number];

export interface AuditTest {
  name: string;
  /** What to compare with (the do-nothing run if not given). */
  against?: string;
  difficulty?: Difficulty;
  enact: { id: string; params?: Record<string, number | boolean | string> }[];
  expect: Expectation[];
}

function test(name: string, params: Record<string, number | boolean | string>, expect: Expectation[], id = name.split(":")[0]): AuditTest {
  return { name, enact: [{ id, params }], expect };
}

export const AUDIT_TESTS: AuditTest[] = [
  { name: "base", enact: [], expect: [] },
  { name: "base:hard", difficulty: "hard", enact: [], expect: [] },

  // Subsidies
  test("solar-subsidy", { perKwp: 300, fixed: 0 }, [["solarKwp", ">"], ["spentChf.solar", ">"]]),
  test("solar-subsidy:max", { perKwp: 2000, fixed: 10000, steep: 2000 }, [["solarKwp", ">"], ["spentChf.solar", ">"]]),
  test("solar-subsidy:steep", { perKwp: 0, fixed: 0, steep: 500 }, [["audit.steepKwp", ">"], ["audit.framedKwp", ">"], ["spentChf.solar", ">"]]),
  test("solar-subsidy:steep-max", { perKwp: 0, fixed: 0, steep: 2000 }, [["audit.steepKwp", ">"], ["audit.framedKwp", ">"], ["spentChf.solar", ">"]]),
  test("fleet-ev-grant", { vanEarly: 6000, vanEnd: 6000, truckEarly: 40000, truckEnd: 40000 }, [["fleet.vansElectric", ">"], ["fleet.trucksElectric", ">"], ["spentChf.vehicle", ">"]]),
  test("fleet-ev-grant:early", { vanEarly: 20000, vanEnd: 0, truckEarly: 150000, truckEnd: 0 }, [["fleet.vansElectric", ">"], ["fleet.trucksElectric", ">"], ["spentChf.vehicle", ">"]]),
  test("fleet-ev-grant:end", { vanEarly: 0, vanEnd: 20000, truckEarly: 0, truckEnd: 150000 }, [["fleet.vansElectric", ">"], ["fleet.trucksElectric", ">"], ["spentChf.vehicle", ">"]]),
  test("fleet-ev-grant:max", { vanEarly: 30000, vanEnd: 30000, truckEarly: 200000, truckEnd: 200000 }, [["fleet.vansElectric", ">"], ["fleet.trucksElectric", ">"], ["spentChf.vehicle", ">"]]),
  test("pv-loans", { max: 40000 }, [["solarKwp", ">"], ["spentExGridChf", ">"]]),
  test("pv-loans:max", { max: 150000 }, [["solarKwp", ">"], ["spentExGridChf", ">"]]),
  test("solar-cooperatives", { perKwp: 200 }, [["solarKwp", ">"], ["spentExGridChf", ">"]]),
  test("solar-cooperatives:max", { perKwp: 800 }, [["solarKwp", ">"], ["spentExGridChf", ">"]]),
  test("solar-cooperatives:low", { perKwp: 50 }, [["solarKwp", ">"]]),
  test("car-park-solar-subsidy", { perKwp: 300 }, [["audit.canopyKw", ">"], ["spentChf.solar", ">"]]),
  test("car-park-solar-subsidy:max", { perKwp: 1000 }, [["audit.canopyKw", ">"], ["spentChf.solar", ">"]]),
  test("home-battery-subsidy", { perKwh: 300, condition: "grid" }, [["batteries.withBattery", ">"], ["batteries.gridFriendly", ">"], ["spentExGridChf", ">"]]),
  test("home-battery-subsidy:free", { perKwh: 300, condition: "none" }, [["batteries.withBattery", ">"], ["spentExGridChf", ">"]]),
  test("home-battery-subsidy:max", { perKwh: 1000, condition: "grid" }, [["batteries.withBattery", ">"], ["batteries.gridFriendly", ">"], ["spentExGridChf", ">"]]),
  test("heat-pump-grant", { early: 5000, fossil: 5000, other: 5000 }, [["heatPumpShare", ">"], ["spentChf.heating", ">"]]),
  test("heat-pump-grant:max", { early: 20000, fossil: 20000, other: 20000 }, [["heatPumpShare", ">"], ["spentChf.heating", ">"]]),
  test("heat-pump-grant:early", { early: 5000, fossil: 0, other: 0 }, [["heatPumpShare", ">"], ["spentChf.heating", ">"]]),
  test("heat-pump-grant:early-max", { early: 20000, fossil: 0, other: 0 }, [["heatPumpShare", ">"], ["spentChf.heating", ">"]]),
  test("heat-pump-grant:fossil", { early: 0, fossil: 5000, other: 0 }, [["heatPumpShare", ">"], ["spentChf.heating", ">"]]),
  test("heat-pump-grant:other", { early: 0, fossil: 0, other: 5000 }, [["spentChf.heating", ">"]]),
  test("heat-pump-grant:default", {}, [["heatPumpShare", ">"], ["spentChf.heating", ">"]]),
  test("district-heat-connection-grant", { early: 5000, fossil: 5000, other: 5000 }, [["heating.districtHeating", ">"], ["spentChf.heating", ">"]]),
  test("district-heat-connection-grant:early", { early: 20000, fossil: 0, other: 0 }, [["spentChf.heating", ">"]]), // few pipes without a network: those it reaches would connect by the middle year anyway
  test("district-heat-connection-grant:max", { early: 20000, fossil: 20000, other: 20000 }, [["heating.districtHeating", ">"], ["spentChf.heating", ">"]]),
  test("ev-grant", { early: 3000, fossil: 3000, other: 3000 }, [["carSlots.evShare", ">"], ["spentChf.vehicle", ">"]]),
  test("ev-grant:max", { early: 10000, fossil: 10000, other: 10000 }, [["carSlots.evShare", ">"], ["spentChf.vehicle", ">"]]),
  test("ev-grant:early", { early: 3000, fossil: 0, other: 0 }, [["carSlots.evShare", ">"], ["spentChf.vehicle", ">"]]),
  test("ev-grant:early-max", { early: 10000, fossil: 0, other: 0 }, [["carSlots.evShare", ">"], ["spentChf.vehicle", ">"]]),
  test("ev-grant:fossil", { early: 0, fossil: 3000, other: 0 }, [["carSlots.evShare", ">"], ["spentChf.vehicle", ">"]]),
  test("ev-grant:default", {}, [["carSlots.evShare", ">"], ["spentChf.vehicle", ">"]]),
  test("retrofit-topup", { standard: 40, minergie: 40, minergieP: 40 }, [["audit.goodEnvelopes", ">"], ["spentChf.retrofit", ">"]]),
  test("retrofit-topup:max", { standard: 200, minergie: 200, minergieP: 200 }, [["audit.goodEnvelopes", ">"], ["spentChf.retrofit", ">"]]),
  test("retrofit-topup:deep", { standard: 0, minergie: 40, minergieP: 100 }, [["audit.minergieEnvelopes", ">"], ["spentChf.retrofit", ">"]]),
  test("workplace-charging", { reach: 30, timing: "sun" }, [["audit.workShare", ">"], ["carSlots.evShare", ">"], ["audit.workMiddayShare", ">"], ["spentChf.programs", ">"]]),
  test("workplace-charging:arrival", { reach: 60, timing: "arrival" }, [["audit.workShare", ">"], ["carSlots.evShare", ">"], ["spentChf.programs", ">"]]),

  // Infrastructure
  test("municipal-solar", { perYear: 3 }, [["solarKwp", ">"], ["spentChf.infrastructure", ">"]]),
  test("municipal-solar:max", { perYear: 20 }, [["solarKwp", ">"], ["spentChf.infrastructure", ">"]]),
  test("car-park-solar", { perYear: 2 }, [["audit.canopyMunicipalKw", ">"], ["spentExGridChf", ">"]]),
  test("car-park-solar:max", { perYear: 6 }, [["audit.canopyMunicipalKw", ">"], ["spentExGridChf", ">"]]),
  test("public-building-chargers", { perYear: 2, points: "4" }, [["audit.sitesAtBuildings", ">"], ["audit.municipalPoints", ">"], ["spentChf.charging", ">"]]),
  test("public-building-chargers:max", { perYear: 10, points: "12" }, [["audit.sitesAtBuildings", ">"], ["audit.municipalPoints", ">"], ["spentChf.charging", ">"]]),
  test("heat-pump-load-control", { share: 60 }, [["audit.winterPeakKw", "<", 2041], ["spentChf.programs", ">"]]),
  test("heat-pump-load-control:max", { share: 100 }, [["audit.winterPeakKw", "<", 2041], ["spentChf.programs", ">"]]),
  test("smart-charging", { share: 50 }, [["audit.evEveningShare", "<", 2041], ["spentChf.programs", ">"]]),
  test("smart-charging:max", { share: 100 }, [["audit.evEveningShare", "<", 2041], ["spentChf.programs", ">"]]),
  test("bike-infrastructure", { level: 50 }, [["modeShare.bike", ">"], ["modeShare.car", "<"], ["spentChf.infrastructure", ">"], ["spentChf.programs", ">"]]),
  test("bike-infrastructure:max", { level: 100 }, [["modeShare.bike", ">"], ["modeShare.car", "<"], ["spentChf.infrastructure", ">"], ["spentChf.programs", ">"]]),
  test("public-transport", { level: 50 }, [["modeShare.other", ">"], ["modeShare.car", "<"], ["spentChf.programs", ">"]]),
  test("public-transport:max", { level: 100 }, [["modeShare.other", ">"], ["modeShare.car", "<"], ["spentChf.programs", ">"]]),
  test("carbon-removal", { share: 10 }, []),

  // Information
  test("solar-outreach", { level: 50 }, [["solarKwp", ">"], ["spentChf.programs", ">"]]),
  test("solar-outreach:max", { level: 100 }, [["solarKwp", ">"], ["spentChf.programs", ">"]]),
  test("solar-check", {}, [["solarKwp", ">"], ["spentChf.programs", ">"]]),
  test("energy-consulting", { scope: "basic" }, [["spentChf.programs", ">"]]),
  test("energy-consulting:extensive", { scope: "extensive" }, [["spentChf.programs", ">"]]),
  test("climate-awareness", { level: 50 }, [["heatPumpShare", ">"], ["carSlots.evShare", ">"], ["solarKwp", ">"], ["spentChf.programs", ">"]]),
  test("climate-awareness:max", { level: 100 }, [["heatPumpShare", ">"], ["carSlots.evShare", ">"], ["solarKwp", ">"], ["spentChf.programs", ">"]]),
  test("agri-pv-dialogue", {}, [["audit.agriAcceptance", ">"], ["spentChf.programs", ">"]]),
  test("advisor-roof-solar", {}, [["audit.advisorReports", ">"], ["spentChf.programs", ">"]]),
  test("advisor-mobility", {}, [["audit.advisorReports", ">"], ["spentChf.programs", ">"]]),
  test("advisor-district-heat", {}, [["audit.advisorReports", ">"], ["spentChf.programs", ">"]]),
  test("advisor-finance", {}, [["audit.advisorReports", ">"], ["spentChf.programs", ">"]]),

  // Laws
  test("solar-mandate", { share: 60, minFootprint: 0 }, [["audit.newBuildKwp", ">", 2041], ["solarKwp", ">", 2041]]),
  test("solar-mandate:large-only", { share: 60, minFootprint: 1000 }, [["audit.newBuildKwp", ">", 2041]]),
  test("solar-mandate:max", { share: 100, minFootprint: 0 }, [["audit.newBuildKwp", ">", 2041], ["solarKwp", ">", 2041]]),
  test("insulation-standard", { level: 50 }, [["audit.newBuildUValue", "<", 2041]]),
  test("insulation-standard:max", { level: 100 }, [["audit.newBuildUValue", "<", 2041]]),
  test("car-park-solar-duty", { minSpaces: "50", years: 5 }, [["audit.canopyKw", ">"]]),
  test("car-park-solar-duty:max", { minSpaces: "20", years: 2 }, [["audit.canopyKw", ">"]]),
  test("retrofit-minimum", {}, [["audit.minergieEnvelopes", ">", 2036]]),
  test("fossil-heating-ban", {}, [["audit.fossilBuildings", "<"]]),
  { name: "fossil-heating-ban:hard", against: "base:hard", difficulty: "hard", enact: [{ id: "fossil-heating-ban" }], expect: [["audit.fossilBuildings", "<", 2031]] },
  test("ice-car-ban", {}, [["carSlots.evShare", ">"]]),
  test("parking-management", { strictness: 50 }, [["modeShare.car", "<"], ["modeShare.bike", ">"], ["modeShare.other", ">"]]),
  test("parking-management:max", { strictness: 100 }, [["modeShare.car", "<"], ["modeShare.bike", ">"], ["modeShare.other", ">"]]),
  test("feed-in-limit", { limit: "70" }, [["audit.summerExportKw", "<", 2041]]),
  test("feed-in-limit:max", { limit: "50" }, [["audit.summerExportKw", "<", 2041]]),
  test("right-to-charge", { coverage: 50 }, [["audit.mayInstallOrHave", ">"], ["carSlots.evShare", ">"]]),
  test("right-to-charge:max", { coverage: 80 }, [["audit.mayInstallOrHave", ">"], ["carSlots.evShare", ">"]]),
  test("green-power", { share: 50 }, [["emissionsBreakdownKt.electricity", "<"], ["emissionsKt", "<"]]),
  test("green-power:max", { share: 100 }, [["emissionsBreakdownKt.electricity", "<"], ["emissionsKt", "<"]]),
];

const ADVISORS: AdvisorId[] = ["roofSolar", "mobility", "districtHeat", "finance"];

/** What the row doesn't say, read out of the game as it stands at `t`. */
function auditFigures(t: number, realPlants: PowerPlant[]): Record<string, number> {
  const all = stock.getAll();
  const standing = all.filter((b) => existsAt(b, t));
  const plants = effectivePowerPlantsAt(all, realPlants, t);
  const kwpOf = new Map<string, number>();
  for (const p of plants) if (p.egid && p.technology === "Photovoltaic" && (p.activeToMs === undefined || p.activeToMs > t)) kwpOf.set(p.egid, (kwpOf.get(p.egid) ?? 0) + (p.capacityKw ?? 0));

  const classes: Record<string, number> = {};
  const newClasses: Record<string, number> = {};
  let newBuilds = 0;
  let newBuildKwp = 0;
  let newUValueSum = 0;
  let fossil = 0;
  for (const b of standing) {
    const c = energyClassAt(b, t);
    classes[c] = (classes[c] ?? 0) + 1;
    if (b.builtAtMs !== undefined && b.builtAtMs > 0) {
      newBuilds++;
      newClasses[c] = (newClasses[c] ?? 0) + 1;
      newBuildKwp += kwpOf.get(b.egid) ?? 0;
      newUValueSum += b.uValueWPerM2K ?? 0;
    }
    const h = currentHeatingSystemId(b, t);
    if (h === "oilBoiler" || h === "gasBoiler") fossil++;
  }
  const good = (m: Record<string, number>) => (m.standard ?? 0) + (m.minergie ?? 0) + (m.minergieP ?? 0);

  let households = 0;
  let atHome = 0;
  let mayInstall = 0;
  for (const a of publicCharging.householdAccess(standing, t).values()) {
    households += a.households;
    atHome += a.atHome;
    mayInstall += a.mayInstall;
  }

  // When electric vehicles charge, over the week before: the evening's share of evening and night; and
  // staff cars, the share of a working day's charging around midday.
  const today = Math.floor(toDateMs(t) / DAY_MS) * DAY_MS - toDateMs(0);
  const hours = (from: number, to: number) => Array.from({ length: 7 }, (_, d) => Array.from({ length: to - from }, (_, h) => today - (d + 1) * DAY_MS + (from + h + 0.5) * HOUR_MS)).flat();
  const ev = (times: number[]) => sampleMunicipalityCategorySeries(all, times, tariffStore.get(), plants).evW.reduce((a, b) => a + b, 0) / times.length;
  const evening = ev(hours(18, 22));
  const night = ev(hours(0, 5));
  const work = (times: number[]) => times.reduce((s, x) => s + totalWorkChargingPowerW(all, x), 0);
  const workAll = work(hours(6, 18));
  const workMidday = work(hours(10, 15));

  const municipal = publicCharging.getSites().filter((s) => s.owner === "municipal" && pointsAt(s, t) > 0);
  const canopies = carParks.getCanopies().filter((c) => c.installedAtMs <= t);
  return {
    winterPeakKw: Math.round(grid.getAreas().reduce((s, a) => s + (a.winter?.peakKw ?? 0), 0)),
    summerExportKw: Math.round(grid.getAreas().reduce((s, a) => s + (a.summer?.exportKw ?? 0), 0)),
    canopyKw: Math.round(carParks.capacityAtKw(t)),
    canopyMunicipalKw: Math.round(carParks.municipalCapacityAtKw(t)),
    canopies: canopies.length,
    municipalSites: municipal.length,
    municipalPoints: municipal.reduce((s, x) => s + pointsAt(x, t), 0),
    sitesAtBuildings: municipal.filter((s) => s.atBuildingEgid).length,
    wallboxShare: households ? atHome / households : 0,
    mayInstallOrHave: households ? (atHome + mayInstall) / households : 0,
    workShare: workChargingShareAt(t),
    workMiddayShare: workAll > 0 ? workMidday / workAll : 0,
    evEveningShare: evening + night > 0 ? evening / (evening + night) : 0,
    newBuilds,
    newBuildKwp: Math.round(newBuildKwp),
    newBuildUValue: newBuilds ? newUValueSum / newBuilds : 0,
    newBuildGoodShare: newBuilds ? ((newClasses.minergie ?? 0) + (newClasses.minergieP ?? 0)) / newBuilds : 0,
    steepKwp: Math.round(steepArraysKwp(t).kwp),
    framedKwp: Math.round(steepArraysKwp(t).framedKwp),
    goodEnvelopes: good(classes),
    badEnvelopes: standing.length - good(classes),
    minergieEnvelopes: (classes.minergie ?? 0) + (classes.minergieP ?? 0),
    fossilBuildings: fossil,
    agriAcceptance: agriPv.getAcceptance(),
    advisorReports: ADVISORS.filter((id) => advisors.getReport(id)).length,
    electricVans: fleets.census(all, t).vansElectric,
  };
}

export type AuditRow = ScenarioRow & { audit: Record<string, number>; spentExGridChf: number };

/** One test's run on `slug`: the rows at REPORT_YEARS. */
export async function runAuditTest(name: string, slug: string, onProgress?: (msg: string) => void): Promise<AuditRow[]> {
  const t = AUDIT_TESTS.find((x) => x.name === name);
  if (!t) throw new Error(`No test ${name}`);
  const dataset = (await (await fetch(dataUrl(`${slug}.json`))).json()) as { powerPlants: PowerPlant[] };
  const rows: AuditRow[] = [];
  await runScenario(
    {
      slug,
      difficulty: t.difficulty ?? "normal",
      enact: t.enact,
      reportYears: REPORT_YEARS,
      reinforceGrid: true,
      withEmissions: true,
      fullTown: true,
      onReport: (row, atMs) => {
        rows.push({ ...row, audit: auditFigures(atMs, dataset.powerPlants), spentExGridChf: row.spentTotalChf - (row.spentChf.grid ?? 0) });
      },
    },
    onProgress,
  );
  return rows;
}
