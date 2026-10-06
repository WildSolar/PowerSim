// District heating: the networks, the heat sources that feed them, and the money they turn over
// (sim/districtHeat.ts, sim/districtHeatSources.ts). Informed placeholders to balance, not
// researched figures (see the wiki's own note). Every network is a high-temperature one: the heat
// arrives hot enough for radiators and hot water, with nothing more to install in the building.

// --- Pipes ---

// Laying pipes in a street: trench, pipes, resurfacing, per metre of street.
export const DH_PIPE_COST_CHF_PER_M = 2_000;
// Main roads (8-10 m streets, and those drawn as two carriageways) cost more: traffic management,
// a crowded utility corridor.
export const DH_MAIN_ROAD_COST_FACTOR = 1.5;
export const DH_MAIN_ROAD_CLASSES = new Set(["main"]);

// How long an extension takes to build: a fixed planning/permit lead plus progress along the street.
export const DH_BUILD_MIN_MONTHS = 3;
export const DH_BUILD_METRES_PER_MONTH = 250;

// A trunk line from a plant outside the streets (an incinerator, a treatment plant in the next
// municipality): bigger pipes, across fields and under roads, per metre.
export const DH_TRUNK_COST_CHF_PER_M = 3_000;
export const DH_TRUNK_METRES_PER_MONTH = 400;

// Running the pipes: maintenance, pumping, per metre of piped street (or trunk line) per year
// (networks are usually quoted at 0.5-1% of their build cost a year).
export const DH_NETWORK_UPKEEP_CHF_PER_M_YEAR = 10;
// Heat lost from the pipes on the way: a network produces this much more than it delivers.
export const DH_NETWORK_LOSS_SHARE = 0.1;

// The outdoor temperature a network's peak load is judged at (a cold winter day).
export const DH_DESIGN_OUTDOOR_TEMP_C = -8;

// --- Fossil boilers ---

// Every network has fossil boilers for whatever its clean sources can't cover: the peak boilers of
// a real network, or for a network with no clean source at all, all of it. They burn heating oil
// unless the network's operator reports natural gas.
export const DH_BOILER_EFFICIENCY = 0.9;

// --- The networks a town starts with (the BFE's register) ---

// A network running on a clean main source with a fossil peak boiler: the clean part of the
// reported capacity (a base load plant sized at about half the peak covers ~85-90% of the heat).
export const DH_EXISTING_CLEAN_SHARE_WITH_BOILER = 0.55;
// A fossil main source with a clean second one.
export const DH_EXISTING_CLEAN_SHARE_SECONDARY = 0.25;
// A network whose capacity isn't reported: this far above the winter peak of the buildings
// connected when the game starts.
export const DH_UNKNOWN_CAPACITY_HEADROOM = 1.5;

// --- Heat sources ---

export type DhSourceKind = "incinerator" | "industry" | "wastewater" | "groundwater" | "surfaceWater" | "wood" | "other";

export interface DhSourceSpec {
  label: string;
  /** Used first to last: what costs least to run goes first. */
  merit: number;
  /** Heat pumps: heat delivered per kWh of electricity, lifting to network temperature. */
  cop: number | null;
  /** What a plant of 1 MW costs to build (CHF); bigger ones cost CHF_AT_1MW × MW^SCALE_EXPONENT. */
  capexChfAt1Mw: number;
  /** A fixed part on top: the building, the connection, permits. */
  capexFixedChf: number;
  /** Upkeep a year per kW of heat capacity. */
  upkeepChfPerKwYear: number;
  buildMonths: number;
  /** Size limits a single plant (MW; the potential may set a lower one). */
  minMw: number;
  maxMw: number;
}

// Cost falls per MW as plants get bigger: capex ∝ MW^0.7.
export const DH_CAPEX_SCALE_EXPONENT = 0.7;

