// Solar feed-in (sim/feedIn.ts), as the federal electricity law has it since 2026: the quarter's
// reference market price, weighted by when solar produces, with a federal minimum for small plants.
// The minimum is an informed placeholder for the ordinance's rates (they differ by plant size and
// whether the owner uses some of the power); the game applies one figure to every plant.
export const FEED_IN_MINIMUM_RP_KWH = 6;
/** How often the quarter is sampled to work out its reference price (hours). */
export const FEED_IN_SAMPLE_HOURS = 3;
/** What utilities elsewhere add on top, typically for the certificate of origin (Rp/kWh) — what
 * homeowners judge your bonus against. */
export const BENCHMARK_FEED_IN_BONUS_RP_KWH = 2;
