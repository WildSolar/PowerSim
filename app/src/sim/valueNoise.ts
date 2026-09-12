/**
 * Smoothly-interpolated random noise — anchors at fixed points in time, hashed
 * deterministically per channel, cosine/smoothstep-blended between them. Used
 * anywhere a signal should wander realistically over some characteristic timescale
 * (a weather system lasting days, a passing cloud lasting minutes) rather than
 * jump discontinuously every sample like white noise would, while staying a pure
 * function of time — no state to simulate or remember.
 */

import { hashSeed, mulberry32 } from "./rng";

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A deterministic anchor value in [-1, 1] for the given noise channel and integer index. */
function noiseAnchor(channel: string, index: number): number {
  return mulberry32(hashSeed("weather-noise", channel, String(index)))() * 2 - 1;
}

/** Smoothly-interpolated noise in [-1, 1] — floor+subtract (not `%`) so it's well-defined for negative t too. */
export function valueNoise(channel: string, tMs: number, periodMs: number): number {
  const idxFloat = tMs / periodMs;
  const idx = Math.floor(idxFloat);
  const frac = smoothstep(idxFloat - idx);
  const a = noiseAnchor(channel, idx);
  const b = noiseAnchor(channel, idx + 1);
  return a + (b - a) * frac;
}
