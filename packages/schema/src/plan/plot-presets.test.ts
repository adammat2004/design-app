import { describe, expect, it } from 'vitest';
import { polygonArea, polygonIsSimple, type Point } from '../geometry/primitives.js';
import {
  DEFAULT_LSHAPE_PLOT,
  DEFAULT_RECTANGLE_PLOT,
  isUsableLShape,
  isUsableRectangle,
  lShapePlotOutline,
  matchLShapePlot,
  matchRectanglePlot,
  rectanglePlotOutline,
} from './plot-presets.js';
import { checkPlotSanity } from './sanity.js';

describe('rectanglePlotOutline', () => {
  it('runs clockwise from the origin in the plan frame', () => {
    expect(rectanglePlotOutline({ width: 12, depth: 8 })).toEqual([
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 8 },
      { x: 0, y: 8 },
    ]);
  });

  it('measures the area it says it does', () => {
    expect(polygonArea(rectanglePlotOutline({ width: 12, depth: 8 }))).toBeCloseTo(96);
  });

  it('anchors wherever it is asked to', () => {
    const outline = rectanglePlotOutline({ width: 4, depth: 3 }, { x: 10, y: 20 });

    expect(outline[0]).toEqual({ x: 10, y: 20 });
    expect(outline[2]).toEqual({ x: 14, y: 23 });
  });
});

describe('lShapePlotOutline', () => {
  it('is a rectangle with the bottom-right corner taken out', () => {
    const spec = { width: 14, depth: 10, returnWidth: 5, returnDepth: 4 };

    // 140 m² less a 5 x 4 notch.
    expect(polygonArea(lShapePlotOutline(spec))).toBeCloseTo(120);
    expect(lShapePlotOutline(spec)).toHaveLength(6);
  });

  it('does not cross itself', () => {
    expect(polygonIsSimple(lShapePlotOutline(DEFAULT_LSHAPE_PLOT))).toBe(true);
  });
});

describe('the defaults', () => {
  /*
   * The whole point of opening on a preset: the starting plot has to be one the sanity band is
   * happy with, or step 1 greets the user with a warning about a shape they did not draw.
   */
  it('are plots the sanity band has nothing to say about', () => {
    expect(checkPlotSanity(rectanglePlotOutline(DEFAULT_RECTANGLE_PLOT), 'm')).toBeNull();
    expect(checkPlotSanity(lShapePlotOutline(DEFAULT_LSHAPE_PLOT), 'm')).toBeNull();
  });

  it('are usable specs', () => {
    expect(isUsableRectangle(DEFAULT_RECTANGLE_PLOT)).toBe(true);
    expect(isUsableLShape(DEFAULT_LSHAPE_PLOT)).toBe(true);
  });
});

describe('isUsableLShape', () => {
  it('refuses a return that swallows the plot', () => {
    expect(isUsableLShape({ width: 6, depth: 6, returnWidth: 6, returnDepth: 2 })).toBe(false);
    expect(isUsableLShape({ width: 6, depth: 6, returnWidth: 2, returnDepth: 6 })).toBe(false);
  });

  it('refuses a return with nothing in it', () => {
    expect(isUsableLShape({ width: 14, depth: 10, returnWidth: 0, returnDepth: 4 })).toBe(false);
  });

  it('leaves at least a metre of limb on both axes', () => {
    // A metre of limb exactly is allowed; anything thinner is a sliver with a handle on it.
    expect(isUsableLShape({ width: 6, depth: 6, returnWidth: 5, returnDepth: 5 })).toBe(true);
    expect(isUsableLShape({ width: 6, depth: 6, returnWidth: 5.5, returnDepth: 5 })).toBe(false);
    expect(isUsableLShape({ width: 6, depth: 6, returnWidth: 5, returnDepth: 5.5 })).toBe(false);
  });
});

describe('matchRectanglePlot', () => {
  it('recognises what it built', () => {
    expect(matchRectanglePlot(rectanglePlotOutline({ width: 12, depth: 8 }))).toEqual({
      width: 12,
      depth: 8,
    });
  });

  it('recognises one drawn from any corner', () => {
    const outline = rectanglePlotOutline({ width: 12, depth: 8 });

    for (let offset = 0; offset < 4; offset += 1) {
      const rotated = outline.map((_, i) => outline[(i + offset) % 4]!);
      expect(matchRectanglePlot(rotated)).toEqual({ width: 12, depth: 8 });
    }
  });

  /*
   * The derived-not-stored consequence, stated as a test: a per-edge length edit slides one
   * corner and the shape stops being a rectangle, so the width and depth fields go away rather
   * than editing a shape that is no longer there.
   */
  it('stops recognising a rectangle once one corner has moved', () => {
    const nudged: Point[] = [
      { x: 0, y: 0 },
      { x: 9, y: 0 },
      { x: 12, y: 8 },
      { x: 0, y: 8 },
    ];

    expect(matchRectanglePlot(nudged)).toBeNull();
  });

  it('refuses an anticlockwise outline rather than reversing it under the user', () => {
    const clockwise = rectanglePlotOutline({ width: 12, depth: 8 });

    expect(matchRectanglePlot([...clockwise].reverse())).toBeNull();
  });

  it('refuses anything that is not four corners, or has no area', () => {
    expect(matchRectanglePlot(lShapePlotOutline(DEFAULT_LSHAPE_PLOT))).toBeNull();
    expect(
      matchRectanglePlot([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 15, y: 0 },
      ]),
    ).toBeNull();
  });
});

describe('matchLShapePlot', () => {
  it('recovers the spec it was built from', () => {
    expect(matchLShapePlot(lShapePlotOutline(DEFAULT_LSHAPE_PLOT))).toEqual(DEFAULT_LSHAPE_PLOT);
  });

  it('survives being anchored away from the origin', () => {
    const outline = lShapePlotOutline(DEFAULT_LSHAPE_PLOT, { x: 30, y: -12 });

    expect(matchLShapePlot(outline)).toEqual(DEFAULT_LSHAPE_PLOT);
  });

  it('stops recognising one once a corner has moved', () => {
    const outline = lShapePlotOutline(DEFAULT_LSHAPE_PLOT);
    const nudged = outline.map((point, i) => (i === 2 ? { ...point, x: point.x - 1 } : point));

    expect(matchLShapePlot(nudged)).toBeNull();
  });

  it('is not fooled by a rectangle with six corners on it', () => {
    const sixOnARectangle: Point[] = [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 8 },
      { x: 6, y: 8 },
      { x: 0, y: 8 },
    ];

    expect(matchLShapePlot(sixOnARectangle)).toBeNull();
  });
});
