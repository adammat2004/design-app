import { Inject, Injectable } from '@nestjs/common';
import { polygonToWkt, type Point } from '@garden-studio/schema';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/db.module.js';

/**
 * The ground cover between the things the brief asked for.
 *
 * The client's mock did this by guillotining the zone's bounding box into rectangles and keeping
 * the ones that missed everything — approximate by construction, and unable to produce a shape
 * that wraps around anything. This is the real version: subtract what is standing from the zone
 * and take what is left.
 *
 * That is worth the query. An L-shaped plot yields an accent that follows the notch, and a bed
 * wraps around a shed instead of being cut into four rectangular offcuts either side of it.
 *
 * **What has not changed is the base layer.** `concepts.service.ts` still lays the whole zone
 * polygon down underneath, and the note in the old `concept-fill.ts` that the backend could
 * "drop the base layer" once it had true booleans is wrong — see the comment there for why.
 */

type PartRow = {
  ring: string;
  area: number;
};

// The sliver limits live in a leaf module so the pure sketch layer can respect them without
// importing the database driver. Re-exported here for the callers that always found them here.
import { MIN_FILL_AREA, MIN_FILL_SIDE } from './fill-limits.js';
export { MIN_FILL_AREA, MIN_FILL_SIDE };

/** How far an accent is pulled in from its neighbours, so the base layer reads as a margin. */
const INSET = 0.4;

/** Quadrant segments for the negative buffers. The `::int` cast is load-bearing. */
const BUFFER_QUAD_SEGMENTS = 4;

/**
 * Vertex-thinning tolerance in metres, applied after the insets.
 *
 * A negative buffer of a rounded shape produces a great many nearly-collinear points; left alone
 * they bloat the stored document and slow the canvas down for detail nobody can see at 1:100.
 */
const SIMPLIFY_TOLERANCE = 0.05;

/**
 * A set of rings as one geometry to subtract, every one of them made valid first.
 *
 * **`ST_MakeValid` is not defensive tidiness here — without it the query throws.** `ST_UnaryUnion`
 * answers a self-intersecting ring with `TopologyException: side location conflict` rather than
 * with a geometry, which takes the whole generation down; and obstacle sets routinely contain path
 * strips, which `polylineStrip` mitres square, so a route that doubles back sharply is a bow tie by
 * construction. The evaluation harness found it on an L-shaped plot, where the route round the
 * notch is exactly that shape — every fixture before it happened to have gentler corners.
 *
 * One function rather than the same six lines in four places, because three of those four had the
 * guard and one did not, and nothing about reading them said which.
 *
 * `'POLYGON EMPTY'` for an empty set rather than a conditional CTE: an empty obstacle list is the
 * common case on a fresh garden, and an empty geometry makes `ST_Difference` a no-op instead of
 * forcing two versions of every query to keep in step.
 */
export function unionOf(rings: Point[][]): SQL {
  const usable = rings.filter((ring) => ring.length >= 3);
  if (usable.length === 0) return sql`'POLYGON EMPTY'::geometry`;

  /*
   * Per ring, and **not** one `ST_MakeValid` over the collection — which repairs the same bow ties
   * and is far slower. Measured on forty overlapping rings, the shape of a real obstacle set:
   *
   * ```
   *   ST_UnaryUnion(ST_Collect(g))                 102 ms   (throws on a bow tie)
   *   ST_UnaryUnion(ST_MakeValid(ST_Collect(g)))   279 ms
   *   ST_UnaryUnion(ST_Collect(ST_MakeValid(g)))    24 ms
   * ```
   *
   * Repairing each ring first normalises it, which leaves the union far less work to do — so the
   * guard against the crash is also four times faster than not guarding at all. The collection form
   * is the one to avoid; it put six concept tests over vitest's five-second default.
   */
  return sql`ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(
    usable.map((ring) => sql`ST_MakeValid(ST_GeomFromText(${polygonToWkt(ring)}::text))`),
    sql`, `,
  )}]))`;
}

