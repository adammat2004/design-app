import {
  geometryOutline,
  polygonsIntersect,
  type DesignElement,
  type MaterialId,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';
import { materialFor } from '../archetypes.js';
import type { DesignConstraints } from '../constraints.js';
import { isIgnored, layRoutes, routeFromHouse, withinRing } from '../design/circulation.js';
import type { LayoutAdjustments } from '../design/types.js';
import type { DesignFrame } from '../layout/frame.js';
import type { LayoutSketch } from '../layout/sketch.js';
import { localShapeRing } from '../layout/trees.js';
import { circulationFor } from '../room-policy.js';

export interface RoutesContext {
  houseRing: Point[] | null;
  /** The composed sketch and the frame it is drawn in, or `null` where there was nothing to compose round. */
  sketch: LayoutSketch | null;
  frame: DesignFrame | null;
  /** The terrace as built: every route starts from it. */
  terrace: DesignElement | null;
  /** What has been built so far, read for the rooms to reach and grown by the paths laid. */
  featureLayer: DesignElement[];
  /** Which element each of the composition's slots ended up holding. */
  placedBySlot: Map<string, DesignElement>;
  gate: { centre: Point; inward: Point } | null;
  /** What a path must clear, grown by every path laid. */
  obstacles: Point[][];
  thresholds: Point[][];
  boundary: Point[];
  scopePolygon: Point[] | null;
  adjustments: LayoutAdjustments;
  constraints: DesignConstraints;
  index: number;
  /** Rooms the sampler placed on a plot with nothing to compose round, reached from the house. */
  destinations: { outline: Point[]; name: string; primary: boolean }[];
  pathElement: (
    geometry: PlanGeometry,
    name: string,
    material: MaterialId,
    category?: DesignElement['category'],
    purpose?: string,
  ) => DesignElement;
}

/**
 * Every path in the plan: the formal axis where the composition drew one, every route the
 * composition's circulation names — laid by `layRoutes`, the function the preview lays them with —
 * and, where there was nothing to compose round, a path from the house to each room the sampler
 * placed. Paths go onto the feature layer and onto the obstacles, in the order they are laid.
 */
export function layPaths(context: RoutesContext): void {
  const {
    houseRing,
    sketch,
    terrace,
    featureLayer,
    placedBySlot,
    gate,
    obstacles,
    thresholds,
    boundary,
    scopePolygon,
    adjustments,
    constraints,
    index,
    destinations,
    pathElement,
    frame,
  } = context;

  if (houseRing && sketch && frame && terrace) {
    const terraceOutline = geometryOutline(terrace.shape);
    // The formal plan's paved line down the middle, over the lawn it divides.
    if (sketch.axisPath) {
      const axis = sketch.axisPath;
      const geometry: PlanGeometry = {
        kind: 'polyline',
        points: [
          frame.toWorld(axis.u0, 0),
          ...(sketch.axisStops ?? [])
            .filter((u) => u > axis.u0 + 0.5 && u < axis.u1 - 0.5)
            .sort((a, b) => a - b)
            .map((u) => frame.toWorld(u, 0)),
          frame.toWorld(axis.u1, 0),
        ],
        width: axis.v1 - axis.v0,
      };
      const strip = geometryOutline(geometry);
      const ignore = [houseRing, terraceOutline, ...thresholds];
      if (
        withinRing(strip, boundary) &&
        (!scopePolygon || withinRing(strip, scopePolygon)) &&
        !obstacles.some(
          (obstacle) => !isIgnored(obstacle, ignore) && polygonsIntersect(strip, obstacle),
        )
      ) {
        obstacles.push(strip);
        featureLayer.push(
          pathElement(
            geometry,
            'Axis path',
            materialFor('paved-area', constraints, index),
            'paved-area',
            'axis',
          ),
        );
      }
    }

    /*
     * Every route in the plan, laid once by the function the preview lays them with. Each is an
     * edge the composition drew, down the corridor it kept, and the lawn is an obstacle to
     * anything but the walk down the view. See `layRoutes`.
     */
    const target = (element: DesignElement) => ({
      id: element.id,
      ring: geometryOutline(element.shape),
      name: element.name ?? 'garden room',
      utility: element.symbol === 'shed' || element.symbol === 'raised-bed',
    });
    const rooms = featureLayer.filter(
      (element) =>
        element.role === 'feature' &&
        element.id !== terrace.id &&
        element.category !== 'furniture' &&
        element.category !== 'existing-feature' &&
        element.symbol !== 'steps' &&
        element.shape.kind !== 'polyline',
    );
    const laid = layRoutes({
      paths: sketch.paths,
      placed: new Map([...placedBySlot].map(([slot, element]) => [slot, target(element)])),
      rooms: rooms.map(target),
      terrace: terraceOutline,
      gate: gate ? { centre: gate.centre, inward: gate.inward } : null,
      panel: sketch.lawn ? localShapeRing(sketch.lawn, frame) : null,
      frame: frame,
      obstacles,
      thresholds,
      boundary,
      scope: scopePolygon,
      adjustments,
      widthOf: (purpose) => circulationFor(purpose, constraints).width,
    });
    for (const route of laid) {
      /*
       * A walk across the lawn is stepping stones whatever the brief's paving: the grass shows
       * between them, so the lawn stays one lawn rather than being cut in two by a strip of
       * gravel or setts. Only the formal axis is paved, and that is not laid here.
       */
      const policy =
        route.elementPurpose === 'axis'
          ? { category: 'paved-area' as const, material: 'stepping-stones' as MaterialId }
          : circulationFor(route.purpose, constraints);
      featureLayer.push(
        pathElement(
          route.geometry,
          route.name,
          policy.material,
          policy.category,
          route.elementPurpose,
        ),
      );
    }
  }

  if (houseRing) {
    for (const destination of destinations) {
      const path = routeFromHouse(houseRing, destination.outline, {
        obstacles,
        boundary,
        scope: scopePolygon,
      });
      if (!path) continue;

      obstacles.push(geometryOutline(path));
      featureLayer.push(
        pathElement(
          path,
          destination.primary ? 'Service path' : `Path to ${destination.name.toLowerCase()}`,
          'stepping-stones',
          'paved-area',
          'garden-route',
        ),
      );
    }
  }
}
