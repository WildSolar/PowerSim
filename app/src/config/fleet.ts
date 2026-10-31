// Businesses' vans and trucks (sim/fleet.ts). The town-wide count and how many are electric are
// real (the BFS vehicle register, dataset.vehicleRegister); how they spread over the buildings, the
// van/truck split and the costs are informed placeholders.

import type { CurvePoint } from "./curve";

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
// 18 t. Electric lorries are exempt through 2030; from 2031 they pay it too, at a discount that
// steps down. The revised law (passed in October 2026) sets at least 70% for 2031; the later steps
// here are the ones reported while the Federal Council's ordinance is pending. None from 2036.
export const LSVA_RP_PER_KM = 41;
export const LSVA_EV_EXEMPT_THROUGH_YEAR = 2030;
export const LSVA_EV_DISCOUNT_BY_YEAR: Record<number, number> = { 2031: 0.7, 2032: 0.5, 2033: 0.3, 2034: 0.2, 2035: 0.1 };

// The share of lorry routes an electric lorry can take on with a charge overnight; a lorry whose route
// isn't among them yet stays diesel whatever the price, and each lorry's route is seeded. No study gives
// this share directly, so it is an estimate from the federal Swiss e-Cargo study (Infras, PSI et al.,
// 2025): Swiss goods vehicles average 110 km a day, most do under 200 km, overnight charging works up
// to about 300 km, and for the great majority range isn't what limits electrification; only a small
// but relevant part does over 400 km a day. What holds lorries back is cost (FLEET_PAYBACK_YEARS).
export const TRUCK_EV_ROUTE_SHARE: CurvePoint[] = [
  { x: 2026, y: 0.7 },
  { x: 2030, y: 0.85 },
  { x: 2035, y: 0.95 },
  { x: 2045, y: 0.98 },
];

// The town's own vans and lorries (its works yard, its utility) and the lorries of the firms it
// contracts for waste collection and the like. No register says how many, so this estimates them from
// the number of residents; they are counted among the town's goods vehicles, not added to them, and
// picked among those with a yard. A working vehicle the town replaces early costs this share of a new
// diesel's price on top, for what it is written off at. Informed placeholders.
export const TOWN_OWN_VEHICLES_PER_RESIDENT = 1 / 500;
export const TOWN_CONTRACT_LORRIES_PER_RESIDENT = 1 / 2000;
export const TOWN_EARLY_WRITE_OFF_SHARE = 0.4;

// Fallbacks for a dataset without the vehicle register (BFS withdrew the per-municipality table,
// px-x-1103020100_111, from its API in 2026): the Swiss average, about 0.05 goods vehicles per
// resident (some 430,000 in 2024), 4% of them electric. A town with much industry has more.
export const FALLBACK_GOODS_VEHICLES_PER_RESIDENT = 0.05;
export const FALLBACK_GOODS_ELECTRIC_SHARE = 0.04;

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

// Going electric at the depot needs a charger there first — a wallbox for a van; for a lorry a
// high-power charger and, usually, a stronger grid connection — CHF, spread over the vehicle's life.
// What makes a lorry charging park worth it for businesses.
export const DEPOT_CHARGER_COST_RP: Record<FleetVehicleClass, number> = { van: 3_000_00, truck: 80_000_00 };

// Charging at the depot: overnight, starting after the working day, at this power (kW).
export const DEPOT_POWER_KW: Record<FleetVehicleClass, number> = { van: 11, truck: 44 };

// A business won't put up the extra money for an electric vehicle and its charger if the savings take
// too long to pay it back: each draws its own limit from this range of years. The long end is about
// how long a business keeps a lorry. It stands in for what makes firms hold back even where electric
// is cheaper over the years, which the federal Ecoplan study (CIS4BET, 2025) also has to allow for:
// the money, the chargers still to build, changing how the work runs. Set so that a town with nothing
// enacted roughly follows the studies' fleets (see TRUCK_EV_ROUTE_SHARE). A working diesel replaced
// early sells for this share of a new one's price.
export const FLEET_PAYBACK_YEARS: [number, number] = [3, 8];
export const FLEET_EARLY_RESALE_SHARE = 0.4;

// Businesses weigh the numbers more carefully than households (a narrower indifference band) and
// lean less on sentiment (a bias as a share of the vehicle's yearly cost).
export const FLEET_UNCERTAINTY_FRACTION = 0.1;
export const FLEET_BIAS_FRACTION = 0.08;
export const FLEET_WEIBULL_SHAPE = 2.2;
