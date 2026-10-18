/**
 * Public transport near each building: the federal quality classes (ÖV-Güteklassen, ARE), from A
 * (very good) to D (basic), by how far the nearest stop is and how often it is served; outside every
 * class, next to none (pipeline/sources/transit.py).
 *
 * mobility.ts weighs a household's chance of getting about by public transport by its building's
 * class — likelier near a busy station, rarer where the bus hardly comes — normalised over the
 * town's households, so the town's modal split as a whole stays the survey's.
 */

import { TRANSIT_CLASS_WEIGHT, type TransitClass } from "../config/mobility";
import type { Building, Dwelling, MunicipalityDataset } from "../data/types";
import { LocalProjection, pointInPolygon, type XY } from "./localGeo";

interface Area {
  cls: TransitClass;
  rings: XY[][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

class Transit {
  private areas: Area[] = [];
  private projection = new LocalProjection(8.4, 47.4);
  private lookup: (egid: string) => Building | undefined = () => undefined;
  private classByEgid = new Map<string, TransitClass>();
  /** The town's mean weight over its households' cars-or-not (mobility slots) at the start: what the
   * weights are divided by. */
  private meanWeight = 1;

  init(dataset: MunicipalityDataset, lookup: (egid: string) => Building | undefined, slotsOf: (b: Building, d: Dwelling) => number): void {
    const first = dataset.buildings[0];
    this.projection = new LocalProjection(first?.lon ?? 8.4, first?.lat ?? 47.4);
    this.areas = (dataset.transitClasses ?? []).map((a) => {
      const rings = a.rings.map((ring) => ring.map(([lon, lat]) => this.projection.toXY(lon, lat)));
      const xs = rings[0].map((q) => q[0]);
      const ys = rings[0].map((q) => q[1]);
      return { cls: a.class, rings, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    });
    // Best class first: where areas meet, a building takes the better one.
    this.areas.sort((a, b) => a.cls.localeCompare(b.cls));
    this.lookup = lookup;
    this.classByEgid = new Map();
    let slots = 0;
    let weighted = 0;
    for (const b of dataset.buildings) {
      if (b.dwellings.length === 0) continue;
      const n = b.dwellings.reduce((sum, d) => sum + slotsOf(b, d), 0);
      slots += n;
      weighted += n * TRANSIT_CLASS_WEIGHT[this.classOf(b)];
    }
    this.meanWeight = slots > 0 ? weighted / slots : 1;
  }

  /** A building's public transport class ("none": next to no public transport). */
  classOf(b: Building): TransitClass {
    let cls = this.classByEgid.get(b.egid);
    if (cls === undefined) {
      const [x, y] = this.projection.toXY(b.lon, b.lat);
      const p: XY = [x, y];
      cls = this.areas.find((a) => x >= a.minX && x <= a.maxX && y >= a.minY && y <= a.maxY && pointInPolygon(p, a.rings))?.cls ?? "none";
      this.classByEgid.set(b.egid, cls);
    }
    return cls;
  }

  /** How much likelier than the town's average a household in this building is to get about by
   * public transport (1 where the town has no classes at all). */
  factor(egid: string): number {
    const b = this.lookup(egid);
    return b ? TRANSIT_CLASS_WEIGHT[this.classOf(b)] / this.meanWeight : 1;
  }
}

export const transit = new Transit();
