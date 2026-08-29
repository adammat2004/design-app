import { Inject, Injectable } from '@nestjs/common';
import {
  geometryOutline,
  housePolygon,
  polygonToWkt,
  type PlanDocument,
  type PlanGeometry,
  type ValidationResult,
  type ValidationViolation,
  type ViolationCode,
} from '@garden-studio/schema';
import { sql, type SQL } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../db/db.module.js';

// A type alias rather than an interface: db.execute's row generic requires an index
// signature, which TypeScript infers implicitly for aliases but never for interfaces.
type ViolationRow = {
  code: ViolationCode;
  target_ids: string[];
};

@Injectable()
export class GeometryValidationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Checks a candidate plan against the hard spatial constraints.
   *
   * Geometries are constructed inline from the payload, so this never needs the plan to exist
   * in the database. That keeps it a pure function of its input: the section-patch handlers
   * validate the merged document before writing it, `POST /validate` has no side effects at
   * all, and the tests insert nothing.
   *
   * Every shape is tessellated by `geometryOutline` in TypeScript and handed to PostGIS as a
   * polygon — the canvas draws the same ring. Buffering a circle or a line here instead would
   * make the server disagree with the editor about where the edge is, which reads to the user
   * as an inexplicable refusal.
   */
  async validate(document: PlanDocument): Promise<ValidationResult> {
    const violations: ValidationViolation[] = [];
    const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));

    // Structural checks SQL cannot express: there has to be a ring before there is geometry.
    if (boundary.length < 3 || !document.site.closed) {
      violations.push({
        code: 'boundary_not_closed',
        targetIds: [],
        section: 'site',
        message: 'The property boundary is not closed yet.',
      });

      return { valid: false, violations };
    }

    const house = document.site.house;
    const features = document.features.features;
    const elements = document.layout.elements;

    const ctes: SQL[] = [
      sql`boundary AS (SELECT ST_GeomFromText(${polygonToWkt(boundary)}::text) AS geom)`,
    ];

    const branches: SQL[] = [
      sql`SELECT 'invalid_boundary'::text AS code, ARRAY[]::text[] AS target_ids
          FROM boundary WHERE NOT ST_IsValid(geom)`,
    ];

    if (house) {
      ctes.push(
        sql`house AS (SELECT ST_GeomFromText(${polygonToWkt(housePolygon(house))}::text) AS geom)`,
      );

      // A check that could not exist while the house was an edge index rather than a shape.
      branches.push(
        sql`SELECT 'house_outside_boundary'::text, ARRAY[]::text[]
            FROM house h, boundary b WHERE NOT ST_Contains(b.geom, h.geom)`,
      );
    }

    if (features.length > 0) {
      ctes.push(
        shapesCte(
          'features',
          features.map((feature) => shapeRow(feature.id, feature.geometry)),
        ),
      );

      // ST_Contains permits a feature sitting flush against the fence while still rejecting
      // anything that pokes out over it.
      branches.push(
        sql`SELECT 'feature_outside_boundary'::text, ARRAY[f.id]
            FROM features f, boundary b
            WHERE NOT ST_Contains(b.geom, f.geom)`,
      );

      // NOT ST_Overlaps: that predicate is false when one feature sits entirely inside
      // another (a shed within a patio would slip through) and false for features that
      // merely touch. Sharing interior space is ST_Intersects minus ST_Touches.
      // `a.id < b.id` reports each unordered pair exactly once.
      branches.push(
        sql`SELECT 'features_overlap'::text, ARRAY[a.id, b.id]
            FROM features a JOIN features b ON a.id < b.id
            WHERE ST_Intersects(a.geom, b.geom) AND NOT ST_Touches(a.geom, b.geom)`,
      );

      if (house) {
        // Touching stays legal: a patio butting against the back wall is the normal case, and
        // the same allowance the editor's `geometryClearsHouse` already makes.
        branches.push(
          sql`SELECT 'feature_on_house'::text, ARRAY[f.id]
              FROM features f, house h
              WHERE ST_Intersects(f.geom, h.geom) AND NOT ST_Touches(f.geom, h.geom)`,
        );
      }
    }

    if (elements.length > 0) {
      ctes.push(
        shapesCte(
          'elements',
          elements.map((element) => shapeRow(element.id, element.shape)),
        ),
      );

      branches.push(
        sql`SELECT 'element_outside_boundary'::text, ARRAY[e.id]
            FROM elements e, boundary b
            WHERE NOT ST_Contains(b.geom, e.geom)`,
      );

      if (house) {
        branches.push(
          sql`SELECT 'element_on_house'::text, ARRAY[e.id]
              FROM elements e, house h
              WHERE ST_Intersects(e.geom, h.geom) AND NOT ST_Touches(e.geom, h.geom)`,
        );
      }
    }

    /*
     * There is deliberately no `elements_overlap`. A concept stacks a pergola on a patio on a
     * base fill by design — `element-groups.ts` computes shares against the planned area for
     * exactly that reason — so treating overlap as a violation would flag every correct
     * concept. Layout elements are checked for containment and house clearance only, which is
     * precisely what `geometryIsLegal` checks on the client.
     */

    const rows = await this.db.execute<ViolationRow>(
      sql`WITH ${sql.join(ctes, sql`, `)} ${sql.join(branches, sql` UNION ALL `)}`,
    );

    const labels = new Map<string, string>([
      ...features.map((feature) => [feature.id, feature.name || feature.kind] as const),
      ...elements.map((element) => [element.id, element.name || element.category] as const),
    ]);

    for (const row of rows) {
      const targetIds = row.target_ids ?? [];
      violations.push({
        code: row.code,
        targetIds,
        section: sectionFor(row.code),
        message: describeViolation(row.code, targetIds, labels),
      });
    }

    return { valid: violations.length === 0, violations };
  }
}

