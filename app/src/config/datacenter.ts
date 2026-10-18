// A data centre (sim/datacenter.ts): now and then one comes to a town with open work-zone land — a
// regional colocation site. Informed placeholders.

/** The chance, each year from the second game year on, that one is announced (at most one a game). */
export const DATACENTER_CHANCE_PER_YEAR = 0.02;
/** Its IT load at full use (kW), drawn between these. */
export const DATACENTER_IT_KW: [number, number] = [3_000, 10_000];
/** Cooling and the rest on top of the IT load (power usage effectiveness): best in winter, when the
 * outside air cools for free, worst in high summer. */
export const DATACENTER_PUE_WINTER = 1.22;
export const DATACENTER_PUE_SUMMER = 1.4;
/** It fills up over a few years: this share of its IT load when it opens, all of it this many years on. */
export const DATACENTER_OPENING_SHARE = 0.4;
export const DATACENTER_RAMP_YEARS = 3;
/** The hall: footprint per kW of IT load (m², two floors), on a site with room for this much more
 * around it (access, cooling plant, the substation). */
export const DATACENTER_M2_PER_IT_KW = 0.6;
export const DATACENTER_MIN_FOOTPRINT_M2 = 2_000;
export const DATACENTER_SITE_PER_FOOTPRINT = 2;
export const DATACENTER_FLOORS = 2;
/** From the announcement to the opening. */
export const DATACENTER_BUILD_MONTHS = 24;
/** Its waste heat, offered to the utility this long after it opens: what a heat pump can make of it
 * for the district heating network (MW of heat per MW of IT load — the warm water it gives off, and
 * the heat pump's own power on top). */
export const DATACENTER_OFFER_MONTHS = 12;
export const DATACENTER_HEAT_PER_IT_KW = 0.9;
