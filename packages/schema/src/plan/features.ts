import { z } from 'zod';
import {
  midpoint,
  polygonArea,
  polygonCentroid,
  polygonContainsPolygon,
  polygonsIntersect,
  PointSchema,
  type Point,
} from '../geometry/primitives.js';
import {
  circleRing,
  polylineLength,
  polylineStrip,
  rectToPolygon,
  roundPolygon,
} from '../geometry/shapes.js';

/**
 * What is already in the garden, and what the user wants done with it.
 *
 * Same convention as everywhere else on the plan: metres, origin top-left, +y downwards,
 * rotation in degrees clockwise.
 */

export const FeatureKindSchema = z.enum([
  'tree',
  'shed',
  'patio',
  'path',
  'fence',
  /**
   * A side gate, on the **boundary** rather than on the house.
   *
   * A sibling of `Opening`, not one of them, and the distinction is load-bearing: an opening is
   * keyed on a *wall id*, and the boundary has vertices, not walls. Reusing `Opening` here would
   * make `wallId` mean a house wall in one place and a boundary edge in another — exactly the
   * ambiguity `ZoneId` was given its own leaf module to avoid. As a feature it is placed on step 2
   * alongside every other physical thing in the garden, and the existing placement and validation
   * machinery handles it unchanged.
   */
  'gate',
  'water',
  'steps',
  'planting',
  'other',
]);
export type FeatureKind = z.infer<typeof FeatureKindSchema>;

export const FeatureStatusSchema = z.enum(['keep', 'remove', 'replace']);
export type FeatureStatus = z.infer<typeof FeatureStatusSchema>;

/** How a feature of a given kind gets drawn onto the plan. */
export type Placement = 'point' | 'rect' | 'polygon' | 'polyline';

/**
 * The four shapes a garden plan needs.
 *
 * Named `PlanGeometry` rather than `FeatureGeometry` because it is not feature-specific: a
 * generated concept element uses the same union for its `shape`, which is what lets
 * `geometryOutline`, `geometryArea` and `geometryAnchor` work on both with no adapter. A
 * concept element that measured itself differently from an existing feature would be the same
 * class of bug as the canvas and the validator disagreeing.
 */
export const PlanGeometrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('point'),
    at: PointSchema,
    radius: z.number().positive(),
  }),
  z.object({
    kind: z.literal('rect'),
    centre: PointSchema,
    width: z.number().positive(),
    depth: z.number().positive(),
    rotation: z.number().default(0),
  }),
  z.object({
    kind: z.literal('polygon'),
    points: z.array(PointSchema).min(3),
    /** Rounds every corner by the same amount; 0 leaves them square. */
    cornerRadius: z.number().nonnegative().default(0),
  }),
  z.object({
    kind: z.literal('polyline'),
    points: z.array(PointSchema).min(2),
    width: z.number().positive(),
  }),
]);
export type PlanGeometry = z.infer<typeof PlanGeometrySchema>;

export const PlacedFeatureSchema = z.object({
  id: z.string(),
  kind: FeatureKindSchema,
  /** Auto-named on placement, then editable — the mockup's "Rear patio", "Side shed". */
  name: z.string(),
  geometry: PlanGeometrySchema,
  status: FeatureStatusSchema,
  /** Only meaningful while `status` is 'replace'. Free text, e.g. "Deck". */
  replaceWith: z.string().nullable().default(null),
});
export type PlacedFeature = z.infer<typeof PlacedFeatureSchema>;

export const FeaturesSectionSchema = z.object({
  features: z.array(PlacedFeatureSchema).default([]),
  /**
   * "Nothing to add" was ticked. Real user intent rather than an absence of it, which is why it
   * is stored: an empty list because the garden is bare reads differently from an empty list
   * because the user has not started.
   */
  skipped: z.boolean().default(false),
});
export type FeaturesSection = z.infer<typeof FeaturesSectionSchema>;

/** Smallest side a rectangle feature's handles will produce, in metres. */
export const MIN_FEATURE_SIDE = 0.3;

/** How far the corner-rounding control goes, in metres. */
export const MAX_CORNER_RADIUS = 3;

/* ---------------------------------------------------------------- derived reads */

/**
 * A closed ring around the geometry in world coordinates, for hit-testing, area and
 * validation.
 *
 * Every kind is tessellated here, in TypeScript, and the same ring is handed to PostGIS. That
 * is the rule the whole geometry layer exists to keep: if the canvas tessellated a shape
 * differently from the validator, a feature could render inside the boundary and validate as
 * outside it.
 */
