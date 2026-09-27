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
  subscribe(listener: (request: MapFocusRequest) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
