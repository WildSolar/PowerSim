/**
 * Who makes a network's heat, moment by moment, and what that burns, costs and emits. At every
 * sampled instant each network's load — what its buildings draw, plus what the pipes lose — is met
 * by its clean sources in merit order (waste heat, then heat pumps, then wood: what costs least to
 * run first), each up to its capacity; the network's fossil boilers make the rest. yearReport.ts
 * runs it alongside its heating sample, so a month's split is counted once, from the network as it
 * stood each moment.
 */

import {
  DH_BOILER_EFFICIENCY,
  DH_GROUNDWATER_FEE_CHF_PER_KW_YEAR,
  DH_INCINERATOR_HEAT_RP_PER_KWH,
  DH_NETWORK_LOSS_SHARE,
  DH_NETWORK_UPKEEP_CHF_PER_M_YEAR,
  DH_SOURCE_SPECS,
  DH_WOOD_FUEL_RP_PER_KWH,
  DH_WOOD_HEAT_EFFICIENCY,
  DH_WOOD_POWER_EFFICIENCY,
} from "../config/districtHeat";
import { GREEN_POWER_MAX_EMISSION_REDUCTION } from "../config/policy";
import { districtHeat, type DhNetworkInfo, type DhSource } from "./districtHeat";
import { HEATING_OIL_KG_CO2_PER_LITER, NATURAL_GAS_KG_CO2_PER_KWH } from "./emissionFactors";
import { gridCarbonIntensityGPerKWh } from "./gridCarbon";
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
}

/** Meets each network's delivered load (W) at one instant: its clean sources first, in merit
 * order, then its boilers. `orphanW`: district-heated buildings no network reaches any more
 * (their pipes' sources gone) — boilers alone. */
export function dispatchInstant(loads: Map<DhNetworkInfo, number>, orphanW: number): DhInstantW {
  const out: DhInstantW = { bySource: new Map(), oilW: 0, gasW: 0 };
  for (const [network, deliveredW] of loads) {
    let remaining = deliveredW * (1 + DH_NETWORK_LOSS_SHARE);
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
  }
  out.oilW += orphanW * (1 + DH_NETWORK_LOSS_SHARE);
  return out;
}

function sourceById(): Map<string, DhSource> {
  return new Map(districtHeat.getSources().map((s) => [s.id, s]));
}

/** What the heat took beyond itself: the heat pumps' electricity, the wood burned, the power the
 * wood plants made, the heat bought from incinerators, and the boilers' fuel (kWh). */
export function dhInputs(e: DhEnergyKWh): { heatPumpPowerKWh: number; woodFuelKWh: number; chpPowerKWh: number; incineratorHeatKWh: number; oilFuelKWh: number; gasFuelKWh: number } {
  const sources = sourceById();
  let heatPumpPowerKWh = 0;
  let woodFuelKWh = 0;
  let incineratorHeatKWh = 0;
  for (const [id, kWh] of Object.entries(e.bySource)) {
    const kind = sources.get(id)?.kind;
    if (!kind) continue;
    const cop = DH_SOURCE_SPECS[kind].cop;
    if (cop) heatPumpPowerKWh += kWh / cop;
    else if (kind === "wood") woodFuelKWh += kWh / DH_WOOD_HEAT_EFFICIENCY;
    else if (kind === "incinerator") incineratorHeatKWh += kWh;
  }
  return {
    heatPumpPowerKWh,
    woodFuelKWh,
    chpPowerKWh: woodFuelKWh * DH_WOOD_POWER_EFFICIENCY,
    incineratorHeatKWh,
    oilFuelKWh: e.boilerOilKWh / DH_BOILER_EFFICIENCY,
    gasFuelKWh: e.boilerGasKWh / DH_BOILER_EFFICIENCY,
  };
}

/** A year's district heating emissions: the boilers' oil and gas, and the heat pumps' power at the
 * grid's intensity, less the power the wood plants feed in (never below nothing). Wood counts as
 * carbon-neutral, as in the national inventory; waste heat carries nothing. */
export function dhEmissionsKgCO2(e: DhEnergyKWh, year: number): number {
  const inputs = dhInputs(e);
  const greenShare = policyStore.get().greenPowerShare / 100;
  const gridKgPerKWh = (gridCarbonIntensityGPerKWh(year) * (1 - GREEN_POWER_MAX_EMISSION_REDUCTION * greenShare)) / 1000;
  const fossil = (inputs.oilFuelKWh / OIL_ENERGY_KWH_PER_LITER) * HEATING_OIL_KG_CO2_PER_LITER + inputs.gasFuelKWh * NATURAL_GAS_KG_CO2_PER_KWH;
  return Math.max(0, fossil + (inputs.heatPumpPowerKWh - inputs.chpPowerKWh) * gridKgPerKWh);
}

/** What producing the heat cost (Rp), at the market prices of `atMs`: fuel, power, heat bought,
 * less the wood plants' power sold. */
export function dhProductionCostRp(e: DhEnergyKWh, atMs: number): number {
  const inputs = dhInputs(e);
  const power = market.price("wholesale", atMs);
  return (
    inputs.incineratorHeatKWh * DH_INCINERATOR_HEAT_RP_PER_KWH +
    inputs.heatPumpPowerKWh * power +
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
