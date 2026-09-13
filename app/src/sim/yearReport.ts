/**
 * Municipality-wide aggregates for the year-end report card (ui/ReportCardModal.tsx)
 * — the two pieces that don't already exist elsewhere: energy delivered broken
 * out by heating *technology* (rather than by device category, which is what
 * history.ts already does), and a tally of how many buildings switched from
 * which heating system to which over the calendar year. Both walk every
 * building directly rather than reusing history.ts's CategorySeries machinery,
 * since neither shape (a technology-keyed breakdown; a same-building-repeated
 * lookup filtered to one year) fits what that module already produces.
 *
 * The technology breakdown is the expensive half (a full year, at municipality
 * scale, needs the same per-timestep per-building resolution history.ts's own
 * heat-pump/water-heating sampling already does) — computed one calendar month
 * at a time with a yield in between, the same reasoning historyLong.ts's own
 * chunking uses, rather than one long synchronous pass. The renewal tally is
 * cheap (it only reads each building's already-cached renewal chain) and runs
 * synchronously.
 */

import type { Building } from "../data/types";
import { toSimTimeMs } from "./calendar";
import { energyKWh } from "./energy";
import { currentHeatingSystemId, heatingRenewalsInRange } from "./heatingRenewal";
import type { HeatingSystemId } from "./heatingSystems";
import { historyTimeSteps } from "./history";
import { spaceHeatingThermalDemandW } from "./spaceHeating";
import { dwellingWaterHeaterProfile, waterHeaterPowerW, waterHeatingKind, type WaterHeaterProfile } from "./waterHeating";
import { dailyMeanTempC, weatherAt } from "./weather";

const SAMPLES_PER_MONTH = 24; // matches historyLong.ts's own per-period density

export interface HeatingTechnologyEnergyKWh {
  airHeatPumpSpaceKWh: number;
  groundHeatPumpSpaceKWh: number;
  gasBoilerSpaceKWh: number;
  oilBoilerSpaceKWh: number;
  districtHeatingSpaceKWh: number;
  heatPumpWaterKWh: number;
  directElectricWaterKWh: number;
}

const ZERO_TECHNOLOGY_ENERGY_KWH: HeatingTechnologyEnergyKWh = {
  airHeatPumpSpaceKWh: 0,
  groundHeatPumpSpaceKWh: 0,
  gasBoilerSpaceKWh: 0,
  oilBoilerSpaceKWh: 0,
  districtHeatingSpaceKWh: 0,
  heatPumpWaterKWh: 0,
  directElectricWaterKWh: 0,
};

interface TechnologySeriesW {
  airHeatPumpSpaceW: number[];
  groundHeatPumpSpaceW: number[];
  gasBoilerSpaceW: number[];
  oilBoilerSpaceW: number[];
  districtHeatingSpaceW: number[];
  heatPumpWaterW: number[];
  directElectricWaterW: number[];
}

/** Space heating bucketed by which of the five systems is actually installed
 * at each sample instant (not the device-category split history.ts uses),
 * plus water heating split by heat-pump vs. direct-electric (waterHeating.ts's
 * own distinction) — everything else about the physics is unchanged from the
 * live simulation. `waterProfilesByEgid` is precomputed once per report (not
 * once per sample) purely to avoid re-deriving every dwelling's seeded profile
 * on every one of a year's several hundred samples. */
function sampleTechnologySeries(buildings: Building[], waterProfilesByEgid: Map<string, WaterHeaterProfile[]>, times: number[]): TechnologySeriesW {
  const out: TechnologySeriesW = {
    airHeatPumpSpaceW: [],
    groundHeatPumpSpaceW: [],
    gasBoilerSpaceW: [],
    oilBoilerSpaceW: [],
    districtHeatingSpaceW: [],
    heatPumpWaterW: [],
    directElectricWaterW: [],
  };
  for (const t of times) {
    const dailyMeanC = dailyMeanTempC(t);
    const outsideTempC = weatherAt(t).tempC;
    let air = 0;
    let ground = 0;
    let gas = 0;
    let oil = 0;
    let district = 0;
    let hpWater = 0;
    let directWater = 0;
    for (const building of buildings) {
      const heatingId = currentHeatingSystemId(building, t);
      if (heatingId) {
        const thermalW = spaceHeatingThermalDemandW(building, dailyMeanC, outsideTempC);
        if (heatingId === "airHeatPump") air += thermalW;
        else if (heatingId === "groundHeatPump") ground += thermalW;
        else if (heatingId === "gasBoiler") gas += thermalW;
        else if (heatingId === "oilBoiler") oil += thermalW;
        else district += thermalW;
      }
      const kind = waterHeatingKind(building, t);
      if (kind) {
        const profiles = waterProfilesByEgid.get(building.egid) ?? [];
        let buildingWaterW = 0;
        for (const profile of profiles) buildingWaterW += waterHeaterPowerW(profile, t);
        if (kind === "heatPump") hpWater += buildingWaterW;
        else directWater += buildingWaterW;
      }
    }
    out.airHeatPumpSpaceW.push(air);
    out.groundHeatPumpSpaceW.push(ground);
    out.gasBoilerSpaceW.push(gas);
    out.oilBoilerSpaceW.push(oil);
    out.districtHeatingSpaceW.push(district);
    out.heatPumpWaterW.push(hpWater);
    out.directElectricWaterW.push(directWater);
  }
  return out;
}

