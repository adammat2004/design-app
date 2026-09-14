import { describe, expect, it } from 'vitest';
import { rectToPolygon, type Point } from '@garden-studio/schema';
import { depthOf, extrude, lift, liftRing, RISE, visualBounds } from './projection';

const LIGHT: Point = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

/** A unit square, clockwise in this y-down frame. */
const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 2, y: 0 },
  { x: 2, y: 2 },
  { x: 0, y: 2 },
];

describe('the camera', () => {
  it('leaves the ground plane exactly where it is', () => {
    const point = { x: 3, y: 4 };
    expect(lift(point, 0)).toEqual(point);
    expect(liftRing(SQUARE, 0)).toEqual(SQUARE);
  });

  it('moves a height up the screen and nowhere else', () => {
    const lifted = lift({ x: 3, y: 4 }, 2);

    expect(lifted.x).toBe(3);
    expect(lifted.y).toBeCloseTo(4 - 2 * RISE, 10);
  });

  /**
   * The property that makes the drawing a plan rather than a model: the lift is a *translation*, so
   * a thing's top is its own footprint and two identical sheds show identical faces wherever they
   * stand. A perspective camera would fail this, which is why it is asserted rather than assumed.
   */
  it('lifts by a rigid translation, so the top is the footprint', () => {
    const top = liftRing(SQUARE, 3);

    expect(top).toHaveLength(SQUARE.length);
    for (const [index, point] of top.entries()) {
      expect(point.x).toBeCloseTo(SQUARE[index]!.x, 10);
      expect(SQUARE[index]!.y - point.y).toBeCloseTo(3 * RISE, 10);
    }
  });

  it('is about twelve degrees off vertical', () => {
    expect(RISE).toBeCloseTo(0.2126, 4);
  });
});

describe('extruding an outline', () => {
  it('shows the face the camera can see and no other', () => {
    const { faces } = extrude(SQUARE, 2, LIGHT);

    expect(faces).toHaveLength(1);
    // The near edge: y = 2, the largest y in the ring.
    expect(faces[0]!.base[0].y).toBe(2);
    expect(faces[0]!.base[1].y).toBe(2);
  });

  it('draws that face between the footprint edge and its lifted copy', () => {
    const [face] = extrude(SQUARE, 2, LIGHT).faces;

    const ys = face!.quad.map((point) => point.y);
    expect(Math.max(...ys)).toBeCloseTo(2, 10);
    expect(Math.min(...ys)).toBeCloseTo(2 - 2 * RISE, 10);
  });

  /**
   * The whole reason built structures are extruded rather than photographed.
   *
   * A single elevated raster has its lit side and its visible face baked in, so turning it turns
   * both. Here the geometry is recomputed from the outline, so whichever wall faces the viewer is
   * the wall that gets drawn — at every angle, including the ones between the right angles.
   */
  it('always shows the wall facing the viewer, at every rotation', () => {
    for (const rotation of [0, 30, 45, 90, 135, 180, 270, 315]) {
      const outline = rectToPolygon({ centre: { x: 5, y: 5 }, width: 4, depth: 2, rotation });

      const { faces } = extrude(outline, 2.3, LIGHT);

      expect(faces.length, `${rotation}°`).toBeGreaterThan(0);
      for (const face of faces) expect(face.normal.y, `${rotation}°`).toBeGreaterThan(0);

      // The near-most face must start on the outline's own near-most corner.
      const nearest = Math.max(...faces.map((face) => Math.max(face.base[0].y, face.base[1].y)));
      expect(nearest, `${rotation}°`).toBeCloseTo(Math.max(...outline.map((p) => p.y)), 6);
    }
  });

  /**
   * `rectToPolygon` winds one way and a hand-drawn boundary may wind the other. An outward normal
   * that is silently inward puts every visible face on the far side of the building — geometry that
   * looks plausible, which is worse than geometry that is obviously broken.
   */
  it('finds the outside whichever way the ring is wound', () => {
    const clockwise = extrude(SQUARE, 2, LIGHT);
    const anticlockwise = extrude([...SQUARE].reverse(), 2, LIGHT);

    expect(anticlockwise.faces).toHaveLength(1);
    expect(anticlockwise.faces[0]!.normal.y).toBeGreaterThan(0);
    expect(anticlockwise.faces[0]!.base[0].y).toBe(clockwise.faces[0]!.base[0].y);
  });

  it('draws no face for a wall seen exactly edge-on', () => {
    const { faces } = extrude(SQUARE, 2, LIGHT);

    // The two side walls run up and down the screen; neither is a face this view can show.
    for (const face of faces) expect(Math.abs(face.normal.x)).toBeLessThan(1);
    expect(faces.every((face) => face.normal.y > 0)).toBe(true);
  });

  it('has nothing to draw for something flat on the ground', () => {
    expect(extrude(SQUARE, 0, LIGHT).faces).toEqual([]);
    expect(extrude(SQUARE, 0, LIGHT).top).toEqual(SQUARE);
  });

  it('shades a face by its own normal against the light', () => {
    const lit = extrude(SQUARE, 2, LIGHT).faces[0]!;
    const unlit = extrude(SQUARE, 2, { x: -LIGHT.x, y: -LIGHT.y }).faces[0]!;

    expect(lit.lit).toBeCloseTo(-unlit.lit, 10);
    // The near wall faces down the screen; a light from the upper left does not reach it.
    expect(lit.lit).toBeLessThan(0);
  });

  /**
   * A concave outline can have a near limb's face overlapping a far limb's. Filling them far to
   * near is what makes a painter with no depth buffer draw the right picture.
   */
  it('orders the faces of an L far to near', () => {
    const ell: Point[] = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 6, y: 3 },
      { x: 3, y: 3 },
      { x: 3, y: 6 },
      { x: 0, y: 6 },
    ];

    const { faces } = extrude(ell, 2.5, LIGHT);

    expect(faces.length).toBeGreaterThan(1);
    const depths = faces.map((face) => Math.max(face.base[0].y, face.base[1].y));
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it('leaves the footprint untouched', () => {
    const outline = SQUARE.map((point) => ({ ...point }));
    const { footprint } = extrude(outline, 4, LIGHT);

    expect(footprint).toEqual(SQUARE);
    expect(outline).toEqual(SQUARE);
    expect(footprint).not.toBe(outline);
  });
});

describe('what a lifted thing occupies', () => {
  it('covers its footprint and the height above it', () => {
    const bounds = visualBounds(SQUARE, 4);

    expect(bounds.minX).toBe(0);
    expect(bounds.width).toBe(2);
    expect(bounds.minY).toBeCloseTo(-4 * RISE, 10);
    expect(bounds.length).toBeCloseTo(2 + 4 * RISE, 10);
  });

  it('is the footprint alone for something on the ground', () => {
    expect(visualBounds(SQUARE, 0)).toEqual({ minX: 0, minY: 0, width: 2, length: 2 });
  });

  /**
   * Depth is about where a thing *stands*, never about how tall it is.
   *
   * Sorting by the visual bounds instead would put a tree behind the shed it stands in front of,
   * simply because the canopy reaches further up the screen — the classic way an oblique drawing
   * goes wrong, and it looks like a z-order bug rather than a sorting-key one.
   */
  it('sorts on where the thing stands, not on how tall it is', () => {
    expect(depthOf(SQUARE)).toBe(2);
    expect(depthOf(liftRing(SQUARE, 5))).toBeLessThan(depthOf(SQUARE));
    expect(visualBounds(SQUARE, 5).minY).toBeLessThan(0);
  });
});
