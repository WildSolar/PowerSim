// Public charging for electric cars (sim/publicCharging.ts). Placeholders to balance, not
// researched figures, except where noted.

import type { CurvePoint } from "./curve";
import type { BuildingGroup } from "./stock";

// --- Charging at home ---

// The chance a household can charge at home (own parking space, a wallbox allowed), by building.
// Most owners of a house can; many flat-dwellers, renters especially, can't.
export const HOME_CHARGING_SHARE: Partial<Record<BuildingGroup, number>> = {
  houseSingle: 0.85,
  apartments: 0.35,
};
export const HOME_CHARGING_SHARE_OTHER = 0.35; // flats in mixed-use and other buildings

// --- Public sites ---

// "ac": on-street chargers; "dc": fast-charging hubs; "fleet": lorry charging parks — high-power
// bays for businesses' lorries and vans only, built by the municipality.
export type ChargingKind = "ac" | "dc" | "fleet";

// Who charges in public: households' cars, and businesses' vans and trucks (sim/fleet.ts).
export type ChargingVehicle = "car" | "van" | "truck";

// --- How good charging is ---

// Each source of charging gives a household (or business) without a charger of its own a quality
// of service: the share of its charging it can do there without trouble, 0-1. A public charger's is
// best close by and falls with the distance along the streets — on foot to an on-street charger
// (the car stays there overnight, you walk home), by car to the others: steady up to `plateauM`,
// then fading to nothing over `fadeM`. `ceiling` is the best that kind can do: an on-street charger
// next door almost as good as charging at home; a fast-charging hub a weekly stop that does the job
// less comfortably, over a wider area; a shop's car park only tops up while you shop. Placeholders
// to balance.
export interface QosCurve {
  ceiling: number;
  plateauM: number;
  fadeM: number;
}
/** The kinds of public site, plus "shop": on-street (AC) points in a shop's car park. */
export type QosKind = ChargingKind | "shop";
export const QOS_CURVE: Record<QosKind, QosCurve> = {
  ac: { ceiling: 0.9, plateauM: 200, fadeM: 300 },
  dc: { ceiling: 0.5, plateauM: 1000, fadeM: 3000 },
  shop: { ceiling: 0.3, plateauM: 500, fadeM: 2500 },
  fleet: { ceiling: 0.9, plateauM: 3000, fadeM: 6000 }, // a lorry park serves the whole town
};
// Register sites that are a shop's or a store's car park, by their name (AC sites only: a fast
// charger at a supermarket is a fast-charging hub like any other).
export const SHOP_SITE_NAME =
  /\b(migros|coop|lidl|aldi|denner|volg|landi|spar|manor|ikea|jumbo|obi|hornbach|bauhaus|interio|pfister|conforama|fust|mediamarkt|media markt)\b|shopping|einkauf|kundenpark|m(ö|oe|o)bel/i;

// A busy charger is less use: someone else's car on the spot, a hunt for a free one. A site's
// quality holds while it is up to `from` full, falls to `atFull` of itself once its room (below) is
// taken, and on to nothing at MAX_FILL — beyond which it takes nobody new. A fast-charging hub
// hardly suffers (a queue there is minutes, not a night without a charge).
export const BUSY_QOS: Record<ChargingKind, { from: number; atFull: number }> = {
  ac: { from: 0.6, atFull: 0.4 },
  dc: { from: 0.8, atFull: 0.8 },
  fleet: { from: 0.8, atFull: 0.7 },
};
export const MAX_FILL = 1.25;

// Sources of different kinds add up, each covering part of what the others leave:
// 1 - (1-q1)(1-q2)...; two of the same kind do the same job, so only the better counts. Below
// QOS_FLOOR an electric vehicle is no option at all. A vehicle's charging is shared out among its
// sources by what each contributes; one contributing less than QOS_MIN_SHARE of it isn't counted
// on, and at most QOS_MAX_SOURCES are.
export const QOS_FLOOR = 0.1;
export const QOS_MIN_SHARE = 0.1;
export const QOS_MAX_SOURCES = 3;

// The nuisance of relying on public charging, CHF a year: `base` for having to at all, plus `span`
// times what the quality falls short of perfect — so an empty on-street charger next door makes an
// electric car about as good a deal as a petrol one (charging at home is clearly better), and
// where the chargers are, how busy, and what they cost tips it. A van and a lorry lose working
// time to it.
export const HASSLE_CHF: Record<ChargingVehicle, { base: number; span: number }> = {
  car: { base: 50, span: 800 },
  van: { base: 100, span: 1200 },
  truck: { base: 400, span: 2000 },
};

// Where operators and letters look for demand gathering around a spot (straight line, m).
export const DEMAND_RADIUS_M: Record<QosKind, number> = { ac: 300, shop: 1500, dc: 1500, fleet: 3000 };

// --- Charging at work ---

// Some people can charge where they work: the employer has chargers in its car park. The share of
// drivers who can grows as employers equip their car parks (this project's guess), and a
// municipal programme raises it. Charging at work covers a good part of the week; it counts as one
// more source of charging, at a price employers usually keep low. Most of it is drawn outside the
// town, where people work.
export const WORK_CHARGING_SHARE: CurvePoint[] = [
  { x: 2025, y: 0.12 },
  { x: 2035, y: 0.25 },
  { x: 2045, y: 0.35 },
];
export const WORK_CHARGING_QOS = 0.45;
export const WORK_CHARGING_PRICE_RP_PER_KWH = 25;

