import { pointInPolygon, type Point } from '@garden-studio/schema';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlacementService } from './placement.service.js';
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

describe.skipIf(connection === null)('PlacementService', () => {
  let service: PlacementService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    service = new PlacementService(db.db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('finds candidates in an empty zone', async () => {
    const candidates = await service.candidates({
      zone,
      obstacles: [],
      inradius: 1,
      houseCentre: null,
      affinity: 'any',
      seed: 1,
    });

    expect(candidates.length).toBeGreaterThan(0);
  });

  it('keeps every candidate at least the inradius inside the zone', async () => {
    const candidates = await service.candidates({
      zone,
      obstacles: [],
      inradius: 2,
      houseCentre: null,
      affinity: 'any',
      seed: 1,
    });

    for (const point of candidates) {
      expect(point.x).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(point.x).toBeLessThanOrEqual(10 + 1e-6);
      expect(point.y).toBeGreaterThanOrEqual(2 - 1e-6);
      expect(point.y).toBeLessThanOrEqual(8 + 1e-6);
    }
  });

  it('finds nothing when the footprint cannot fit at all', async () => {
    const candidates = await service.candidates({
      zone,
      obstacles: [],
      // Half the zone's short side plus a margin: nowhere for a centre to sit.
      inradius: 6,
      houseCentre: null,
      affinity: 'any',
      seed: 1,
    });

    expect(candidates).toEqual([]);
  });

  it('finds nothing when the zone is entirely obstructed', async () => {
    const candidates = await service.candidates({
      zone,
      obstacles: [rect(-1, -1, 14, 12)],
      inradius: 0.5,
      houseCentre: null,
      affinity: 'any',
      seed: 1,
    });

    expect(candidates).toEqual([]);
  });

  it('steers around an obstacle rather than through it', async () => {
    // A wall down the middle: nothing may be centred inside x 5..7.
    const candidates = await service.candidates({
      zone,
      obstacles: [rect(5, 0, 2, 10)],
      inradius: 0.5,
      houseCentre: null,
      affinity: 'any',
      seed: 3,
    });

    expect(candidates.length).toBeGreaterThan(0);
    for (const point of candidates) {
      expect(point.x < 5 || point.x > 7).toBe(true);
    }
  });

  it('works on a concave zone, where a bounding-box scan would waste its budget', async () => {
    const lShape: Point[] = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 12, y: 4 },
      { x: 5, y: 4 },
      { x: 5, y: 10 },
      { x: 0, y: 10 },
    ];

    const candidates = await service.candidates({
      zone: lShape,
      obstacles: [],
      inradius: 0.75,
      houseCentre: null,
      affinity: 'any',
      seed: 5,
    });

    expect(candidates.length).toBeGreaterThan(0);
    // Every one is genuinely in the L, not merely in its bounding box.
    for (const point of candidates) {
      expect(pointInPolygon(point, lShape)).toBe(true);
    }
  });

  /*
   * Determinism is the whole reason `ST_GeneratePoints` is given a seed rather than left to its
   * own devices: a generated concept the user chose has to be the concept they get back.
   */
  it('is deterministic for a given seed', async () => {
    const request = {
      zone,
      obstacles: [],
      inradius: 1,
      houseCentre: null,
      affinity: 'any' as const,
      seed: 99,
    };

    expect(await service.candidates(request)).toEqual(await service.candidates(request));
  });

  it('produces a different sample for a different seed', async () => {
    const base = { zone, obstacles: [], inradius: 1, houseCentre: null, affinity: 'any' as const };

    expect(await service.candidates({ ...base, seed: 1 })).not.toEqual(
      await service.candidates({ ...base, seed: 2 }),
    );
  });

  it('orders by affinity, so near-house and far-from-house disagree about the first pick', async () => {
    const base = {
      zone,
      obstacles: [],
      inradius: 1,
      houseCentre: { x: 0, y: 0 },
      seed: 21,
    };

    const [near] = await service.candidates({ ...base, affinity: 'near-house' });
    const [far] = await service.candidates({ ...base, affinity: 'far-from-house' });

    const distance = (point: Point) => Math.hypot(point.x, point.y);
    expect(distance(near!)).toBeLessThan(distance(far!));
  });

  it('finds the closest point on the house outline', async () => {
    const house = rect(4, 4, 4, 2);

    const closest = await service.closestOnHouse(house, { x: 6, y: 9 });

    expect(closest!.y).toBeCloseTo(6, 6);
    expect(closest!.x).toBeCloseTo(6, 6);
  });

  /*
   * The relocated load-bearing cast. It used to live on the validator's circle buffer; the
   * validator now tessellates in TypeScript, so this erosion is the last `ST_Buffer` in the
   * codebase and the lesson keeps its home here.
   *
   * Sent untyped, the quadrant-segments argument resolves to the
   * `ST_Buffer(geometry, float8, text)` style-parameters overload, and PostGIS then fails trying
   * to read "4" as a style string like "quad_segs=4".
   */
  it("rejects ST_Buffer's quadrant-segments argument without the ::int cast", async () => {
    await expect(
      db.db.execute(
        sql`SELECT ST_Buffer(ST_GeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))'::text), -1::float8, ${4})`,
      ),
    ).rejects.toThrow();

    // And the cast form is fine.
    await expect(
      db.db.execute(
        sql`SELECT ST_Buffer(ST_GeomFromText('POLYGON((0 0, 10 0, 10 10, 0 10, 0 0))'::text), -1::float8, ${4}::int)`,
      ),
    ).resolves.toBeDefined();
  });
});

if (connection === null) {
  describe('PlacementService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
