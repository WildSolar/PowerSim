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
}

export interface PowerPlant {
  plantId: string;
  lon: number;
  lat: number;
  capacityKw: number | null;
  technology: string | null;
  commissioningDate: string | null;
  egid: string | null;
}

/** Polygons -> rings (outer ring first, then holes) -> [lon, lat]. */
export type MunicipalityBoundary = number[][][][];

export interface MunicipalityDataset {
  bfsNumber: number;
  name: string;
  employmentBySector: Record<string, number>;
  /** Absent in datasets built before boundaries were added — the map just skips the border. */
  boundary?: MunicipalityBoundary;
  buildings: Building[];
  powerPlants: PowerPlant[];
}