// How many cars relying on public charging one charge point can serve. A van or truck takes up
// room by the energy it needs a day, in cars' worth (a van about two cars, a truck about twenty).
export const CARS_PER_POINT: Record<ChargingKind, number> = { ac: 3, dc: 30, fleet: 100 }; // a lorry-park bay: about four lorries

// What private operators charge (the municipality's own prices are in the tariff), Rp/kWh.
export const PRIVATE_PRICE_RP_PER_KWH: Record<ChargingKind, number> = { ac: 45, dc: 55, fleet: 45 }; // fleet: only what a lorry would expect to pay (no private lorry parks)

// How a publicly charged vehicle uses its charger: on some days only, with a bigger top-up each
// time — a truck nearly every day.
export const SESSION_DAY_SHARE: Record<ChargingVehicle, Record<ChargingKind, number>> = {
  car: { ac: 0.4, dc: 0.2, fleet: 0.2 },
  van: { ac: 0.6, dc: 0.4, fleet: 0.4 },
  truck: { ac: 0.9, dc: 0.9, fleet: 0.9 },
};
// What a vehicle actually draws while charging, kW (a fast charger's rated power is rarely reached).
export const SESSION_POWER_KW: Record<ChargingVehicle, Record<ChargingKind, number>> = {
  car: { ac: 11, dc: 100, fleet: 100 },
  van: { ac: 11, dc: 80, fleet: 80 },
  truck: { ac: 22, dc: 150, fleet: 300 },
};

// --- Building sites (the municipality) ---

export interface SiteSpec {
  label: string;
  points: number;
  powerKw: number;
  costChf: number; // the whole site, installation and grid connection included
  upkeepChfPerPointYear: number;
  buildMonths: number;
}

export const BUILD_SPEC: Record<ChargingKind, SiteSpec> = {
  ac: { label: "On-street chargers", points: 4, powerKw: 11, costChf: 60_000, upkeepChfPerPointYear: 800, buildMonths: 4 },
  dc: { label: "Fast-charging hub", points: 4, powerKw: 150, costChf: 600_000, upkeepChfPerPointYear: 8_000, buildMonths: 12 },
  fleet: { label: "Lorry charging park", points: 4, powerKw: 350, costChf: 1_200_000, upkeepChfPerPointYear: 12_000, buildMonths: 12 },
};

// Every kind of municipal site comes in several sizes; a bigger one shares the grid connection
// (for a hub or a lorry park, the transformer) and the civil works, so each point costs less. A
// running municipal site can be enlarged later: the difference in price, plus opening the site up
// again, and some months' work.
export interface SiteSize {
  points: number;
  costChf: number;
  buildMonths: number;
}
export const SITE_SIZES: Partial<Record<ChargingKind, SiteSize[]>> = {
  ac: [
    { points: 4, costChf: 60_000, buildMonths: 4 },
    { points: 8, costChf: 100_000, buildMonths: 5 },
    { points: 12, costChf: 135_000, buildMonths: 6 },
  ],
  dc: [
    { points: 4, costChf: 600_000, buildMonths: 12 },
    { points: 8, costChf: 1_050_000, buildMonths: 14 },
  ],
  fleet: [
    { points: 4, costChf: 1_200_000, buildMonths: 12 },
    { points: 8, costChf: 2_100_000, buildMonths: 15 },
  ],
};
export const UPGRADE_EXTRA_CHF: Partial<Record<ChargingKind, number>> = { ac: 15_000, dc: 80_000, fleet: 150_000 };
export const UPGRADE_MONTHS: Partial<Record<ChargingKind, number>> = { ac: 3, dc: 6, fleet: 6 };

// --- Private operators ---

// Each New Year, private operators look at last year's unmet demand (households that would have
// bought an electric car with an empty on-street charger next door, but didn't): a busy site with demand around
// it gets more points, and where enough demand gathers with no charger nearby, a new on-street
// site opens — after OPERATOR_BUILD_MONTHS.
export const OPERATOR_NEW_SITE_MIN_DEMAND = 4;
export const OPERATOR_MAX_NEW_SITES_PER_YEAR = 3;
export const OPERATOR_NEW_SITE_POINTS = 4;
export const OPERATOR_EXPAND_POINTS = 2;
export const OPERATOR_MAX_POINTS = 12;
export const OPERATOR_EXPAND_AT_USE = 0.8;
export const OPERATOR_BUILD_MONTHS = 6;
// The demand left over may also bring chargers to a shop's car park: a large shop (a retail
// building of at least this footprint, its car park without chargers yet) with enough of that
// demand within DEMAND_RADIUS_M.shop gets a few points, as a service to its customers.
export const OPERATOR_SHOP_MIN_FOOTPRINT_M2 = 800;
export const OPERATOR_NEW_SHOP_MIN_DEMAND = 6;
export const OPERATOR_MAX_NEW_SHOPS_PER_YEAR = 1;
export const OPERATOR_SHOP_POINTS = 4;
export const OPERATOR_SHOP_POWER_KW = 22;
// No new shop chargers this close to a shop's car park that has some: the same shopping area (and
// of two chargers of a kind, only the better counts).
export const SHOP_CAR_PARK_M = 300;
