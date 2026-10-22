// The charging tariff (sim/chargingTariff.ts): a wallbox on its own meter.

// A household's bother of signing up, a year (CHF): the second meter to have put in, and the paperwork
// — a median, spread lognormally between households; giving the utility control of when the car
// charges costs some of them more.
export const CHARGING_SIGN_UP_HASSLE_MEDIAN_CHF = 60;
export const CHARGING_CONTROL_HASSLE_MEDIAN_CHF = 30;
export const CHARGING_SIGN_UP_HASSLE_SPREAD = 0.9;
// A household that charges as soon as it gets home also gives up that habit — the reason it hasn't
// been waiting for the night rate all along (a median, on top).
export const CHARGING_ARRIVAL_HABIT_MEDIAN_CHF = 100;

// The most of the network fee a utility-controlled wallbox may be let off (Swiss utilities give
// controllable loads such as heat pumps a reduced network fee).
export const MAX_CHARGING_NETWORK_DISCOUNT = 0.6;

// Under control, the utility starts each car somewhere in the night's quietest hours: from this hour
// (or when the car is plugged in) until the latest start that has it full by morning, most around
// the middle.
export const CONTROLLED_EARLIEST_HOUR = 22;

// How the charging tariff weighs on approval: drivers like a charging price below the household
// price (up to this much goodwill), homeowners a little; tenants resent the network discount the
// rest of the town makes up (this much at the largest discount).
export const CHARGING_DRIVER_GOODWILL = 0.25;
export const CHARGING_HOMEOWNER_GOODWILL = 0.08;
export const CHARGING_DISCOUNT_TENANT_RESENTMENT = 0.12;
