// Businesses' vans and trucks (sim/fleet.ts). The town-wide count and how many are electric are
// real (the BFS vehicle register, dataset.vehicleRegister); how they spread over the buildings, the
// van/truck split and the costs are informed placeholders.

export type FleetVehicleClass = "van" | "truck";
export type FleetVehicleId = "vanDiesel" | "vanEV" | "truckDiesel" | "truckEV";

export interface FleetVehicleSpec {
  id: FleetVehicleId;
  label: string;
  vehicleClass: FleetVehicleClass;
  electric: boolean;
  purchaseCostRp: number;
  lifetimeMeanYears: number;
  annualKm: number;
  litersPer100Km: number; // diesel; 0 for electric
  kWhPer100Km: number; // 0 for diesel
  greenness: number;
}

// A delivery van (up to 3.5 t) and a local-distribution lorry (~18 t), 2025 list prices.
export const FLEET_CATALOG: Record<FleetVehicleId, FleetVehicleSpec> = {
  vanDiesel: { id: "vanDiesel", label: "Diesel van", vehicleClass: "van", electric: false, purchaseCostRp: 42_000_00, lifetimeMeanYears: 10, annualKm: 18_000, litersPer100Km: 8.5, kWhPer100Km: 0, greenness: -1 },
  vanEV: { id: "vanEV", label: "Electric van", vehicleClass: "van", electric: true, purchaseCostRp: 55_000_00, lifetimeMeanYears: 10, annualKm: 18_000, litersPer100Km: 0, kWhPer100Km: 24, greenness: 1 },
  truckDiesel: { id: "truckDiesel", label: "Diesel lorry", vehicleClass: "truck", electric: false, purchaseCostRp: 170_000_00, lifetimeMeanYears: 10, annualKm: 45_000, litersPer100Km: 28, kWhPer100Km: 0, greenness: -1 },
  truckEV: { id: "truckEV", label: "Electric lorry", vehicleClass: "truck", electric: true, purchaseCostRp: 330_000_00, lifetimeMeanYears: 10, annualKm: 45_000, litersPer100Km: 0, kWhPer100Km: 110, greenness: 1 },
};

export const FLEET_CHOICES: Record<FleetVehicleClass, FleetVehicleId[]> = {
  van: ["vanEV", "vanDiesel"],
  truck: ["truckEV", "truckDiesel"],
};

// The heavy vehicle fee (LSVA/RPLP) for a lorry like the one above: about 2.3 Rp per tonne-km at
// 18 t. Electric lorries are exempt through 2030 under current law; what follows is still being
// decided — the game assumes they pay the full fee from 2031.
export const LSVA_RP_PER_KM = 41;
export const LSVA_EV_EXEMPT_THROUGH_YEAR = 2030;

// Fallbacks for a dataset without the vehicle register: Schlieren, 2024 (BFS px-x-1103020100_111,
// Sachentransportfahrzeuge, Gemeinde 247) — 1,908 goods vehicles, 143 of them electric.
export const FALLBACK_GOODS_VEHICLES = 1908;
export const FALLBACK_GOODS_VEHICLES_ELECTRIC = 143;

// Goods vehicles in Switzerland are about 87% vans, 13% lorries and articulated lorries (BFS vehicle
// stock); electric lorries are still rare — most of the electric goods vehicles are vans.
export const INITIAL_TRUCK_EV_SHARE = 0.01;

// Where the vehicles are: vehicles per 1,000 m² of floor area, relative, by building use — scaled so
// the town's total matches the register. Warehouses, industry and workshops run the most; shops and
// offices far fewer; a building with flats and a business on the ground floor a few.
export const FLEET_DENSITY_BY_CLASS: Record<string, number> = {
  "Industriegebäude": 1.0,
  "Behälter, Silos und Lagergebäude": 1.2,
  "Gebäude des Verkehrs- und Nachrichtenwesens ohne Garagen": 1.0,
  "Landwirtschaftliche Betriebsgebäude": 0.5,
  "Sonstige Hochbauten, anderweitig nicht genannt": 0.4,
  "Gross-und Einzelhandelsgebäude": 0.4,
  "Bürogebäude": 0.15,
  "Krankenhäuser und Facheinrichtungen des Gesundheitswesens": 0.05,
  "Schul- und Hochschulgebäude, Forschungseinrichtungen": 0.03,
  Hotelgebäude: 0.05,
};
export const FLEET_DENSITY_MIXED_USE = 0.06; // residential buildings with a business in them
export const MIXED_USE_CATEGORIES = ["Gebäude mit teilweiser Wohnnutzung", "Andere Wohngebäude (Wohngebäude mit Nebennutzung)"];

// The share of a building's vehicles that are lorries.
export const TRUCK_SHARE_BY_CLASS: Record<string, number> = {
  "Industriegebäude": 0.25,
  "Behälter, Silos und Lagergebäude": 0.3,
  "Gebäude des Verkehrs- und Nachrichtenwesens ohne Garagen": 0.3,
  "Landwirtschaftliche Betriebsgebäude": 0.2,
  "Sonstige Hochbauten, anderweitig nicht genannt": 0.12,
  "Gross-und Einzelhandelsgebäude": 0.1,
};
export const TRUCK_SHARE_OTHER = 0.03;

// The chance a vehicle has its own place to charge (a yard, a depot, a company car park with room
// for a wallbox): high for industry and logistics, lower for shops, offices and small businesses in
// town-centre buildings. Lorries almost always have a depot.
export const DEPOT_SHARE_BY_CLASS: Record<string, number> = {
  "Industriegebäude": 0.9,
  "Behälter, Silos und Lagergebäude": 0.9,
  "Gebäude des Verkehrs- und Nachrichtenwesens ohne Garagen": 0.9,
  "Landwirtschaftliche Betriebsgebäude": 0.9,
  "Sonstige Hochbauten, anderweitig nicht genannt": 0.7,
  "Gross-und Einzelhandelsgebäude": 0.6,
  "Bürogebäude": 0.45,
};
export const DEPOT_SHARE_OTHER = 0.3;
export const DEPOT_SHARE_TRUCK_MIN = 0.85;

// Charging at the depot: overnight, starting after the working day, at this power (kW).
export const DEPOT_POWER_KW: Record<FleetVehicleClass, number> = { van: 11, truck: 44 };

// Businesses weigh the numbers more carefully than households (a narrower indifference band) and
// lean less on sentiment (a bias as a share of the vehicle's yearly cost).
export const FLEET_UNCERTAINTY_FRACTION = 0.1;
export const FLEET_BIAS_FRACTION = 0.08;
export const FLEET_WEIBULL_SHAPE = 2.2;
