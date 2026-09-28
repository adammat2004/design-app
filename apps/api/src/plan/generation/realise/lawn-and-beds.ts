import {
  geometryOutline,
  type DesignElement,
  type PlanGeometry,
  type Point,
  type ZoneId,
} from '@garden-studio/schema';
import { materialFor } from '../archetypes.js';
import { styleCornerRadius, type DesignConstraints } from '../constraints.js';
import { withinRing } from '../design/circulation.js';
import type { FillService } from '../fill.service.js';
import type { DesignFrame } from '../layout/frame.js';
import type { LayoutSketch } from '../layout/sketch.js';
import { placeable } from './placeable.js';

export interface LawnAndBedsContext {
  sketch: LayoutSketch;
  frame: DesignFrame;
  /** The garden room the sketch was drawn in, in world metres. */
  room: Point[];
  fill: FillService;
  /** What the beds are cut round: the features placed so far. */
  featureLayer: DesignElement[];
  constraints: DesignConstraints;
  index: number;
  nextId: () => string;
  houseRing: Point[] | null;
  boundary: Point[];
  scopePolygon: Point[] | null;
  /** The zone the garden room is in, which the lawn and the beds are filed under. */
  zoneId: ZoneId;
}

export interface LawnAndBeds {
  lawn: DesignElement | null;
  designed: DesignElement[];
  /** What to say about the open ground, where there is one. */
  openGround: { text: string; lawnId: string } | null;
}

/**
 * The lawn panel the sketch drew, and the beds composed with it.
 *
 * The lawn follows the sketch, or the room where the sketch's panel would leave it (an L-plot). The
 * beds are the sketch's own, clipped to the room and cut round the features and round the lawn:
 * the open space was reserved first, so the beds give way to it and never the other way round.
 */
export async function lawnAndBeds(context: LawnAndBedsContext): Promise<LawnAndBeds> {
  let lawn: DesignElement | null = null;
  let openGround: LawnAndBeds['openGround'] = null;
  const designed: DesignElement[] = [];

  if (context.sketch.lawn) {
    let points: Point[] | null =
      context.sketch.lawn.kind === 'rect'
        ? [
            context.frame.toWorld(context.sketch.lawn.rect.u0, context.sketch.lawn.rect.v0),
            context.frame.toWorld(context.sketch.lawn.rect.u1, context.sketch.lawn.rect.v0),
            context.frame.toWorld(context.sketch.lawn.rect.u1, context.sketch.lawn.rect.v1),
            context.frame.toWorld(context.sketch.lawn.rect.u0, context.sketch.lawn.rect.v1),
          ]
        : context.sketch.lawn.points.map((point) => context.frame.toWorld(point.u, point.v));
    let cornerRadius =
      context.sketch.lawn.kind === 'rect'
        ? Math.max(context.sketch.lawn.cornerRadius, styleCornerRadius(context.constraints.style))
        : context.sketch.lawn.styleCorners
          ? styleCornerRadius(context.constraints.style)
          : 0;

    const proposed: PlanGeometry = { kind: 'polygon', points, cornerRadius };
    if (
      !placeable(proposed, context.houseRing, context.boundary, context.scopePolygon) ||
      !withinRing(geometryOutline(proposed), context.room)
    ) {
      // An L-plot or an odd room: the lawn follows the room instead of the sketch.
      points = await context.fill.clipTo(geometryOutline(proposed), context.room, 0.1);
      cornerRadius = 0;
    }

    if (points && points.length >= 3) {
      lawn = {
        id: context.nextId(),
        category: context.sketch.lawnCategory,
        role: 'fill',
        fillKind: 'accent',
        shape: { kind: 'polygon', points, cornerRadius },
        zone: context.zoneId,
        material: materialFor(context.sketch.lawnCategory, context.constraints, context.index),
      };
      openGround = {
        text:
          context.sketch.lawnCategory === 'lawn'
            ? 'Kept the lawn as one continuous panel rather than cutting it into pieces.'
            : 'Laid one open panel of gravel where a lawn would have been, since none was wanted.',
        lawnId: lawn.id,
      };
    }
  }

  // Fit each designed bed into the garden and clear the places people use.
  /*
   * Each bed takes its own planting, the way the leftover border runs already do.
   *
   * Every designed bed used to be `materialFor('planting-bed', constraints, index)` — one
   * argument, one answer, so the rear border, both side beds and the terrace flanks were the
   * same mixture in the same plan. A real garden changes its planting where the border turns a
   * corner, and it is the cheapest variety available here: the palette is already written, the
   * schemes already differ by material, and nothing about the geometry moves.
   *
   * Ordered by the sketch rather than by the pieces PostGIS returns, so two pieces of one bed
   * that a feature happened to cut in half are still one bed of one thing.
   */
  for (const [order, bed] of context.sketch.beds.entries()) {
    const local = bed.shape;
    const points =
      local.kind === 'polygon'
        ? local.points
        : [
            { u: local.rect.u0, v: local.rect.v0 },
            { u: local.rect.u1, v: local.rect.v0 },
            { u: local.rect.u1, v: local.rect.v1 },
            { u: local.rect.u0, v: local.rect.v1 },
          ];
    const world = points.map((p) => context.frame.toWorld(p.u, p.v));
    const clipped = await context.fill.clipTo(world, context.room, 0);
    if (!clipped) continue;
    const pieces = await context.fill.remainderPieces({
      zone: clipped,
      rooms: [
        ...designed.map((bed) => geometryOutline(bed.shape)),
        ...context.featureLayer
          .filter((e) => e.category !== 'planting-bed' && e.category !== 'furniture')
          .map((e) => geometryOutline(e.shape)),
        /*
         * The open space was reserved first, so the beds give way to it — never the other way
         * round, which is how a lawn used to become whatever the beds left.
         */
        ...(lawn ? [geometryOutline(lawn.shape)] : []),
      ],
      cuts: [],
      limit: 6,
    });
    for (const ring of pieces) {
      const shape: PlanGeometry = { kind: 'polygon', points: ring, cornerRadius: 0 };
      if (!placeable(shape, context.houseRing, context.boundary, context.scopePolygon)) continue;
      designed.push({
        id: context.nextId(),
        name: bed.name,
        category: 'planting-bed',
        role: 'fill',
        fillKind: 'accent',
        shape,
        zone: context.zoneId,
        material: materialFor('planting-bed', context.constraints, context.index + order),
        plantingStyle: context.constraints.plantingStyle,
        ...(context.sketch.composed.bedPurposes[order]
          ? { purpose: context.sketch.composed.bedPurposes[order] }
          : {}),
      });
    }
  }
  return { lawn, designed, openGround };
}
