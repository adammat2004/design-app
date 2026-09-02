import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  MATERIALS,
  MATERIAL_PATTERNS,
  type ElementCategory,
  type MaterialId,
} from '@garden-studio/schema';
import { MATERIAL_TONES, resolvePattern } from './palette';

/** Which category each material sits in, for the rules below that differ by category. */
const CATEGORY_BY_ID: Record<string, ElementCategory> = Object.fromEntries(
  Object.entries(MATERIALS).flatMap(([category, list]) =>
    list.map((material) => [material.id, category as ElementCategory]),
  ),
);
import { hexToRgb, rgbToCss, shiftBrightness } from './light';

describe('resolvePattern', () => {
  it('returns the full manifest for a material that has one', () => {
    const entry = resolvePattern('stone-pavers');

    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      id: 'stone-pavers',
      category: 'paved-area',
      pattern: {
        patternType: 'grid',
        moduleSize: { w: 600, h: 600 },
        jointWidth: 10,
      },
    });
    expect(entry!.palette.length).toBeGreaterThanOrEqual(3);
    expect(entry!.palette.length).toBeLessThanOrEqual(5);
  });

  it('returns null for a material with no pattern, which is the flat-fill path', () => {
    /*
     * `formal-pool` was here and is not any more: it has a manifest now, a deliberately still one.
     * Powder-coated steel and "existing, unchanged" genuinely have no texture at this scale and
     * should not be given one for the sake of completeness.
     */
    expect(resolvePattern('powder-coated-steel')).toBeNull();
    expect(resolvePattern('existing')).toBeNull();
  });

  it('gives every water material a manifest, still or moving', () => {
    // These four drew as a flat blue shape for the whole life of the renderer. Water is a focal
    // point, so it was the one obviously unfinished element on an otherwise finished plan.
    for (const id of ['naturalistic-pond', 'formal-pool', 'rill', 'water-bowl']) {
      expect(resolvePattern(id), id).not.toBeNull();
    }
  });

  it('returns null for an unknown or absent material rather than throwing', () => {
    // `DesignElement.material` is a plain string, so a stored document can carry anything.
    expect(resolvePattern(undefined)).toBeNull();
    expect(resolvePattern('reclaimed-yorkshire-flagstone')).toBeNull();
  });

  it('files every patterned material under its real category', () => {
    for (const id of Object.keys(MATERIAL_PATTERNS) as MaterialId[]) {
      const entry = resolvePattern(id);
      if (!entry) continue;

      expect(MATERIALS[entry.category].some((material) => material.id === id)).toBe(true);
    }
  });
});

