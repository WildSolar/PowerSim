/**
 * Small deterministic PRNG utilities. Every simulated entity (a dwelling's fridge,
 * a dwelling's lighting circuit) derives its behavior from a seed hashed out of its
 * identity (building EGID + dwelling id + device name), so the same entity always
 * produces the same behavior across sessions, and — later — so an on-demand detail
 * view can regenerate an entity's real time series without needing to have
 * simulated it continuously in the background.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a string hash -> 32-bit unsigned seed. */
export function hashSeed(...parts: string[]): number {
  return continueHash(FNV_OFFSET_BASIS, parts);
}

/** Continues a hash with more parts: hashSeedFrom(hashSeed(a, b), c) === hashSeed(a, b, c) (FNV-1a
 * has no finalisation step). For hot paths that hash many seeds sharing a long prefix — a
 * dwelling's identity plus a device name, then a day or bucket index — so the prefix is hashed once
 * rather than on every call. */
export function hashSeedFrom(prefix: number, ...parts: string[]): number {
  return continueHash(prefix, parts);
}

function continueHash(start: number, parts: string[]): number {
  let h = start;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      h ^= part.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/** mulberry32: a fast, small, deterministic PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The first value mulberry32(seed) would produce — the same number, without allocating a generator.
 * For the many places that only ever take one draw from a seed. */
export function firstRandom(seed: number): number {
  const a = ((seed | 0) + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Deterministic pseudo-random float in [0, 1) for a given seed and integer "time bucket". */
export function bucketRandom(seed: number, bucket: number): number {
  return firstRandom(seed ^ Math.imul(bucket + 1, 0x9e3779b1));
}
