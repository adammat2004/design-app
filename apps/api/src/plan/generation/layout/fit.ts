import {
  geometryClearsHouse,
  geometryIsLegal,
  geometryOutline,
  polygonContainsPolygon,
  polygonsIntersect,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';
import type { DesignFrame } from './frame.js';
import type { Slot } from './sketch.js';

/**
 * Turns a slot into a legal footprint, or gives up honestly.
 *
 * No sampling. The slot says where the thing should be; this tries exactly there, then nudges it
 * a little way along each axis of the frame, then shrinks it, and the first candidate that is
 * legal, inside the room and clear of everything already placed wins. Deterministic by
 * construction — the same request always tries the same candidates in the same order — and
 * cheap: a few dozen TypeScript checks, no query.
 *
 * Every candidate goes through the same `geometryIsLegal` the editor, the validator and the
 * assistant use, so a fitted feature can never fail the check that guards its own save.
 */

export type Footprint =
  { kind: 'rect'; width: number; depth: number } | { kind: 'point'; radius: number };

/** How far a nudge may carry a feature from its anchor, and in what steps. */
const NUDGE_STEP = 0.25;
const NUDGE_STEPS = 8;

/** How far a feature may shrink to fit before it stops being the thing that was asked for. */
const MIN_SCALE = 0.6;
const SHRINK_STEP = 0.9;

export interface FitContext {
  frame: DesignFrame;
  /** The room in world metres. A fitted footprint must lie wholly inside it. */
  room: Point[];
  houseRing: Point[] | null;
  boundary: Point[];
  obstacles: Point[][];
  /** Obstacles a footprint may overlap: the terrace a table stands on, for instance. */
  ignore?: Point[][];
}

export function fitInSlot(
  footprint: Footprint,
  slot: Slot,
  context: FitContext,
): PlanGeometry | null {
  const sized = sizeToSlot(footprint, slot);

  for (let scale = 1; scale >= MIN_SCALE - 1e-9; scale *= SHRINK_STEP) {
    const scaled = scaleFootprint(sized, scale);

    for (const anchor of nudges(slot.anchor)) {
      const geometry = geometryAt(scaled, anchor, context.frame);
      if (isPlaceable(geometry, context)) return geometry;
    }
  }

  return null;
}

/** The slot's anchor, then rings of nudges around it along the frame's axes. */
function* nudges(anchor: { u: number; v: number }): Generator<{ u: number; v: number }> {
  yield anchor;
  for (let step = 1; step <= NUDGE_STEPS; step += 1) {
    const d = step * NUDGE_STEP;
    yield { u: anchor.u - d, v: anchor.v };
    yield { u: anchor.u + d, v: anchor.v };
    yield { u: anchor.u, v: anchor.v - d };
    yield { u: anchor.u, v: anchor.v + d };
  }
}

/** Shrinks a footprint into the slot's `maxSize`, turning it a quarter if the slot says so. */
export function sizeToSlot(footprint: Footprint, slot: Slot): Footprint {
  if (footprint.kind === 'point') {
    const limit = Math.min(slot.maxSize.width, slot.maxSize.depth) / 2;
    return { kind: 'point', radius: Math.min(footprint.radius, limit) };
  }

  const turned = slot.turn ? { width: footprint.depth, depth: footprint.width } : footprint;
  // Keep the long side along the slot's long side.
  const along =
    turned.width >= turned.depth === slot.maxSize.width >= slot.maxSize.depth
      ? turned
      : { width: turned.depth, depth: turned.width };

  const ratio = Math.min(1, slot.maxSize.width / along.width, slot.maxSize.depth / along.depth);
  return { kind: 'rect', width: along.width * ratio, depth: along.depth * ratio };
}

function scaleFootprint(footprint: Footprint, scale: number): Footprint {
  return footprint.kind === 'point'
    ? { kind: 'point', radius: footprint.radius * scale }
    : { kind: 'rect', width: footprint.width * scale, depth: footprint.depth * scale };
}

/** The footprint in world metres, aligned to the frame's wall. */
export function geometryAt(
  footprint: Footprint,
  anchor: { u: number; v: number },
  frame: DesignFrame,
): PlanGeometry {
  const at = frame.toWorld(anchor.u, anchor.v);
  if (footprint.kind === 'point') return { kind: 'point', at, radius: footprint.radius };

  // `width` runs along `v` (the wall), `depth` along `u` (out from it): the frame's own bearing.
  return {
    kind: 'rect',
    centre: at,
    width: footprint.width,
    depth: footprint.depth,
    rotation: frame.wallBearing,
  };
}

/** Legal, inside the room, and clear of everything placed — the three checks `pick` made. */
export function isPlaceable(geometry: PlanGeometry, context: FitContext): boolean {
  if (!geometryIsLegal(geometry, context.boundary)) return false;
  // The house is the generator's own rule, not a legality one — see `placeable` in concepts.service.
  if (!geometryClearsHouse(geometry, context.houseRing)) return false;

  const outline = geometryOutline(geometry);
  if (context.room.length >= 3 && !polygonContainsPolygon(context.room, outline)) return false;

  const ignore = context.ignore ?? [];
  return !context.obstacles.some(
    (obstacle) => !ignore.includes(obstacle) && polygonsIntersect(outline, obstacle),
  );
}
