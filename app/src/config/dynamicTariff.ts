// The dynamic electricity tariff (sim/dynamicTariff.ts): the next day's market prices, published the
// day before, that households may sign up for instead of the time-of-use tariff — the day-ahead
// price of each hour and the utility's margin, plus the network fee. Informed placeholders.

/** How much the market's demand moves the day-ahead price through the day (00:00-01:00 first):
 * the morning and evening peaks, the night trough. Only the shape matters: it is shifted to average
 * zero and scaled so its extreme is 1; the sun's effect is the spot model's (config/spotMarket.ts). */
export const DAY_AHEAD_DEMAND_SHAPE = [
  -0.8, -0.9, -1.0, -1.0, -0.9, -0.6, 0.0, 0.5, 0.6, 0.4, 0.3, 0.3, 0.3, 0.2, 0.1, 0.2, 0.5, 0.9, 1.0, 0.8, 0.4, 0.0, -0.3, -0.6,
];
/** How far demand lifts or lowers the day-ahead price at its extremes (a share of the wholesale price). */
export const DAY_AHEAD_DEMAND_SHARE = 0.3;

/** When an ordinary household uses its electricity through the day (relative), for judging what
 * the dynamic tariff would cost it. */
export const HOUSEHOLD_LOAD_SHAPE = [
  0.5, 0.4, 0.35, 0.35, 0.35, 0.4, 0.6, 0.9, 0.9, 0.8, 0.8, 0.9, 1.0, 0.9, 0.8, 0.8, 0.9, 1.1, 1.3, 1.4, 1.3, 1.1, 0.9, 0.7,
];

/** The margin on the day-ahead price the price page suggests, and the most it allows (Rp/kWh). */
export const SUGGESTED_MARGIN_RP_KWH = 5;
export const MAX_MARGIN_RP_KWH = 20;

// How households on the dynamic tariff respond. Electric cars charge automatically in the
// cheapest hours before they're needed (spread a little, below). A heat pump runs this much harder when power is at its
// cheapest and this much softer at its dearest (the house stores the heat). A share of washing
// machines and dryers is started by timer in the cheapest hour within this many hours.
export const HEAT_PUMP_SHIFT = 0.3;
/** Cars don't all aim at the same minute: each centres its charging somewhere in a window this
 * wide around the night's cheapest moment. */
export const SMART_CHARGE_SPREAD_HOURS = 3;
export const SMART_LAUNDRY_SHARE = 0.4;
export const LAUNDRY_MAX_DELAY_HOURS = 10;

// What a household weighs when deciding to sign up (kWh a year): its everyday use, a car's charging,
// its laundry. A heat pump is on its own meter, judged by the building's owner.
export const DWELLING_BASE_KWH = 3000;
export const EV_KWH = 4000;
export const LAUNDRY_KWH = 575;

/** The bother of switching tariff and watching prices, a yearly sum in CHF that varies a lot from
 * one household (or owner) to the next: half are put off by less than this. */
export const SIGN_UP_HASSLE_MEDIAN_CHF = { dwelling: 120, heatPump: 80 };
export const SIGN_UP_HASSLE_SPREAD = 0.9;
