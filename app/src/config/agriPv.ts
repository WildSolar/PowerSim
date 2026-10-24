// Agri-PV (sim/agriPv.ts): solar over farmland that stays farmed, on fields the municipality zones
// for it, developed by businesses that buy the power, energy cooperatives, or the municipality
// itself. Informed placeholders.

// Designating fields: the planning work for a change to the zoning plan, and its procedure.
export const AGRI_PV_PLANNING_COST_CHF = 40_000;
export const AGRI_PV_PLANNING_COST_CHF_PER_HA = 3_000;
export const AGRI_PV_LEAD_MONTHS = 24;

// How people take farmland being zoned for solar, at full scale (this much land designated; less
// land, proportionally less, down to a floor): landscape and food production against, the climate-
// minded and business for. Prime cropland (Fruchtfolgefläche) stirs half again as much opposition.
export const AGRI_PV_STANCES = { homeowners: -0.7, tenants: -0.3, drivers: -0.1, business: 0.15, climate: 0.4 } as const;
export const AGRI_PV_FULL_SCALE_HA = 20;
export const AGRI_PV_MIN_SCALE = 0.3;
export const AGRI_PV_PRIME_FACTOR = 1.5;
// While zones are in force, this share of the stance stays as a lasting pull.
export const AGRI_PV_LASTING_SHARE = 0.4;

// Acceptance (0-1) takes the edge off the opposition, both to new zones and to those in force. It
// grows while the Agri-PV dialogue runs, a little with every field built (people see one), up to a
// limit — some will always mind.
export const AGRI_PV_ACCEPTANCE_PER_YEAR_DIALOGUE = 0.15;
export const AGRI_PV_ACCEPTANCE_PER_FIELD = 0.03;
export const AGRI_PV_ACCEPTANCE_MAX = 0.8;

// The installations, in three kinds, each covering its whole field (how each faces the sun:
// config/pvProfiles.ts): vertical bifacial rows running north–south between the crops (one face to
// the east, the other to the west — power in the morning and the late afternoon; wide gaps for the
// machines, so the least power per hectare; a light frame, so the cheapest); fixed rows high over
// orchards, vines and berries, facing south like a good roof (the panels shelter the crop, so the
// most per hectare; snow stays on them until it melts); and rows that turn to follow the sun from
// east to west (steady from morning to evening, the most per kWp; the motors and bearings make them
// the dearest, and the dearest to keep up). Power per hectare, the build cost relative to fixed rows,
// and the upkeep a year; informed placeholders.
export type AgriPvSystem = "vertical" | "overhead" | "tracking";
export const AGRI_PV_SYSTEMS: Record<AgriPvSystem, { label: string; kwpPerHa: number; capexFactor: number; upkeepChfPerKwpYear: number; blurb: string }> = {
  vertical: {
    label: "Vertical rows",
    kwpPerHa: 300,
    capexFactor: 0.8,
    upkeepChfPerKwpYear: 12,
    blurb: "Panels on edge between the crops, facing east and west: power in the morning and the late afternoon, little at noon. The cheapest, but the fewest per hectare. Snow can't settle on them.",
  },
  overhead: {
    label: "Fixed rows",
    kwpPerHa: 800,
    capexFactor: 1,
    upkeepChfPerKwpYear: 15,
    blurb: "Panels high over orchards, vines or berries, facing south like a good roof: most at noon, and the most per hectare. Not on cropland — the machines can't work under them. Snow stays on them until it melts.",
  },
  tracking: {
    label: "Tracking rows",
    kwpPerHa: 500,
    capexFactor: 1.35,
    upkeepChfPerKwpYear: 22,
    blurb: "Rows that turn with the sun from east to west: steady from morning to evening, and the most from each panel. The dearest; they turn steep to shed snow.",
  },
};
// Which kinds a field takes: cropland (at least this share of it prime cropland) only rows that leave
// the machines room; other farmland — meadows, orchards, vines — any of the three.
export const AGRI_PV_CROPLAND_SHARE = 0.5;
export const AGRI_PV_CROPLAND_SYSTEMS: AgriPvSystem[] = ["vertical", "tracking"];
// Build cost per kWp: CHF 1,000 for a 0.5 MWp field, falling with size to CHF 600 for 10 MWp.
export const AGRI_PV_CAPEX_CHF_PER_KWP_AT_500KWP = 1_000;
export const AGRI_PV_CAPEX_SCALE_EXPONENT = 0.17;
export const AGRI_PV_CAPEX_FLOOR_CHF_PER_KWP = 600;
// What the farmer gets for the land under the panels, a year: the typical ask. Each farmer asks
// their own, spread around it (log-normal).
export const AGRI_PV_RENT_CHF_PER_HA_YEAR = 3_000;
export const AGRI_PV_RENT_SPREAD = 0.35;

