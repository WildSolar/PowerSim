/**
 * Asking the map to look somewhere: a panel (a list of chargers, of public buildings) requests a
 * point, and MapView eases there. No map reference has to travel through React props.
 */

export interface MapFocusRequest {
  lon: number;
  lat: number;
  /** Zoom in at least this far (the map never zooms out for a focus). */
  minZoom?: number;
}

const listeners = new Set<(request: MapFocusRequest) => void>();

export const mapFocus = {
  request(request: MapFocusRequest): void {
    listeners.forEach((l) => l(request));
  },
  /** Centres a building: the middle of its footprint (its register coordinate is often an entrance
   * at one edge). A moment later, so a panel opened by the same click (selecting the building) is
   * already there to be steered around. */
  focusBuilding(building: { lon: number; lat: number; footprint: [number, number][] | null }, minZoom?: number): void {
    const ring = building.footprint && building.footprint.length >= 3 ? building.footprint : null;
    const lon = ring ? ring.reduce((s, p) => s + p[0], 0) / ring.length : building.lon;
    const lat = ring ? ring.reduce((s, p) => s + p[1], 0) / ring.length : building.lat;
    setTimeout(() => listeners.forEach((l) => l({ lon, lat, minZoom })), 80);
  },
  subscribe(listener: (request: MapFocusRequest) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
