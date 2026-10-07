// Wind power (sim/wind.ts): a generic modern low-wind turbine, and the long road to building one in
// Switzerland — a study, a zoning plan the voters decide on, a permit that is almost always appealed,
// and only then the build. Informed placeholders.

// The turbine: 4.2 MW, 150 m rotor, 125 m hub (the wind atlas's height). Power curve: nothing below
// cut-in, rising with the cube of the wind speed to its rating, off above cut-out.
export const TURBINE_KW = 4_200;
export const CUT_IN_MS = 2.5;
export const RATED_MS = 10;
export const CUT_OUT_MS = 25;
// Wake losses, downtime, icing: what reaches the grid of what the wind could give.
export const WIND_AVAILABILITY = 0.93;

// Seasons: Swiss wind blows hardest in winter. The share the wind quantile shifts at the peak of
// winter (and down at the height of summer).
export const WIND_WINTER_SHIFT = 0.12;

// 1. The study: measurements and a site assessment across the municipality.
export const WIND_STUDY_COST_CHF = 120_000;
export const WIND_STUDY_MONTHS = 12;
// 2. The zoning plan (Nutzungsplanung): a special-use zone for the park, always put to the vote.
export const WIND_ZONING_COST_CHF = 250_000;
export const WIND_ZONING_COST_CHF_PER_TURBINE = 50_000;
export const WIND_ZONING_MONTHS = 24;
// 3. The permit: the environmental impact assessment and the building permit — and then, as a rule,
// an appeal (landscape and bird protection, neighbours), which takes years in the courts and is
// sometimes upheld.
export const WIND_PERMIT_COST_CHF = 400_000;
export const WIND_PERMIT_MONTHS = 18;
export const WIND_APPEAL_CHANCE = 0.65;
export const WIND_APPEAL_YEARS: [number, number] = [1, 4];
export const WIND_APPEAL_UPHELD_CHANCE = 0.25;
// After a lost vote or a lost appeal, the site can be taken up again after this long.
export const WIND_RETRY_YEARS = 4;
// 4. The build: per kW installed (CHF), less the federal investment contribution for wind.
export const WIND_CAPEX_CHF_PER_KW = 1_900;
export const WIND_FEDERAL_SHARE = 0.5;
export const WIND_BUILD_MONTHS = 12;
export const WIND_UPKEEP_CHF_PER_KW_YEAR = 45;

// How people take it. At the vote (and as a jolt when put forward): the town as a whole, plus the
// homes within WIND_LOCAL_RADIUS_M of a turbine, who mind most — their weight grows with their share
// of the town's homes, full at WIND_LOCAL_FULL_SHARE.
export const WIND_STANCES = { homeowners: -0.35, tenants: -0.1, drivers: -0.05, business: 0.1, climate: 0.6 } as const;
export const WIND_LOCAL_RADIUS_M = 1_000;
export const WIND_LOCAL_FULL_SHARE = 0.05;
export const WIND_LOCAL_STANCES = { homeowners: -0.6, tenants: -0.25 } as const;
// While turbines turn, the local part stays, this much of it.
export const WIND_LASTING_SHARE = 0.5;
