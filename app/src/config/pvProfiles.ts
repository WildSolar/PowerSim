// How solar arrays face the sun (sim/pv.ts). Not a survey of the town's roofs: a plausible spread,
// so that the town's arrays don't all peak at the same moment as if every panel lay flat.

/** How an array is mounted: fixed at a tilt facing a compass direction (degrees from north,
 * clockwise: 90 east, 180 south, 270 west); a flat roof's low rows facing east and west in turn;
 * vertical bifacial rows running north–south (one face to the east, the other to the west); or rows
 * on a north–south axis tracking the sun from east to west. */
export type PvMount =
  | { kind: "fixed"; tiltDeg: number; azimuthDeg: number }
  | { kind: "eastWest"; tiltDeg: number }
  | { kind: "vertical" }
  | { kind: "tracking"; maxAngleDeg: number };

export interface PvProfile {
  id: string;
  label: string;
  mount: PvMount;
  /** How common it is on the town's roofs (relative); 0: not on roofs (Agri-PV only). */
  roofWeight: number;
}

export const PV_PROFILES: PvProfile[] = [
  { id: "s30", label: "south, 30°", mount: { kind: "fixed", tiltDeg: 30, azimuthDeg: 180 }, roofWeight: 3 },
  { id: "s20", label: "south, 20°", mount: { kind: "fixed", tiltDeg: 20, azimuthDeg: 180 }, roofWeight: 2 },
  { id: "s45", label: "south, 45°", mount: { kind: "fixed", tiltDeg: 45, azimuthDeg: 180 }, roofWeight: 1 },
  { id: "s10", label: "south, 10° (flat roof)", mount: { kind: "fixed", tiltDeg: 10, azimuthDeg: 180 }, roofWeight: 1.5 },
  { id: "sse35", label: "south-south-east, 35°", mount: { kind: "fixed", tiltDeg: 35, azimuthDeg: 157 }, roofWeight: 1 },
  { id: "ssw35", label: "south-south-west, 35°", mount: { kind: "fixed", tiltDeg: 35, azimuthDeg: 203 }, roofWeight: 1 },
  { id: "se30", label: "south-east, 30°", mount: { kind: "fixed", tiltDeg: 30, azimuthDeg: 135 }, roofWeight: 2 },
  { id: "sw30", label: "south-west, 30°", mount: { kind: "fixed", tiltDeg: 30, azimuthDeg: 225 }, roofWeight: 2 },
  { id: "se20", label: "south-east, 20°", mount: { kind: "fixed", tiltDeg: 20, azimuthDeg: 135 }, roofWeight: 1 },
  { id: "sw20", label: "south-west, 20°", mount: { kind: "fixed", tiltDeg: 20, azimuthDeg: 225 }, roofWeight: 1 },
  { id: "ese40", label: "east-south-east, 40°", mount: { kind: "fixed", tiltDeg: 40, azimuthDeg: 112 }, roofWeight: 0.6 },
  { id: "wsw40", label: "west-south-west, 40°", mount: { kind: "fixed", tiltDeg: 40, azimuthDeg: 248 }, roofWeight: 0.6 },
  { id: "e30", label: "east, 30°", mount: { kind: "fixed", tiltDeg: 30, azimuthDeg: 90 }, roofWeight: 1.2 },
  { id: "w30", label: "west, 30°", mount: { kind: "fixed", tiltDeg: 30, azimuthDeg: 270 }, roofWeight: 1.2 },
  { id: "ew10", label: "east and west, 10° (flat roof)", mount: { kind: "eastWest", tiltDeg: 10 }, roofWeight: 2 },
  { id: "s60", label: "south, 60°", mount: { kind: "fixed", tiltDeg: 60, azimuthDeg: 180 }, roofWeight: 0.3 },
  // Agri-PV (config/agriPv.ts):
  { id: "vertical", label: "vertical rows facing east and west", mount: { kind: "vertical" }, roofWeight: 0 },
  { id: "overhead", label: "fixed rows facing south, 20°", mount: { kind: "fixed", tiltDeg: 20, azimuthDeg: 180 }, roofWeight: 0 },
  { id: "tracking", label: "rows tracking the sun", mount: { kind: "tracking", maxAngleDeg: 45 }, roofWeight: 0 },
];

// Light: the share of the sky's light that comes diffuse rather than straight from the sun — little on
// a clear day, all of it under full overcast; what the ground reflects (albedo); and what the back of
// a bifacial panel makes of the light it gets, against its front (less in vertical rows, where the
// next row shades it).
export const PV_DIFFUSE_SHARE_CLEAR = 0.12;
export const PV_ALBEDO = 0.2;
export const PV_BIFACIALITY = 0.6;
