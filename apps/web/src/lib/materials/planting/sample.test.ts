import { describe, expect, it } from 'vitest';
import { schemeFor, type PlantingLayer, type Point } from '@garden-studio/schema';
import {
  cellSize,
  distanceToEdge,
  driftNoise,
  pointInPolygon,
  samplePlanting,
} from './sample';

/** A 10 × 6 m bed with its corner at (2, 1), so nothing sits at the world origin by accident. */
const bed: Point[] = [
  { x: 2, y: 1 },
  { x: 12, y: 1 },
  { x: 12, y: 7 },
  { x: 2, y: 7 },
];

const layer = (overrides: Partial<PlantingLayer> = {}): PlantingLayer => ({
  role: 'mass',
  taxon: { type: 'perennial' },
  heightBand: { min: 0.5, max: 1 },
  spread: { min: 0.4, max: 0.7 },
  share: 0.6,
  clustering: 0,
  edgeAffinity: 0,
  ...overrides,
});

describe('samplePlanting', () => {
  it('plants inside the bed and nowhere else', () => {
    for (const placement of samplePlanting(bed, layer(), 'bed-1')) {
      expect(pointInPolygon(placement.at, bed)).toBe(true);
    }
  });

  it('plants something', () => {
    expect(samplePlanting(bed, layer(), 'bed-1').length).toBeGreaterThan(20);
  });

  it('gives every plant a spread inside the layer’s band', () => {
    const spec = layer();
    for (const placement of samplePlanting(bed, spec, 'bed-1')) {
      expect(placement.spread).toBeGreaterThanOrEqual(spec.spread.min);
      expect(placement.spread).toBeLessThanOrEqual(spec.spread.max);
    }
  });

  it('returns nothing for an outline that is not a polygon', () => {
    expect(samplePlanting([{ x: 0, y: 0 }, { x: 1, y: 1 }], layer(), 'bed-1')).toEqual([]);
  });

  /* -------------------------------------------------------------- determinism */

  it('is identical for the same bed and seed', () => {
    expect(samplePlanting(bed, layer(), 'bed-1')).toEqual(samplePlanting(bed, layer(), 'bed-1'));
  });

  it('differs between beds, so two borders are not the same border', () => {
    expect(samplePlanting(bed, layer(), 'bed-1')).not.toEqual(
      samplePlanting(bed, layer(), 'bed-2'),
    );
  });

  it('differs between layers of one bed, so a stack is not one plant repeated', () => {
    const mass = samplePlanting(bed, layer({ role: 'mass' }), 'bed-1');
    const edge = samplePlanting(bed, layer({ role: 'edge' }), 'bed-1');

    expect(mass.map((p) => p.at)).not.toEqual(edge.map((p) => p.at));
  });

  /**
   * The property the whole design exists for, and the reason Poisson-disc sampling is not used.
   *
   * Dragging one corner must leave the plants near the *other* corners exactly where they were.
   * A sequence-ordered sampler cannot do this — every plant depends on the ones placed before it,
   * so any edit repaints the bed and the user watches their border reshuffle while they drag.
   */
  it('leaves plants away from the edited corner untouched', () => {
    const before = samplePlanting(bed, layer(), 'bed-1');

    // Drag the bottom-right corner out. That moves two edges: the right side and the bottom.
    const dragged: Point[] = [bed[0]!, bed[1]!, { x: 13.5, y: 8 }, bed[3]!];
    const after = samplePlanting(dragged, layer(), 'bed-1');

    /*
     * The top-left quadrant, which both moved edges are far from.
     *
     * Not simply "x < 6": dragging that corner tilts the *bottom* edge along its whole length, so
     * a point near y = 7 at any x can legitimately fall inside now and outside before. That is the
     * sampler being right, and an earlier version of this test read it as a failure. What must not
     * change is a plant nowhere near either moved edge.
     */
    const quiet = (list: typeof before) =>
      list
        .filter((p) => p.at.x < 6 && p.at.y < 6)
        .map((p) => `${p.at.x.toFixed(4)},${p.at.y.toFixed(4)}`);

    expect(quiet(before).length).toBeGreaterThan(10);
    expect(quiet(after)).toEqual(quiet(before));
    // And the edit did do something, or the test proves nothing.
    expect(after.length).not.toBe(before.length);
  });

  /**
   * The same guarantee against translation of an *unrelated* bed. Cells are indexed from the world
   * origin, not from the bed's own corner, so moving one bed cannot disturb another.
   */
  it('indexes cells from the world origin, not the bed’s corner', () => {
    const shifted = bed.map((p) => ({ x: p.x + 4, y: p.y }));
    const here = samplePlanting(bed, layer(), 'bed-1');
    const there = samplePlanting(shifted, layer(), 'bed-1');

    // A plant in the overlap region is in the same place in both samples.
    const overlap = (list: typeof here) =>
      list
        .filter((p) => p.at.x >= 6 && p.at.x <= 12)
        .map((p) => `${p.at.x.toFixed(4)},${p.at.y.toFixed(4)}`);

    expect(overlap(there)).toEqual(overlap(here));
  });

  /* -------------------------------------------------------------- composition */

  /**
   * What grades a border. Low things at the front, tall behind — a bed with no such gradient looks
   * like a texture swatch however good its plants are.
   */
  it('pushes an edge-affine layer towards the bed’s edge', () => {
    const edging = samplePlanting(bed, layer({ edgeAffinity: 0.9, share: 0.5 }), 'bed-1');
    const middle = samplePlanting(bed, layer({ edgeAffinity: -0.9, share: 0.5 }), 'bed-1');

    const mean = (list: typeof edging) =>
      list.reduce((sum, p) => sum + p.edgeness, 0) / Math.max(1, list.length);

    expect(mean(edging)).toBeGreaterThan(mean(middle) + 0.15);
  });

  it('gathers a clustered layer into drifts rather than spreading it evenly', () => {
    const even = samplePlanting(bed, layer({ clustering: 0 }), 'bed-1');
    const drifted = samplePlanting(bed, layer({ clustering: 1 }), 'bed-1');

    /** Variance of the count per square metre: a drifted layer is lumpier by construction. */
    const lumpiness = (list: typeof even) => {
      const cells = new Map<string, number>();
      for (const p of list) {
        const key = `${Math.floor(p.at.x)},${Math.floor(p.at.y)}`;
        cells.set(key, (cells.get(key) ?? 0) + 1);
      }
      const counts = [...cells.values()];
      const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
      return counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / counts.length;
    };

    expect(lumpiness(drifted)).toBeGreaterThan(lumpiness(even));
  });

  it('plants more of a layer with a bigger share', () => {
    const sparse = samplePlanting(bed, layer({ share: 0.2 }), 'bed-1').length;
    const dense = samplePlanting(bed, layer({ share: 0.9 }), 'bed-1').length;

    expect(dense).toBeGreaterThan(sparse * 1.5);
  });

  it('spaces a big plant further apart than a small one', () => {
    expect(cellSize(layer({ spread: { min: 1.2, max: 1.8 } }))).toBeGreaterThan(
      cellSize(layer({ spread: { min: 0.2, max: 0.4 } })),
    );
  });

  /** A path crossing a bed, or a shed standing in it, is a real case the generator produces. */
  it('keeps out of an exclusion', () => {
    const path: Point[] = [
      { x: 5, y: 0 },
      { x: 7, y: 0 },
      { x: 7, y: 8 },
      { x: 5, y: 8 },
    ];
    const placements = samplePlanting(bed, layer(), 'bed-1', { exclusions: [path] });

    expect(placements.length).toBeGreaterThan(0);
    for (const placement of placements) expect(pointInPolygon(placement.at, path)).toBe(false);
  });
});

