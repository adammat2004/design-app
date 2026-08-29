import { describe, expect, it } from 'vitest';
import type { Point } from '@garden-studio/schema';
import { rectangleHouse } from '@/lib/house';
import { computeZones } from '@/lib/zones';
import { thumbnailGeometry } from './PropertyThumbnail';

/** A 20 m x 16 m plot, origin top-left, +y downwards. Same fixture the zone tests use. */
const PLOT: Point[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

const HOUSE = rectangleHouse({ x: 10, y: 8 }, 8, 6);
const ZONES = computeZones(PLOT, HOUSE);

/** Parses the SVG `points` attribute back into numbers. */
function coords(points: string): Point[] {
  return points.split(' ').map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });
}

describe('thumbnailGeometry', () => {
  it('draws nothing without a plot', () => {
    expect(thumbnailGeometry([], null, [], [])).toBeNull();
  });

  it('draws nothing from an unfinished outline', () => {
    expect(
      thumbnailGeometry(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
        ],
        HOUSE,
        ZONES,
        ['front'],
      ),
    ).toBeNull();
  });

  it('fits the plot inside the viewBox', () => {
    const plan = thumbnailGeometry(PLOT, HOUSE, ZONES, []);
    if (!plan) throw new Error('expected a plan');

    for (const point of coords(plan.outline)) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(240);
      expect(point.y).toBeLessThanOrEqual(150);
    }
  });

  it('keeps the plot to proportion — one scale across both axes', () => {
    const plan = thumbnailGeometry(PLOT, HOUSE, ZONES, []);
    if (!plan) throw new Error('expected a plan');

    const points = coords(plan.outline);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));

    // The plot is 20 x 16, so the drawn ratio must match 1.25 rather than stretching to fill.
    expect(width / height).toBeCloseTo(20 / 16, 5);
  });

  it('omits the house when step 1 has not placed one', () => {
    const plan = thumbnailGeometry(PLOT, null, [], []);
    if (!plan) throw new Error('expected a plan');

    expect(plan.house).toBeNull();
    expect(plan.houseAt).toBeNull();
  });

  it('puts the house label inside the plot', () => {
    const plan = thumbnailGeometry(PLOT, HOUSE, ZONES, []);
    if (!plan?.houseAt) throw new Error('expected a house');

    const outline = coords(plan.outline);
    expect(plan.houseAt.x).toBeGreaterThan(Math.min(...outline.map((p) => p.x)));
    expect(plan.houseAt.x).toBeLessThan(Math.max(...outline.map((p) => p.x)));
    expect(plan.houseAt.y).toBeGreaterThan(Math.min(...outline.map((p) => p.y)));
    expect(plan.houseAt.y).toBeLessThan(Math.max(...outline.map((p) => p.y)));
  });

  it('draws only the selected zones, in plan order rather than click order', () => {
    const plan = thumbnailGeometry(PLOT, HOUSE, ZONES, ['left', 'back', 'front']);
    if (!plan) throw new Error('expected a plan');

    expect(plan.zones.map((zone) => zone.id)).toEqual(['front', 'back', 'left']);
    expect(plan.zones.map((zone) => zone.label)).toEqual(['Front', 'Back', 'Left']);
  });

  it('ignores a tick for a zone the house has dissolved', () => {
    // A house spanning the full width leaves no side gardens to draw.
    const wide = rectangleHouse({ x: 10, y: 8 }, 20, 6);
    const plan = thumbnailGeometry(PLOT, wide, computeZones(PLOT, wide), ['left', 'right']);
    if (!plan) throw new Error('expected a plan');

    expect(plan.zones).toEqual([]);
  });

  it('keeps every zone label on screen', () => {
    const plan = thumbnailGeometry(PLOT, HOUSE, ZONES, ['front', 'back', 'left', 'right']);
    if (!plan) throw new Error('expected a plan');

    expect(plan.zones).toHaveLength(4);
    for (const zone of plan.zones) {
      expect(zone.at.x).toBeGreaterThan(0);
      expect(zone.at.y).toBeGreaterThan(0);
      expect(zone.at.x).toBeLessThan(240);
      expect(zone.at.y).toBeLessThan(150);
    }
  });
});