/** `(id, geom)` row for a VALUES-backed CTE. */
function shapeRow(id: string, geometry: PlanGeometry): SQL {
  return sql`(${id}::text, ST_GeomFromText(${polygonToWkt(geometryOutline(geometry))}::text))`;
}

function shapesCte(name: 'features' | 'elements', rows: SQL[]): SQL {
  const table = sql.raw(name);

  return sql`${table} AS (SELECT * FROM (VALUES ${sql.join(rows, sql`, `)}) AS t(id, geom))`;
}

/** Which step can fix it, so the UI can offer a way back there. */
function sectionFor(code: ViolationCode): ValidationViolation['section'] {
  switch (code) {
    case 'boundary_not_closed':
    case 'invalid_boundary':
    case 'house_outside_boundary':
      return 'site';
    case 'feature_outside_boundary':
    case 'feature_on_house':
    case 'features_overlap':
      return 'features';
    case 'element_outside_boundary':
    case 'element_on_house':
      return 'layout';
  }
}

function describeViolation(
  code: ViolationCode,
  targetIds: string[],
  labels: Map<string, string>,
): string {
  const label = (id: string) => labels.get(id) ?? 'shape';

  switch (code) {
    case 'boundary_not_closed':
      return 'The property boundary is not closed yet.';
    case 'invalid_boundary':
      return 'The property boundary is not a valid shape — its outline crosses itself.';
    case 'house_outside_boundary':
      return 'The house is not fully inside the property boundary.';
    case 'feature_outside_boundary':
      return `The ${label(targetIds[0] ?? '')} is not fully inside the property boundary.`;
    case 'feature_on_house':
      return `The ${label(targetIds[0] ?? '')} overlaps the house.`;
    case 'features_overlap':
      return `The ${label(targetIds[0] ?? '')} overlaps the ${label(targetIds[1] ?? '')}.`;
    case 'element_outside_boundary':
      return `The ${label(targetIds[0] ?? '')} is not fully inside the property boundary.`;
    case 'element_on_house':
      return `The ${label(targetIds[0] ?? '')} overlaps the house.`;
  }
}
