// Home batteries next to rooftop solar (sim/homeBattery.ts for how they run, sim/solarAdoption.ts
// for who buys one). Informed placeholders.

import type { CurvePoint } from "./curve";

// Sizing, as Swiss installers do it for homes: about 1 kWh of storage per kWp of panels, charging and
// discharging at up to half its capacity per hour.
export const HOME_BATTERY_KWH_PER_KWP = 1;
export const HOME_BATTERY_KW_PER_KWH = 0.5;
export const HOME_BATTERY_ROUND_TRIP = 0.9;

// Installed price today (2026): roughly CHF 9'000 for 10 kWh, falling along the "homeBattery" price
// trajectory (config/costTrends.ts). It lasts about 15 years.
export const HOME_BATTERY_FIXED_CHF = 2_500;
export const HOME_BATTERY_CHF_PER_KWH = 650;
export const HOME_BATTERY_LIFETIME_YEARS = 15;
// Full cycles a year: most days from spring to autumn, few in winter.
export const HOME_BATTERY_CYCLES_PER_YEAR = 220;

// Owners value a battery beyond what it saves — independence from the grid, backup power, using
// "their own" electricity — which the savings alone rarely cover. A per-owner preference, CHF a
// year: centred here, spread either way. Calibrated so about half of new home systems take one at
// today's prices, as in Switzerland.
export const HOME_BATTERY_PREFERENCE_CHF_PER_YEAR = 250;
export const HOME_BATTERY_PREFERENCE_SPREAD_CHF_PER_YEAR = 500;

// Grid-friendly operation: the battery charges from the top of the midday peak, so the system never
// feeds in more than this share of its rating (the rest is stored or, once full, curtailed) — the
// condition the grid operator sets for a large array in a full area, and the one a battery subsidy
// may set. After this hour it tops up from any surplus, for the evening.
export const GRID_FRIENDLY_FEED_IN_CAP = 0.5;
export const GRID_FRIENDLY_PEAK_UNTIL_HOUR = 14;

// Owners of an existing system without a battery who look into adding one each year.
export const BATTERY_RETROFIT_ANNUAL_HAZARD = 0.03;

// Registered systems (the Pronovo register says nothing about storage): the share of small systems
// (up to 30 kWp) that have a battery, by the year they were commissioned.
export const REGISTERED_SYSTEM_BATTERY_SHARE: CurvePoint[] = [
  { x: 2014, y: 0 },
  { x: 2018, y: 0.2 },
  { x: 2023, y: 0.45 },
  { x: 2026, y: 0.5 },
];
// New buildings: the share whose (voluntary) array comes with a battery.
export const NEW_BUILD_BATTERY_SHARE = 0.5;

// How the day plays out, per kWp, for the stateless model in sim/homeBattery.ts: the building's own
// use while the sun is up (what isn't surplus), and how long a full battery lasts from the
// afternoon on.
export const DAYTIME_OWN_USE_KW_PER_KWP = 0.1;
export const HOURS_A_FULL_BATTERY_LASTS = 6;
