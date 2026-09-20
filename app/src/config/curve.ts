/**
 * Shared linear-interpolation-with-flat-extrapolation helper for every
 * "value as a function of X" curve in config/ (grid carbon intensity by
 * year, PV module efficiency by year, construction-era U-value by year) —
 * previously three separate, byte-for-byte-identical implementations, one
 * per curve. A curve is just an array of {x, y} sample points, sorted
 * ascending by x: below the first point or above the last, the curve holds
 * flat at that endpoint's y; in between, linear interpolation between the
 * two bracketing points. To recalibrate a curve, edit its points array in
 * the relevant config/*.ts file — add a point to sharpen a bend, move one to
 * shift a milestone, or extend the last point's x to push the flat region
 * further out.
 */

export interface CurvePoint {
  x: number;
  y: number;
}

export function interpolateCurve(points: CurvePoint[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i].x) {
      const a = points[i - 1];
      const b = points[i];
      const t = (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return last.y;
}
