import { describe, expect, it } from 'vitest';
import { DesignElementSchema, type DesignElement } from './concepts.js';
import { HOUSE_HEIGHT, MIN_SHADOW_HEIGHT } from './heights.js';
import { projectShadow, shadowOccluders, shadowOffset, shadowRings } from './shadows.js';
import { rectangleHouse } from './site.js';
import type { ShadowCast } from './sun.js';

/** Sun due south, 45 degrees up: shadows fall due north at one metre per metre of height. */
const NOON: ShadowCast = { direction: { x: 0, y: -1 }, lengthPerMetre: 1 };

/** A 4 x 4 m square, wound clockwise in the plan's y-down frame. */
const SQUARE = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
  { x: 0, y: 4 },
];

describe('shadowOffset', () => {
  it('is the direction scaled by height times the ratio', () => {
    expect(shadowOffset(2, NOON)).toEqual({ x: 0, y: -2 });
    expect(shadowOffset(6, { direction: { x: 1, y: 0 }, lengthPerMetre: 0.5 })).toEqual({
      x: 3,
      y: 0,
    });
  });

  it('grows with height, which is the whole reason heights had to exist', () => {
    // A 1.8 m fence and a 6 m tree casting the same shadow was the defect that motivated the
    // height manifest. This is that defect, asserted against.
    const fence = shadowOffset(1.8, NOON);
    const tree = shadowOffset(6, NOON);

    expect(Math.abs(tree.y)).toBeGreaterThan(Math.abs(fence.y));
  });
});

describe('projectShadow', () => {
  it('translates the cap by exactly the offset', () => {
    const shadow = projectShadow(SQUARE, 2, NOON)!;

    expect(shadow.cap).toEqual([
      { x: 0, y: -2 },
      { x: 4, y: -2 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ]);
  });

  it('sweeps one quad per edge, joining each base edge to its cap edge', () => {
    const shadow = projectShadow(SQUARE, 2, NOON)!;

    expect(shadow.sides).toHaveLength(SQUARE.length);
    // The first quad walks base[0] to base[1], then back along cap[1] to cap[0].
    expect(shadow.sides[0]).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: -2 },
      { x: 0, y: -2 },
    ]);
  });

  it('closes the sweep, so the last quad wraps to the first vertex', () => {
    // Off-by-one here leaves a wedge missing from the shadow, which reads as a bite taken out
    // of it rather than as an obviously broken polygon.
    const shadow = projectShadow(SQUARE, 2, NOON)!;
    const last = shadow.sides.at(-1)!;

    expect(last[0]).toEqual(SQUARE.at(-1));
    expect(last[1]).toEqual(SQUARE[0]);
  });

  it('sends the noon shadow north, matching where the sun put it', () => {
    // The join between this module and the sun. If the shadow ever falls towards the sun, this
    // is where it shows up rather than as a plan that looks subtly wrong.
    const shadow = projectShadow(SQUARE, 3, NOON)!;

    for (const point of shadow.cap) {
      expect(point.y).toBeLessThan(0 + 4);
    }
    expect(Math.min(...shadow.cap.map((p) => p.y))).toBe(-3);
  });

  it('refuses anything too low to cast a shadow worth drawing', () => {
    expect(projectShadow(SQUARE, 0, NOON)).toBeNull();
    expect(projectShadow(SQUARE, MIN_SHADOW_HEIGHT - 0.001, NOON)).toBeNull();
    expect(projectShadow(SQUARE, MIN_SHADOW_HEIGHT, NOON)).not.toBeNull();
  });

  it('refuses an outline that is not a polygon', () => {
    expect(projectShadow([], 2, NOON)).toBeNull();
    expect(projectShadow([{ x: 0, y: 0 }], 2, NOON)).toBeNull();
    expect(
      projectShadow(
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        2,
        NOON,
      ),
    ).toBeNull();
  });

  it('refuses a sun at the zenith, which casts nothing', () => {
    const overhead: ShadowCast = { direction: { x: 0, y: -1 }, lengthPerMetre: 0 };

    expect(projectShadow(SQUARE, 5, overhead)).toBeNull();
  });

  /**
   * The architectural invariant, in miniature.
   *
   * `CLAUDE.md` says deleting the renderer leaves the plan dimensionally correct, which holds
   * today because nothing downstream of the geometry writes to it. The shadow pass is the first
   * code in this project to do real geometry on its way to being drawn, so it is the first place
   * that property could quietly stop being true.
   */
  it('does not mutate the outline it was given', () => {
    const outline = SQUARE.map((point) => ({ ...point }));
    const before = JSON.stringify(outline);

    projectShadow(outline, 4, NOON);

    expect(JSON.stringify(outline)).toBe(before);
  });

  it('hands back the base by reference without copying it, and never writes through it', () => {
    const outline = SQUARE.map((point) => ({ ...point }));
    const shadow = projectShadow(outline, 4, NOON)!;

    expect(shadow.base).toBe(outline);
    // The cap must be fresh points, not the same objects shifted in place.
    expect(shadow.cap[0]).not.toBe(outline[0]);
  });
});

