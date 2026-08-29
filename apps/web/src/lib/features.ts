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
 * The *model* — what a placed feature is, the four geometry kinds, and the two rules every
 * mutation has to satisfy — lives in `@garden-studio/schema`, because the PostGIS validator
 * checks the same shapes against the same rules. What stays here is the screen: which kinds the
 * palette offers, how big a new one starts, and what dragging a handle does.
 */

export {
  MAX_CORNER_RADIUS,
  MIN_FEATURE_SIDE,
  featureAnchor,
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
  moveGeometry,
  polylineLength,
  polylineStrip,
  roundPolygon,
  translateGeometry,
  type FeatureKind,
  type FeatureStatus,
  type PlacedFeature,
  type PlanGeometry,
} from '@garden-studio/schema';

/** How a feature of a given kind gets drawn onto the plan. */
export type Placement = 'point' | 'rect' | 'polygon' | 'polyline';

export interface FeatureDefinition {
  label: string;
  placement: Placement;
  /** Point radius, rect size, or strip width, depending on the placement. */
  size: { radius?: number; width?: number; depth?: number };
}

/** Palette order, which is also legend order. */
export const FEATURE_KINDS: FeatureKind[] = [
  'tree',
  'shed',
  'patio',
  'path',
  'fence',
  'gate',
  'water',
  'steps',
  'planting',
  'other',
];

export const FEATURE_DEFINITIONS: Record<FeatureKind, FeatureDefinition> = {
  tree: { label: 'Tree', placement: 'point', size: { radius: 1.5 } },
  shed: { label: 'Shed', placement: 'rect', size: { width: 2.5, depth: 2 } },
  patio: { label: 'Patio/Deck', placement: 'polygon', size: {} },
  path: { label: 'Path', placement: 'polyline', size: { width: 1 } },
  fence: { label: 'Fence', placement: 'polyline', size: { width: 0.2 } },
  /*
   * A point on the boundary rather than a run along it: what matters about a gate is where you get
   * through, and the radius is about the width of one. Wide enough for a wheelie bin, which is the
   * measurement the utility route will care about.
   */
  gate: { label: 'Side gate', placement: 'point', size: { radius: 0.45 } },
  water: { label: 'Water feature', placement: 'point', size: { radius: 0.6 } },
  steps: { label: 'Steps', placement: 'rect', size: { width: 1.5, depth: 0.8 } },
  planting: { label: 'Planting bed', placement: 'polygon', size: {} },
  other: { label: 'Other', placement: 'point', size: { radius: 0.5 } },
};

/** The fewest clicks that make a shape: a polygon needs three, a line needs two. */
export function minimumDraftPoints(placement: Placement): number {
  return placement === 'polygon' ? 3 : 2;
}

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

/* ---------------------------------------------------------------- naming */

/**
 * "Patio", then "Patio 2" — the plainest thing that stays unique, since the user renames
 * anything they care about anyway.
 */
export function defaultFeatureName(kind: FeatureKind, existing: PlacedFeature[]): string {
  const base = FEATURE_DEFINITIONS[kind].label;
  const taken = new Set(existing.map((feature) => feature.name));

  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
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
