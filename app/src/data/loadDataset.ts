import type { MunicipalityDataset } from "./types";

export async function loadDataset(url = "/data/schlieren.json"): Promise<MunicipalityDataset> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load dataset from ${url}: ${response.status} ${response.statusText}`);
  }
  return (await response.json()) as MunicipalityDataset;
}
