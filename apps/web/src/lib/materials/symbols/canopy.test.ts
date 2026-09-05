import { describe, expect, it } from 'vitest';
import { pointInPolygon, polygonArea, type Point } from '@garden-studio/schema';
import { beamLines, canopyCrown, canopyRing, canopySpriteBox, firePitRings,
  CANOPY_OFFSET_RATIO,
  TRUNK_RADIUS_RATIO,
  trunkAndCanopy,
} from './canopy';

const centre: Point = { x: 5, y: 4 };

describe('canopySpriteBox', () => {
  it('is stable for one tree, like the ring', () => {
    const ratio = () => 1;
    expect(canopySpriteBox(centre, 1.6, 'tree-1', 6, ratio)).toEqual(
      canopySpriteBox(centre, 1.6, 'tree-1', 6, ratio),
    );
  });

  it('puts the furthest opaque pixel exactly on the radius', () => {
    /*
     * Load-bearing for the same reason `canopyRing` is inscribed: the placer erodes by exactly the
     * radius, so a sprite whose leaves reach past it is a tree over the fence that the geometry
     * says is inside. A sprite that stops short is scaled up to meet the circle.
     */
    for (const ratio of [0.86, 1, 1.03]) {
      const box = canopySpriteBox(centre, 1.6, 'tree-1', 3, () => ratio);
      expect(box.halfWidth * ratio).toBeCloseTo(1.6, 9);
    }
  });

  it('picks a variant within the family and turns the crown', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 40; i += 1) {
      const box = canopySpriteBox(centre, 1.6, `tree-${i}`, 4, () => 1);
      expect(box.variant).toBeGreaterThanOrEqual(0);
      expect(box.variant).toBeLessThan(4);
      expect(box.rotation).toBeGreaterThanOrEqual(0);
      expect(box.rotation).toBeLessThan(Math.PI * 2);
      seen.add(box.variant);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('refuses to blow a dot up into a tree', () => {
    // A ratio far under one means the model drew something small in a big frame.
    const box = canopySpriteBox(centre, 1.6, 'tree-1', 1, () => 0.1);
    expect(box.halfWidth).toBeLessThanOrEqual(1.6 / 0.5 + 1e-9);
  });
});

describe('canopyRing', () => {
  it('is stable for one tree, so a canopy does not reshuffle on pan', () => {
    // The same property the surface patterns hold, and the most visible place to lose it.
    expect(canopyRing(centre, 1.6, 'tree-1')).toEqual(canopyRing(centre, 1.6, 'tree-1'));
  });

  it('gives two trees different outlines', () => {
    expect(canopyRing(centre, 1.6, 'tree-1')).not.toEqual(canopyRing(centre, 1.6, 'tree-2'));
  });

  it('stays inside the radius the placer reserved for it', () => {
    /*
     * Load-bearing. The generator erodes the placement region by exactly this radius, so a lobe
     * reaching past it would put a canopy over the fence that the validator then refuses.
     */
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      for (const point of canopyRing(centre, 1.6, seed)) {
        expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeLessThanOrEqual(1.6 + 1e-9);
      }
    }
  });

  it('does not fold through its own centre', () => {
    // A lobe shorter than the centre would cross the outline and draw a bow-tie.
    for (const point of canopyRing(centre, 1.6, 'tree-1')) {
      expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeGreaterThan(0.5);
    }
  });

  it('reads as round rather than as a polygon', () => {
    const ring = canopyRing(centre, 2, 'tree-1');
    // Comfortably more than the four or five points that would read as a drawn shape.
    expect(ring.length).toBeGreaterThanOrEqual(9);
  });
});

describe('canopyCrown', () => {
  it('sits inside the canopy it lights', () => {
    const canopy = canopyRing(centre, 1.6, 'tree-1');
    const crown = canopyCrown(centre, 1.6, 'tree-1');

    expect(polygonArea(crown)).toBeLessThan(polygonArea(canopy));
    for (const point of crown) {
      expect(pointInPolygon(point, canopy)).toBe(true);
    }
  });

  it('is offset towards the light rather than centred', () => {
    // Centred, it would read as a ring; offset, it reads as the lit top of one object.
    const crown = canopyCrown(centre, 1.6, 'tree-1');
    const mean = crown.reduce(
      (sum, point) => ({ x: sum.x + point.x / crown.length, y: sum.y + point.y / crown.length }),
      { x: 0, y: 0 },
    );

    expect(Math.hypot(mean.x - centre.x, mean.y - centre.y)).toBeGreaterThan(0.1);
  });
});

describe('firePitRings', () => {
  it('draws a rim inside the pit and a flame inside the rim', () => {
    const { rim, flame } = firePitRings(centre, 1.4);

    for (const point of rim) {
      expect(Math.hypot(point.x - centre.x, point.y - centre.y)).toBeLessThan(1.4);
    }
    expect(polygonArea(flame)).toBeGreaterThan(0);
    expect(polygonArea(flame)).toBeLessThan(polygonArea(rim));
  });
});

describe('beamLines', () => {
  it('spans the shorter side, the way a real beam does', () => {
    // 4 m wide, 2 m deep: beams run across the 2 m depth, so each is 2 m long.
    const beams = beamLines(centre, 4, 2, 0);

    expect(beams.length).toBeGreaterThan(0);
    for (const [start, end] of beams) {
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(4, 6);
    }
  });

  it('turns with the structure', () => {
    const straight = beamLines(centre, 4, 2, 0);
    const turned = beamLines(centre, 4, 2, 90);

    expect(turned).not.toEqual(straight);
    expect(turned.length).toBe(straight.length);
  });

  it('stays within the footprint', () => {
    const footprint: Point[] = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 5 },
      { x: 3, y: 5 },
    ];

    for (const [start, end] of beamLines(centre, 4, 2, 0)) {
      expect(pointInPolygon(start, footprint)).toBe(true);
      expect(pointInPolygon(end, footprint)).toBe(true);
    }
  });
});

describe('the trunk', () => {
  /**
   * The failure the first numbers had, and it is the kind that survives a review: the mark was
   * computed, drawn, and completely covered by the canopy on top of it. An offset smaller than the
   * trunk's own radius means no trunk is ever visible, so the whole depth cue does nothing while
   * looking, in the code, exactly as though it works.
   */
  it('offsets the canopy further than the trunk is wide, or nothing shows', () => {
    expect(CANOPY_OFFSET_RATIO).toBeGreaterThan(TRUNK_RADIUS_RATIO);
  });

  it('leaves the trunk on the element’s own point and moves the canopy', () => {
    const centre = { x: 100, y: 100 };
    const light = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };
    const stand = trunkAndCanopy(centre, 50, light);

    // The point is where the placer put the tree and where the validator checked it.
    expect(stand.trunk).toEqual(centre);
    // The canopy moves away from the light, so the trunk shows on the lit side.
    expect(stand.canopy.x).toBeGreaterThan(centre.x);
    expect(stand.canopy.y).toBeGreaterThan(centre.y);
  });

  it('keeps a trunk at least a pixel wide however small the tree', () => {
    const light = { x: -1, y: 0 };
    expect(trunkAndCanopy({ x: 0, y: 0 }, 2, light).trunkRadius).toBeGreaterThanOrEqual(1);
  });
});
