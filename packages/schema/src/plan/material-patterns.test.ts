import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATTERN_ORIGIN,
  DesignElementSchema,
  patternAnchor,
  type DesignElement,
} from './concepts.js';
import { readPlanDocument } from './document.js';
import { EDGING_MATERIALS, MATERIALS, WALLING_MATERIALS } from './materials.js';
import {
  MATERIAL_PATTERNS,
  MM_PER_METRE,
  PATTERN_TYPES,
  PatternTypeSchema,
  hasPattern,
  isCountable,
  isModular,
  materialPattern,
  modulePitchMetres,
  packMeanUnitMetres,
  scatterForm,
  bondFor,
  bondOffset,
  unitsPerSquareMetre,
  waterSurface,
  type MaterialPattern,
} from './material-patterns.js';

const element = (overrides: Partial<DesignElement> = {}): DesignElement =>
  DesignElementSchema.parse({
    id: 'element-1',
    category: 'paved-area',
    role: 'feature',
    zone: 'back',
    shape: {
      kind: 'polygon',
      points: [
        { x: 2, y: 3 },
        { x: 6, y: 3 },
        { x: 6, y: 7 },
      ],
    },
    ...overrides,
  });

describe('patternAnchor', () => {
  it('resolves an unanchored surface to the plan origin', () => {
    /*
     * Not the shape's own bounding box, deliberately. Anchoring each surface to its own corner
     * would guarantee two touching patios *miss* at the seam; one shared origin makes continuous
     * courses the default and re-anchoring an explicit decision.
     */
    expect(patternAnchor(element())).toEqual({ origin: DEFAULT_PATTERN_ORIGIN, rotation: 0 });
    expect(DEFAULT_PATTERN_ORIGIN).toEqual({ x: 0, y: 0 });
  });

  it('gives two unanchored surfaces the same grid', () => {
    const a = element({ id: 'a' });
    const b = element({
      id: 'b',
      shape: {
        kind: 'rect',
        centre: { x: 20, y: 20 },
        width: 4,
        depth: 3,
        rotation: 0,
      },
    });

    expect(patternAnchor(a)).toEqual(patternAnchor(b));
  });

  it('uses the stored anchor once a surface has one', () => {
    const anchored = element({ pattern: { origin: { x: 1.5, y: 2 }, rotation: 30 } });

    expect(patternAnchor(anchored)).toEqual({ origin: { x: 1.5, y: 2 }, rotation: 30 });
  });

  it('defaults the rotation but not the origin', () => {
    // Rotation is optional within the object; an anchored surface must say where it is anchored.
    const parsed = DesignElementSchema.parse({
      ...element(),
      pattern: { origin: { x: 1, y: 1 } },
    });

    expect(patternAnchor(parsed).rotation).toBe(0);
    expect(() => DesignElementSchema.parse({ ...element(), pattern: { rotation: 30 } })).toThrow();
  });
});

describe('backwards compatibility', () => {
  it('parses a stored document written before the field existed', () => {
    /*
     * The field is optional precisely so no migration is needed. If this ever goes red, every plan
     * already in the database has stopped loading.
     */
    const stored = {
      version: 1,
      unit: 'm',
      layout: {
        elements: [
          {
            id: 'element-1',
            category: 'paved-area',
            role: 'fill',
            fillKind: 'base',
            zone: 'back',
            material: 'stone-pavers',
            shape: {
              kind: 'polygon',
              points: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
              ],
            },
          },
        ],
      },
    };

    const document = readPlanDocument(stored);
    const [restored] = document.layout.elements;

    expect(restored).toBeDefined();
    expect(restored!.pattern).toBeUndefined();
    expect(patternAnchor(restored!)).toEqual({ origin: DEFAULT_PATTERN_ORIGIN, rotation: 0 });
  });
});

