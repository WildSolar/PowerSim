// Public charging for electric cars (sim/publicCharging.ts). Placeholders to balance, not
// researched figures, except where noted.

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

export type ChargingKind = "ac" | "dc";

// How far a household will go to its charger: an on-street charger has to be within walking
// distance (it charges overnight); a fast-charging hub is a weekly errand.
export const REACH_M: Record<ChargingKind, number> = { ac: 300, dc: 1500 };
// How many cars relying on public charging one charge point can serve.
export const CARS_PER_POINT: Record<ChargingKind, number> = { ac: 3, dc: 20 };
// The nuisance of charging in public rather than at home, CHF a year: a base for having to go at
// all, more the further away the charger is, and more as it fills up (queues, blocked points).
// Tuned so an empty on-street charger next door makes an electric car about as good a deal as a
// petrol one (charging at home is clearly better): where a charger is, and what it costs, tips it.
export const HASSLE_BASE_CHF: Record<ChargingKind, number> = { ac: 100, dc: 500 };
export const HASSLE_AT_REACH_CHF: Record<ChargingKind, number> = { ac: 250, dc: 300 };
export const HASSLE_WHEN_FULL_CHF = 400;

// What private operators charge (the municipality's own prices are in the tariff), Rp/kWh.
export const PRIVATE_PRICE_RP_PER_KWH: Record<ChargingKind, number> = { ac: 45, dc: 65 };

// How a publicly charged car uses its charger: on some days only, with a bigger top-up each time.
export const SESSION_DAY_SHARE: Record<ChargingKind, number> = { ac: 0.4, dc: 0.2 };
export const SESSION_POWER_KW: Record<ChargingKind, number> = { ac: 11, dc: 100 }; // dc: what a car actually draws on average

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
};

// --- Private operators ---

// Each New Year, private operators look at last year's unmet demand (households that would have
// bought an electric car but had no charger with room in reach): a full site with demand around
// it gets more points, and where enough demand gathers with no charger nearby, a new on-street
// site opens — after OPERATOR_BUILD_MONTHS.
export const OPERATOR_NEW_SITE_MIN_DEMAND = 4;
export const OPERATOR_MAX_NEW_SITES_PER_YEAR = 3;
export const OPERATOR_NEW_SITE_POINTS = 4;
export const OPERATOR_EXPAND_POINTS = 2;
export const OPERATOR_MAX_POINTS = 12;
export const OPERATOR_EXPAND_AT_USE = 0.8;
export const OPERATOR_BUILD_MONTHS = 6;
