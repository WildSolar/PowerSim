// Solar feed-in (sim/feedIn.ts), as the federal electricity law has it since 2026 (EnV Art. 12): the
// quarter's reference market price, weighted by when solar produces, with a federal minimum for
// smaller plants — the full minimum under 30 kW; from 30 to 150 kW the minimum on the first 30 kW
// only (180 Rp ÷ kW over the whole output — the rule for plants whose owner uses some of the power,
// which the game applies to all of them); over 150 kW none.
export const FEED_IN_MINIMUM_RP_KWH = 6;
export const FEED_IN_FULL_MINIMUM_BELOW_KW = 30;
export const FEED_IN_MINIMUM_UP_TO_KW = 150;
/** How often the quarter is sampled to work out its reference price (hours). */
export const FEED_IN_SAMPLE_HOURS = 3;
/** What utilities elsewhere add on top, typically for the certificate of origin (Rp/kWh) — what
 * homeowners judge your bonus against. */
export const BENCHMARK_FEED_IN_BONUS_RP_KWH = 2;

// What utilities elsewhere pay for solar above its market value, spread over the power they sell —
// the federal minimum and their bonus, which the regulator lets them count in the energy price: the
// Swiss average household's price carries it too (tariffApproval.ts). Solar credited per kWh sold,
// nationally: about a fifth today, growing, and the share of it from plants small enough for the
// minimum. Informed placeholders.
export const BENCHMARK_SOLAR_PER_KWH_SOLD = 0.2;
export const BENCHMARK_SOLAR_PER_KWH_SOLD_GROWTH = 0.015;
export const BENCHMARK_SOLAR_PER_KWH_SOLD_MAX = 0.45;
export const BENCHMARK_SOLAR_UNDER_MINIMUM_SHARE = 0.7;