describe('the pattern manifest', () => {
  it('describes riven sandstone as the mixed pack it is sold as', () => {
    /*
     * A single 600 × 600 square on a `random` bond before. The bond was doing the work the sizes
     * should have: random coursing gives the varying vertical joint that is the signature of laid
     * stone, but with one unit size a patio still read as a chequerboard however small the module.
     */
    expect(materialPattern('stone-pavers')).toEqual({
      patternType: 'pack',
      courses: [300, 450],
      lengths: [300, 450, 600],
      jointWidth: 10,
    });
  });

  it('quotes a garden slab, not a utility flag', () => {
    // 900 × 600 before, which is a real product and the wrong one: the coarsest thing the app drew.
    expect(materialPattern('concrete')).toEqual({
      patternType: 'grid',
      moduleSize: { w: 400, h: 400 },
      jointWidth: 8,
      bond: 'running',
    });
  });

  it('answers null for a material with no pattern', () => {
    /*
     * `formal-pool` used to be here. It has a manifest now — a still one, `rippleSpacing: 0`,
     * because a formal pool is meant to read as a mirror and that is a design statement rather
     * than an absence. Powder-coated steel genuinely has no texture worth drawing at 1:100.
     */
    expect(materialPattern('powder-coated-steel')).toBeNull();
    expect(materialPattern(undefined)).toBeNull();
    expect(materialPattern('not-a-material')).toBeNull();
    expect(hasPattern('stone-pavers')).toBe(true);
    expect(hasPattern('powder-coated-steel')).toBe(false);
  });

  it('covers every material a garden is mostly made of', () => {
    // The point of the union: the surfaces that dominate a plan by area must all be patterned, or
    // the plan still reads as flat colour however good the paving looks.
    for (const id of [
      'standard-turf',
      'mixed-border',
      'shrubs',
      'bark-mulch',
      'decorative-gravel',
      'timber-decking',
      'porcelain',
    ] as const) {
      expect(hasPattern(id), `${id} should be patterned`).toBe(true);
    }
  });

  it('draws planting dense enough for it to close up', () => {
    /*
     * `density × the mean unit's area` is the coverage a bed will be drawn at. Below 1 the plants
     * cannot touch even in principle and the bed reads as dots on soil — the failure the first
     * tuning pass had, and the reason these are drawn densities rather than planting schedules.
     *
     * Planting only. An aggregate is a *mass* whose ground is drawn in its own colour, so its
     * units are texture rather than cover and a low number there is correct; `palette.test.ts`
     * holds up the other half of that rule.
     */
    const planted = new Set(MATERIALS['planting-bed'].map((material) => material.id));

    for (const [id, pattern] of Object.entries(MATERIAL_PATTERNS)) {
      if (pattern.patternType !== 'scatter' || !planted.has(id as never)) continue;

      const mean = (pattern.sizeRange.min + pattern.sizeRange.max) / 2 / MM_PER_METRE;
      const coverage = pattern.density * Math.PI * (mean / 2) ** 2;

      expect(coverage, `${id} coverage`).toBeGreaterThan(1);
    }
  });

  it('only names materials that exist in the catalogue', () => {
    /*
     * The catalogue is in two halves and both count. `EDGING_MATERIALS` is deliberately outside
     * `MATERIALS` because edging is not an `ElementCategory` — a run is derived from the outline of
     * the bed it follows, so there is no element to give a category to. It is still a real product
     * with a real pattern, so a pattern naming one is not an orphan.
     */
    const known = new Set([
      ...Object.values(MATERIALS).flatMap((list) => list.map((m) => m.id)),
      ...EDGING_MATERIALS.map((m) => m.id),
      ...WALLING_MATERIALS.map((m) => m.id),
    ]);

    for (const id of Object.keys(MATERIAL_PATTERNS)) {
      expect(known.has(id as never), `${id} is in neither half of the catalogue`).toBe(true);
    }
  });

  it('quotes its dimensions in millimetres and converts once', () => {
    const pattern = materialPattern('porcelain')!;

    // 600 mm tile on a 5 mm joint is a 0.605 m pitch — what a costing pass divides an area by.
    expect(modulePitchMetres(pattern as never)).toEqual({ x: 0.605, y: 0.605 });
    expect(MM_PER_METRE).toBe(1000);
  });

  it('gives a pack a mean unit where a grid has a pitch', () => {
    const pack = materialPattern('stone-pavers')! as Extract<
      MaterialPattern,
      { patternType: 'pack' }
    >;

    // Lengths 0.31/0.46/0.61 average 0.46; courses 0.31/0.46 average 0.385.
    const unit = packMeanUnitMetres(pack);
    expect(unit.x).toBeCloseTo(0.46, 6);
    expect(unit.y).toBeCloseTo(0.385, 6);

    /*
     * Countable but not modular, and the distinction is the point: a pack has no single pitch, so
     * it cannot answer `modulePitchMetres` — but its members are real product dimensions and it is
     * sold by the area it covers, so its mean unit is a fact somebody can order from.
     */
    expect(isCountable(pack)).toBe(true);
    expect(isModular(pack)).toBe(false);
    expect(unitsPerSquareMetre(pack)).toBeCloseTo(1 / (unit.x * unit.y), 6);
  });
});

