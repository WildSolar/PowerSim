/**
 * Who makes a network's heat, moment by moment, and what that burns, costs and emits. At every
 * sampled instant each network's load — what its buildings draw, plus what the pipes lose — is met
 * by its clean sources in merit order (waste heat, then heat pumps, then wood: what costs least to
 * run first), each up to its capacity; the network's fossil boilers make the rest. yearReport.ts
 * runs it alongside its heating sample, so a month's split is counted once, from the network as it
 * stood each moment.
 *
 * The heat pumps' electricity is part of the town's own (dhHeatPumpPowerW): the utility buys it
 * hour by hour with the rest, and it counts with the town's electricity in the emissions — so it
 * is neither costed nor counted again here.
 */

import {
  DH_BOILER_EFFICIENCY,
  DH_COP_CHANGE_PER_DEGREE,
  DH_SURFACE_WATER_AMPLITUDE_C,
  DH_SURFACE_WATER_MEAN_C,
  DH_SURFACE_WATER_WARMEST_DAY,
  DH_GROUNDWATER_FEE_CHF_PER_KW_YEAR,
  DH_INCINERATOR_HEAT_RP_PER_KWH,
  DH_NETWORK_LOSS_SHARE,
  DH_NETWORK_UPKEEP_CHF_PER_M_YEAR,
  DH_SOURCE_SPECS,
  DH_WOOD_FUEL_RP_PER_KWH,
  DH_WOOD_HEAT_EFFICIENCY,
  DH_WOOD_POWER_EFFICIENCY,
  type DhSourceKind,
} from "../config/districtHeat";
import { dayOfYear, toDateMs } from "./calendar";
import { GREEN_POWER_MAX_EMISSION_REDUCTION } from "../config/policy";
import { districtHeat, type DhNetworkInfo, type DhSource } from "./districtHeat";
import { HEATING_OIL_KG_CO2_PER_LITER, NATURAL_GAS_KG_CO2_PER_KWH } from "./emissionFactors";
import { gridCarbonWinterGPerKWh } from "./gridCarbon";
import { OIL_ENERGY_KWH_PER_LITER } from "./heatingSystems";
import { market } from "./market";
import { policyStore } from "./policy";

/** Heat produced over a stretch of time, by who made it (kWh). */
export interface DhEnergyKWh {
  /** Clean heat by source id. */
  bySource: Record<string, number>;
  /** Heat from the networks' fossil boilers, by fuel. */
  boilerOilKWh: number;
  boilerGasKWh: number;
}

export function zeroDhEnergy(): DhEnergyKWh {
  return { bySource: {}, boilerOilKWh: 0, boilerGasKWh: 0 };
}

export function addDhEnergy(into: DhEnergyKWh, add: DhEnergyKWh): DhEnergyKWh {
  for (const [id, kWh] of Object.entries(add.bySource)) into.bySource[id] = (into.bySource[id] ?? 0) + kWh;
  into.boilerOilKWh += add.boilerOilKWh;
  into.boilerGasKWh += add.boilerGasKWh;
  return into;
}

/** One instant's production (W), filled in by dispatchInstant. */
export interface DhInstantW {
  bySource: Map<string, number>;
  oilW: number;
  gasW: number;
  /** Each network's clean heat and its boilers' (by the network's name, for the charts). */
  byNetwork: Map<string, { cleanW: number; boilerW: number }>;
}

/** Meets each network's delivered load (W) at one instant: its clean sources first, in merit
 * order, then its boilers. `orphanW`: district-heated buildings no network reaches any more
 * (their pipes' sources gone) — boilers alone. */
export function dispatchInstant(loads: Map<DhNetworkInfo, number>, orphanW: number): DhInstantW {
  const out: DhInstantW = { bySource: new Map(), oilW: 0, gasW: 0, byNetwork: new Map() };
  for (const [network, deliveredW] of loads) {
    const madeW = deliveredW * (1 + DH_NETWORK_LOSS_SHARE);
    let remaining = madeW;
    for (const s of network.sources) {
      if (remaining <= 0) break;
      const capacity = Number.isFinite(s.cleanW) ? s.cleanW : 0;
      if (!s.kind || capacity <= 0) continue;
      const w = Math.min(remaining, capacity);
      out.bySource.set(s.id, (out.bySource.get(s.id) ?? 0) + w);
      remaining -= w;
    }
    if (remaining > 0) {
      if (network.fossil === "gas") out.gasW += remaining;
      else out.oilW += remaining;
    }
    const n = out.byNetwork.get(network.name) ?? { cleanW: 0, boilerW: 0 };
    n.cleanW += madeW - Math.max(0, remaining);
    n.boilerW += Math.max(0, remaining);
    out.byNetwork.set(network.name, n);
  }
  out.oilW += orphanW * (1 + DH_NETWORK_LOSS_SHARE);
  return out;
}

function sourceById(): Map<string, DhSource> {
  return new Map(districtHeat.getSources().map((s) => [s.id, s]));
}

/** A heat pump's COP at `simTimeMs` (null for a source that isn't one): a river or lake heat pump's
 * follows the water temperature through the year, the others' stay as they are. */
