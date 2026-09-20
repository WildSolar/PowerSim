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
}
