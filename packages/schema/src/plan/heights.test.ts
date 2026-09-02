import { describe, expect, it } from 'vitest';
import { ElementCategorySchema } from './concepts.js';
import { MaterialIdSchema } from './materials.js';
import {
  CATEGORY_HEIGHTS,
  MATERIAL_HEIGHTS,
  MIN_SHADOW_HEIGHT,
  castsShadow,
  heightFor,
} from './heights.js';

describe('heightFor', () => {
  it('prefers an explicit height over everything else', () => {
    // A pergola and a raised bed are both `structure` and can both be softwood. Only the thing
    // that placed them knows which is which, so its answer has to win.
    expect(heightFor({ category: 'structure', material: 'softwood', height: 0.45 })).toBe(0.45);
  });

  it('prefers the material over the category when the material implies a form', () => {
    // Seven-fold difference inside one category — this is the whole reason the material tier
    // exists rather than a flat per-category table.
    expect(heightFor({ category: 'planting-bed', material: 'hedging' })).toBe(1.8);
    expect(heightFor({ category: 'planting-bed', material: 'ground-cover' })).toBe(0.25);
    expect(CATEGORY_HEIGHTS['planting-bed']).toBe(0.9);
  });

  it('falls through to the category for a material that implies no height', () => {
    // Softwood says nothing about how tall a thing is, so it is deliberately absent from
    // MATERIAL_HEIGHTS and must not shadow the category default.
    expect(heightFor({ category: 'structure', material: 'softwood' })).toBe(
      CATEGORY_HEIGHTS.structure,
    );
  });

  it('falls through to the category for an unknown material id', () => {
    // `DesignElement.material` is a plain string, not the enum, so a stored document can carry
    // an id the catalogue no longer has. That must resolve, not throw.
    expect(heightFor({ category: 'lawn', material: 'no-such-material' })).toBe(
      CATEGORY_HEIGHTS.lawn,
    );
  });

  it('resolves with no material at all', () => {
    expect(heightFor({ category: 'paved-area' })).toBe(0);
  });

  it('treats explicit zero as a real answer, not as absent', () => {
    // `?? ` on a numeric field would swallow this and hand back the category default instead.
    expect(heightFor({ category: 'structure', height: 0 })).toBe(0);
  });

  it('is total: every category resolves to a number', () => {
    for (const category of ElementCategorySchema.options) {
      const height = heightFor({ category });
      expect(Number.isFinite(height)).toBe(true);
      expect(height).toBeGreaterThanOrEqual(0);
    }
  });

  it('gives ground surfaces no height, so they are never occluders', () => {
    expect(heightFor({ category: 'paved-area' })).toBe(0);
    expect(heightFor({ category: 'gravel-mulch' })).toBe(0);
    expect(heightFor({ category: 'water-feature' })).toBe(0);
    expect(heightFor({ category: 'lawn' })).toBe(0);
  });
});

describe('the manifests themselves', () => {
  it('covers every element category', () => {
    // Exhaustive rather than partial, which is what makes heightFor total. TypeScript already
    // enforces this via Record<ElementCategory, number>; the test catches the case where the
    // enum grows and someone widens the type instead of filling in the value.
    for (const category of ElementCategorySchema.options) {
      expect(CATEGORY_HEIGHTS[category]).toBeTypeOf('number');
    }
  });

  it('keys every material override on a real material id', () => {
    // The failure this catches is a typo: a misspelled key is silently ignored by the lookup,
    // so the material quietly falls through to the category and a hedge is drawn 0.9 m tall
    // with nothing anywhere reporting a problem.
    const known = new Set<string>(MaterialIdSchema.options);

    for (const id of Object.keys(MATERIAL_HEIGHTS)) {
      expect(known.has(id), `${id} is not a material id`).toBe(true);
    }
  });
});

describe('castsShadow', () => {
  it('excludes flat ground surfaces', () => {
    expect(castsShadow({ category: 'paved-area', material: 'stone-pavers' })).toBe(false);
    expect(castsShadow({ category: 'lawn', material: 'standard-turf' })).toBe(false);
  });

  it('includes anything with real height', () => {
    expect(castsShadow({ category: 'planting-bed', material: 'hedging' })).toBe(true);
    expect(castsShadow({ category: 'structure', height: 2.4 })).toBe(true);
  });

  it('excludes things below the minimum, which is above zero on purpose', () => {
    // A 40 mm kerb has a computable shadow that is a fraction of a pixel at every zoom the plan
    // supports. Projecting and compositing it costs work to produce nothing visible.
    expect(MIN_SHADOW_HEIGHT).toBeGreaterThan(0);
    expect(castsShadow({ category: 'structure', height: 0.04 })).toBe(false);
    expect(castsShadow({ category: 'structure', height: MIN_SHADOW_HEIGHT })).toBe(true);
  });
});
