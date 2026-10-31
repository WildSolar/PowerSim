/**
 * What the measures page says around the measures: for each goal, how the decisions behind it are
 * made, and what else moves it outside the page. Which measures belong to a goal is their `topic`
 * (sim/measureCatalog.ts).
 */

import type { ColorMode } from "../map/colorModes";
import { BASELINE_YEAR } from "../sim/calendar";
import { cachedEmissionsForYear, type EmissionsBreakdown } from "../sim/emissions";
import type { MeasureTopic } from "../sim/measureTypes";
import { type EmissionShares, startEmissionShares } from "../sim/startEmissions";

export type GoalLink = { label: string; tool: ColorMode } | { label: string; prices: true };

export interface MeasureGoal {
  topic: MeasureTopic;
  /** Who decides, and when: what a measure here has to reach. */
  who: string;
  /** In place of a share of emissions, for a goal that has none of its own. */
  noShare?: string;
  links: GoalLink[];
}

export const MEASURE_GOALS: MeasureGoal[] = [
  {
    topic: "heating",
    who: "Owners decide when a boiler wears out, or earlier if switching clearly pays. Insulation is a separate decision, made when they renovate.",
    links: [
      { label: "District heating", tool: "districtHeat" },
      { label: "Heat and electricity prices", prices: true },
    ],
  },
  {
    topic: "cars",
    who: "Households rethink their car when it is due for replacing. Many flat-dwellers have nowhere to charge, and some could do without a car.",
    links: [
      { label: "EV charging", tool: "evCharging" },
      { label: "Charging prices", prices: true },
    ],
  },
  {
    topic: "fleet",
    who: "Businesses replace a vehicle at the end of its life, or earlier if it pays back fast enough and the route suits an electric one.",
    links: [{ label: "EV charging", tool: "evCharging" }],
  },
  {
    topic: "solar",
    who: "Nothing forces an owner to act on solar, and most who find it pays still put it off. Its share can look small, but heat pumps and electric cars all draw on this power, so it grows as they spread.",
    links: [
      { label: "PV Contracting", tool: "roofSolar" },
      { label: "Public buildings", tool: "publicBuildings" },
      { label: "Car parks", tool: "carParks" },
      { label: "Agri-PV", tool: "agriPv" },
      { label: "Wind", tool: "wind" },
      { label: "Feed-in price", prices: true },
    ],
  },
  {
    topic: "grid",
    who: "No emissions of its own. It grows urgent as heat pumps, electric cars and panels spread, and every full transformer station holds them back.",
    noShare: "Holds up the rest",
    links: [
      { label: "Grid", tool: "grid" },
      { label: "Tariffs", prices: true },
    ],
  },
  {
    topic: "town",
    who: "Measures that reach every decision, and contracts for what is left at the very end.",
    noShare: "Every decision",
    links: [],
  },
];

function sharesOf(e: EmissionsBreakdown): EmissionShares {
  if (e.totalKgCO2 <= 0) return {};
  return {
    heating: (e.gasKgCO2 + e.oilKgCO2 + e.districtHeatingKgCO2) / e.totalKgCO2,
    cars: (e.carsKgCO2 + e.evCarsKgCO2) / e.totalKgCO2,
    fleet: (e.vansKgCO2 + e.lorriesKgCO2 + e.evVansKgCO2 + e.evLorriesKgCO2) / e.totalKgCO2,
    solar: (e.electricityKgCO2 - e.evChargingKgCO2) / e.totalKgCO2,
  };
}

/** Each goal's share of the emissions: the last year counted, or until then the town at the start.
 * Never counts a year itself, which would settle households' decisions early. */
export function goalShares(year: number): { shares: EmissionShares | null; countedYear: number | null } {
  const counted = [year - 1, year - 2].find((y) => y >= BASELINE_YEAR && cachedEmissionsForYear(y) !== null);
  if (counted !== undefined) return { shares: sharesOf(cachedEmissionsForYear(counted)!), countedYear: counted };
  return { shares: startEmissionShares(), countedYear: null };
}