// The farmer has the last word: a zoned field is only built on if whoever farms it agrees, and no
// one knows beforehand who will. At first about a third would; as acceptance grows (the dialogue,
// fields to see), more come round — up to this share more at full acceptance. A farmer who says no
// is left alone for a few years, then may be asked again.
export const AGRI_PV_FARMER_WILLING_SHARE = 0.35;
export const AGRI_PV_FARMER_ACCEPTANCE_PULL = 0.4;
export const AGRI_PV_FARMER_RETRY_YEARS = 3;
export const AGRI_PV_LIFETIME_YEARS = 25;
export const AGRI_PV_BUILD_MONTHS = 12;
export const AGRI_PV_MIN_KWP = 200;

// The permit for a field (a year): outside the building zones, the canton's exceptional permit —
// the developer shows the farming goes on and gains — and the building permit. Then, now and then,
// an appeal (landscape protection, neighbours), which takes a year or more in the courts and is
// sometimes upheld: then the field rests a few years before anyone takes it up again. The
// developer pays: a business or a cooperative its own, the municipality from the treasury.
export const AGRI_PV_PERMIT_COST_CHF = 60_000;
export const AGRI_PV_PERMIT_COST_CHF_PER_HA = 10_000;
export const AGRI_PV_PERMIT_MONTHS = 12;
// The canton refuses the permit outright this often — the farming doesn't gain enough, the landscape
// matters more here — and the field rests; of those it grants, this many are appealed, and of those
// this many upheld in court.
export const AGRI_PV_PERMIT_REFUSED_CHANCE = 0.12;
export const AGRI_PV_APPEAL_CHANCE = 0.45;
export const AGRI_PV_APPEAL_YEARS: [number, number] = [1, 3];
export const AGRI_PV_APPEAL_UPHELD_CHANCE = 0.3;
export const AGRI_PV_RETRY_YEARS = 3;

// Who invests: businesses that use a lot of electricity, through a power purchase agreement (PPA):
// they take the field's power as it comes, instead of buying that energy from the utility (they
// still pay for the grid). Each looks into it now and then, at the zoned field nearest to them.
export const AGRI_PV_MIN_FOOTPRINT_M2 = 1_000;
export const AGRI_PV_MIN_CONSUMER_MWH = 300;
export const AGRI_PV_CONSIDER_PER_YEAR = 0.15;
// The business takes the field's power up to this share of its yearly use, at its own price; the
// rest is sold to the utility at the feed-in price.
export const AGRI_PV_PPA_COVER_SHARE = 0.6;
// How much the numbers are guessed at (a share of the yearly cost, as for every investment decision).
export const AGRI_PV_UNCERTAINTY_FRACTION = 0.25;

// Energy cooperatives (Energiegenossenschaften): residents pooling their savings for a field, and
// selling all its power to the utility at the feed-in price. Now and then one looks into each free
// zoned field, and takes it up if the feed-in pays for the build, the rent and the upkeep with a
// little to spare — its members want their money back, not a big return. What they can raise
// limits how big a field they take on.
export const AGRI_PV_COOP_CONSIDER_PER_YEAR = 0.1;
export const AGRI_PV_COOP_MIN_RETURN = 0.1;
export const AGRI_PV_COOP_MAX_CHF = 3_000_000;
