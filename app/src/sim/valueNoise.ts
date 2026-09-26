/**
 * Smoothly-interpolated random noise — anchors at fixed points in time, hashed
 * deterministically per channel, cosine/smoothstep-blended between them. Used
 * anywhere a signal should wander realistically over some characteristic timescale
 * (a weather system lasting days, a passing cloud lasting minutes) rather than
 * jump discontinuously every sample like white noise would, while staying a pure
 * function of time — no state to simulate or remember.
 */

import { firstRandom, hashSeed, hashSeedFrom } from "./rng";

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** A channel's hashed identity, for valueNoiseFrom — worth keeping for a channel sampled often. */
export function noiseChannelSeed(channel: string): number {
  return hashSeed("weather-noise", channel);
}

/** A deterministic anchor value in [-1, 1] for the given noise channel and integer index. */
function noiseAnchor(channelSeed: number, index: number): number {
  return firstRandom(hashSeedFrom(channelSeed, String(index))) * 2 - 1;
}

/** Smoothly-interpolated noise in [-1, 1] — floor+subtract (not `%`) so it's well-defined for negative t too. */
export function valueNoise(channel: string, tMs: number, periodMs: number): number {
  return valueNoiseFrom(noiseChannelSeed(channel), tMs, periodMs);
}

/** valueNoise for a channel already hashed with noiseChannelSeed. */
export function valueNoiseFrom(channelSeed: number, tMs: number, periodMs: number): number {
  const idxFloat = tMs / periodMs;
  const idx = Math.floor(idxFloat);
  const frac = smoothstep(idxFloat - idx);
  const a = noiseAnchor(channelSeed, idx);
  const b = noiseAnchor(channelSeed, idx + 1);
  return a + (b - a) * frac;
}
