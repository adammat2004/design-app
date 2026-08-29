import { describe, expect, it } from 'vitest';
import type { Point } from '../geometry/primitives.js';
import { checkPlotSanity, longestEdge, scalePolygonAbout, SCALE_DOWN_FACTOR } from './sanity.js';
import { houseSize, rectangleHouse, scaleHouseAbout } from './site.js';

/** A rectangle laid out from the origin, in the same +y-downwards frame as the plan. */
function rect(width: number, depth: number): Point[] {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: depth },
    { x: 0, y: depth },
  ];
}

describe('longestEdge', () => {
  it('walks the edge that closes the polygon', () => {
    // A triangle whose longest side is the wrap from the last vertex back to the first.
    const triangle: Point[] = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];

    expect(longestEdge(triangle)).toBeCloseTo(5);
  });

  it('is zero for a polygon with nothing to measure', () => {
    expect(longestEdge([])).toBe(0);
    expect(longestEdge([{ x: 1, y: 1 }])).toBe(0);
  });
});

describe('checkPlotSanity', () => {
  it('says nothing about an ordinary garden', () => {
    expect(checkPlotSanity(rect(12, 8), 'm')).toBeNull();
  });

  it('says nothing about a polygon that is still being drawn', () => {
    expect(checkPlotSanity([{ x: 0, y: 0 }], 'm')).toBeNull();
    expect(
      checkPlotSanity(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        'm',
      ),
    ).toBeNull();
  });

  /*
   * The plot that prompted the band: drawn at ten times its real size and accepted in silence.
   * Area is checked before edge length because it is the number that makes the mistake obvious.
   */
  it('catches the 113 x 74.5 m plot, and knows the fix clears it', () => {
    const warning = checkPlotSanity(rect(113, 74.5), 'm');

    expect(warning?.code).toBe('area-too-large');
    expect(warning?.headline).toContain('8419');
    expect(warning?.scaleDownHelps).toBe(true);
  });

  it('catches a long thin plot whose area is still in band', () => {
    // 700 m² is an ordinary area; a 70 m side is not an ordinary side.
    const warning = checkPlotSanity(rect(70, 10), 'm');

    expect(warning?.code).toBe('edge-too-long');
    expect(warning?.scaleDownHelps).toBe(true);
  });

  it('guards the low end too, and does not offer a fix that makes it worse', () => {
    const warning = checkPlotSanity(rect(2, 2), 'm');

    expect(warning?.code).toBe('area-too-small');
    expect(warning?.scaleDownHelps).toBe(false);
  });

  it('refuses to promise a fix when one step is not enough', () => {
    // Three orders of magnitude out: a tenth of this is still far outside the band.
    const warning = checkPlotSanity(rect(11300, 7450), 'm');

    expect(warning?.code).toBe('area-too-large');
    expect(warning?.scaleDownHelps).toBe(false);
  });

  it('reads the measurement in the user unit', () => {
    const warning = checkPlotSanity(rect(70, 10), 'ft');

    // 70 m is about 230 ft, and the sentence has to say so rather than quoting metres.
    expect(warning?.headline).toContain('229.7 ft');
  });
});

describe('scaling a plot down', () => {
  const factor = 1 / SCALE_DOWN_FACTOR;

  it('clears the warning that offered it', () => {
    const plot = rect(113, 74.5);
    const centre = { x: 56.5, y: 37.25 };

    expect(checkPlotSanity(scalePolygonAbout(plot, centre, factor), 'm')).toBeNull();
  });

  it('keeps the plot where it was', () => {
    const plot = rect(113, 74.5);
    const centre = { x: 56.5, y: 37.25 };
    const scaled = scalePolygonAbout(plot, centre, factor);

    // Scaling about the centroid moves the corners inwards, not the plot across the canvas.
    expect(scaled[0]!.x).toBeCloseTo(50.85);
    expect(scaled[2]!.x).toBeCloseTo(62.15);
  });

  /*
   * The obvious bug in a whole-plot rescale, and the reason `scaleHouseAbout` touches both
   * fields: a house whose outline is left at full size no longer fits the plot it is standing in.
   */
  it('shrinks the house itself, not only its position', () => {
    const house = rectangleHouse({ x: 60, y: 40 }, 8, 6);
    const scaled = scaleHouseAbout(house, { x: 56.5, y: 37.25 }, factor);

    expect(houseSize(scaled).width).toBeCloseTo(0.8);
    expect(houseSize(scaled).depth).toBeCloseTo(0.6);
    expect(scaled.centre.x).toBeCloseTo(56.85);
    expect(scaled.centre.y).toBeCloseTo(37.525);
  });

  it('leaves the house rotation alone', () => {
    const house = { ...rectangleHouse({ x: 60, y: 40 }, 8, 6), rotation: 37 };

    expect(scaleHouseAbout(house, { x: 0, y: 0 }, factor).rotation).toBe(37);
  });
});
