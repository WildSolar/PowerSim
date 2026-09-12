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
  constructionYear: number | null;
  category: string | null;
  floorCount: number | null;
  energyReferenceAreaM2: number | null;
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

export interface MunicipalityDataset {
  bfsNumber: number;
  name: string;
  employmentBySector: Record<string, number>;
  buildings: Building[];
  powerPlants: PowerPlant[];
}
