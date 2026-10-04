// The dynamic electricity tariff (sim/dynamicTariff.ts): a price that changes through the day by a
// fixed rule — dear when the town's grid is expected to be busiest, cheap when it's quiet — that
// households may sign up for instead of the time-of-use tariff. Informed placeholders.

/** How busy the grid is expected to be, hour by hour (00:00-01:00 first), on a winter and a summer
 * day: the evening peak, the night trough, and in summer the midday solar dip. Only the shape
 * matters: each is shifted to average zero and scaled so its extreme is 1. */
export const DYNAMIC_SHAPE_WINTER = [
  -0.8, -0.9, -1.0, -1.0, -0.9, -0.6, 0.0, 0.5, 0.6, 0.4, 0.3, 0.3, 0.3, 0.2, 0.1, 0.2, 0.5, 0.9, 1.0, 0.8, 0.4, 0.0, -0.3, -0.6,
];
export const DYNAMIC_SHAPE_SUMMER = [
  -0.5, -0.6, -0.6, -0.6, -0.5, -0.3, 0.1, 0.4, 0.3, 0.0, -0.4, -0.8, -1.0, -1.0, -0.8, -0.4, 0.1, 0.6, 0.9, 1.0, 0.8, 0.5, 0.1, -0.2,
];

/** When an ordinary household uses its electricity through the day (relative), for judging what
 * the dynamic tariff would cost it. */
export const HOUSEHOLD_LOAD_SHAPE = [
  0.5, 0.4, 0.35, 0.35, 0.35, 0.4, 0.6, 0.9, 0.9, 0.8, 0.8, 0.9, 1.0, 0.9, 0.8, 0.8, 0.9, 1.1, 1.3, 1.4, 1.3, 1.1, 0.9, 0.7,
];

/** The spread the price page suggests, and the most it allows (Rp/kWh either side of the average). */
export const SUGGESTED_SPREAD_RP_KWH = 10;
export const MAX_SPREAD_RP_KWH = 25;

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
