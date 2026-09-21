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

/** Residents are not in the data; dwellings are. The Swiss average household is ~2.2 people. */
export const RESIDENTS_PER_DWELLING = 2.2;
