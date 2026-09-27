// Zoning: the municipality's building and zoning plan (Bau- und Zonenordnung), changed parcel by
// parcel (sim/zoning.ts). Placeholders to balance, informed by canton Zürich practice.

import type { SiteZone } from "../data/types";
import type { Bloc } from "./approval";

// A change to the zoning plan: drafted, publicly exhibited, adopted by the municipal parliament
// (optional referendum), approved by the canton — about a year and a half.
export const ZONING_LEAD_MONTHS = 18;
// A change covering this much of the town's zoned land or more is a revision of the plan itself and
// always goes to a public vote; a smaller one only when it's contested.
export const ZONING_VOTE_AREA_SHARE = 0.15;
// Planning work for the change (the planning office, reports, exhibition), paid when it's put forward.
export const ZONING_PLANNING_COST_CHF = 40_000;
export const ZONING_PLANNING_COST_CHF_PER_HA = 5_000;

// The zones a parcel can be rezoned to (public-use zones — schools, hospitals — are left as they are).
export const REZONE_TARGETS: SiteZone[] = ["residential", "mixed", "centre", "work"];
// Densification: floors allowed above what the plan allows today.
export const MAX_EXTRA_FLOORS = 2;

// Redevelopment pressure: an old building in a densified parcel is likelier to be replaced (the
// extra floors make it pay), and so is one whose use no longer fits a rezoned parcel (a factory in
// what is now a residential zone). Multipliers on its renewal rate, bounded by stock.ts's cap.
export const DENSIFY_RENEWAL_BOOST_PER_FLOOR = 0.5;
export const MISFIT_RENEWAL_BOOST = 2;

// Value capture (Mehrwertausgleich): canton Zürich lets a municipality levy up to 40% of the land
// value a zoning change creates. Charged when a project using the gain gets its permit.
export const VALUE_LEVY_RATE = 0.25;
// A rezoning raises the value of the land itself: land value per m² of land, by zone (Limmattal
// ballpark). Levied once per plot, on its area — estimated from the building's footprint and a
// typical site coverage.
export const LAND_VALUE_CHF_PER_M2_LAND: Record<SiteZone, number> = {
  residential: 1250,
  mixed: 1300,
  centre: 1600,
  work: 900,
  public: 0,
};
export const TYPICAL_SITE_COVERAGE = 0.35; // footprint / plot area
// Densification adds floor space that can be sold or let: land value per m² of that extra floor space.
export const LAND_VALUE_CHF_PER_M2_GFA: Record<SiteZone, number> = {
  residential: 700,
  mixed: 750,
  centre: 900,
  work: 350,
  public: 0,
};

// Energy zones from municipal energy planning.
// District-heat priority: no new oil or gas heating at all; a new building on a street with a
// district heating pipe must connect (a renewing one may still choose a heat pump).
// High standard: new and replacement buildings to Minergie-P (U-values 35% below code) and a full
// roof of solar panels.
export const HIGH_STANDARD_U_VALUE_FACTOR = 0.65;

// How each group of voters takes a change, at full scale — a change covering a quarter of the
// town's zoned land or more. A smaller change draws a proportionally smaller reaction, but never
// less than a quarter of it (people notice any rezoning in their neighbourhood).
export const ZONING_STANCE_FULL_AREA_SHARE = 0.25;
export const ZONING_STANCE_MIN_SCALE = 0.25;

type Stances = Partial<Record<Bloc, number>>;

export const REZONE_STANCES: Record<SiteZone, Stances> = {
  residential: { tenants: 0.3, homeowners: 0.05, climate: 0.05 },
  mixed: { tenants: 0.2, business: 0.05, climate: 0.1 },
  centre: { business: 0.2, tenants: 0.1, homeowners: -0.1, climate: 0.1, drivers: -0.05 },
  work: { business: 0.3, tenants: -0.2, homeowners: -0.2 },
  public: {},
};
// Taking land away from businesses (a work zone rezoned to anything else) costs their support.
export const LOST_WORK_ZONE_STANCE: Stances = { business: -0.5 };
// Per extra floor allowed (negative when floors are taken back).
export const DENSIFY_STANCES_PER_FLOOR: Stances = { tenants: 0.2, homeowners: -0.25, business: 0.1, climate: 0.1, drivers: -0.05 };
export const DH_PRIORITY_STANCES: Stances = { climate: 0.3, homeowners: -0.3, business: -0.1 };
export const HIGH_STANDARD_STANCES: Stances = { climate: 0.3, homeowners: -0.1, business: -0.2, tenants: -0.1 };
// Lifting an energy zone again: the opposite reaction, somewhat muted.
export const LIFT_STANCE_FACTOR = -0.7;
