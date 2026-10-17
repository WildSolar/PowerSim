// Solar over car parks (sim/carParks.ts): canopies over open-air car parks of about 20 spaces and
// up (pipeline/sources/car_parks.py), built by their owners or by the municipality. Informed
// placeholders.

// A canopy covers the spaces, not the aisles: about 2.7 kWp a space (a 2.5 × 5 m bay of panels).
export const CAR_PARK_KWP_PER_SPACE = 2.7;
// How the panels face: low rows tilted south, or east and west in turn, drawn per car park
// (config/pvProfiles.ts).
export const CAR_PARK_PROFILES: { id: string; weight: number }[] = [
  { id: "s10", weight: 0.6 },
  { id: "ew10", weight: 0.4 },
];

// Build cost per kWp: the steel structure makes a canopy dearer than a roof. CHF 2,300 for 100 kWp,
// falling with size to CHF 1,500.
export const CAR_PARK_CAPEX_CHF_PER_KWP_AT_100KWP = 2_300;
export const CAR_PARK_CAPEX_SCALE_EXPONENT = 0.15;
export const CAR_PARK_CAPEX_FLOOR_CHF_PER_KWP = 1_500;
export const CAR_PARK_UPKEEP_CHF_PER_KWP_YEAR = 20;
export const CAR_PARK_LIFETIME_YEARS = 30;
export const CAR_PARK_BUILD_MONTHS = 6;

// What the owner's building takes of the canopy's power: at most this share of the building's
// yearly use (it mostly runs by day), and never more than this share of what the canopy makes.
export const CAR_PARK_SELF_USE_OF_DEMAND = 0.5;
export const CAR_PARK_SELF_USE_MAX = 0.6;

// Owners look into it now and then (a share of them a year), and weigh it like any investment —
// but a business wants its money back sooner than the canopy lasts: the cost is spread over this
// many years, not its lifetime.
export const CAR_PARK_CONSIDER_PER_YEAR = 0.08;
export const CAR_PARK_PAYBACK_YEARS = 12;
export const CAR_PARK_UNCERTAINTY_FRACTION = 0.25;

// Which car parks are the municipality's: those by its own buildings, and those open to everyone
// (mapped access) with no shop, office or factory as their building.
export const CAR_PARK_PUBLIC_ACCESS = ["yes", "public", "permissive"];
