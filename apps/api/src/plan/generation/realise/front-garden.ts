import {
  geometryOutline,
  polygonsIntersect,
  type DesignElement,
  type MaterialId,
  type PlanGeometry,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import { materialFor } from '../archetypes.js';
import type { DesignConstraints } from '../constraints.js';
import { isIgnored, withinRing } from '../design/circulation.js';
import { localBox, type DesignFrame } from '../layout/frame.js';
import { FRONT_PATH_WIDTH, frontGarden } from '../layout/front.js';
import { placeable } from './placeable.js';

export interface FrontGardenContext {
  /** The frame off the front door, and the front garden the plot has in it. */
  frame: DesignFrame;
  room: Point[];
  zone: ZoneId;
  street: [Point, Point] | null;
  houseRing: Point[];
  thresholds: Point[][];
  boundary: Point[];
  scopePolygon: Point[] | null;
  /** What the path and beds must clear, grown by the path laid. */
  obstacles: Point[][];
  constraints: DesignConstraints;
  index: number;
  nextId: () => string;
  /** Where the front path goes: it is a feature, drawn over the ground cover. */
  featureLayer: DesignElement[];
  pathElement: (
    geometry: PlanGeometry,
    name: string,
    material: MaterialId,
    category?: DesignElement['category'],
    purpose?: string,
  ) => DesignElement;
  plantTree: (at: Point, zoneId?: ZoneId, purpose?: string) => boolean;
}

/**
 * The front garden: a paved path from the door to the street, beds by the wall and a hedge along
 * the fence, from `frontGarden`'s sketch. The path goes onto the feature layer; the beds and the
 * hedge are returned as ground cover, to be laid with the rest of it.
 */
export function frontGardenElements(context: FrontGardenContext): DesignElement[] {
  const fills: DesignElement[] = [];
  const front = context.frame;
  const frontSketch = frontGarden(
    front,
    localBox(context.room, front),
    context.street,
    front.doorWidth,
  );

  if (frontSketch) {
    const points = frontSketch.path.map((point) => front.toWorld(point.u, point.v));
    const geometry: PlanGeometry = { kind: 'polyline', points, width: FRONT_PATH_WIDTH };
    const strip = geometryOutline(geometry);
    const ignore = [context.houseRing, ...context.thresholds];
    if (
      strip.length >= 3 &&
      withinRing(strip, context.boundary) &&
      (!context.scopePolygon || withinRing(strip, context.scopePolygon)) &&
      !context.obstacles.some(
        (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
      )
    ) {
      context.obstacles.push(strip);
      // Paved, not stepping stones: the front path is walked with shopping and in the rain.
      context.featureLayer.push(
        // Setts, like every other route: a front path walked with shopping, not a small patio.
        context.pathElement(geometry, 'Front path', 'stone-setts', 'paved-area', 'arrival'),
      );
    }

    const localRect = (rect: { u0: number; u1: number; v0: number; v1: number }): PlanGeometry => ({
      kind: 'rect',
      centre: front.toWorld((rect.u0 + rect.u1) / 2, (rect.v0 + rect.v1) / 2),
      width: rect.v1 - rect.v0,
      depth: rect.u1 - rect.u0,
      rotation: front.wallBearing,
    });

    for (const bed of frontSketch.beds) {
      const shape = localRect(bed);
      if (!placeable(shape, context.houseRing, context.boundary, context.scopePolygon)) continue;
      if (
        context.obstacles.some(
          (obstacle) =>
            obstacle !== context.houseRing && polygonsIntersect(geometryOutline(shape), obstacle),
        )
      )
        continue;
      fills.push({
        id: context.nextId(),
        category: 'planting-bed',
        role: 'fill',
        fillKind: 'accent',
        shape,
        zone: context.zone,
        material: materialFor('planting-bed', context.constraints, context.index),
      });
    }

    for (const hedge of frontSketch.hedges) {
      const shape = localRect(hedge);
      if (!placeable(shape, context.houseRing, context.boundary, context.scopePolygon)) continue;
      if (
        context.obstacles.some(
          (obstacle) =>
            obstacle !== context.houseRing && polygonsIntersect(geometryOutline(shape), obstacle),
        )
      )
        continue;
      fills.push({
        id: context.nextId(),
        category: 'planting-bed',
        role: 'fill',
        fillKind: 'accent',
        shape,
        zone: context.zone,
        material: 'hedging',
      });
    }

    if (frontSketch.tree) {
      context.plantTree(front.toWorld(frontSketch.tree.u, frontSketch.tree.v), context.zone);
    }
  }
  return fills;
}
