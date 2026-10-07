/**
 * Mirrors pipeline/src/pipeline/schema.py — keep the two in sync. The pipeline
 * serializes to camelCase JSON so these types can be used directly.
 */

export interface Dwelling {
  ewid: string;
  roomCount: number | null;
  areaM2: number | null;
}

export interface Building {
  egid: string;
  lon: number;
  lat: number;
  footprint: [number, number][] | null;
  address: string | null;
  constructionYear: number | null;
  category: string | null;
  buildingClass: string | null;
  floorCount: number | null;
  energyReferenceAreaM2: number | null;
  footprintAreaM2: number | null;
  heatingGenerator: string | null;
  heatingEnergySource: string | null;
  hotWaterGenerator: string | null;
  hotWaterEnergySource: string | null;
  dwellings: Dwelling[];
  /** The street segments (StreetSegment ids) this building fronts on, from its entrances. Absent
   * in datasets built before streets were added. */
  streetSegments?: number[];

  // Lifecycle, set at runtime by sim/stock.ts (never by the pipeline). All absent on a
  // building that simply existed when the game started.
  origin?: "renewal" | "new";
  /** Site works begin (a renewal's demolition moment, or a new build's groundbreaking). */
  constructionStartMs?: number;
  /** Completion: the building only exists (draws power, houses anyone) from here on. */
  builtAtMs?: number;
  demolishedAtMs?: number;
  replacesEgids?: string[];
  replacedByEgid?: string;
  /** New builds only: the building's own U-value (W/m2K), replacing the era-curve
   * lookup — set from the construction code and the insulation policy at permit time. */
  uValueWPerM2K?: number;
}

export interface PowerPlant {
  plantId: string;
  lon: number;
  lat: number;
  capacityKw: number | null;
  technology: string | null;
  commissioningDate: string | null;
  egid: string | null;
  /** Set by solarAdoption.ts on a copy of a real plant whose building is (to be) demolished. */
  activeToMs?: number;
  /** A home battery with this system (sim/homeBattery.ts) — set by solarAdoption.ts. */
  battery?: { kwh: number; kw: number; feedInCap: number | null };
  /** A wind turbine's site: its wind distribution at hub height (Weibull A, k) — sim/windPower.ts. */
  wind?: { a: number; k: number };
}

/** Where a wind park could stand (pipeline/sources/wind.py): its turbines' positions and the wind at
 * each, from the federal wind atlas at 125 m. */
export interface WindSiteData {
  id: string;
  name: string | null;
  lon: number;
  lat: number;
  turbines: { lon: number; lat: number; vMean: number; a: number; k: number }[];
}

export interface StockHistory {
  firstYear: number;
  builtGfaM2: number[];
  demolishedGfaM2: number[];
  totalGfaM2: number;
}

export type SiteZone = "residential" | "work" | "mixed" | "centre" | "public";

export interface DevelopmentSite {
  id: string;
  zone: SiteZone;
  areaM2: number;
  /** Orientation of the site's long axis, degrees counter-clockwise from east. */
  angleDeg: number;
  /** Exterior ring first, then holes — [lon, lat]. */
  rings: [number, number][][];
}

/** Polygons -> rings (outer ring first, then holes) -> [lon, lat]. */
export type MunicipalityBoundary = number[][][][];

export interface MunicipalityDataset {
  bfsNumber: number;
  name: string;
  employmentBySector: Record<string, number>;
  /** Absent in datasets built before boundaries were added — the map just skips the border. */
  boundary?: MunicipalityBoundary;
  /** The municipality's own recent construction/demolition history (GWR) — calibrates stock.ts. */
  stockHistory?: StockHistory;
  /** Vacant buildable land new construction is placed into — see pipeline/sources/sites.py. */
  developmentSites?: DevelopmentSite[];
  buildings: Building[];
  powerPlants: PowerPlant[];
  /** The street network, junction to junction — see pipeline/sources/streets.py. */
  streets?: StreetSegment[];
  /** The district heating network the game starts with, inferred — see pipeline/sources/district_heat.py. */
  districtHeat?: DistrictHeatData | null;
  /** Farmland plots for Agri-PV; absent in older datasets. */
  farmPlots?: FarmPlotData[];
  /** Wind sites; absent in older datasets. */
  windSites?: WindSiteData[];
  /** Public charging sites for electric cars, from the federal register — see pipeline/sources/chargers.py. */
  chargingSites?: ChargingSiteData[];
  /** The registered road vehicles (BFS), latest year. Absent in older datasets. */
  vehicleRegister?: VehicleRegister | null;
  /** The building-zone parcels of the federal harmonised layer — see pipeline/sources/sites.py. */
  zoneParcels?: ZoneParcelData[];
  /** Where heat may be taken from the ground (canton ZH's heat-use atlas) — see
   * pipeline/sources/heat_use.py. Absent outside canton Zurich and in older datasets. */
  heatUse?: HeatUseData | null;
}

