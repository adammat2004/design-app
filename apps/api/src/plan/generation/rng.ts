/**
 * mulberry32. Small, fast, and deterministic given a seed.
 *
 * `Math.random` would make the generator untestable, and would mean regenerating a concept could
 * not be trusted to produce something genuinely different rather than the same garden again.
 */
export function makeRng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per-concept seed. The concept's index is folded in with a prime stride so regenerating slot 2
 * cannot silently produce what slot 1 already shows.
 */
export function conceptSeed(documentSeed: number, index: number): number {
  return documentSeed + index * 7919;
}

/**
 * Seeds for `ST_GeneratePoints`, which needs a positive integer and is the one piece of
 * randomness that lives in SQL. Stepping per call keeps successive placements in one concept from
 * sampling the identical point set.
 */
export function sqlSeed(base: number, step: number): number {
  return Math.abs((base + step * 104729) % 2147483647) + 1;
}
