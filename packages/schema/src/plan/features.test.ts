import { describe, expect, it } from 'vitest';
import {
  geometryClearsHouse,
  geometryFitsInside,
  geometryIsLegal,
  type PlanGeometry,
} from './features.js';

/**
 * The two constraints, tested apart, because they are no longer the same rule.
 *
 * `geometryIsLegal` is containment alone: a patio attached to the back wall is the ordinary case
 * for a hand-drawn plan, and the house is painted over whatever runs under it. The house test
 * survives as `geometryClearsHouse`, which the *generator* asks — a composed concept must not lay
 * a terrace or a border across the footprint — so both halves need pinning, and pinning
 * separately is the point.
 */

/** A 20 x 16 plot with an 8 x 6 house in the middle: x 6-14, y 5-11. */
const BOUNDARY = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

const HOUSE = [
  { x: 6, y: 5 },
  { x: 14, y: 5 },
  { x: 14, y: 11 },
  { x: 6, y: 11 },
];

function rect(centre: { x: number; y: number }, width: number, depth: number): PlanGeometry {
  return { kind: 'rect', centre, width, depth, rotation: 0 };
}

describe('geometryIsLegal', () => {
  it('accepts a shape sitting squarely on the house', () => {
    expect(geometryIsLegal(rect({ x: 10, y: 8 }, 4, 3), BOUNDARY)).toBe(true);
  });

  it('accepts a patio half under the back wall', () => {
    expect(geometryIsLegal(rect({ x: 10, y: 12 }, 6, 3), BOUNDARY)).toBe(true);
  });

  it('refuses a shape hanging over the fence', () => {
    expect(geometryIsLegal(rect({ x: 19, y: 8 }, 4, 3), BOUNDARY)).toBe(false);
  });

  it('accepts anything at all when there is no boundary to be inside of', () => {
    expect(geometryIsLegal(rect({ x: 100, y: 100 }, 4, 3), [])).toBe(true);
  });
});

describe('geometryClearsHouse', () => {
  it('refuses a shape that shares interior space with the house', () => {
    expect(geometryClearsHouse(rect({ x: 10, y: 8 }, 4, 3), HOUSE)).toBe(false);
  });

  /*
   * Touching is not overlapping, which is what lets the generator lay a terrace flush against
   * the wall it routed a path from. The TypeScript twin of `NOT ST_Touches`.
   */
  it('allows a shape flush against a wall', () => {
    expect(geometryClearsHouse(rect({ x: 10, y: 13 }, 6, 4), HOUSE)).toBe(true);
  });

  it('has nothing to say before a house has been placed', () => {
    expect(geometryClearsHouse(rect({ x: 10, y: 8 }, 4, 3), null)).toBe(true);
  });
});

describe('geometryFitsInside', () => {
  it('catches an edge crossing out through a concave notch with every corner inside', () => {
    // A C-shaped plot: the notch is the bite taken out of the right-hand side.
    const c = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 7 },
      { x: 10, y: 7 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];

    // Both corners are inside the arms; the middle of the shape spans the notch.
    expect(geometryFitsInside(rect({ x: 7, y: 5 }, 4, 6), c)).toBe(false);
  });
});
