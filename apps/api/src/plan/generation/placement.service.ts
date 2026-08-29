import { Inject, Injectable } from '@nestjs/common';
import { polygonToWkt, type Point } from '@garden-studio/schema';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module.js';

/**
 * Where a footprint can legally go.
 *
 * The client's mock answered this by scanning up to 420 grid cells per attempt and running a
 * containment test on each. PostGIS can express the feasible region exactly instead:
 *
 *   free = zone − everything already standing        (exact, and handles concave zones)
 *   room = free eroded by the footprint's inradius   (where a centre may sit at all)
 *
 * and then sample it. That turns hundreds of guesses into one query per attempt, and — because
 * the erosion is exact rather than a grid approximation — it finds space in the awkward corners
 * of an L-shaped plot that a coarse scan steps straight over.
 *
 * What it deliberately does *not* do is decide whether a candidate is legal. That stays in
 * TypeScript, with the same `geometryIsLegal` the canvas and the validator use, so a generated
 * concept can never fail the validation that guards its own save. The query narrows hundreds of
 * possibilities to a couple of dozen good ones; the shared predicate has the final word.
 */

// A type alias, not an interface: db.execute's row generic needs an index signature, which
// TypeScript infers for aliases and never for interfaces.
type CandidateRow = {
  x: number;
  y: number;
  house_distance: number;
};

export interface CandidateRequest {
  zone: Point[];
  /** Rings the footprint must stay clear of: the house, and everything already placed. */
  obstacles: Point[][];
  /** How far a centre must sit from the free region's edge, in metres. */
  inradius: number;
  houseCentre: Point | null;
  affinity: 'near-house' | 'far-from-house' | 'any';
  /** Positive integer. `ST_GeneratePoints` is deterministic for a given seed. */
  seed: number;
  /** How many points to sample. More candidates, more variety, one query either way. */
  sampleCount?: number;
}

/** Quadrant segments for the erosion buffer. The `::int` cast on this is load-bearing. */
const BUFFER_QUAD_SEGMENTS = 4;

const DEFAULT_SAMPLES = 48;

@Injectable()
export class PlacementService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Candidate centres inside `zone`, ordered by the request's affinity.
   *
   * Returns an empty array when the footprint cannot fit at all — a zone entirely taken up by
   * the house and what is already in it — which is what makes "we could not fit your fire pit"
   * an honest answer rather than a missing element.
   */
  async candidates(request: CandidateRequest): Promise<Point[]> {
    if (request.zone.length < 3) return [];

    const samples = request.sampleCount ?? DEFAULT_SAMPLES;
    const obstacles = request.obstacles.filter((ring) => ring.length >= 3);

    /*
     * COALESCE rather than a conditional CTE: an empty obstacle set is the common case on a
     * fresh garden, and 'POLYGON EMPTY' makes ST_Difference a no-op instead of forcing two
     * versions of the query to keep in step.
     */
    const obstacleUnion: SQL =
      obstacles.length === 0
        ? sql`'POLYGON EMPTY'::geometry`
        : sql`ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(
            obstacles.map((ring) => sql`ST_GeomFromText(${polygonToWkt(ring)}::text)`),
            sql`, `,
          )}]))`;

    const houseGeom: SQL = request.houseCentre
      ? sql`ST_MakePoint(${request.houseCentre.x}::float8, ${request.houseCentre.y}::float8)`
      : sql`ST_MakePoint(0::float8, 0::float8)`;

    /*
     * `ORDER BY` is interpolated as raw SQL because it is a keyword, not a value — and it is
     * chosen from a closed set here rather than from anything a caller can type.
     */
    const direction = sql.raw(request.affinity === 'near-house' ? 'ASC' : 'DESC');

    const rows = await this.db.execute<CandidateRow>(sql`
      WITH zone AS (
        SELECT ST_GeomFromText(${polygonToWkt(request.zone)}::text) AS geom
      ),
      free AS (
        SELECT ST_Difference(zone.geom, ${obstacleUnion}) AS geom FROM zone
      ),
      room AS (
        SELECT ST_Buffer(free.geom, ${-request.inradius}::float8, ${BUFFER_QUAD_SEGMENTS}::int) AS geom
        FROM free
      ),
      sampled AS (
        SELECT (ST_Dump(ST_GeneratePoints(room.geom, ${samples}::int, ${request.seed}::int))).geom AS pt
        FROM room
        WHERE NOT ST_IsEmpty(room.geom) AND ST_Area(room.geom) > 0
      )
      SELECT
        ST_X(sampled.pt)::float8 AS x,
        ST_Y(sampled.pt)::float8 AS y,
        ST_Distance(sampled.pt, ${houseGeom})::float8 AS house_distance
      FROM sampled
      ORDER BY house_distance ${direction}
    `);

    /*
     * Every numeric column is cast ::float8 above. postgres-js hands back `numeric` as a string,
     * so without the cast `x` would be "3.5" and the arithmetic downstream would silently
     * concatenate rather than add.
     */
    return rows.map((row) => ({ x: row.x, y: row.y }));
  }

  /**
   * The point on the house's outline closest to `target`.
   *
   * `ST_ClosestPoint` in one call, where the client walked every edge with a projection helper.
   */
  async closestOnHouse(houseRing: Point[], target: Point): Promise<Point | null> {
    if (houseRing.length < 3) return null;

    const [row] = await this.db.execute<{ x: number; y: number }>(sql`
      SELECT
        ST_X(p.geom)::float8 AS x,
        ST_Y(p.geom)::float8 AS y
      FROM (
        SELECT ST_ClosestPoint(
          ST_ExteriorRing(ST_GeomFromText(${polygonToWkt(houseRing)}::text)),
          ST_MakePoint(${target.x}::float8, ${target.y}::float8)
        ) AS geom
      ) AS p
    `);

    return row ? { x: row.x, y: row.y } : null;
  }
}
