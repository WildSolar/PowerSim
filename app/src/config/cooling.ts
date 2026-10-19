import type { CommercialCategory } from "../sim/commercial";

/** Cooling (sim/ac.ts): who has it, how it spreads with hot summers, and what it takes. Loads are
 * heat to remove per m² of cooled floor (W). */
export const COOLING = {
  // Hot days (weather.ts) are counted from this year on: each makes cooling a little more common.
  spreadFromYear: 2026,
  homes: {
    // A few homes in a hundred today — mostly portable units — more in new and large ones.
    baseShare: 0.04,
    recencyBoost: 0.08,
    sizeBoost: 0.03,
    oldYear: 1980,
    newYear: 2024,
    smallAreaM2: 200,
    largeAreaM2: 3000,
    // Each hot day adds this to the share; about a third of homes cool by 2050.
    perHotDay: 0.001,
    maxShare: 0.6,
    // A unit or two cools the bedroom and the living room, not the whole flat.
    cooledShare: 0.4,
    fallbackDwellingAreaM2: 80,
    // Only on a warm day (its mean at least this), once it is warm outside: a flat that has soaked
    // up a few hot days stays warm, so the people and the sun inside count for much.
    dayMeanOnC: 18,
    onC: 22,
    setpointC: 24,
    internalWPerM2: 6,
    sunWPerM2: 20,
    wPerM2K: 2.5,
    maxWPerM2: 40,
  },
  business: {
    baseShare: {
      office: 0.55,
      retail: 0.6,
      hospital: 0.7,
      other: 0.45, // hotels, museums, venues
      school: 0.08,
      sports: 0.1,
      industrial: 0.15,
      church: 0,
      datacenter: 0, // its own cooling, in its load (commercial.ts)
    } satisfies Record<CommercialCategory, number>,
    perHotDay: 0.0008,
    maxShare: 0.95,
    cooledShare: 0.7,
    // People, computers and lights warm an occupied office from about 18 °C outside.
    onC: 18,
    setpointC: 22,
    internalWPerM2: 14,
    sunWPerM2: 22,
    wPerM2K: 2.5,
    maxWPerM2: 60,
    // Outside opening hours, a little (server rooms, set-back).
    idleShare: 0.1,
  },
  // Heat removed per unit of power for a split unit: about 4 at 20 °C outside, falling as it heats up.
  efficiency: { at20C: 4, dropPerC: 0.1, min: 2.5, max: 4.5 },
  // Cooling through a ground-source heat pump's probes: just the circulation pump, but gentle.
  ground: { efficiency: 15, maxWPerM2: 25, homesShare: 0.6 },
};
