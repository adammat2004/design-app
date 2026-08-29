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

/** Below this a region is a sliver, not a bed. */
export const MIN_FILL_AREA = 1.2;

/** And below this it is a sliver in one direction even if its area passes. */
export const MIN_FILL_SIDE = 1.2;

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

    const obstacleUnion: SQL =
      rings.length === 0
        ? sql`'POLYGON EMPTY'::geometry`
        : sql`ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(
            rings.map((ring) => sql`ST_GeomFromText(${polygonToWkt(ring)}::text)`),
            sql`, `,
          )}]))`;

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

    const obstacleUnion: SQL =
      rings.length === 0
        ? sql`'POLYGON EMPTY'::geometry`
        : sql`ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(
            rings.map((ring) => sql`ST_GeomFromText(${polygonToWkt(ring)}::text)`),
            sql`, `,
          )}]))`;

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
