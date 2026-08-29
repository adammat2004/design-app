import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PATTERN_ORIGIN,
  DesignElementSchema,
  patternAnchor,
  type DesignElement,
} from './concepts.js';
import { readPlanDocument } from './document.js';
import { MATERIALS } from './materials.js';
import {
  MATERIAL_PATTERNS,
  MM_PER_METRE,
  hasPattern,
  materialPattern,
  modulePitchMetres,
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
  it('describes 600 × 600 slab paving', () => {
    expect(materialPattern('stone-pavers')).toEqual({
      patternType: 'grid',
      moduleSize: { w: 600, h: 600 },
      jointWidth: 10,
    });
  });

  it('answers null for a material with no pattern', () => {
    // Still water and powder-coated steel have no texture worth drawing at 1:100.
    expect(materialPattern('formal-pool')).toBeNull();
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
    const known = new Set(Object.values(MATERIALS).flatMap((list) => list.map((m) => m.id)));

    for (const id of Object.keys(MATERIAL_PATTERNS)) {
      expect(known.has(id as never), `${id} is not in MATERIALS`).toBe(true);
    }
  });

  it('quotes its dimensions in millimetres and converts once', () => {
    const pattern = materialPattern('stone-pavers')!;

    // 600 mm slab on a 10 mm joint is a 0.61 m pitch — what a costing pass divides an area by.
    expect(modulePitchMetres(pattern)).toEqual({ x: 0.61, y: 0.61 });
    expect(MM_PER_METRE).toBe(1000);
  });
});