describe('the two halves of the manifest', () => {
  it('gives every patterned material a set of tones', () => {
    /*
     * Geometry lives in the shared package and tones live here, so the two can fall out of step.
     * `resolvePattern` returns null when they do — which is safe, but silently unpatterns a
     * material somebody meant to pattern. This is the test that says so out loud.
     */
    for (const id of Object.keys(MATERIAL_PATTERNS) as MaterialId[]) {
      expect(MATERIAL_TONES[id], `${id} has a pattern but no tones`).toBeDefined();
    }
  });

  it('carries no product or brand names in the palette', () => {
    // Tones are abstract; matching a material to a real product is a separate lookup.
    for (const tones of Object.values(MATERIAL_TONES)) {
      for (const colour of [...tones.palette, tones.jointColour]) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('draws a modular pattern on a ground darker than every unit, so the courses read', () => {
    /*
     * Only the modular patterns. A mortar joint is a recess and has to be darker than the slab
     * either side of it, or the grid stops reading — but a scatter's ground is the *same stuff*
     * seen between the units, and for aggregates it is drawn from the middle of the material's own
     * palette on purpose. Requiring it to be darker there is what produced the first attempt's
     * gravel: sparse dots scattered on mud.
     */
    for (const [id, tones] of Object.entries(MATERIAL_TONES)) {
      const pattern = MATERIAL_PATTERNS[id as MaterialId];
      if (!pattern || (pattern.patternType !== 'grid' && pattern.patternType !== 'board')) continue;

      const joint = hexToRgb(tones.jointColour);
      const jointBrightness = joint.r + joint.g + joint.b;

      for (const colour of tones.palette) {
        const tone = hexToRgb(colour);
        expect(tone.r + tone.g + tone.b, `${id} · ${colour}`).toBeGreaterThan(jointBrightness);
      }
    }
  });

  it('keeps an aggregate ground inside its own material family', () => {
    /*
     * The complement of the rule above, and scoped to aggregates rather than to every scatter.
     *
     * Two kinds of material use the same renderer for opposite reasons. Gravel, bark and chippings
     * are a *mass*: the units are texture on a body of the same stuff, so the ground must sit
     * inside the palette's own range — contrast it and the material reads as sparse dots on mud,
     * which is exactly what the first tuning pass produced. Planting and meadow are *figure on
     * ground*: plants on soil, flowers in grass, where a darker ground is the whole point. Those
     * are covered by the coverage test in the renderer's suite instead.
     */
    const AGGREGATE_CATEGORIES: ElementCategory[] = ['gravel-mulch', 'paved-area'];

    const brightness = (hex: string) => {
      const { r, g, b } = hexToRgb(hex);
      return r + g + b;
    };

    for (const [id, tones] of Object.entries(MATERIAL_TONES)) {
      const pattern = MATERIAL_PATTERNS[id as MaterialId];
      if (!pattern || pattern.patternType !== 'scatter') continue;
      if (!AGGREGATE_CATEGORIES.includes(CATEGORY_BY_ID[id]!)) continue;

      const spread = tones.palette.map(brightness);
      const ground = brightness(tones.jointColour);

      expect(ground, `${id} ground`).toBeGreaterThanOrEqual(Math.min(...spread) - 25);
      expect(ground, `${id} ground`).toBeLessThanOrEqual(Math.max(...spread) + 25);
    }
  });
});

describe('colour maths', () => {
  it('reads both hex forms', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#dcdcd5')).toEqual({ r: 220, g: 220, b: 213 });
  });

  it('rejects anything that is not a colour', () => {
    expect(() => hexToRgb('rebeccapurple')).toThrow();
    expect(() => hexToRgb('#12345')).toThrow();
  });

  it('shifts brightness proportionally and clamps at the ends', () => {
    // Channels stay unrounded here — `rgbToCss` is where they become whole numbers.
    const brighter = shiftBrightness({ r: 100, g: 100, b: 100 }, 0.1);
    expect(brighter.r).toBeCloseTo(110, 6);
    expect(brighter.g).toBeCloseTo(110, 6);
    expect(brighter.b).toBeCloseTo(110, 6);

    expect(shiftBrightness({ r: 250, g: 250, b: 250 }, 0.5)).toEqual({ r: 255, g: 255, b: 255 });
    expect(shiftBrightness({ r: 10, g: 10, b: 10 }, -2)).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('shifts a dark tone and a light one by the same visual proportion', () => {
    // Multiplicative rather than additive: adding a flat amount would blow out the pale stones
    // and barely touch the dark ones, which is what makes a mixed palette shade inconsistently.
    const dark = shiftBrightness({ r: 60, g: 60, b: 60 }, 0.1);
    const light = shiftBrightness({ r: 200, g: 200, b: 200 }, 0.1);

    expect(dark.r / 60).toBeCloseTo(light.r / 200, 6);
  });

  it('rounds to whole channels on the way out', () => {
    expect(rgbToCss({ r: 10.4, g: 10.6, b: 10 })).toBe('rgb(10, 11, 10)');
  });
});

describe('a palette entry that is not a colour', () => {
  const pavers = MATERIAL_TONES['stone-pavers'];

  afterEach(() => {
    (MATERIAL_TONES as Record<string, unknown>)['stone-pavers'] = pavers;
    // `process.env.NODE_ENV` is readonly in Next's types, so assigning it fails the build even
    // though it works at runtime. `stubEnv` is vitest's supported way in and it typechecks.
    vi.unstubAllEnvs();
  });

  it('stops you at once while tuning, naming the material and the key', () => {
    // A typo in a hand-written manifest is a bug, and the person who can fix it is looking at the
    // file. Bisecting a palette by hand is the alternative.
    (MATERIAL_TONES as Record<string, unknown>)['stone-pavers'] = {
      ...pavers,
      palette: ['#dcdcd5', '#ff00', '#d5d6cf'],
    };

    expect(() => resolvePattern('stone-pavers')).toThrow(/stone-pavers\.palette\[1\]/);
  });

  it('names a bad joint colour too, not just the units', () => {
    (MATERIAL_TONES as Record<string, unknown>)['stone-pavers'] = {
      ...pavers,
      jointColour: 'grey',
    };

    expect(() => resolvePattern('stone-pavers')).toThrow(/stone-pavers\.jointColour/);
  });

  it('falls back rather than taking the canvas down in production', () => {
    /*
     * `hexToRgb` throws, the throw escapes through Konva's render, and with no error boundary
     * above it the whole plan vanishes. In front of an audience a slightly wrong grey is the
     * better answer — and it is only safe because this is a colour. The return-null-rather-than-
     * guess rule exists for geometry, where a guess misleads about where things are.
     */
    vi.stubEnv('NODE_ENV', 'production');
    (MATERIAL_TONES as Record<string, unknown>)['stone-pavers'] = {
      ...pavers,
      palette: ['#dcdcd5', 'not-a-colour'],
    };

    const resolved = resolvePattern('stone-pavers');

    expect(resolved).not.toBeNull();
    expect(resolved!.palette[1]).toBe('#8a8a8a');
  });
});
