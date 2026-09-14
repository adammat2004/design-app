import { describe, expect, it } from 'vitest';
import { conceptSeed, makeRng, mix, sqlSeed } from './rng.js';

/**
 * The seeding, and the one property that is easy to get wrong.
 *
 * Determinism is a requirement rather than a nicety here — "Regenerate" has to mean "roll again",
 * and a concept the user chose has to be the concept they get — so every derivation has to be
 * reproducible *and* distinct from its neighbours.
 */
describe('seeds', () => {
  it('gives each concept slot its own stream', () => {
    const seeds = [0, 1, 2].map((index) => conceptSeed(11, index));
    expect(new Set(seeds).size).toBe(3);
  });

  /**
   * The trap `mix` exists for. A linear stride cannot be nested: `conceptSeed` adds a prime per
   * step, so candidate 2 of brief 0 would be candidate 0 of brief 2, and two different layouts
   * would sample the identical points.
   */
  it('cannot nest conceptSeed, which is why mix exists', () => {
    expect(conceptSeed(conceptSeed(11, 0), 2)).toBe(conceptSeed(11, 2));
    expect(mix(conceptSeed(11, 0), 2)).not.toBe(mix(conceptSeed(11, 2), 0));
  });

  it('keeps every nested seed distinct across briefs and candidates', () => {
    const seen = new Set<number>();
    for (let brief = 0; brief < 3; brief += 1) {
      for (let candidate = 0; candidate < 64; candidate += 1) {
        seen.add(mix(conceptSeed(11, brief), candidate));
      }
    }
    expect(seen.size).toBe(3 * 64);
  });

  it('is stable: the same inputs give the same seed', () => {
    expect(mix(12345, 7)).toBe(mix(12345, 7));
    expect(sqlSeed(99, 3)).toBe(sqlSeed(99, 3));
  });

  it('produces a usable generator from a mixed seed', () => {
    const rng = makeRng(mix(11, 4));
    const draws = Array.from({ length: 5 }, () => rng());
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
    expect(new Set(draws).size).toBe(5);
  });
});
