// The town's solar hours (sim/townSurplus.ts): when its own solar and wind are forecast to make more
// than it uses.

// The town's typical use, for the forecast: a home a year (kWh, appliances, hot water and some
// heating), and a business per m² of floor (kWh a year). Rough, as a utility's own forecast would be.
export const SURPLUS_HOME_KWH = 3500;
export const SURPLUS_BUSINESS_KWH_PER_M2 = 60;
// ...more in winter (this much above the year's average in mid-January), and by the hour (relative).
export const SURPLUS_USE_SEASON = 0.2;
export const SURPLUS_USE_HOUR_SHAPE = [
  0.6, 0.55, 0.5, 0.5, 0.5, 0.55, 0.7, 0.9, 1.0, 1.0, 1.0, 1.05, 1.05, 1.0, 1.0, 1.0, 1.05, 1.15, 1.3, 1.35, 1.25, 1.1, 0.9, 0.75,
];
// What 1 kW of panels makes of 1,000 W/m² of sunshine, on average over the town's roofs and their
// orientations (kW).
export const SURPLUS_PV_PERFORMANCE = 0.8;

// When cars on a utility-controlled charging meter are at home in the solar hours: every weekend
// day, and on a weekday this share of them (home office, part-time, retired).
export const HOME_WEEKDAY_SHARE = 0.25;
