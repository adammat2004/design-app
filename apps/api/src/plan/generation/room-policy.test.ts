import { describe, expect, it } from 'vitest';
import {
  canTake,
  geometryOutline,
  polygonContainsPolygon,
  polygonsIntersect,
  type DesignElement,
} from '@garden-studio/schema';
import { ARCHETYPES } from './archetypes.js';
import { resolveConstraints } from './constraints.js';
import { furnishRoom } from './furnish.js';
import { circulationFor, roomSurface, wantsLoungeRoom } from './room-policy.js';
import { designedBeds } from './layout/beds.js';
import type { SketchRequest } from './layout/sketch.js';

const brief = {
  purpose: '',
  desiredFeatures: ['seating' as const],
  featuresOther: '',
  budget: 'high' as const,
  maintenance: 'medium' as const,
  style: 'modern' as const,
  styleOther: '',
};
const constraints = resolveConstraints(brief, ARCHETYPES[0]!, 180);
const boundary = [
  { x: -20, y: -20 },
  { x: 20, y: -20 },
  { x: 20, y: 20 },
  { x: -20, y: 20 },
];

describe('garden room policy', () => {
  it('uses a complementary terrace, lounge and fire-room palette deterministically', () => {
    const palette = ['primary', 'lounge', 'fire', 'utility'] as const;
    const surfaces = palette.map((purpose) => roomSurface(purpose, constraints, 0));
    expect(surfaces).toEqual(palette.map((purpose) => roomSurface(purpose, constraints, 0)));
    expect(new Set(surfaces.map((s) => s.material)).size).toBe(3);
    for (const surface of surfaces) expect(canTake(surface.category, surface.material)).toBe(true);
  });
  it('gives utility routes practical access and secondary paths a lighter footprint', () => {
    const utility = circulationFor('utility', constraints);
    const secondary = circulationFor('secondary', constraints);
    expect(utility.width).toBeGreaterThan(secondary.width);
    expect(utility.material).toBe('decorative-gravel');
    expect(secondary.material).toBe('stepping-stones');
    /*
     * Setts, not the terrace's slab. A route laid in the same paving as the patio it leaves reads
     * as a narrow patio; at the old 900 × 600 a 1.2 m path was barely one slab wide. Setts give a
     * path its own grain, which is how a plan tells a route from a surface at a glance.
     */
    expect(circulationFor('access', constraints).material).toBe('stone-setts');
  });
  it('keeps low-upkeep circulation continuous and does not add timber decking', () => {
    const low = { ...constraints, maintenance: 'low' as const };
    expect(circulationFor('secondary', low).material).toBe('decorative-gravel');
    expect(roomSurface('lounge', low, 0).material).not.toBe('timber-decking');
  });
  it('adds a lounge only when intent, budget, space and other rooms permit it', () => {
    expect(wantsLoungeRoom(['seating'], constraints)).toBe(true);
    expect(wantsLoungeRoom(['storage'], constraints)).toBe(false);
    expect(wantsLoungeRoom(['seating', 'play'], constraints)).toBe(false);
    expect(wantsLoungeRoom(['seating', 'pergola'], constraints)).toBe(false);
    expect(wantsLoungeRoom(['seating'], { ...constraints, budget: 'medium' })).toBe(false);
    expect(
      wantsLoungeRoom(['seating'], {
        ...constraints,
        scale: { ...constraints.scale, designedArea: 80 },
      }),
    ).toBe(false);
  });
});

describe('furnished rooms', () => {
  const make = (shape: DesignElement['shape'], feature: 'seating' | 'firePit') => {
    let id = 0;
    const host: DesignElement = {
      id: 'room',
      category: 'paved-area',
      role: 'feature',
      zone: 'back',
      shape,
    };
    const items = furnishRoom(host, feature, {
      index: 0,
      rng: () => 0.2,
      constraints,
      boundary,
      houseRing: null,
      nextId: () => `f${++id}`,
    });
    for (const item of items)
      expect(polygonContainsPolygon(geometryOutline(shape), geometryOutline(item.shape))).toBe(
        true,
      );
    for (let i = 0; i < items.length; i++)
      for (const other of items.slice(i + 1))
        expect(
          polygonsIntersect(geometryOutline(items[i]!.shape), geometryOutline(other.shape)),
        ).toBe(false);
    return items;
  };
  it('furnishes a rotated terrace with a main group and planters, all inside its footprint', () => {
    const shape = {
      kind: 'rect' as const,
      centre: { x: 0, y: 0 },
      width: 6,
      depth: 4.4,
      rotation: 32,
    };
    const items = make(shape, 'seating');
    expect(items.map((e) => e.symbol)).toEqual(['sofa-set', 'planter', 'planter']);
    expect(make(shape, 'seating')).toEqual(items);
  });
  it('gives a generous fire room seats, and shrinks the group honestly in a tiny room', () => {
    expect(
      make({ kind: 'point', at: { x: 0, y: 0 }, radius: 2 }, 'firePit').map((e) => e.symbol),
    ).toEqual(['fire-pit', 'bench', 'bench']);
    expect(make({ kind: 'point', at: { x: 0, y: 0 }, radius: 1.2 }, 'firePit')).toHaveLength(1);
  });
});

describe('designed planting bays', () => {
  const request: SketchRequest = {
    features: ['seating'],
    scale: 1,
    style: 'modern',
    lawnAllowed: true,
    gateSide: 'right',
    houseWallLength: 6,
    doorWidth: 2.4,
  };
  for (const width of [4, 6, 12, 22])
    for (const template of ['rectilinear', 'curved', 'formal'] as const) {
      it(`keeps a useful centre in a ${width} m ${template} garden`, () => {
        const room = { uMin: 0, uMax: 18, vMin: -width / 2, vMax: width / 2 };
        const terrace = { u0: 0, u1: 3, v0: -width / 2 + 0.2, v1: width / 2 - 0.2 };
        const beds = designedBeds(request, room, terrace, template);
        expect(designedBeds(request, room, terrace, template)).toEqual(beds);
        const outlines = beds.map((bed) =>
          bed.shape.kind === 'polygon'
            ? bed.shape.points.map((p) => ({ x: p.v, y: p.u }))
            : geometryOutline({
                kind: 'polygon',
                cornerRadius: 0,
                points: [
                  { x: bed.shape.rect.v0, y: bed.shape.rect.u0 },
                  { x: bed.shape.rect.v1, y: bed.shape.rect.u0 },
                  { x: bed.shape.rect.v1, y: bed.shape.rect.u1 },
                  { x: bed.shape.rect.v0, y: bed.shape.rect.u1 },
                ],
              }),
        );
        const centre = geometryOutline({
          kind: 'rect',
          centre: { x: 0, y: 8 },
          width: Math.min(2, width * 0.3),
          depth: 3,
          rotation: 0,
        });
        for (const ring of outlines) expect(polygonsIntersect(ring, centre)).toBe(false);
      });
    }
});
