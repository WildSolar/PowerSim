import type { MunicipalityDataset } from "./types";

export async function loadDataset(url = "/data/schlieren.json"): Promise<MunicipalityDataset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load dataset from ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MunicipalityDataset;
}

export interface MunicipalityIndexEntry {
  slug: string;
  name: string;
  bfsNumber: number;
  buildingCount: number;
}

/** The list of municipalities the pipeline has built, from public/data/index.json. */
export async function loadMunicipalityIndex(): Promise<MunicipalityIndexEntry[]> {
  const response = await fetch("/data/index.json");
  if (!response.ok) {
    throw new Error(`Failed to load municipality list: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MunicipalityIndexEntry[];
}