export interface HeatUseData {
  zones: { zone: "A" | "B" | "C" | "D" | "E" | "F"; noBoreholes: boolean; rings: [number, number][][][] }[];
  /** Areas with special conditions for boreholes (depth limits, casing). */
  conditions: { rings: [number, number][][][] }[];
  /** Tunnels and galleries, as lines of [lon, lat]. */
  tunnels: [number, number][][];
}

export interface ZoneParcelData {
  id: string;
  zone: SiteZone;
  areaM2: number;
  /** Polygons -> rings (outer ring first, then holes) -> [lon, lat]. */
  rings: [number, number][][][];
}

export interface VehicleRegister {
  year: number;
  cars: number;
  carsElectric: number;
  goodsVehicles: number;
  goodsVehiclesElectric: number;
}

export interface ChargingSiteData {
  id: string;
  name: string;
  lon: number;
  lat: number;
  points: number;
  powerKw: number;
  /** "dc": a fast-charging site (50 kW and up); "ac": ordinary (on-street) charge points. */
  kind: "ac" | "dc";
}

/** A street from one junction to the next — the unit district heating pipes are laid in. */
export interface StreetSegment {
  id: number;
  name: string | null;
  /** "main" (8-10 m roads, and streets drawn as two carriageways), "street" or "path". */
  highway: string;
  a: number; // end node ids, shared by segments meeting at a junction
  b: number;
  lengthM: number;
  /** How wide the street is (both carriageways, for one drawn as two) — for drawing it. */
  widthM: number;
  /** Every junction along it, ends included: a short stretch merged into this one leaves the
   * junction between them inside it. Absent in older datasets (then just a and b). */
  nodes?: number[];
  line: [number, number][]; // [lon, lat]
}

/** Where a plant joins the street graph (pipeline/sources/district_heat.py). */
export interface DhSiteData {
  /** The plant itself. */
  lon: number;
  lat: number;
  /** The street junction the network is fed at. */
  node: number;
  feedLon: number;
  feedLat: number;
  /** The trunk line from the plant to that junction (m; 0 when it stands at the street). */
  trunkM: number;
  /** The plant is in a neighbouring municipality. */
  outside: boolean;
}

/** BFE energy sources, as the game reads them: a clean kind, or a fossil fuel. */
export type DhNetworkSourceKind = "incinerator" | "industry" | "wastewater" | "groundwater" | "surfaceWater" | "wood" | "other" | "oil" | "gas";

/** A district heating network the town starts with: its plant (from the BFE's register of thermal
 * networks — or, where district-heated buildings have none near them, one of unknown origin) and
 * the streets inferred to be piped. */
export interface DhNetworkData extends DhSiteData {
  name: string;
  operator: string | null;
  /** The year it went into service, where reported. */
  since: number | null;
  /** In the register (false: a plant the pipeline had to place at its customers' centre). */
  known: boolean;
  /** Its heat capacity, where reported (MW). */
  powerMw: number | null;
  /** What it runs on, main source first. */
  sources: { kind: DhNetworkSourceKind; label: string }[];
  segments: number[];
}

/** A place new heat could come from: an incinerator or a waste water treatment plant within reach,
 * or a factory with waste heat to sell. */
export interface DhCandidateData extends DhSiteData {
  id: string;
  kind: "incinerator" | "wastewater" | "industry";
  name: string;
  /** Incinerators: the heat and electricity delivered in the latest year reported (MWh). */
  heatMwh?: number;
  electricityMwh?: number;
  /** Treatment plants and factories: the heat that could be recovered a year (MWh). */
  potentialMwh?: number;
  /** Factories: the building, and its branch (NOGA division). */
  egid?: string;
  noga?: number | null;
}

/** A farmland plot outside the building zones, one parcel's field (pipeline/sources/farm.py). */
export interface FarmPlotData {
  /** The parcel's land register id (E-GRID). */
  id: string;
  /** Its parcel number. */
  number: string | null;
  /** The field name the survey gives the place. */
  name: string | null;
  areaM2: number;
  /** The share of it that is prime cropland (Fruchtfolgefläche). */
  primeShare: number;
  /** Outer ring first, then holes: [lon, lat]. */
  rings: [number, number][][];
}

export interface DistrictHeatData {
  networks?: DhNetworkData[];
  candidates?: DhCandidateData[];
  /** Rivers and lakes big enough to draw heat from: polygons of rings, [lon, lat]. */
  water?: [number, number][][][];
  /** Forest in the municipality (ha): the local wood supply. */
  forestHa?: number;
  /** Older datasets: one network, its source and its piped streets. */
  source?: { name: string; lon: number; lat: number; node: number; feedLon: number; feedLat: number };
  initialSegments?: number[];
}