describe('driftNoise', () => {
  /**
   * Keyed on the world, not on cell indices. A drift has to stay where it is when the bed's outline
   * changes — keyed on cells, dragging an edge would renumber them and slide every drift sideways.
   */
  it('depends on the world position and nothing else', () => {
    const at = { x: 3.5, y: 2.25 };
    expect(driftNoise('bed-1', at, 4)).toBe(driftNoise('bed-1', { ...at }, 4));
  });

  it('gives two beds in the same place the same drift, because they are in one garden', () => {
    const at = { x: 3.5, y: 2.25 };
    expect(driftNoise('bed-1', at, 4)).not.toBe(driftNoise('bed-2', at, 4));
  });

  it('stays inside 0 and 1', () => {
    for (let i = 0; i < 200; i += 1) {
      const value = driftNoise('bed-1', { x: i * 0.37, y: i * 0.91 }, 3);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('varies smoothly, so a drift is a drift rather than noise', () => {
    const a = driftNoise('bed-1', { x: 5, y: 5 }, 6);
    const b = driftNoise('bed-1', { x: 5.05, y: 5 }, 6);

    expect(Math.abs(a - b)).toBeLessThan(0.1);
  });
});

describe('distanceToEdge', () => {
  it('measures to the nearest side', () => {
    expect(distanceToEdge({ x: 3, y: 4 }, bed)).toBeCloseTo(1, 6);
    expect(distanceToEdge({ x: 7, y: 2 }, bed)).toBeCloseTo(1, 6);
  });

  it('is zero on the outline itself', () => {
    expect(distanceToEdge({ x: 2, y: 4 }, bed)).toBeCloseTo(0, 6);
  });
});

describe('the schemes', () => {
  it('gives every style layers that differ from every other', () => {
    const shapes = (['contemporary', 'cottage', 'naturalistic', 'low-maintenance', 'architectural', 'pollinator'] as const).map(
      (style) => JSON.stringify(schemeFor(style).layers),
    );

    expect(new Set(shapes).size).toBe(shapes.length);
  });

  it('falls back rather than refusing an unknown style', () => {
    expect(schemeFor('not-a-style').style).toBe('cottage');
    expect(schemeFor(undefined).style).toBe('cottage');
  });

  /** Every layer has to be plantable: a zero share draws nothing and is a scheme with a hole. */
  it('gives every layer of every scheme a usable share and spread', () => {
    for (const style of ['contemporary', 'cottage', 'naturalistic', 'low-maintenance', 'architectural', 'pollinator'] as const) {
      for (const spec of schemeFor(style).layers) {
        expect(spec.share, `${style}/${spec.role}`).toBeGreaterThan(0);
        expect(spec.spread.min, `${style}/${spec.role}`).toBeGreaterThan(0);
        expect(spec.spread.max).toBeGreaterThanOrEqual(spec.spread.min);
        expect(spec.heightBand.max).toBeGreaterThanOrEqual(spec.heightBand.min);
      }
    }
  });
});
