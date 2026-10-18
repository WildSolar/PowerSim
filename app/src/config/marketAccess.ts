// Market access (sim/marketAccess.ts): businesses using this much a year at one site may buy their
// energy on the open market, under the federal electricity supply law — and can't come back.
export const MARKET_ACCESS_MIN_KWH = 100_000;
/** What a supplier adds to the forward price of a year's power (Rp/kWh): its costs and margin. */
export const MARKET_SUPPLIER_MARGIN_RP_KWH = 1.5;
/** The share of a business's energy used at the peak rate (it works by day). */
export const MARKET_ACCESS_BUSINESS_PEAK_SHARE = 0.7;
/** How much cheaper the market has to be before a site bothers to leave (Rp/kWh): the median, and
 * how far it varies from site to site (log-normal) — tenders, contracts, someone to look after it,
 * the risk of the market's swings. About two thirds of the eligible use is on the market at today's
 * prices, as in Switzerland. */
export const MARKET_ACCESS_HURDLE_MEDIAN_RP_KWH = 2.5;
export const MARKET_ACCESS_HURDLE_SPREAD = 0.6;
/** The month the sites still in basic supply decide (0 = January): October, once next year's tariff
 * is out. */
export const MARKET_ACCESS_DECISION_MONTH = 9;
