import {
  boundingBox,
  featureAnchor,
  featureOutline,
  translateGeometry,
  MAX_CORNER_RADIUS,
  MIN_FEATURE_SIDE,
  type FeatureKind,
  type PlacedFeature,
  type Point,
} from '@garden-studio/schema';

/**
 * The palette and the editing gestures for step 2.
 *
 * The *model* — what a placed feature is, the four geometry kinds, how each one is drawn and how
 * big it starts, and the two rules every mutation has to satisfy — lives in
 * `@garden-studio/schema`, because the PostGIS validator checks the same shapes against the same
 * rules and the garden assistant places from the same defaults. What stays here is the screen:
 * which kinds the palette offers, in what order, and what dragging a handle does.
 */

export {
  defaultFeatureName,
  FEATURE_DEFINITIONS,
  MAX_CORNER_RADIUS,
  MIN_FEATURE_SIDE,
  minimumDraftPoints,
  featureAnchor,
  elementIsLegal,
  featureArea,
  featureClearsHouse,
  featureFitsInside,
  featureIsLegal,
  featureOutline,
  geometryAnchor,
  geometryArea,
  geometryClearsHouse,
  geometryFitsInside,
  geometryIsLegal,
  geometryOutline,
  legalFootprint,
  moveGeometry,
  polylineLength,
  polylineStrip,
  roundPolygon,
  translateGeometry,
  type FeatureDefinition,
  type FeatureKind,
  type FeatureStatus,
  type PlacedFeature,
  type Placement,
  type PlanGeometry,
} from '@garden-studio/schema';

/** Palette order, which is also legend order. */
export const FEATURE_KINDS: FeatureKind[] = [
  'tree',
  'shed',
  'patio',
  'path',
  'fence',
  // 'gate' is deliberately absent: a gate is placed on step 1 as part of the fence (see
  // `gate.ts`), where the generator can read which fence it opens through. The kind stays in the
  // schema so a plan that placed one here before still parses.
  'water',
  'steps',
  'planting',
  'other',
];

/* ---------------------------------------------------------------- gestures */

/** Moves a feature so its anchor lands on `to`, keeping its shape. */
export function moveFeature(feature: PlacedFeature, to: Point): PlacedFeature {
  const from = featureAnchor(feature);

  return translateFeature(feature, to.x - from.x, to.y - from.y);
}

export function translateFeature(feature: PlacedFeature, dx: number, dy: number): PlacedFeature {
  return { ...feature, geometry: translateGeometry(feature.geometry, dx, dy) };
}

/**
 * The corner points a user can drag, for the shapes that have them. Points and rectangles return
 * null — a rectangle is reshaped by its handles, not vertex by vertex.
 *
 * These are the raw, pre-rounding points: rounding is a property of the shape, not something the
 * user edits corner by corner.
 */
export function featureVertices(feature: PlacedFeature): Point[] | null {
  const { geometry } = feature;
  if (geometry.kind === 'polygon' || geometry.kind === 'polyline') return geometry.points;
  return null;
}

export function withVertices(feature: PlacedFeature, points: Point[]): PlacedFeature {
  const { geometry } = feature;
  if (geometry.kind !== 'polygon' && geometry.kind !== 'polyline') return feature;

  return { ...feature, geometry: { ...geometry, points } };
}

/** Below this a polygon is no longer an area and a line is no longer a line. */
export function minimumVertices(feature: PlacedFeature): number {
  return feature.geometry.kind === 'polygon' ? 3 : 2;
}

export function resizeFeature(
  feature: PlacedFeature,
  size: Partial<{ width: number; depth: number }>,
): PlacedFeature {
  const { geometry } = feature;
  if (geometry.kind !== 'rect') return feature;

  return {
    ...feature,
    geometry: {
      ...geometry,
      width: Math.max(MIN_FEATURE_SIDE, size.width ?? geometry.width),
      depth: Math.max(MIN_FEATURE_SIDE, size.depth ?? geometry.depth),
    },
  };
}

export function rotateFeature(feature: PlacedFeature, degrees: number): PlacedFeature {
  const { geometry } = feature;
  if (geometry.kind !== 'rect') return feature;

  const wrapped = degrees % 360;

  return {
    ...feature,
    geometry: { ...geometry, rotation: wrapped < 0 ? wrapped + 360 : wrapped },
  };
}

export function setCornerRadius(feature: PlacedFeature, radius: number): PlacedFeature {
  const { geometry } = feature;
  if (geometry.kind !== 'polygon') return feature;

  const clamped = Math.min(MAX_CORNER_RADIUS, Math.max(0, radius));
  if (clamped === geometry.cornerRadius) return feature;

  return { ...feature, geometry: { ...geometry, cornerRadius: clamped } };
}

/** The axis-aligned box a feature occupies — for marquee hit-testing and snap targets. */
export function featureBounds(feature: PlacedFeature) {
  return boundingBox(featureOutline(feature));
}

/** Live counts for the "N placed · X keep · Y remove · Z replace" line. */
export function summariseFeatures(features: PlacedFeature[]): {
  total: number;
  keep: number;
  remove: number;
  replace: number;
} {
  return {
    total: features.length,
    keep: features.filter((feature) => feature.status === 'keep').length,
    remove: features.filter((feature) => feature.status === 'remove').length,
    replace: features.filter((feature) => feature.status === 'replace').length,
  };
}
