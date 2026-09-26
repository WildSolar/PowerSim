// District heating network: what extending it costs and takes, and the money it turns over.
// All of these are placeholders to balance, not researched figures (see the wiki's own note).

// Laying pipes in a street: trench, pipes, resurfacing, per metre of street.
export const DH_PIPE_COST_CHF_PER_M = 2_000;
// Main roads (trunk/primary/secondary) cost more: traffic management, a crowded utility corridor.
export const DH_MAIN_ROAD_COST_FACTOR = 1.5;
export const DH_MAIN_ROAD_CLASSES = new Set(["trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);

// How long an extension takes to build: a fixed planning/permit lead plus progress along the street.
export const DH_BUILD_MIN_MONTHS = 3;
export const DH_BUILD_METRES_PER_MONTH = 250;

// The municipal utility sells the heat it buys from the source; customers pay the tariff's
// district heating price. What the source charges per kWh:
export const DH_SOURCE_HEAT_PRICE_RP_PER_KWH = 7;
// Running the pipes: maintenance, pumping, losses, per metre of piped street per year (networks are
// usually quoted at 0.5-1% of their build cost a year).
export const DH_NETWORK_UPKEEP_CHF_PER_M_YEAR = 10;

// A source's capacity isn't known from any open data; for now it is set this far above the
// peak load of the buildings connected when the game starts. Shown, not enforced (yet).
export const DH_SOURCE_CAPACITY_HEADROOM = 1.5;
// The outdoor temperature a network's peak load is judged at (a cold winter day).
export const DH_DESIGN_OUTDOOR_TEMP_C = -8;