describe('scatterForm', () => {
  const scatter = (over = {}) => ({
    patternType: 'scatter' as const,
    density: 3,
    sizeRange: { min: 100, max: 200 },
    lobes: 8,
    ...over,
  });

  it('resolves an absent form to a blob, which is what every scatter did before', () => {
    // The manifest is hand-written literals that never go through `.parse()`, so a Zod default
    // would look like it applied and never fire. Resolving here is what makes it total.
    expect(scatterForm(scatter())).toBe('blob');
  });

  it('returns what was asked for', () => {
    expect(scatterForm(scatter({ form: 'tufted' }))).toBe('tufted');
    expect(scatterForm(scatter({ form: 'clipped-mass' }))).toBe('clipped-mass');
  });
});

describe('the forms the catalogue actually uses', () => {
  /*
   * Pinned because these are the two materials the form axis was introduced for. Looking at the
   * contact sheet was how the gap was found: every planting material drew the same round blob and
   * differed only in size, density and hue, so grasses read as pale cauliflower and a hedge read
   * as loose bobbles rather than a clipped mass.
   */
  it('draws ornamental grasses as a rosette, not a mound', () => {
    const pattern = materialPattern('ornamental-grasses')!;
    expect(pattern.patternType).toBe('scatter');
    expect(scatterForm(pattern as never)).toBe('tufted');
  });

  /**
   * A hedge is no longer a scatter at all, and that is the fix rather than a regression.
   *
   * `form: 'clipped-mass'` was the best a scatter could do: blobs on a grid, merged into one path.
   * It has no notion of which way the hedge runs, and every property that reads as a hedge is
   * directional — a stated width, capped ends, and one lit long edge. Without them it drew as
   * camouflage with pale holes, which is what a row of shrubs looks like from above and is exactly
   * what a clipped hedge is not.
   */
  it('draws a hedge as a run along its own line, not as a scatter', () => {
    const pattern = materialPattern('hedging')!;

    expect(pattern.patternType).toBe('hedge');
    if (pattern.patternType !== 'hedge') throw new Error('unreachable');

    // The crowns must overlap, or the hedge reads as a row of separate bushes.
    expect(pattern.pitch).toBeLessThan(pattern.crownSize);
  });

  it('leaves the aggregates as blobs, because a gravel chip is a blob', () => {
    for (const id of ['bark-mulch', 'decorative-gravel', 'play-bark', 'slate-chippings'] as const) {
      expect(scatterForm(materialPattern(id) as never)).toBe('blob');
    }
  });
});

