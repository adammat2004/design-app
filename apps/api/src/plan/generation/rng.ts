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

/**
 * A seed derived from another, without colliding with a neighbour's.
 *
 * `conceptSeed(base, k)` is `base + k * 7919`, which is fine once and wrong twice:
 * `conceptSeed(conceptSeed(seed, i), k)` equals `conceptSeed(seed, i + k)`, so candidate `k` of
 * brief `i` would share a seed with candidate 0 of brief `i + k`. A linear stride cannot be nested.
 *
 * This is the mulberry32 mixing step applied to the golden-ratio-scrambled pair, which is the same
 * arithmetic `makeRng` already trusts — so the nesting is safe at any depth and no new source of
 * randomness is introduced.
 */
export function mix(base: number, step: number): number {
  let t = (base ^ Math.imul(step + 1, 0x9e3779b9)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}
