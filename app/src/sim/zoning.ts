/**
 * The municipality's zoning plan (Bau- und Zonenordnung), parcel by parcel: the real zone types from
 * the federal harmonised building-zone layer. The zoning layer shows it; the game reads it, too —
 * stock.ts builds on vacant land what its zone allows, and heatPumpSiting.ts takes a building's
 * zone for the noise limits at its neighbours'. The plan stays as it is through the game.
 */

import type { Building, DevelopmentSite, MunicipalityDataset, SiteZone } from "../data/types";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";

export interface Parcel {
  id: string;
  zone: SiteZone;
  areaM2: number;
  rings: [number, number][][][];
  polygonsXY: XY[][][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

class Zoning {
  private parcels: Parcel[] = [];
  private byId = new Map<string, Parcel>();
  private projection = new LocalProjection(8.4, 47.4);
  private parcelOfBuilding = new Map<string, string | null>();
  private parcelOfSite = new Map<string, string | null>();

  init(dataset: MunicipalityDataset): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.parcels = (dataset.zoneParcels ?? []).map((p) => {
      const polygonsXY = p.rings.map((polygon) => polygon.map((ring) => ring.map(([lon, lat]) => this.projection.toXY(lon, lat))));
      const xs = polygonsXY.flatMap((poly) => poly[0].map((q) => q[0]));
      const ys = polygonsXY.flatMap((poly) => poly[0].map((q) => q[1]));
      return { ...p, polygonsXY, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });
    this.byId = new Map(this.parcels.map((p) => [p.id, p]));
    this.parcelOfBuilding = new Map();
    this.parcelOfSite = new Map();
  }

  getParcels(): Parcel[] {
    return this.parcels;
  }

  getParcel(id: string): Parcel | undefined {
    return this.byId.get(id);
  }

  private parcelIdAt(x: number, y: number): string | null {
    const p: XY = [x, y];
    for (const parcel of this.parcels) {
      if (x < parcel.minX || x > parcel.maxX || y < parcel.minY || y > parcel.maxY) continue;
      if (parcel.polygonsXY.some((rings) => pointInPolygon(p, rings))) return parcel.id;
    }
    return null;
  }

  parcelIdAtLonLat(lon: number, lat: number): string | null {
    const [x, y] = this.projection.toXY(lon, lat);
    return this.parcelIdAt(x, y);
  }

  parcelIdOfBuilding(b: Building): string | null {
    let id = this.parcelOfBuilding.get(b.egid);
    if (id === undefined) {
      id = this.parcelIdAtLonLat(b.lon, b.lat);
      this.parcelOfBuilding.set(b.egid, id);
    }
    return id;
  }

  /** The zone a building stands in (null outside every parcel). */
  zoneForBuilding(b: Building): SiteZone | null {
    const id = this.parcelIdOfBuilding(b);
    return (id && this.byId.get(id)?.zone) || null;
  }

  /** The zone a development site builds to (its own zone when it lies outside every parcel). */
  zoneForSite(site: DevelopmentSite): SiteZone {
    let id = this.parcelOfSite.get(site.id);
    if (id === undefined) {
      const ring = site.rings[0] ?? [];
      const lon = ring.reduce((s, q) => s + q[0], 0) / Math.max(1, ring.length);
      const lat = ring.reduce((s, q) => s + q[1], 0) / Math.max(1, ring.length);
      id = this.parcelIdAtLonLat(lon, lat);
      this.parcelOfSite.set(site.id, id);
    }
    return (id && this.byId.get(id)?.zone) || site.zone;
  }
}

export const zoning = new Zoning();
