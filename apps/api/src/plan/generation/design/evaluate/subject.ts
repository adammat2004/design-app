import {
  elementArea,
  elementCentreline,
  elementOutline,
  isCounted,
  isPlantSymbol,
  isTreeSymbol,
  polygonCentroid,
  polylineLength,
  resolveSymbol,
  type DesignBrief,
  type DesignElement,
  type DesiredFeature,
  type ElementCategory,
  type FunctionalZoneType,
  type Point,
} from '@garden-studio/schema';
import { FEATURE_LIBRARY } from '../../knowledge/feature-library.js';
import type { RelationSubject } from '../../knowledge/relationship-rules.js';
import type { SiteAnalysis } from '../types.js';

/**
 * The plan, resolved once into the shape the principles actually ask questions of.
 *
 * Every principle wants some version of the same three things: where the built features are, where
 * the routes run, and what covers the ground. Resolving that ten times — once per principle, each
 * with its own idea of what counts as a feature — is how two rules come to disagree about whether a
 * raised bed is a structure or planting. So it is done once, here, and the principles are pure
 * functions of the result.
 *
 * The subject is built from `DesignElement[]`, which is deliberate: the **same evaluator** then
 * scores a structural candidate (whose sketched rectangles the layout generator converts to
 * elements) and a finished concept (whose elements PostGIS has already cut and clipped). The two
 * tiers differ in when they run and what they can see, never in what they measure.
 */

/** A built thing: a terrace, a shed, a fire pit — anything the brief asked for and got. */
export interface SubjectItem {
  id: string;
  /** Which requested feature this is, where it could be identified. */
  feature: DesiredFeature | null;
  zone: FunctionalZoneType | null;
  category: ElementCategory;
  name: string;
  ring: Point[];
  centre: Point;
  area: number;
  /** Degrees clockwise, for the alignment check. `null` for anything that is not a rectangle. */
  rotation: number | null;
  material: string | null;
}

/** A path: the strip it occupies and the line down the middle of it. */
export interface SubjectRoute {
  id: string;
  name: string;
  ring: Point[];
  centreline: Point[];
  width: number;
  length: number;
  /** Straight-line distance between its ends: the denominator of the detour ratio. */
  span: number;
}

/** A region of ground cover: a lawn panel, a planting bed, a gravel area. */
export interface SubjectRegion {
  id: string;
  category: ElementCategory;
  ring: Point[];
  centre: Point;
  area: number;
  isBase: boolean;
}

export interface DesignSubject {
  /** Every element, in stacking order, for the passes that need the whole picture. */
  elements: DesignElement[];
  items: SubjectItem[];
  routes: SubjectRoute[];
  regions: SubjectRegion[];
  /** Accent lawn and gravel panels: the open ground of the garden. */
  panels: SubjectRegion[];
  beds: SubjectRegion[];
  trees: SubjectItem[];
  /** Distinct surface materials, which is what the style rules cap. */
  materials: Set<string>;
  /** Where each relation subject actually is, for the relationship rules. */
  positions: Map<RelationSubject, Point[]>;
  analysis: SiteAnalysis;
  brief: DesignBrief;
}

/**
 * A minimum route width, below which a strip is decoration rather than circulation.
 *
 * **Read off `circulationFor`'s own narrowest legitimate route rather than declared.** The first
 * version said 0.9 m, which is a defensible number for a path and happens to be a centimetre above
 * the 0.85 m the generator deliberately gives a secondary stepping-stone route — so the harness
 * reported over a hundred "too narrow" faults that were the generator doing exactly what its own
 * policy says. A scorer that disagrees with a considered decision elsewhere in the system is
 * reporting a difference of opinion as a defect.
 *
 * 0.8 m leaves that route alone and still catches a strip nobody could walk down.
 */
export const MIN_ROUTE_WIDTH = 0.8;

/**
 * The categories whose material is a composition decision.
 *
 * What a style rule means by "few materials" is the ground: paving, setts, gravel, turf. A timber
 * shed and a mixed border are a structure choice and a planting choice, and counting them had every
 * plan in the harness reporting six materials against a cap of three — a number that could never be
 * met and therefore said nothing about any particular plan.
 */
const SURFACE_CATEGORIES: ElementCategory[] = ['paved-area', 'gravel-mulch', 'lawn'];