describe('the bond', () => {
  /**
   * A resolver rather than a Zod default, because `MATERIAL_PATTERNS` is hand-written literals
   * that never go through `.parse()` — the trap `scatterForm` and `patternAnchor` exist to avoid.
   * These pin that the two defaults are what each pattern drew before the field existed.
   */
  it('defaults a grid to stack and a board to running, so nothing changed on landing', () => {
    expect(bondFor({ patternType: 'grid', moduleSize: { w: 600, h: 600 }, jointWidth: 10 })).toBe(
      'stack',
    );
    expect(bondFor({ patternType: 'board', moduleSize: { w: 3600, h: 145 }, jointWidth: 6 })).toBe(
      'running',
    );
  });

  it('takes the stated bond when there is one', () => {
    expect(
      bondFor({
        patternType: 'grid',
        moduleSize: { w: 600, h: 600 },
        jointWidth: 10,
        bond: 'third',
      }),
    ).toBe('third');
  });

  const never = () => {
    throw new Error('a deterministic bond must not draw from the course generator');
  };

  it('lines every course up on a stack bond', () => {
    expect([0, 1, 2, 3].map((row) => bondOffset('stack', row, never))).toEqual([0, 0, 0, 0]);
  });

  it('alternates a running bond by half a module', () => {
    expect([0, 1, 2, 3].map((row) => bondOffset('running', row, never))).toEqual([0, 0.5, 0, 0.5]);
  });

  it('repeats a third bond every three courses', () => {
    expect([0, 1, 2, 3].map((row) => bondOffset('third', row, never))).toEqual([
      0,
      1 / 3,
      2 / 3,
      0,
    ]);
  });

  /**
   * Negative rows are not hypothetical: `gridRange` indexes from the *pattern origin*, which is the
   * plan origin, so any surface above or left of it has them. `%` on a negative number is negative
   * in JavaScript, and an offset of −⅓ shifts a course the wrong way.
   */
  it('handles a course above the pattern origin', () => {
    expect(bondOffset('third', -1, never)).toBeCloseTo(2 / 3, 10);
    expect(bondOffset('running', -1, never)).toBe(0.5);
  });

  /**
   * Quantised to eighths. A continuous offset leaves slivers at the clip edge that read as badly
   * cut stone, and a mason setting out random coursed work is working to a module anyway.
   */
  it('quantises a random bond to eighths', () => {
    for (const value of [0, 0.13, 0.5, 0.99]) {
      const offset = bondOffset('random', 3, () => value);
      expect(offset * 8).toBeCloseTo(Math.round(offset * 8), 10);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(1);
    }
  });
});

describe('the water surface', () => {
  /**
   * The axis that finally separated the four water materials. `rippleSpacing` alone could not: a
   * formal pool and a water bowl are both perfectly still, so they resolved to the same two
   * numbers and drew the same picture.
   */
  it('tells all four apart', () => {
    const surfaces = (['naturalistic-pond', 'formal-pool', 'rill', 'water-bowl'] as const).map(
      (id) => {
        const pattern = materialPattern(id);
        if (!pattern || pattern.patternType !== 'water') throw new Error(`${id} must be water`);
        return waterSurface(pattern);
      },
    );

    expect(new Set(surfaces).size).toBe(4);
  });

  /** A material that states no surface draws what its ripple spacing already implied. */
  it('falls back to what the ripple spacing meant', () => {
    expect(waterSurface({ patternType: 'water', rippleSpacing: 0 })).toBe('reflective');
    expect(waterSurface({ patternType: 'water', rippleSpacing: 200 })).toBe('planted');
  });
});

describe('PatternTypeSchema', () => {
  /*
   * Derived from the union's discriminator rather than hand-written. This enum listed four types
   * while the union had grown to seven, so anything validating a manifest entry's type against it
   * would have rejected `hedge`, `pads` and `water` — patterns the renderer draws every day.
   */
  it('covers every member of the pattern union', () => {
    expect([...PATTERN_TYPES].sort()).toEqual(
      ['board', 'grid', 'hedge', 'pack', 'pads', 'scatter', 'stripe', 'water'].sort(),
    );
  });

  it('parses the type of every entry in the manifest', () => {
    for (const [id, pattern] of Object.entries(MATERIAL_PATTERNS)) {
      expect(
        { id, parsed: PatternTypeSchema.safeParse(pattern.patternType).success },
        `${id} draws as ${pattern.patternType}`,
      ).toEqual({ id, parsed: true });
    }
  });
});
