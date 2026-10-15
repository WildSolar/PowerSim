/**
 * The municipal treasury's tunable numbers (sim/treasury.ts, sim/finances.ts).
 *
 * Both figures are PLACEHOLDERS: how much the wider government hands the energy
 * and infrastructure department each year, and what it starts with, is an open
 * design question (see the project notes). They are sized so that a moderate
 * subsidy programme is affordable but a generous one visibly is not.
 */

/** Cash in the treasury when the game starts. */
export const INITIAL_TREASURY_CHF = 2_000_000;

/** The overall government's annual allocation to the energy department, per resident. */
export const GOVERNMENT_ALLOCATION_CHF_PER_RESIDENT = 150;

/** Before the player took office, the municipal utility handed most of its profit to the town's
 * general account; the energy department kept this share (a loss stayed with it). From the first year
 * in office the town takes a concession fee per kWh sold instead (finances.ts), set so that it takes
 * as much as this rule did in that last year — so what the utility earns beyond it, or saves through
 * what the department builds, is the department's. */
export const UTILITY_PROFIT_RETAINED_SHARE = 0.25;

/** Solar on public buildings: the share of what the panels make that the building uses itself (worth
 * the household tariff to it); the rest is fed in, at the feed-in price. The department is credited
 * both — it paid for the panels. */
export const PUBLIC_SOLAR_SELF_USE_SHARE = 0.4;

/** Residents are not in the data; dwellings are. The Swiss average household is ~2.2 people. */
export const RESIDENTS_PER_DWELLING = 2.2;