export function geometryOutline(geometry: PlanGeometry): Point[] {
  switch (geometry.kind) {
    case 'point':
      return circleRing(geometry.at, geometry.radius);

    case 'rect':
      return rectToPolygon(geometry);

    case 'polygon':
      return roundPolygon(geometry.points, geometry.cornerRadius);

    case 'polyline':
      return polylineStrip(geometry.points, geometry.width);
  }
}

/**
 * Ground covered, in square metres. Point features report zero — a tree's canopy is not an
 * area anybody is costing — so the panels can use a falsy check to decide whether to show it.
 */
export function geometryArea(geometry: PlanGeometry): number {
  if (geometry.kind === 'point') return 0;
  if (geometry.kind === 'polyline') return polylineLength(geometry.points) * geometry.width;

  return polygonArea(geometryOutline(geometry));
}

/** Where a label hangs and which zone the shape counts as being in. */
export function geometryAnchor(geometry: PlanGeometry): Point {
  switch (geometry.kind) {
    case 'point':
      return geometry.at;
    case 'rect':
      return geometry.centre;
    case 'polygon':
      return polygonCentroid(geometry.points);
    case 'polyline': {
      // The middle of the middle segment, so a path label sits on the path rather than in the
      // empty space a centroid would find inside a bend.
      const index = Math.max(0, Math.floor((geometry.points.length - 1) / 2));
      return midpoint(
        geometry.points[index]!,
        geometry.points[index + 1] ?? geometry.points[index]!,
      );
    }
  }
}

export function translateGeometry(geometry: PlanGeometry, dx: number, dy: number): PlanGeometry {
  const shift = (point: Point): Point => ({ x: point.x + dx, y: point.y + dy });

  switch (geometry.kind) {
    case 'point':
      return { ...geometry, at: shift(geometry.at) };
    case 'rect':
      return { ...geometry, centre: shift(geometry.centre) };
    case 'polygon':
    case 'polyline':
      return { ...geometry, points: geometry.points.map(shift) };
  }
}

/** Moves a geometry so its anchor lands on `to`, keeping its shape. */
export function moveGeometry(geometry: PlanGeometry, to: Point): PlanGeometry {
  const from = geometryAnchor(geometry);
  return translateGeometry(geometry, to.x - from.x, to.y - from.y);
}

/* ---------------------------------------------------------------- constraints */

/**
 * Nothing sits on the house.
 *
 * Touching is fine — a patio butting up against the back wall is the normal case, and
 * `polygonsIntersect` already treats flush edges as clear. This is the TypeScript twin of the
 * validator's `ST_Intersects(a, b) AND NOT ST_Touches(a, b)`.
 */
export function geometryClearsHouse(geometry: PlanGeometry, housePolygon: Point[] | null): boolean {
  if (!housePolygon || housePolygon.length < 3) return true;

  return !polygonsIntersect(geometryOutline(geometry), housePolygon);
}

/**
 * Nothing hangs over the fence. `polygonContainsPolygon` checks both that every corner is
 * inside and that no edge crosses out — the second half is what catches a shape spanning a
 * concave notch with all its corners still on the property.
 */
export function geometryFitsInside(geometry: PlanGeometry, boundary: Point[]): boolean {
  if (boundary.length < 3) return true;

  return polygonContainsPolygon(boundary, geometryOutline(geometry));
}

/**
 * The single predicate every mutation runs before committing. Placement, dragging, reshaping,
 * resizing, rotating and rounding all have to satisfy the same two rules, so they all ask here
 * rather than each remembering to check both — and so does the server's assistant planner,
 * which means a patio the AI proposes is judged by exactly the rule a shed dragged by hand on
 * step 2 is judged by.
 */
export function geometryIsLegal(
  geometry: PlanGeometry,
  housePolygon: Point[] | null,
  boundary: Point[],
): boolean {
  return geometryClearsHouse(geometry, housePolygon) && geometryFitsInside(geometry, boundary);
}

/* ---------------------------------------------------------------- feature wrappers */

export function featureOutline(feature: PlacedFeature): Point[] {
  return geometryOutline(feature.geometry);
}

export function featureArea(feature: PlacedFeature): number {
  return geometryArea(feature.geometry);
}

export function featureAnchor(feature: PlacedFeature): Point {
  return geometryAnchor(feature.geometry);
}

export function featureClearsHouse(feature: PlacedFeature, housePolygon: Point[] | null): boolean {
  return geometryClearsHouse(feature.geometry, housePolygon);
}

export function featureFitsInside(feature: PlacedFeature, boundary: Point[]): boolean {
  return geometryFitsInside(feature.geometry, boundary);
}

export function featureIsLegal(
  feature: PlacedFeature,
  housePolygon: Point[] | null,
  boundary: Point[],
): boolean {
  return geometryIsLegal(feature.geometry, housePolygon, boundary);
}