/** Energy delivered per heating technology over the given calendar year,
 * computed one month at a time with a yield back to the event loop between
 * each — municipality-scale, full-year sampling is real work (the same order
 * of cost as historyLong.ts's own municipality-wide tiers), too long to block
 * the main thread in one call. `isCancelled` is checked between months so a
 * dismissed report card (or a fresh one for a later year) doesn't keep a
 * stale computation running. */
export async function computeHeatingTechnologyBreakdown(
  buildings: Building[],
  year: number,
  isCancelled: () => boolean,
): Promise<HeatingTechnologyEnergyKWh> {
  const waterProfilesByEgid = new Map<string, WaterHeaterProfile[]>();
  for (const building of buildings) {
    waterProfilesByEgid.set(
      building.egid,
      building.dwellings.map((d) => dwellingWaterHeaterProfile(building.egid, d)),
    );
  }

  const totals = { ...ZERO_TECHNOLOGY_ENERGY_KWH };
  for (let month = 0; month < 12; month++) {
    if (isCancelled()) return totals;
    const monthStartMs = toSimTimeMs(Date.UTC(year, month, 1));
    const monthEndMs = toSimTimeMs(Date.UTC(year, month + 1, 1));
    const times = historyTimeSteps(monthEndMs, monthEndMs - monthStartMs, SAMPLES_PER_MONTH);
    const series = sampleTechnologySeries(buildings, waterProfilesByEgid, times);
    totals.airHeatPumpSpaceKWh += energyKWh(times, series.airHeatPumpSpaceW);
    totals.groundHeatPumpSpaceKWh += energyKWh(times, series.groundHeatPumpSpaceW);
    totals.gasBoilerSpaceKWh += energyKWh(times, series.gasBoilerSpaceW);
    totals.oilBoilerSpaceKWh += energyKWh(times, series.oilBoilerSpaceW);
    totals.districtHeatingSpaceKWh += energyKWh(times, series.districtHeatingSpaceW);
    totals.heatPumpWaterKWh += energyKWh(times, series.heatPumpWaterW);
    totals.directElectricWaterKWh += energyKWh(times, series.directElectricWaterW);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return totals;
}

/** Type-safe accessor for the space-heating field matching a given technology
 * id — avoids a template-literal-keyed lookup at every call site. */
export function spaceHeatingKWhFor(technology: HeatingTechnologyEnergyKWh, id: HeatingSystemId): number {
  switch (id) {
    case "airHeatPump":
      return technology.airHeatPumpSpaceKWh;
    case "groundHeatPump":
      return technology.groundHeatPumpSpaceKWh;
    case "gasBoiler":
      return technology.gasBoilerSpaceKWh;
    case "oilBoiler":
      return technology.oilBoilerSpaceKWh;
    case "districtHeating":
      return technology.districtHeatingSpaceKWh;
  }
}

export interface RenewalTallyEntry {
  previousSystem: HeatingSystemId;
  system: HeatingSystemId;
  count: number;
}

/** How many buildings switched from which heating system to which, over the
 * given calendar year, most common first. Cheap — every building's renewal
 * chain is already cached by the time the year-end report fires (see
 * yearEndWatcher.ts), so this only ever does cache reads plus, for whichever
 * handful of buildings renew in this specific year, the one-time cost of
 * generating that event (already paid once, not per report). */
export function computeHeatingRenewalTally(buildings: Building[], year: number): RenewalTallyEntry[] {
  const yearStartMs = toSimTimeMs(Date.UTC(year, 0, 1));
  const yearEndMs = toSimTimeMs(Date.UTC(year + 1, 0, 1));
  const counts = new Map<string, RenewalTallyEntry>();
  for (const building of buildings) {
    for (const record of heatingRenewalsInRange(building, yearStartMs, yearEndMs)) {
      const key = `${record.previousSystem}>${record.system}`;
      const existing = counts.get(key);
      if (existing) existing.count++;
      else counts.set(key, { previousSystem: record.previousSystem, system: record.system, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