@Injectable()
export class FillService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The parts of `zone` not taken up by `obstacles`, largest first, inset and simplified.
   *
   * Returned as plain rings. Interior rings are discarded: subtracting a tree from the middle of
   * a lawn leaves a donut, `PlanGeometry.polygon` has no way to express a hole, and the geometry
   * that made the hole is drawn on top of the fill anyway — so the hole is invisible either way.
   * Keeping the exterior ring is the honest simplification; silently indexing `[0]` into the
   * GeoJSON coordinates would be the same thing without saying so.
   */
  async accentRegions(zone: Point[], obstacles: Point[][], limit: number): Promise<Point[][]> {
    if (zone.length < 3 || limit <= 0) return [];

    const rings = obstacles.filter((ring) => ring.length >= 3);

    const obstacleUnion = unionOf(rings);

    const rows = await this.db.execute<PartRow>(sql`
      WITH zone AS (
        SELECT ST_GeomFromText(${polygonToWkt(zone)}::text) AS geom
      ),
      remainder AS (
        SELECT ST_Difference(zone.geom, ${obstacleUnion}) AS geom FROM zone
      ),
      parts AS (
        SELECT (ST_Dump(remainder.geom)).geom AS geom FROM remainder
      ),
      inset AS (
        SELECT
          ST_SimplifyPreserveTopology(
            ST_Buffer(parts.geom, ${-INSET}::float8, ${BUFFER_QUAD_SEGMENTS}::int),
            ${SIMPLIFY_TOLERANCE}::float8
          ) AS geom
        FROM parts
        WHERE ST_GeometryType(parts.geom) = 'ST_Polygon'
          AND ST_Area(parts.geom) >= ${MIN_FILL_AREA}::float8
          /*
           * "Does a disc of this radius fit inside?" — an exact minimum-width test on any shape,
           * where the guillotine could only measure an axis-aligned bounding box. This is what
           * rejects a 0.3 x 5 m offcut while keeping a 1.2 m square.
           */
          AND NOT ST_IsEmpty(
            ST_Buffer(parts.geom, ${-MIN_FILL_SIDE / 2}::float8, ${BUFFER_QUAD_SEGMENTS}::int)
          )
      )
      SELECT
        ST_AsGeoJSON(inset.geom)::text AS ring,
        ST_Area(inset.geom)::float8 AS area
      FROM inset
      WHERE NOT ST_IsEmpty(inset.geom)
        AND ST_GeometryType(inset.geom) = 'ST_Polygon'
        AND ST_Area(inset.geom) >= ${MIN_FILL_AREA}::float8
      ORDER BY area DESC
      LIMIT ${limit}::int
    `);

    return rows
      .map((row) => exteriorRing(row.ring))
      .filter((ring): ring is Point[] => ring !== null && ring.length >= 3);
  }

  /**
   * A planted band hugging the inside of the fence, broken by the house and by anything standing.
   *
   * This is the one thing a garden always has and a generated plan never did: the eye reads a
   * border against the boundary as "designed" long before it reads what is in the middle.
   *
   * **It cannot be built with `accentRegions`, and the reason is structural.** A band round a plot
   * is an annulus — a polygon with a hole — and `exteriorRing` below deliberately discards interior
   * rings. Handed a band it would return the whole plot, silently, and pave the garden in shrubs.
   * `fill.service.test.ts` pins that hole-dropping behaviour, so this is a fact about the file
   * rather than a bug in it.
   *
   * **Nor can it be built per zone.** `computeZones` clips half-planes out of the boundary, so the
   * zones' union is not the boundary and their interior seams are not fence. A band grown inward
   * from a zone polygon would run a border across the middle of the garden along the seam between
   * one zone and the next. So: grow the annulus from the **boundary**, then intersect it with each
   * zone — which both cuts it into simple, hole-free pieces and tells each piece which zone it is
   * in, without a second opinion about where the zones are.
   */
  async borderRegions(
    boundary: Point[],
    zone: Point[],
    obstacles: Point[][],
    width: number,
  ): Promise<Point[][]> {
    if (boundary.length < 3 || zone.length < 3) return [];
    /*
     * A band narrower than the sliver floor is rejected piece by piece downstream and the border
     * simply never appears — no error, no row, nothing to debug. Refuse it here instead.
     */
    if (width < MIN_FILL_SIDE) return [];

    const rings = obstacles.filter((ring) => ring.length >= 3);

    const obstacleUnion = unionOf(rings);

    const rows = await this.db.execute<PartRow>(sql`
      WITH plot AS (
        SELECT ST_GeomFromText(${polygonToWkt(boundary)}::text) AS geom
      ),
      band AS (
        /* The annulus: the plot less its own interior. Has a hole, which is why it is cut below. */
        SELECT ST_Difference(
          plot.geom,
          ST_Buffer(plot.geom, ${-width}::float8, ${BUFFER_QUAD_SEGMENTS}::int)
        ) AS geom
        FROM plot
      ),
      slice AS (
        /*
         * Cut to one zone. Each piece is a strip along that zone's stretch of fence, hole-free,
         * so exteriorRing is honest about it.
         */
        SELECT ST_Intersection(band.geom, ST_GeomFromText(${polygonToWkt(zone)}::text)) AS geom
        FROM band
      ),
      clear AS (
        SELECT ST_Difference(slice.geom, ${obstacleUnion}) AS geom FROM slice
      ),
      parts AS (
        SELECT (ST_Dump(clear.geom)).geom AS geom FROM clear
      ),
      tidy AS (
        SELECT
          /*
           * Clamped back inside the plot as the last step. ST_SimplifyPreserveTopology preserves
           * topology but not containment, and nothing upstream applies geometryIsLegal to a fill
           * element -- so a vertex nudged a millimetre outward would sail through generation and
           * be refused by the validator that guards the save.
           */
          ST_Intersection(
            ST_SimplifyPreserveTopology(parts.geom, ${SIMPLIFY_TOLERANCE}::float8),
            plot.geom
          ) AS geom
        FROM parts, plot
        WHERE ST_GeometryType(parts.geom) = 'ST_Polygon'
          AND ST_Area(parts.geom) >= ${MIN_FILL_AREA}::float8
          /*
           * The guard that makes this method safe to hand to exteriorRing.
           *
           * A piece with an interior ring is one the zone cut failed to open -- the annulus came
           * through whole. Flattening it to its exterior ring would return the entire plot and
           * plant the whole garden, which is a far worse answer than none. Real zones are
           * half-plane slabs and always cut it; this refuses the case where that is not true
           * instead of trusting it.
           */
          AND ST_NumInteriorRings(parts.geom) = 0
      )
      SELECT
        ST_AsGeoJSON(tidy.geom)::text AS ring,
        ST_Area(tidy.geom)::float8 AS area
      FROM tidy
      WHERE NOT ST_IsEmpty(tidy.geom)
        AND ST_GeometryType(tidy.geom) = 'ST_Polygon'
        AND ST_Area(tidy.geom) >= ${MIN_FILL_AREA}::float8
      ORDER BY area DESC
    `);

    return rows
      .map((row) => exteriorRing(row.ring))
      .filter((ring): ring is Point[] => ring !== null && ring.length >= 3);
  }

  /**
   * What is left of `zone` once the rooms are taken out, cut into pieces that have no holes.
   *
   * This is the layout grammar's border: everything round the terrace, the lawn and the placed
   * features, hugging the fence on one side and the lawn's edge on the other. Subtracting the
   * rooms leaves an annulus, and `PlanGeometry.polygon` cannot hold a hole — so the remainder is
   * split by the `cuts` (two lines through the lawn's centre) into runs, each a plain ring open
   * on the lawn's side. A feature standing wholly inside a run still leaves a hole, and that one
   * `exteriorRing` flattens as it always has: the caller lays these pieces *under* the lawn and
   * the features, so a flattened hole is covered by the thing that made it. Keep that ordering.
   *
   * `inset` is zero by default: a border meets the lawn's edge, it does not float 40 cm off it.
   */
  async remainderPieces(request: {
    zone: Point[];
    rooms: Point[][];
    cuts: [Point, Point][];
    inset?: number;
    limit?: number;
  }): Promise<Point[][]> {
    const { zone, cuts } = request;
    const rooms = request.rooms.filter((ring) => ring.length >= 3);
    const inset = request.inset ?? 0;
    const limit = request.limit ?? 64;
    if (zone.length < 3 || limit <= 0) return [];

    const roomUnion: SQL =
      rooms.length === 0
        ? sql`'POLYGON EMPTY'::geometry`
        : sql`ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(
            rooms.map((ring) => sql`ST_MakeValid(ST_GeomFromText(${polygonToWkt(ring)}::text))`),
            sql`, `,
          )}]))`;

    const blade: SQL =
      cuts.length === 0
        ? sql`'LINESTRING EMPTY'::geometry`
        : sql`ST_Collect(ARRAY[${sql.join(
            cuts.map((cut) => sql`ST_GeomFromText(${lineWkt(cut)}::text)`),
            sql`, `,
          )}])`;

    /*
     * Every CTE is MATERIALIZED, and that is the whole difference between 1.4 s and 30 ms. Left to
     * itself the planner inlines a single-reference CTE into its consumer and then constant-folds
     * the geometry expressions at plan time — the union of every room, several times over. A
     * query whose nodes report 25 ms of execution was spending a second in the planner.
     */
    const rows = await this.db.execute<PartRow>(sql`
      WITH zone AS MATERIALIZED (
        SELECT ST_MakeValid(ST_GeomFromText(${polygonToWkt(zone)}::text)) AS geom
      ),
      rooms AS MATERIALIZED (
        SELECT ${roomUnion} AS geom
      ),
      remainder AS MATERIALIZED (
        SELECT ST_Difference(zone.geom, rooms.geom) AS geom FROM zone, rooms
      ),
      blade AS MATERIALIZED (
        SELECT ${blade} AS geom
      ),
      pieces AS MATERIALIZED (
        SELECT (ST_Dump(${cuts.length === 0 ? sql`remainder.geom` : sql`ST_Split(remainder.geom, blade.geom)`})).geom AS geom FROM remainder, blade
      ),
      parts AS MATERIALIZED (
        SELECT (ST_Dump(pieces.geom)).geom AS geom FROM pieces
      ),
      sized AS MATERIALIZED (
        SELECT parts.geom
        FROM parts
        WHERE ST_GeometryType(parts.geom) = 'ST_Polygon'
          AND ST_Area(parts.geom) >= ${MIN_FILL_AREA}::float8
          AND NOT ST_IsEmpty(
            ST_Buffer(parts.geom, ${-MIN_FILL_SIDE / 2}::float8, ${BUFFER_QUAD_SEGMENTS}::int)
          )
      ),
      kept AS MATERIALIZED (
        SELECT
          ST_Intersection(
            ST_SimplifyPreserveTopology(
              ${inset > 0 ? sql`ST_Buffer(sized.geom, ${-inset}::float8, ${BUFFER_QUAD_SEGMENTS}::int)` : sql`sized.geom`},
              ${SIMPLIFY_TOLERANCE}::float8
            ),
            zone.geom
          ) AS geom
        FROM sized, zone
      )
      SELECT
        ST_AsGeoJSON(kept.geom)::text AS ring,
        ST_Area(kept.geom)::float8 AS area
      FROM kept
      WHERE NOT ST_IsEmpty(kept.geom)
        AND ST_GeometryType(kept.geom) = 'ST_Polygon'
        AND ST_Area(kept.geom) >= ${MIN_FILL_AREA}::float8
      ORDER BY area DESC
      LIMIT ${limit}::int
    `);

    return rows
      .map((row) => exteriorRing(row.ring))
      .filter((ring): ring is Point[] => ring !== null);
  }

  /**
   * A shape clipped to another, as one ring, or `null` if nothing usable survives.
   *
   * Named for the operation rather than for its first caller: the curved template's lawn is
   * sketched as a clean curve and then has to live inside an L-shaped or irregular room, and the
   * garden room itself has to live inside whatever redesign area the user drew. Same intersection,
   * same sliver guards, same "largest piece" answer. Pulled in by `inset` so it clears the edge.
   */
  async clipTo(shape: Point[], clip: Point[], inset = 0): Promise<Point[] | null> {
    if (shape.length < 3 || clip.length < 3) return null;

    const rows = await this.db.execute<PartRow>(sql`
      WITH clipped AS MATERIALIZED (
        SELECT (ST_Dump(
          ST_Intersection(
            ST_MakeValid(ST_GeomFromText(${polygonToWkt(shape)}::text)),
            ST_MakeValid(ST_GeomFromText(${polygonToWkt(clip)}::text))
          )
        )).geom AS geom
      ),
      inset AS MATERIALIZED (
        SELECT ST_SimplifyPreserveTopology(
          ${inset > 0 ? sql`ST_Buffer(clipped.geom, ${-inset}::float8, ${BUFFER_QUAD_SEGMENTS}::int)` : sql`clipped.geom`},
          ${SIMPLIFY_TOLERANCE}::float8
        ) AS geom
        FROM clipped
        WHERE ST_GeometryType(clipped.geom) = 'ST_Polygon'
      )
      SELECT ST_AsGeoJSON(inset.geom)::text AS ring, ST_Area(inset.geom)::float8 AS area
      FROM inset
      WHERE NOT ST_IsEmpty(inset.geom)
        AND ST_GeometryType(inset.geom) = 'ST_Polygon'
        AND ST_NumInteriorRings(inset.geom) = 0
        AND ST_Area(inset.geom) >= ${MIN_FILL_AREA}::float8
      ORDER BY area DESC
      LIMIT 1
    `);

    const first = rows[0];
    return first ? exteriorRing(first.ring) : null;
  }

  /**
   * A shape with another cut out of it, as one ring, or `null` if nothing usable survives.
   *
   * The twin of `clipTo`, and it exists for the assistant's `reshape`: deepening a border means the
   * lawn beside it gives up exactly the strip the border gained, or the two simply overlap and the
   * plan is drawing one piece of ground twice. Both halves or neither — the caller checks this
   * answered before it emits either change.
   *
   * **Refuses a result with a hole in it**, the same guard `borderRegions` keeps and for the same
   * reason: `PlanGeometry.polygon` cannot express an interior ring, so a doughnut would come back
   * flattened to its outside edge — which is the *opposite* of the subtraction that was asked for.
   * Cutting a bed out of the middle of a lawn is a legitimate thing to want and this is not the
   * operation that can do it; saying so is better than silently returning the lawn unchanged.
   */
  async subtract(shape: Point[], cut: Point[]): Promise<Point[] | null> {
    if (shape.length < 3 || cut.length < 3) return null;

    const rows = await this.db.execute<PartRow>(sql`
      WITH cut AS MATERIALIZED (
        SELECT (ST_Dump(
          ST_Difference(
            ST_MakeValid(ST_GeomFromText(${polygonToWkt(shape)}::text)),
            ST_MakeValid(ST_GeomFromText(${polygonToWkt(cut)}::text))
          )
        )).geom AS geom
      ),
      simplified AS MATERIALIZED (
        SELECT ST_SimplifyPreserveTopology(cut.geom, ${SIMPLIFY_TOLERANCE}::float8) AS geom
        FROM cut
        WHERE ST_GeometryType(cut.geom) = 'ST_Polygon'
      )
      SELECT ST_AsGeoJSON(simplified.geom)::text AS ring, ST_Area(simplified.geom)::float8 AS area
      FROM simplified
      WHERE NOT ST_IsEmpty(simplified.geom)
        AND ST_GeometryType(simplified.geom) = 'ST_Polygon'
        AND ST_NumInteriorRings(simplified.geom) = 0
        AND ST_Area(simplified.geom) >= ${MIN_FILL_AREA}::float8
      ORDER BY area DESC
      LIMIT 1
    `);

    const first = rows[0];
    return first ? exteriorRing(first.ring) : null;
  }

  /**
   * Every ring clipped to `scope`, bucketed by input index, largest piece first.
   *
   * One query for all of them rather than one each: the scope geometry is parsed and validated
   * once, and four zones become one round trip instead of four.
   *
   * Returns *every* surviving piece rather than the largest, which is the difference from
   * `clipTo` and is deliberate. A zone cut by a U-shaped redesign area is genuinely two gardens,
   * and keeping only the bigger one would leave the other with no base fill under it — bare graph
   * paper inside the area the user asked to have designed, which is the exact fault the scope
   * feature exists to prevent.
   */
  async clipRingsTo(rings: Point[][], scope: Point[], inset = 0): Promise<Point[][][]> {
    const buckets: Point[][][] = rings.map(() => []);
    if (scope.length < 3) return buckets;

    const usable = rings
      .map((ring, index) => ({ ring, index }))
      .filter((entry) => entry.ring.length >= 3);
    if (usable.length === 0) return buckets;

    const subjects = sql.join(
      usable.map(
        (entry) =>
          sql`(${entry.index}::int, ST_MakeValid(ST_GeomFromText(${polygonToWkt(entry.ring)}::text)))`,
      ),
      sql`, `,
    );

    const rows = await this.db.execute<PartRow & { idx: number }>(sql`
      WITH scope AS MATERIALIZED (
        SELECT ST_MakeValid(ST_GeomFromText(${polygonToWkt(scope)}::text)) AS geom
      ),
      subject (idx, geom) AS (VALUES ${subjects}),
      cut AS MATERIALIZED (
        SELECT subject.idx, (ST_Dump(ST_Intersection(subject.geom, scope.geom))).geom AS geom
        FROM subject, scope
      ),
      eroded AS MATERIALIZED (
        SELECT cut.idx, (ST_Dump(
          ${
            inset > 0
              ? sql`ST_Buffer(cut.geom, ${-inset}::float8, ${BUFFER_QUAD_SEGMENTS}::int)`
              : sql`cut.geom`
          }
        )).geom AS geom
        FROM cut
        WHERE ST_GeometryType(cut.geom) = 'ST_Polygon'
      ),
      sized AS MATERIALIZED (
        SELECT eroded.idx, eroded.geom
        FROM eroded
        WHERE ST_GeometryType(eroded.geom) = 'ST_Polygon'
          AND ST_Area(eroded.geom) >= ${MIN_FILL_AREA}::float8
          -- The same minimum-width test accentRegions uses: a 0.3 x 5 m offcut is not a garden.
          AND NOT ST_IsEmpty(
            ST_Buffer(eroded.geom, ${-MIN_FILL_SIDE / 2}::float8, ${BUFFER_QUAD_SEGMENTS}::int)
          )
      ),
      tidy AS MATERIALIZED (
        /*
         * Clamped back inside the scope as the last step, exactly as borderRegions clamps to the
         * plot and for the same reason: ST_SimplifyPreserveTopology preserves topology but *not*
         * containment, and a vertex nudged a centimetre outward is a centimetre of garden the
         * user said not to touch.
         */
        SELECT sized.idx,
          ST_Intersection(
            ST_SimplifyPreserveTopology(sized.geom, ${SIMPLIFY_TOLERANCE}::float8),
            scope.geom
          ) AS geom
        FROM sized, scope
      )
      SELECT tidy.idx::int AS idx,
             ST_AsGeoJSON(tidy.geom)::text AS ring,
             ST_Area(tidy.geom)::float8 AS area
      FROM tidy
      WHERE NOT ST_IsEmpty(tidy.geom)
        AND ST_GeometryType(tidy.geom) = 'ST_Polygon'
        /*
         * Defensive, in the style borderRegions uses. Two simple rings cannot intersect to a shape
         * with a hole, so this can only fire if the scope ring was not simple — and exteriorRing
         * would then silently hand back the whole outer ring and paint over the very ground the
         * user excluded. Refuse rather than trust.
         */
        AND ST_NumInteriorRings(tidy.geom) = 0
        AND ST_Area(tidy.geom) >= ${MIN_FILL_AREA}::float8
      ORDER BY idx, area DESC
    `);

    for (const row of rows) {
      const ring = exteriorRing(row.ring);
      if (ring) buckets[row.idx]?.push(ring);
    }

    return buckets;
  }
}

/** A cut line, extended well past any plot so `ST_Split` always crosses the whole remainder. */
const CUT_REACH = 500;

function lineWkt([a, b]: [Point, Point]): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = (dx / length) * CUT_REACH;
  const uy = (dy / length) * CUT_REACH;
  return `LINESTRING(${a.x - ux} ${a.y - uy}, ${a.x + ux} ${a.y + uy})`;
}

/**
 * The exterior ring of a GeoJSON polygon, with the closing point dropped.
 *
 * `PlanGeometry.polygon` rings are open — `polygonToWkt` closes them on the way out — so keeping
 * GeoJSON's repeated final vertex would put a duplicate corner in every stored shape.
 */
function exteriorRing(geoJson: string): Point[] | null {
  const parsed = JSON.parse(geoJson) as { type: string; coordinates: [number, number][][] };
  if (parsed.type !== 'Polygon') return null;

  const outer = parsed.coordinates[0];
  if (!outer || outer.length < 4) return null;

  const closed = outer.slice(0, -1);

  return closed.map(([x, y]) => ({ x, y }));
}
