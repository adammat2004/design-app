import { describe, expect, it } from 'vitest';
import { resolvePattern } from './palette';
import { layerSeed, resolveLayers } from './layers';

const MATERIAL = resolvePattern('stone-pavers');
if (!MATERIAL) throw new Error('stone-pavers must have a pattern manifest for these tests');

describe('resolveLayers', () => {
  /**
   * The invariant every stack has to keep, whatever it adds on top.
   *
   * Layer 0 is the ground: the only layer allowed to be opaque across the whole surface, and the
   * one the material's own pattern and joint colour belong to. A resolver that put something else
   * first would change what a surface *is* rather than what is drawn on it, and the schedule,
   * the cost index and the quantities all read the material — not the stack.
   */
  it('leaves a surface that is not a bed as the one entry it always was', () => {
    /*
     * `stone-pavers` is paving, so it takes the single-layer path. The invariant that matters for
     * it is unchanged: the material's own pattern, palette and joint colour are what get drawn,
     * because the schedule, the cost index and the quantities all read the material.
     */
    expect(resolveLayers(MATERIAL)).toHaveLength(1);
    expect(resolveLayers(MATERIAL)[0]!.entry).toBe(MATERIAL);
    expect(resolveLayers(MATERIAL)[0]!.assets).toBeUndefined();
  });

  it('is pure, so the raster cache key names the style rather than the stack', () => {
    expect(resolveLayers(MATERIAL)).toEqual(resolveLayers(MATERIAL));
  });
});

describe('layerSeed', () => {
  /**
   * A one-layer stack must draw exactly what a seeded surface drew before layers existed. Salting
   * layer 0 would change every tone in the app on the day the plumbing landed, which is precisely
   * the ambiguity the byte-identical gate exists to avoid.
   */
  it('leaves the ground layer’s seed alone', () => {
    expect(layerSeed('surface-a', 0)).toBe('surface-a');
  });

  /**
   * Two layers sharing a pattern would otherwise place their units in identical positions, and the
   * upper would simply hide the lower — a bed of two plantings drawn as a bed of one.
   */
  it('separates the layers above it', () => {
    const seeds = [0, 1, 2, 3].map((index) => layerSeed('surface-a', index));

    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it('keeps two surfaces apart at every level of the stack', () => {
    for (const index of [0, 1, 2]) {
      expect(layerSeed('surface-a', index)).not.toBe(layerSeed('surface-b', index));
    }
  });
});
