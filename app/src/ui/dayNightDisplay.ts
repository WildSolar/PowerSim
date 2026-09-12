import { dayFraction, isSunRising } from "../sim/pv";

export interface DayNightStatus {
  icon: string;
  label: string;
  /** 0 (night) - 1 (day), the same smoothly-transitioning value the label's
   * thresholds are drawn from — exposed for callers that want a continuous cue
   * (a fading tint, an animated icon) rather than just the discrete label. */
  dayFraction: number;
}

export function dayNightStatus(simTimeMs: number): DayNightStatus {
  const frac = dayFraction(simTimeMs);
  if (frac <= 0.02) return { icon: "🌙", label: "Night", dayFraction: frac };
  if (frac >= 0.98) return { icon: "☀️", label: "Day", dayFraction: frac };
  return isSunRising(simTimeMs)
    ? { icon: "🌅", label: "Sunrise", dayFraction: frac }
    : { icon: "🌇", label: "Sunset", dayFraction: frac };
}