export function buildSubject(
  elements: DesignElement[],
  analysis: SiteAnalysis,
  brief: DesignBrief,
  featureOf: Map<string, DesiredFeature> = new Map(),
): DesignSubject {
  const items: SubjectItem[] = [];
  const routes: SubjectRoute[] = [];
  const regions: SubjectRegion[] = [];
  const trees: SubjectItem[] = [];
  const materials = new Set<string>();

  for (const element of elements) {
    if (element.hidden) continue;
    const ring = elementOutline(element);
    if (ring.length < 3) continue;

    /*
     * Plants and furniture are neither features nor ground. A tree canopy counted as a planting
     * region would turn five trees into forty square metres of border — the same trap
     * `measureComposition` documents — and a dining set counted as a built feature would have every
     * terrace score as two overlapping things.
     */
    if (isPlantSymbol(element.symbol)) {
      const symbol = resolveSymbol(element);
      if (symbol && isTreeSymbol(symbol)) trees.push(toItem(element, ring, featureOf));
      continue;
    }
    if (isCounted(element.category)) continue;

    if (element.material && SURFACE_CATEGORIES.includes(element.category)) {
      materials.add(element.material);
    }

    if (element.role === 'feature') {
      const centreline = elementCentreline(element);
      if (centreline && element.shape.kind === 'polyline') {
        const ends = [centreline[0]!, centreline[centreline.length - 1]!];
        routes.push({
          id: element.id,
          name: element.name ?? 'Path',
          ring,
          centreline,
          width: element.shape.width,
          length: polylineLength(centreline),
          span: Math.hypot(ends[1]!.x - ends[0]!.x, ends[1]!.y - ends[0]!.y),
        });
        continue;
      }
      items.push(toItem(element, ring, featureOf));
      continue;
    }

    regions.push({
      id: element.id,
      category: element.category,
      ring,
      centre: polygonCentroid(ring),
      area: elementArea(element),
      isBase: element.fillKind === 'base',
    });
  }

  const panels = regions.filter(
    (region) =>
      !region.isBase && (region.category === 'lawn' || region.category === 'gravel-mulch'),
  );
  const beds = regions.filter((region) => !region.isBase && region.category === 'planting-bed');

  return {
    elements,
    items,
    routes,
    regions,
    panels,
    beds,
    trees,
    materials,
    positions: positionsOf(items, panels, analysis),
    analysis,
    brief,
  };
}

function toItem(
  element: DesignElement,
  ring: Point[],
  featureOf: Map<string, DesiredFeature>,
): SubjectItem {
  const feature = featureOf.get(element.id) ?? null;
  return {
    id: element.id,
    feature,
    zone: feature ? FEATURE_LIBRARY[feature].zone : null,
    category: element.category,
    name: element.name ?? '',
    ring,
    centre: polygonCentroid(ring),
    area: elementArea(element),
    rotation: element.shape.kind === 'rect' ? element.shape.rotation : null,
    material: element.material ?? null,
  };
}

/**
 * Where each thing a relationship rule can name actually is.
 *
 * A list of points per subject rather than one, because a garden can have two seating areas and a
 * rule about seating should be satisfied by the nearer of them. `house`, `gate` and `street` come
 * off the analysis; `lawn` is the centre of every open panel.
 */
function positionsOf(
  items: SubjectItem[],
  panels: SubjectRegion[],
  analysis: SiteAnalysis,
): Map<RelationSubject, Point[]> {
  const positions = new Map<RelationSubject, Point[]>();
  const add = (key: RelationSubject, point: Point | null | undefined) => {
    if (!point) return;
    positions.set(key, [...(positions.get(key) ?? []), point]);
  };

  for (const item of items) if (item.feature) add(item.feature, item.centre);
  for (const panel of panels) if (panel.category === 'lawn') add('lawn', panel.centre);

  /*
   * The house is represented by the doorway rather than by its centroid: every rule that mentions
   * it — the barbecue near the house, the garden room away from it — is really about the distance
   * you walk, and that starts at the door.
   */
  add('house', analysis.exits.primary?.centre ?? analysis.house?.centre);
  for (const gate of analysis.gates) add('gate', gate.centre);
  for (const edge of analysis.edges) {
    if (edge.exposure === 'street') {
      add('street', { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 });
    }
  }

  return positions;
}

/** The shortest distance between any pair of positions for two subjects; `null` if either is absent. */
export function nearestDistance(
  subject: DesignSubject,
  a: RelationSubject,
  b: RelationSubject,
): number | null {
  const from = subject.positions.get(a);
  const to = subject.positions.get(b);
  if (!from?.length || !to?.length) return null;

  let best = Infinity;
  for (const one of from) {
    for (const other of to) best = Math.min(best, Math.hypot(one.x - other.x, one.y - other.y));
  }
  return best;
}
