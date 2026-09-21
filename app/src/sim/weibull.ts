/**
 * Weibull-distributed equipment lifetimes for stock renewal (renewal.ts) — the
 * standard choice for "wear-out" failure modeling (an increasing hazard rate,
 * unlike the constant hazard of an exponential distribution), parameterized by
 * its *mean* rather than the usual scale parameter so callers can just say "this
 * boiler lasts ~18 years on average" without knowing what a Weibull scale is.
 */

const DAY_MS = 24 * 60 * 60_000;
export const MIN_LIFETIME_MS = 30 * DAY_MS; // floor under every draw — guarantees forward progress in renewal.ts's chain loop

// Lanczos approximation of the gamma function (g=7, n=9) — needed to convert a
// target mean into the Weibull scale parameter (mean = scale * Gamma(1 + 1/shape)).
// Standard published coefficients; correct to ~15 significant digits.
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const xm1 = x - 1;
  let a = LANCZOS_COEFFICIENTS[0];
  const t = xm1 + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS_G + 2; i++) a += LANCZOS_COEFFICIENTS[i] / (xm1 + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, xm1 + 0.5) * Math.exp(-t) * a;
}

/** Inverse-CDF (quantile) sampling: `rng` supplies one uniform(0,1) draw. Clamped
 * to a small floor so a freak near-zero draw never produces a same-day renewal. */
export function weibullSample(rng: () => number, shape: number, meanValueMs: number): number {
  const scale = meanValueMs / gamma(1 + 1 / shape);
  const u = Math.min(0.999999, Math.max(0.000001, rng()));
  const raw = scale * Math.pow(-Math.log(1 - u), 1 / shape);
  return Math.max(MIN_LIFETIME_MS, raw);
}

/** For a system whose install date we don't actually know (every building's
 * *currently observed* GWR system, at game start): assume it's already some
 * random fraction of a typical service life into use — uniform(0, mean) — then
 * draw a full lifetime and return whatever's left of it. This is what makes the
 * very first renewals across the municipality spread out realistically (some
 * buildings' current systems are already near end-of-life, most aren't) rather
 * than every building's first renewal landing implausibly far in the future, as
 * a fresh "installed today" draw would. */
export function weibullAgedRemainder(ageRng: () => number, lifeRng: () => number, shape: number, meanValueMs: number): number {
  const assumedAgeMs = ageRng() * meanValueMs;
  const totalMs = weibullSample(lifeRng, shape, meanValueMs);
  return Math.max(MIN_LIFETIME_MS, totalMs - assumedAgeMs);
}

/** The statistically proper "how long is left" for something already `age` old: a lifetime
 * drawn from the distribution *conditional on having lasted that long*, so nothing is ever
 * overdue and there is no pile-up of immediate renewals. (weibullAgedRemainder above instead
 * floors an overdue item to the minimum lifetime — its long-standing behaviour for heating
 * and vehicles, kept as is because their calibration was tuned against it.) */
export function weibullConditionalRemainder(ageRng: () => number, lifeRng: () => number, shape: number, meanValueMs: number): number {
  const scale = meanValueMs / gamma(1 + 1 / shape);
  const assumedAgeMs = ageRng() * meanValueMs;
  const survivalAtAge = Math.exp(-Math.pow(assumedAgeMs / scale, shape));
  const u = Math.min(0.999999, Math.max(0.000001, lifeRng()));
  // Inverse CDF restricted to lifetimes beyond the assumed age.
  const totalMs = scale * Math.pow(-Math.log(survivalAtAge * (1 - u)), 1 / shape);
  return Math.max(MIN_LIFETIME_MS, totalMs - assumedAgeMs);
}
