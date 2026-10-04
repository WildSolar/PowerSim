import type { MunicipalityDataset } from "./types";

/** A file under public/data, wherever the game is served from (a site's root, or a path below it). */
export function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path}`;
}

export async function loadDataset(url = dataUrl("schlieren.json")): Promise<MunicipalityDataset> {
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
  const response = await fetch(dataUrl("index.json"));
  if (!response.ok) {
    throw new Error(`Failed to load municipality list: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MunicipalityIndexEntry[];
}
