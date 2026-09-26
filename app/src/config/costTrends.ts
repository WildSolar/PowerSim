// How technology prices move over the game (sim/costTrends.ts). Every price in the catalogs is
// today's (the start of the game, 2026); from then on each technology's price approaches its own
// long-run level smoothly:
//
//   price(t) = price today × (level + (1 − level) × e^(−t / years)), t = years since the start
//
// so it moves fastest at first and settles at `level` × today's price — below 1 for technologies
// still getting cheaper, above 1 for ones getting dearer. Informed placeholders, not forecasts:
// battery-heavy vehicles fall the most (battery packs keep getting cheaper and are most of the
// price gap), heat pumps and solar less (installation labour is a large, steady share in
// Switzerland), fossil equipment and vehicles creep up (shrinking markets, tighter emission rules),
// and building work creeps up with construction costs.

export type CostTrendId =
  | "carEV"
  | "carICE"
  | "bikeElectric"
  | "bikeStandard"
  | "vanEV"
  | "vanDiesel"
  | "truckEV"
  | "truckDiesel"
  | "airHeatPump"
  | "groundHeatPump"
  | "districtHeating"
  | "gasBoiler"
  | "oilBoiler"
  | "solar"
  | "insulation"
  | "districtHeatPipes"
  | "chargerAc"
  | "chargerDc"
  | "chargerFleet"
  | "depotCharger";

export interface CostTrend {
  label: string;
  level: number; // the long-run price, as a share of today's
  years: number; // how quickly it gets there (the e-folding time)
}

export const COST_TRENDS: Record<CostTrendId, CostTrend> = {
  carEV: { label: "Electric car", level: 0.75, years: 8 },
  carICE: { label: "Petrol/diesel car", level: 1.1, years: 15 },
  bikeElectric: { label: "E-bike", level: 0.85, years: 10 },
  bikeStandard: { label: "Bicycle", level: 1, years: 10 },
  vanEV: { label: "Electric van", level: 0.72, years: 8 },
  vanDiesel: { label: "Diesel van", level: 1.1, years: 15 },
  truckEV: { label: "Electric lorry", level: 0.5, years: 7 },
  truckDiesel: { label: "Diesel lorry", level: 1.1, years: 15 },
  airHeatPump: { label: "Air heat pump", level: 0.8, years: 12 },
  groundHeatPump: { label: "Ground heat pump", level: 0.88, years: 12 },
  districtHeating: { label: "District heat connection", level: 1, years: 15 },
  gasBoiler: { label: "Gas boiler", level: 1.15, years: 15 },
  oilBoiler: { label: "Oil boiler", level: 1.2, years: 15 },
  solar: { label: "Rooftop solar", level: 0.7, years: 10 },
  insulation: { label: "Insulation work", level: 1.1, years: 20 },
  districtHeatPipes: { label: "District heating pipes", level: 1.1, years: 20 },
  chargerAc: { label: "On-street chargers", level: 0.7, years: 8 },
  chargerDc: { label: "Fast-charging hub", level: 0.6, years: 8 },
  chargerFleet: { label: "Lorry charging park", level: 0.55, years: 8 },
  depotCharger: { label: "Depot charger", level: 0.6, years: 8 },
};
