import { describe, expect, it } from 'vitest';
import type { BufferGeometry } from 'three';
import {
  elementOutline,
  localFrame,
  type DesignElement,
  type SiteSection,
} from '@garden-studio/schema';
import { resolveLayers } from '../materials/layers';
import { resolvePattern } from '../materials/palette';
import { buildPlants } from '../render/plants';
import {
  bedPlants,
  broadleafCrown,
  coniferCrown,
  postsAlong,
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

const border: DesignElement = {
  id: 'bed-1',
  category: 'planting-bed',
  role: 'fill',
  fillKind: 'accent',
  zone: 'back',
  material: 'mixed-border',
  shape: {
    kind: 'polygon',
    cornerRadius: 0,
    points: [
      { x: 12, y: 8 },
      { x: 15, y: 8 },
      { x: 15, y: 13 },
      { x: 12, y: 13 },
    ],
  },
};

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

describe('the plants in a bed', () => {
  /** A bed in 3D is planted exactly as the plan plants it. */
  it('stand where the plan’s own planting puts them, turned into the structure’s frame', () => {
    for (const rotation of [0, 30]) {
      const frame = localFrame(pergola(rotation))!;
      const found = bedPlants(border, [border], frame, 50);
      const material = resolvePattern(border.material)!;
      const planned = buildPlants(
        border,
        resolveLayers(material, border),
        elementOutline(border),
        [],
      );
      expect(found.length).toBe(planned.length);
      const first = planned[0]!;
      const local = frame.toLocal(first.at);
      const match = found.find((plant) => plant.id === first.id)!;
      expect(match.at.x).toBeCloseTo(local.x);
      expect(match.at.z).toBeCloseTo(local.z);
      expect(match.spread).toBe(first.spread);
    }
  });

  it('are cut to the window', () => {
    const frame = localFrame(pergola())!;
    const all = bedPlants(border, [border], frame, 50);
    const near = bedPlants(border, [border], frame, 3);
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(all.length);
    for (const plant of near)
      expect(Math.abs(plant.at.x) - plant.spread / 2).toBeLessThanOrEqual(3);
  });
});

describe('a boundary’s posts', () => {
  it('stand at both ends and no further apart than the spacing', () => {
    const posts = postsAlong(
      { start: { x: 0, z: 0 }, end: { x: 5, z: 0 }, inward: { x: 0, z: 1 } },
      1.8,
    );
    expect(posts[0]).toEqual({ x: 0, z: 0 });
    expect(posts.at(-1)).toEqual({ x: 5, z: 0 });
    expect(posts).toHaveLength(4);
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
