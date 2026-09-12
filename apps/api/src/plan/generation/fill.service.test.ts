import { pointInPolygon, polygonArea, type Point } from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FillService } from './fill.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../../test/db.js';

const connection = await connectTestDatabase();

/** A 12 m x 10 m zone. */
const zone: Point[] = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 10 },
  { x: 0, y: 10 },
];

function rect(x: number, y: number, width: number, depth: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + depth },
    { x, y: y + depth },
  ];
}

describe.skipIf(connection === null)('FillService', () => {
  let service: FillService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    service = new FillService(db.db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('returns the whole zone, inset, when nothing is in the way', async () => {
    const [region] = await service.accentRegions(zone, [], 3);

    expect(region).toBeDefined();
    // Inset by 0.4 m all round, so a little smaller than the zone itself.
    expect(polygonArea(region!)).toBeLessThan(polygonArea(zone));
    expect(polygonArea(region!)).toBeGreaterThan(polygonArea(zone) * 0.8);
  });

  it('respects the limit', async () => {
    expect(await service.accentRegions(zone, [], 0)).toEqual([]);
    expect((await service.accentRegions(zone, [rect(5, 0, 2, 10)], 1)).length).toBe(1);
  });

  /*
   * A fully interior obstacle makes the true remainder a donut, and `PlanGeometry.polygon` has no
   * way to express a hole — so the exterior ring comes back and the hole is dropped.
   *
   * That is deliberate rather than a limitation worked around: the shed that made the hole is
   * drawn *on top* of the fill, so the hole is invisible either way. The z-order carries the same
   * weight here as it does for the base layer.
   */
  it('keeps one region around an interior obstacle, dropping the hole', async () => {
    const shed = rect(5, 4, 2, 2);

    const regions = await service.accentRegions(zone, [shed], 4);

    expect(regions).toHaveLength(1);
    // Ground either side of the shed is in it, and so — hole dropped — is the shed's own centre.
    expect(pointInPolygon({ x: 2, y: 5 }, regions[0]!)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 5 }, regions[0]!)).toBe(true);
    expect(pointInPolygon({ x: 6, y: 5 }, regions[0]!)).toBe(true);
  });

  it('splits into separate regions when an obstacle cuts the zone in two', async () => {
    const wall = rect(5, -1, 2, 12);

    const regions = await service.accentRegions(zone, [wall], 4);

    expect(regions).toHaveLength(2);
    expect(regions[0]!.length).toBeGreaterThanOrEqual(3);
  });

  it('orders regions largest first', async () => {
    // An off-centre wall leaves a wide side and a narrow one.
    const regions = await service.accentRegions(zone, [rect(3, -1, 1, 12)], 4);

    expect(regions).toHaveLength(2);
    expect(polygonArea(regions[0]!)).toBeGreaterThan(polygonArea(regions[1]!));
  });

  /*
   * The exact minimum-width test the guillotine could only approximate with a bounding box: a long
   * thin offcut is rejected however much area it has, because a 1.2 m disc will not fit inside it.
   */
  it('rejects a long thin offcut but keeps a small square one', async () => {
    // Leaves a 0.6 m strip down the right-hand side: 6 m², but only 0.6 m wide.
    const sliver = await service.accentRegions(zone, [rect(-1, -1, 12.4, 12)], 4);
    expect(sliver).toEqual([]);

    // A 3 m x 3 m corner is smaller in area but genuinely a bed.
    const square = await service.accentRegions(
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 3 },
        { x: 0, y: 3 },
      ],
      [],
      4,
    );
    expect(square).toHaveLength(1);
  });

  it('follows the notch of a concave zone', async () => {
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];

    const [region] = await service.accentRegions(lShape, [], 2);

    expect(region).toBeDefined();
    // Inside both arms of the L, and not in the missing corner — a rectangle could not do this.
    expect(pointInPolygon({ x: 2, y: 8 }, region!)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 2 }, region!)).toBe(true);
    expect(pointInPolygon({ x: 10, y: 8 }, region!)).toBe(false);
  });

  it('returns open rings, matching how a stored polygon is written', async () => {
    const [region] = await service.accentRegions(zone, [], 1);

    const first = region![0]!;
    const last = region!.at(-1)!;
    expect(first.x === last.x && first.y === last.y).toBe(false);
  });

  describe('remainderPieces', () => {
    /** A 6 x 4 m lawn in the middle of the zone: what is left is an annulus. */
    const lawn = rect(3, 3, 6, 4);
    const centre = { x: 6, y: 5 };
    const cuts: [Point, Point][] = [
      [centre, { x: centre.x + 1, y: centre.y }],
      [centre, { x: centre.x, y: centre.y + 1 }],
    ];

    it('subtracts an edge bed without requiring split lines', async () => {
      const pieces = await service.remainderPieces({ zone, rooms: [rect(0, 0, 2, 10)], cuts: [] });
      expect(pieces).toHaveLength(1);
      expect(polygonArea(pieces[0]!)).toBeCloseTo(100);
    });

    it('cuts the annulus round a room into runs with no holes', async () => {
      const pieces = await service.remainderPieces({ zone, rooms: [lawn], cuts });

      expect(pieces.length).toBeGreaterThanOrEqual(2);
      const total = pieces.reduce((sum, piece) => sum + polygonArea(piece), 0);
      // Roughly the zone less the lawn (120 - 24), allowing for the sliver trim.
      expect(total).toBeGreaterThan(80);
      expect(total).toBeLessThanOrEqual(96.01);
      for (const piece of pieces) {
        // Nothing crosses the room: no vertex of a piece lies strictly inside the lawn.
        for (const point of piece) {
          const insideLawn =
            point.x > 3 + 1e-6 && point.x < 9 - 1e-6 && point.y > 3 + 1e-6 && point.y < 7 - 1e-6;
          expect(insideLawn).toBe(false);
          expect(point.x).toBeGreaterThanOrEqual(-1e-6);
          expect(point.x).toBeLessThanOrEqual(12 + 1e-6);
        }
        // And the lawn's centre is in none of them, which is what "no hole" means here.
        expect(pointInPolygon(centre, piece)).toBe(false);
      }
    });

    it('flattens a feature standing wholly inside a run, for the caller to draw over it', async () => {
      const shed = rect(0.5, 0.5, 1.6, 1.6);
      const pieces = await service.remainderPieces({ zone, rooms: [lawn, shed], cuts });

      // The corner run still comes back as one ring rather than being refused.
      const corner = pieces.find((piece) => pointInPolygon({ x: 0.2, y: 2.5 }, piece));
      expect(corner).toBeDefined();
    });

    it('respects the limit, largest first', async () => {
      const all = await service.remainderPieces({ zone, rooms: [lawn], cuts });
      const two = await service.remainderPieces({ zone, rooms: [lawn], cuts, limit: 2 });

      expect(two).toHaveLength(2);
      expect(polygonArea(two[0]!)).toBeGreaterThanOrEqual(polygonArea(two[1]!));
      expect(polygonArea(two[0]!)).toBeCloseTo(polygonArea(all[0]!), 6);
    });

    it('returns nothing for an empty zone or no budget', async () => {
      expect(await service.remainderPieces({ zone: [], rooms: [lawn], cuts })).toEqual([]);
      expect(await service.remainderPieces({ zone, rooms: [lawn], cuts, limit: 0 })).toEqual([]);
    });
  });

  describe('clipTo', () => {
    it('keeps the part of a shape that lies in the room', async () => {
      const shape = rect(8, 2, 8, 4); // Runs 4 m past the zone's right edge.
      const clipped = await service.clipTo(shape, zone);

      expect(clipped).not.toBeNull();
      expect(polygonArea(clipped!)).toBeCloseTo(16, 3);
      for (const point of clipped!) expect(point.x).toBeLessThanOrEqual(12 + 1e-6);
    });

    it('insets the result when asked', async () => {
      const shape = rect(2, 2, 6, 4);
      const inset = await service.clipTo(shape, zone, 0.5);

      expect(inset).not.toBeNull();
      expect(polygonArea(inset!)).toBeCloseTo(15, 3);
    });

    it('is null when the shape misses the room', async () => {
      expect(await service.clipTo(rect(20, 20, 2, 2), zone)).toBeNull();
    });
  });

  describe('clipRingsTo', () => {
    it('buckets the pieces by input index', async () => {
      const left = rect(0, 0, 5, 10);
      const right = rect(7, 0, 5, 10);
      // Covers all of `left` and only the first 2 m of `right`.
      const scope = rect(0, 0, 9, 10);

      const [leftPieces, rightPieces] = await service.clipRingsTo([left, right], scope);

      expect(polygonArea(leftPieces![0]!)).toBeCloseTo(50, 3);
      expect(polygonArea(rightPieces![0]!)).toBeCloseTo(20, 3);
    });

    /*
     * The case `clipTo` cannot answer and this method exists for. A U-shaped redesign area cuts one
     * zone into two gardens; keeping only the larger would leave the other with no base fill under
     * it, which draws as bare graph paper inside the area the user asked to have designed.
     */
    it('keeps every surviving piece, largest first', async () => {
      /*
       * A U opening upwards whose connecting bar sits below the zone, so the two arms reach into
       * the zone but the bar never does — one simple ring, two disjoint pieces of zone. A U whose
       * bar is inside the zone would clip to a single connected U and prove nothing.
       */
      const u = [
        { x: 1, y: -5 },
        { x: 11, y: -5 },
        { x: 11, y: 8 },
        { x: 7, y: 8 },
        { x: 7, y: -1 },
        { x: 4, y: -1 },
        { x: 4, y: 8 },
        { x: 1, y: 8 },
      ];

      const [pieces] = await service.clipRingsTo([zone], u);

      expect(pieces).toHaveLength(2);
      // The right arm is 4 m wide, the left 3 m, both 8 m deep — so ordering is observable.
      expect(pieces!.map((piece) => polygonArea(piece))).toEqual([32, 24]);
    });

    it('drops a sliver too narrow to be a garden', async () => {
      // 0.8 m of overlap — under MIN_FILL_SIDE, so the negative-buffer width test empties it.
      expect(await service.clipRingsTo([zone], rect(-10, 0, 10.8, 10))).toEqual([[]]);
    });

    it('is empty for a ring the scope misses entirely', async () => {
      expect(await service.clipRingsTo([zone], rect(40, 40, 6, 6))).toEqual([[]]);
    });

    it('returns open rings, as every other ring in the generator is', async () => {
      const [pieces] = await service.clipRingsTo([zone], rect(1, 1, 8, 8));
      const ring = pieces![0]!;

      expect(ring[0]).not.toEqual(ring.at(-1));
    });

    it('leaves a bucket empty rather than dropping it, so indexes still line up', async () => {
      const [first, second] = await service.clipRingsTo(
        [zone, rect(40, 40, 6, 6)],
        rect(1, 1, 8, 8),
      );

      expect(first).toHaveLength(1);
      expect(second).toEqual([]);
    });
  });

  describe('borderRegions', () => {
    /*
     * A half-plane slab, which is what `computeZones` actually produces — never the whole plot.
     * That distinction is load-bearing here: the zone cut is what opens the annulus.
     */
    const leftHalf = rect(0, 0, 6, 10);

    it('hugs the fence and leaves the middle alone', async () => {
      const [band] = await service.borderRegions(zone, leftHalf, [], 1.5);

      expect(band).toBeDefined();
      // Just inside the fence is border; the middle of the plot is not.
      expect(pointInPolygon({ x: 0.5, y: 5 }, band!)).toBe(true);
      expect(pointInPolygon({ x: 4, y: 5 }, band!)).toBe(false);
    });

    it('covers only a fraction of the zone it borders', async () => {
      const regions = await service.borderRegions(zone, leftHalf, [], 1.5);
      const covered = regions.reduce((sum, ring) => sum + polygonArea(ring), 0);

      expect(covered).toBeGreaterThan(0);
      expect(covered).toBeLessThan(polygonArea(leftHalf) * 0.75);
    });

    /**
     * The failure this method exists to avoid, pinned.
     *
     * A band round a plot is an annulus, and `exteriorRing` discards interior rings — so flattening
     * one returns the entire plot and plants the whole garden. Real zones are half-plane slabs and
     * always cut the annulus open; when something is not a proper subset, the SQL refuses the piece
     * rather than trusting it. No border is a far better wrong answer than a garden of shrubs.
     */
    it('refuses rather than returning the whole plot when the zone cannot cut the annulus', async () => {
      expect(await service.borderRegions(zone, zone, [], 1.5)).toEqual([]);
    });

    it('is broken by whatever is standing against the fence', async () => {
      // A shed pushed into the top-left corner, well inside the band.
      const regions = await service.borderRegions(zone, leftHalf, [rect(0, 0, 4, 3)], 1.5);

      for (const ring of regions) {
        expect(pointInPolygon({ x: 1, y: 1 }, ring)).toBe(false);
      }
      expect(regions.length).toBeGreaterThan(0);
    });

    it('is cut to the zone it was asked for', async () => {
      const regions = await service.borderRegions(zone, leftHalf, [], 1.5);

      expect(regions.length).toBeGreaterThan(0);
      for (const ring of regions) {
        for (const point of ring) {
          expect(point.x).toBeLessThanOrEqual(6 + 1e-6);
        }
      }
    });

    it('stays inside the plot, which the validator will insist on', async () => {
      const regions = await service.borderRegions(zone, leftHalf, [], 1.5);

      for (const ring of regions) {
        for (const point of ring) {
          expect(pointInPolygon(point, zone)).toBe(true);
        }
      }
    });

    it('refuses a band narrower than the sliver floor rather than returning nothing', async () => {
      // Silently returning [] for a too-narrow band is how this feature disappears without a trace.
      expect(await service.borderRegions(zone, leftHalf, [], 0.5)).toEqual([]);
    });

    it('follows a concave plot round its notch', async () => {
      const lShape: Point[] = [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
        { x: 12, y: 4 },
        { x: 5, y: 4 },
        { x: 5, y: 10 },
        { x: 0, y: 10 },
      ];

      const regions = await service.borderRegions(lShape, rect(0, 0, 12, 5), [], 1.5);

      expect(regions.length).toBeGreaterThan(0);
      for (const ring of regions) {
        for (const point of ring) {
          expect(pointInPolygon(point, lShape)).toBe(true);
        }
      }
    });

    it('returns open rings, like every other stored polygon', async () => {
      const [band] = await service.borderRegions(zone, leftHalf, [], 1.5);

      const first = band![0]!;
      const last = band!.at(-1)!;
      expect(first.x === last.x && first.y === last.y).toBe(false);
    });
  });
});

if (connection === null) {
  describe('FillService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
