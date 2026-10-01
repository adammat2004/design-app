import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import { localFrame, type DesignElement, type SiteSection } from '@garden-studio/schema';
import {
  broadleafCrown,
  coniferCrown,
  shrubCrown,
  treeShape,
  tuftGeometry,
} from './nature-geometry';
import { sunInFrame } from './sun-3d';

const pergola = (rotation = 0): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  symbol: 'pergola',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 3, depth: 3, rotation },
});

function extent(geometry: BufferGeometry) {
  geometry.computeBoundingBox();
  return geometry.boundingBox!;
}

describe('crowns', () => {
  it('are built once and reused, the same every time', () => {
    expect(broadleafCrown(1)).toBe(broadleafCrown(1));
    expect(broadleafCrown(1)).not.toBe(broadleafCrown(2));
  });

  /** Every crown is a unit shape the plant is scaled from, so its size is the plant's own. */
  it('span exactly one unit each way, so a plant is the size the plan says', () => {
    for (const geometry of [broadleafCrown(0), coniferCrown(0), shrubCrown(0), tuftGeometry(0)]) {
      const box = extent(geometry);
      expect(Math.max(box.max.x - box.min.x, box.max.z - box.min.z)).toBeCloseTo(2, 5);
      expect(box.max.y - box.min.y).toBeCloseTo(2, 5);
      // Shaded dark underneath and light on top.
      expect(geometry.getAttribute('color')).toBeDefined();
    }
  });

  it('put a tree’s crown within its canopy and its top at its height, on a trunk that meets it', () => {
    const shape = treeShape('oak', 'tree-deciduous', 2.5, 7, 0.3);
    expect(shape.form).toBe('broadleaf');
    expect(shape.crown.across).toBe(2.5);
    expect(shape.crown.y + shape.crown.up).toBeCloseTo(7);
    expect(shape.stems[0]!.height).toBeGreaterThan(shape.crown.y - shape.crown.up);
    expect(treeShape('yew', 'tree-evergreen', 1.6, 6, 0.2).form).toBe('conifer');
    expect(treeShape('birch', 'tree-multistem', 1.75, 4, 0.2).stems).toHaveLength(3);
  });
});

describe('the sun in 3D', () => {
  const site = { location: null, orientation: 0 } as unknown as SiteSection;

  /** With no location, the plan's conventional top-left light: up and over, never below the ground. */
  it('is the plan’s drawing light where the site has no location, turned into the frame', () => {
    const [x, y, z] = sunInFrame(site, localFrame(pergola())!);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(y).toBeGreaterThan(0.8);
    // Top-left on the plan is −x and −y in plan, so −X and −Z in the frame of an unturned pergola.
    expect(x).toBeLessThan(0);
    expect(z).toBeLessThan(0);
  });

  it('turns with the structure, so the same sun falls the same way on the ground', () => {
    const straight = sunInFrame(site, localFrame(pergola(0))!);
    const turned = sunInFrame(site, localFrame(pergola(90))!);
    // A quarter turn of the structure is a quarter turn of the sun in its frame.
    expect(turned[0]).toBeCloseTo(straight[2]);
    expect(turned[2]).toBeCloseTo(-straight[0]);
    expect(turned[1]).toBeCloseTo(straight[1]);
  });
});