export function dhCopAt(kind: DhSourceKind, simTimeMs: number): number | null {
  const cop = DH_SOURCE_SPECS[kind].cop;
  if (!cop || kind !== "surfaceWater") return cop;
  const phase = (2 * Math.PI * (dayOfYear(toDateMs(simTimeMs)) - DH_SURFACE_WATER_WARMEST_DAY)) / 365.25;
  const waterC = DH_SURFACE_WATER_MEAN_C + DH_SURFACE_WATER_AMPLITUDE_C * Math.cos(phase);
  return cop * (1 + DH_COP_CHANGE_PER_DEGREE * (waterC - DH_SURFACE_WATER_MEAN_C));
}

/** A heat pump's COP through the heating season, December to February — for estimates made ahead
 * of time (what a source would cost to run). */
export function dhHeatingSeasonCop(kind: DhSourceKind): number | null {
  const cop = DH_SOURCE_SPECS[kind].cop;
  if (!cop || kind !== "surfaceWater") return cop;
  return cop * (1 - DH_COP_CHANGE_PER_DEGREE * 0.8 * DH_SURFACE_WATER_AMPLITUDE_C);
}

/** The heat pumps' electricity at one instant (W), from what each source made then. */
export function dhHeatPumpPowerW(bySource: Map<string, number>, simTimeMs: number): number {
  const sources = sourceById();
  let w = 0;
  for (const [id, heatW] of bySource) {
    const kind = sources.get(id)?.kind;
    const cop = kind ? dhCopAt(kind, simTimeMs) : null;
    if (cop) w += heatW / cop;
  }
  return w;
}

/** What the heat took beyond itself — the wood burned, the power the wood plants made, the heat
 * bought from incinerators, and the boilers' fuel (kWh). The heat pumps' electricity is the town's
 * (dhHeatPumpPowerW). */
export function dhInputs(e: DhEnergyKWh): { woodFuelKWh: number; chpPowerKWh: number; incineratorHeatKWh: number; oilFuelKWh: number; gasFuelKWh: number } {
  const sources = sourceById();
  let woodFuelKWh = 0;
  let incineratorHeatKWh = 0;
  for (const [id, kWh] of Object.entries(e.bySource)) {
    const kind = sources.get(id)?.kind;
    if (kind === "wood") woodFuelKWh += kWh / DH_WOOD_HEAT_EFFICIENCY;
    else if (kind === "incinerator") incineratorHeatKWh += kWh;
  }
  return {
    woodFuelKWh,
    chpPowerKWh: woodFuelKWh * DH_WOOD_POWER_EFFICIENCY,
    incineratorHeatKWh,
    oilFuelKWh: e.boilerOilKWh / DH_BOILER_EFFICIENCY,
    gasFuelKWh: e.boilerGasKWh / DH_BOILER_EFFICIENCY,
  };
}

/** A year's district heating emissions: the boilers' oil and gas, less the power the wood plants feed
 * in at the grid's winter intensity — they make it with their heat, in the heating months (never
 * below nothing). The heat pumps' power counts with the town's
 * electricity. Wood counts as carbon-neutral, as in the national inventory; waste heat carries
 * nothing. */
export function dhEmissionsKgCO2(e: DhEnergyKWh, year: number): number {
  const inputs = dhInputs(e);
  const greenShare = policyStore.get().greenPowerShare / 100;
  const gridKgPerKWh = (gridCarbonWinterGPerKWh(year) * (1 - GREEN_POWER_MAX_EMISSION_REDUCTION * greenShare)) / 1000;
  const fossil = (inputs.oilFuelKWh / OIL_ENERGY_KWH_PER_LITER) * HEATING_OIL_KG_CO2_PER_LITER + inputs.gasFuelKWh * NATURAL_GAS_KG_CO2_PER_KWH;
  return Math.max(0, fossil - inputs.chpPowerKWh * gridKgPerKWh);
}

/** What producing the heat cost (Rp), at the market prices of `atMs`: fuel and heat bought, less
 * the wood plants' power sold. The heat pumps' power the utility buys with the town's. */
export function dhProductionCostRp(e: DhEnergyKWh, atMs: number): number {
  const inputs = dhInputs(e);
  const power = market.price("wholesale", atMs);
  return (
    inputs.incineratorHeatKWh * DH_INCINERATOR_HEAT_RP_PER_KWH +
    inputs.woodFuelKWh * DH_WOOD_FUEL_RP_PER_KWH -
    inputs.chpPowerKWh * power +
    (inputs.oilFuelKWh / OIL_ENERGY_KWH_PER_LITER) * market.price("oil", atMs) +
    inputs.gasFuelKWh * market.price("gas", atMs)
  );
}

/** What district heating costs a year to keep, whatever it produces (Rp): the pipes and trunk lines,
 * every source's upkeep, the factories' contracts and the groundwater concessions. */
export function dhFixedCostRpPerYear(atMs: number): number {
  let total = (districtHeat.pipedLengthM(atMs) + districtHeat.trunkLengthM(atMs)) * DH_NETWORK_UPKEEP_CHF_PER_M_YEAR * 100;
  for (const s of districtHeat.getSources()) {
    if (s.fromMs > atMs || !s.kind) continue;
    const kw = (Number.isFinite(s.cleanW) ? s.cleanW : 0) / 1000;
    total += kw * DH_SOURCE_SPECS[s.kind].upkeepChfPerKwYear * 100 + s.yearlyRp;
  }
  return total;
}

/** The concession for a groundwater plant of `w` (Rp a year). */
export function groundwaterFeeRp(w: number): number {
  return (w / 1000) * DH_GROUNDWATER_FEE_CHF_PER_KW_YEAR * 100;
}