export const DH_SOURCE_SPECS: Record<DhSourceKind, DhSourceSpec> = {
  // Heat taken from an incinerator's turbine or flue gas cooling: a heat exchanger station.
  incinerator: { label: "Incinerator waste heat", merit: 0, cop: null, capexChfAt1Mw: 250_000, capexFixedChf: 400_000, upkeepChfPerKwYear: 4, buildMonths: 12, minMw: 1, maxMw: 60 },
  // A factory's cooling water and exhaust, through a heat exchanger (and a booster where it runs cool).
  industry: { label: "Industrial waste heat", merit: 1, cop: null, capexChfAt1Mw: 250_000, capexFixedChf: 80_000, upkeepChfPerKwYear: 6, buildMonths: 9, minMw: 0.05, maxMw: 20 },
  // A heat pump on a treatment plant's cleaned effluent (10-20 °C all year).
  wastewater: { label: "Waste water heat pump", merit: 2, cop: 2.9, capexChfAt1Mw: 1_500_000, capexFixedChf: 500_000, upkeepChfPerKwYear: 25, buildMonths: 18, minMw: 0.2, maxMw: 40 },
  // A heat pump on wells into the aquifer, with a return well.
  groundwater: { label: "Groundwater heat pump", merit: 3, cop: 2.8, capexChfAt1Mw: 1_600_000, capexFixedChf: 400_000, upkeepChfPerKwYear: 25, buildMonths: 18, minMw: 0.2, maxMw: 4 },
  // A heat pump drawing on a river or lake, with an intake and a return.
  surfaceWater: { label: "River or lake heat pump", merit: 4, cop: 2.7, capexChfAt1Mw: 1_800_000, capexFixedChf: 800_000, upkeepChfPerKwYear: 25, buildMonths: 24, minMw: 0.5, maxMw: 30 },
  // A wood chip combined heat and power plant: heat for the network, power for the grid.
  wood: { label: "Wood chip CHP plant", merit: 5, cop: null, capexChfAt1Mw: 2_200_000, capexFixedChf: 600_000, upkeepChfPerKwYear: 45, buildMonths: 24, minMw: 0.1, maxMw: 20 },
  // Anything else a network starts with that burns nothing (solar thermal, say).
  other: { label: "Other clean heat", merit: 6, cop: null, capexChfAt1Mw: 0, capexFixedChf: 0, upkeepChfPerKwYear: 10, buildMonths: 0, minMw: 0, maxMw: 0 },
};

// Incinerators: what a plant could sell the town is a share of what it delivers today plus what it
// turns into electricity (taking heat costs ~1 kWh of power per 3 kWh of heat) — the rest goes to
// its existing customers and the neighbours. Sold per kWh.
export const DH_INCINERATOR_POWER_TO_HEAT = 3;
export const DH_INCINERATOR_TOWN_SHARE = 0.2;
export const DH_INCINERATOR_HEAT_RP_PER_KWH = 4;
// Industrial waste heat: the factory offers it for a yearly payment, per kWh of its yearly potential.
export const DH_INDUSTRY_PAYMENT_RP_PER_KWH = 1.5;
// What a factory is called, by its branch (NOGA division) — in the offer it writes, and on the map.
export const DH_INDUSTRY_SITE_NAMES: Record<number, string> = {
  10: "Food factory",
  11: "Beverage plant",
  13: "Textile mill",
  16: "Sawmill",
  17: "Paper mill",
  18: "Printing works",
  19: "Refinery",
  20: "Chemical plant",
  21: "Pharmaceutical plant",
  22: "Plastics works",
  23: "Glass and ceramics works",
  24: "Metal works",
  25: "Metalware factory",
  26: "Electronics factory",
  27: "Electrical equipment factory",
  28: "Machine works",
  29: "Vehicle parts factory",
  32: "Factory",
  33: "Repair works",
  35: "Power plant",
  38: "Waste treatment plant",
  41: "Building contractor's yard",
  43: "Construction yard",
  46: "Wholesale warehouse",
  47: "Retail centre",
  52: "Logistics centre",
  56: "Commercial kitchen",
  62: "Data centre",
  63: "Data centre",
  86: "Hospital",
};
// Offers arrive one by one over these years (a firm reviewing its energy, a new owner).
export const DH_INDUSTRY_OFFER_YEARS: [number, number] = [2027, 2040];
// A potential (MWh a year) as a plant size: incinerators and factories give heat most of the year,
// a treatment plant's effluent is drawn on hardest in winter.
export const DH_FULL_LOAD_HOURS = { incinerator: 5_000, industry: 6_000, wastewater: 4_000, wood: 3_500 } as const;
// Groundwater: the water-rights concession, per kW of heat a year (as for a building's own wells).
export const DH_GROUNDWATER_FEE_CHF_PER_KW_YEAR = 10;
// Rivers and lakes: the plant has to stand this close to the water.
export const DH_SURFACE_WATER_MAX_DISTANCE_M = 100;

// Wood: what the municipality's forest yields sustainably as energy wood, a year per hectare
// (Swiss forests grow 8-10 m³/ha a year; roughly a third of the harvest is energy wood, ~2,000 kWh
// per m³ solid). New wood plants together may burn no more than that — the plants a town starts
// with buy their wood regionally, as they always have.
export const DH_WOOD_YIELD_MWH_PER_HA_YEAR = 6.5;
// A CHP plant turns this much of its fuel into network heat and this much into power.
export const DH_WOOD_HEAT_EFFICIENCY = 0.65;
export const DH_WOOD_POWER_EFFICIENCY = 0.2;
export const DH_WOOD_FUEL_RP_PER_KWH = 4.5;
// Neighbours mind the lorries, the chimney and the smell: homes within this distance of a new wood
// plant hold it against the council for as long as it runs.
export const DH_WOOD_NUISANCE_RADIUS_M = 300;
// The stance of homeowners and tenants when this share of the town's homes lies within reach of new
// wood plants (less: proportionally less).
export const DH_WOOD_NUISANCE_FULL_SHARE = 0.1;
export const DH_WOOD_NUISANCE_STANCE = -0.6;