describe('shadowRings', () => {
  it('lists every ring once, base first and cap last', () => {
    const shadow = projectShadow(SQUARE, 2, NOON)!;
    const rings = shadowRings(shadow);

    expect(rings).toHaveLength(2 + SQUARE.length);
    expect(rings[0]).toBe(shadow.base);
    expect(rings.at(-1)).toBe(shadow.cap);
  });

  it('is stable, because rendered output is compared byte for byte', () => {
    const shadow = projectShadow(SQUARE, 2, NOON)!;

    expect(JSON.stringify(shadowRings(shadow))).toBe(JSON.stringify(shadowRings(shadow)));
  });
});

describe('shadowOccluders', () => {
  const element = (over: Partial<DesignElement>): DesignElement =>
    DesignElementSchema.parse({
      id: 'e1',
      category: 'planting-bed',
      role: 'feature',
      zone: 'back',
      shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 2, depth: 2, rotation: 0 },
      ...over,
    });

  it('puts the house first, at the house height', () => {
    // Usually the largest shadow in the garden, and the reason the seating is where it is.
    const house = rectangleHouse({ x: 10, y: 4 }, 8, 6);
    const occluders = shadowOccluders([], house);

    expect(occluders).toHaveLength(1);
    expect(occluders[0]!.height).toBe(HOUSE_HEIGHT);
    expect(occluders[0]!.outline.length).toBeGreaterThanOrEqual(4);
  });

  it('leaves out everything that lies flat on the ground', () => {
    // Paving, gravel, lawn and water are all at or below grade. Dropping them here is what keeps
    // the occluder set small enough for a separate shadow layer to be cheap.
    const flat = shadowOccluders(
      [
        element({ id: 'a', category: 'paved-area', material: 'stone-pavers' }),
        element({ id: 'b', category: 'lawn', material: 'standard-turf' }),
        element({ id: 'c', category: 'gravel-mulch', material: 'bark-mulch' }),
        element({ id: 'd', category: 'water-feature', material: 'formal-pool' }),
      ],
      null,
    );

    expect(flat).toEqual([]);
  });

  it('includes planting, resolving each one to its own height', () => {
    const occluders = shadowOccluders(
      [
        element({ id: 'hedge', material: 'hedging' }),
        element({ id: 'cover', material: 'ground-cover' }),
      ],
      null,
    );

    expect(occluders.map((o) => o.height)).toEqual([1.8, 0.25]);
  });

  it('skips hidden elements', () => {
    // `hidden` means the user took it out of the drawing. A thing you cannot see casting a
    // shadow you can is exactly the sort of artifact that makes people distrust the plan.
    const occluders = shadowOccluders(
      [element({ id: 'hedge', material: 'hedging', hidden: true })],
      null,
    );

    expect(occluders).toEqual([]);
  });

  it('handles a tree, which is a point that tessellates to a ring', () => {
    const occluders = shadowOccluders(
      [
        element({
          id: 'tree',
          shape: { kind: 'point', at: { x: 8, y: 8 }, radius: 1.6 },
          height: 5.5,
        }),
      ],
      null,
    );

    expect(occluders).toHaveLength(1);
    expect(occluders[0]!.height).toBe(5.5);
    // circleRing, so a real polygon rather than the single point it started as.
    expect(occluders[0]!.outline.length).toBeGreaterThan(3);
  });

  it('lets an explicit height override the material, for things the material cannot know', () => {
    // A pergola and a raised bed are both structures built from softwood.
    const occluders = shadowOccluders(
      [
        element({ id: 'pergola', category: 'structure', material: 'softwood', height: 2.4 }),
        element({ id: 'raised-bed', category: 'structure', material: 'softwood', height: 0.45 }),
      ],
      null,
    );

    expect(occluders.map((o) => o.height)).toEqual([2.4, 0.45]);
  });
});
