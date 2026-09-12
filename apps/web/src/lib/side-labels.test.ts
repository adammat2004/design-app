import { describe, expect, it } from 'vitest';
import {
  computeZones,
  rectangleHouse,
  SiteSectionSchema,
  type SiteSection,
} from '@garden-studio/schema';
import { describeSide, describeWall, sideLabel, wallLabel } from './side-labels';

/** A 20 x 16 m plot with the house in the middle, drawn clockwise from the origin. */
function site(overrides: Partial<SiteSection> = {}): SiteSection {
  return SiteSectionSchema.parse({
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 20, y: 0 },
      { id: 'v3', x: 20, y: 16 },
      { id: 'v4', x: 0, y: 16 },
    ],
    closed: true,
    house: rectangleHouse({ x: 10, y: 8 }, 8, 6),
    ...overrides,
  });
}

describe('describeSide', () => {
  it('names the top side the back, as the zone label on the canvas does', () => {
    expect(describeSide(site(), 'v1')).toBe('back');
  });

  it('names the bottom side the front and the returns left and right', () => {
    const s = site();
    expect(describeSide(s, 'v3')).toBe('front');
    expect(describeSide(s, 'v2')).toBe('right');
    expect(describeSide(s, 'v4')).toBe('left');
  });

  /**
   * The bug this exists to stop: the canvas writes "Back garden" across the top zone, and the
   * panel used to call that same strip "Left side" because it asked `gardenDirection`, which
   * infers the garden from where the most plot lies and lands on a side when the house is centred.
   * Two labels for one piece of ground, two inches apart on screen.
   */
  it('agrees with the zone label drawn over the same ground', () => {
    const s = site();
    const zones = computeZones(
      s.vertices.map(({ x, y }) => ({ x, y })),
      s.house,
    );

    // The back zone's centroid is above the house; the side nearest it is the one called `back`.
    const back = zones.find((zone) => zone.id === 'back');
    expect(back).toBeDefined();
    expect(back!.centroid.y).toBeLessThan(s.house!.centre.y);
    expect(describeSide(s, 'v1')).toBe('back');
  });

  it('follows the house round when it is rotated', () => {
    // Bearing 270 is the back; turned 90° clockwise that is bearing 0, which is +x — so the back
    // is now the right-hand fence and the front is the left, exactly as the zone labels move.
    const turned = site({ house: { ...rectangleHouse({ x: 10, y: 8 }, 8, 6), rotation: 90 } });
    expect(describeSide(turned, 'v2')).toBe('back');
    expect(describeSide(turned, 'v4')).toBe('front');
  });

  it('says a side faces the street when the user has said so, whatever else it is', () => {
    expect(describeSide(site({ streetEdgeVertexId: 'v1' }), 'v1')).toBe('faces-street');
  });

  it('has nothing to say without a house to look out from', () => {
    expect(describeSide(site({ house: null }), 'v1')).toBeNull();
    expect(sideLabel(null)).toBeNull();
  });

  it('never reaches for a compass point', () => {
    const s = site();
    for (const vertex of s.vertices) {
      expect(sideLabel(describeSide(s, vertex.id))).not.toMatch(/north|south|east|west/i);
    }
  });
});

describe('describeWall', () => {
  it('names the wall facing the back garden', () => {
    // `rectangleHouse` runs clockwise from the top-left, so w0 is the top wall.
    expect(describeWall(site(), 'w0')).toBe('back');
  });

  it('calls the front wall the street-facing one once the street is known', () => {
    const s = site({ streetEdgeVertexId: 'v3' });
    expect(describeWall(s, 'w2')).toBe('faces-street');
    // Without the street it is simply the front, which is still true and says less.
    expect(describeWall(site(), 'w2')).toBe('front');
  });

  it('has nothing to say about a wall that is not there', () => {
    expect(describeWall(site(), 'w9')).toBeNull();
    expect(wallLabel(null)).toBeNull();
  });
});
