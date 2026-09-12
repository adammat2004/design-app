import {
  boundaryPolygon,
  boundingBox,
  gardenDirection,
  housePolygon,
  pointInPolygon,
  polygonCentroid,
  streetDirection,
  type GardenZone,
  type Point,
  type SiteSection,
} from '@garden-studio/schema';
import {
  backFrame,
  frontFrame,
  gardenRoom,
  sideReturn,
  type DesignFrame,
} from '../../generation/layout/frame.js';
import type { GardenAnchor } from '@garden-studio/schema';

/**
 * Where "the back-left corner" actually is.
 *
 * This is the deterministic half of the garden assistant, and it is the reason the model is never
 * allowed a coordinate. It answers a *point to aim at* — not a position to use — which the planner
 * then hands to the placer as a preference. So a wrong reading of a vague phrase produces a feature
 * in a slightly odd but legal spot that the user can drag, never one hanging over the fence.
 *
 * Everything is resolved in the `DesignFrame` off the garden door — the same frame the generator
 * composes in. That is what makes "back-left" mean "far from the house, to the left as you look out
 * of the doors" rather than anything about the screen: a house drawn upside down on the plot, or a
 * plot drawn 20° off axis, still has a back-left corner and it is the one the user means.
 *
 * Pure, database-free and model-free, so the whole of it is testable on plain data — exactly the
 * split `planner.service.test.ts` already exploits.
 */

export interface AnchorContext {
  site: SiteSection;
  boundary: Point[];
  zones: GardenZone[];
}

/** How far out from the door "just outside the back door" is, in metres. */
const DOOR_STANDOFF = 2;

/** How far in from a fence a thing placed "along" it aims, in metres. */
const FENCE_STANDOFF = 1.2;

/** Fraction of the room's half-width that "left" and "right" aim at. */
const SIDE_REACH = 0.62;

export function buildAnchorContext(site: SiteSection, zones: GardenZone[]): AnchorContext {
  return { site, boundary: boundaryPolygon(site), zones };
}

/**
 * A point to aim at, or `null` when the plan cannot answer.
 *
 * `null` rather than a guess, the rule `openings.ts` and `gates.ts` set: a plan with no house has no
 * "beside the house", and aiming at the middle of the plot instead would put a shed in the drive
 * while reporting success.
 */
export function anchorPoint(anchor: GardenAnchor, context: AnchorContext): Point | null {
  const { site, boundary } = context;
  if (boundary.length < 3) return null;

  const house = site.house;
  const garden = gardenDirection(site);
  const frame = house && garden ? backFrame(house, garden) : null;
  const street = streetDirection(site);
  const front = house && street ? frontFrame(house, street) : null;

  switch (anchor) {
    case 'outside-back-door':
      return frame ? inside(frame.toWorld(DOOR_STANDOFF, 0), boundary) : null;

    case 'outside-front-door':
      return front ? inside(front.toWorld(DOOR_STANDOFF, 0), boundary) : null;

    case 'beside-house-left':
    case 'beside-house-right': {
      if (!house) return null;
      const strip = sideReturn(boundary, house, anchor === 'beside-house-left' ? 'left' : 'right');
      return strip.length >= 3 ? polygonCentroid(strip) : null;
    }

    case 'along-left-fence':
    case 'along-right-fence':
    case 'along-back-fence':
      return alongFence(anchor, frame, house ? housePolygon(house) : null, boundary);

    default:
      return inRoom(anchor, frame, boundary, house ? housePolygon(house) : null, site);
  }
}

/**
 * The nine-square grid, measured in the room rather than in the plot.
 *
 * `gardenRoom` is asked for the real room where there is a house, because the plot's own bounding
 * box includes the front garden and the strip behind the house — so "back-centre" measured on the
 * plot lands beyond the fence on a plot that is deeper at the front.
 */
function inRoom(
  anchor: GardenAnchor,
  frame: DesignFrame | null,
  boundary: Point[],
  houseRing: Point[] | null,
  site: SiteSection,
): Point | null {
  const depth = depthOf(anchor);
  const side = sideOf(anchor);

  if (!frame || !site.house) {
    /*
     * No house, so no door to face. The plot's own box is the honest fallback, oriented by the
     * street when the user has said where it is — "back" is away from the road either way.
     */
    const box = boundingBox(boundary);
    const street = streetDirection(site);
    const flip = street && street.y < 0 ? -1 : 1;

    const u = 0.5 + flip * (depth - 0.5);
    const v = 0.5 + side * 0.5 * SIDE_REACH;

    return inside({ x: box.minX + box.width * v, y: box.minY + box.length * u }, boundary);
  }

  const room = gardenRoom(boundary, site.house, frame, ['front', 'back', 'left', 'right']);
  if (room.length < 3) return null;

  const local = room.map((point) => frame.toLocal(point));
  const uMin = Math.min(...local.map((point) => point.u));
  const uMax = Math.max(...local.map((point) => point.u));
  const vMin = Math.min(...local.map((point) => point.v));
  const vMax = Math.max(...local.map((point) => point.v));

  // `depth` runs 0 at the house to 1 at the far fence; inset so an anchor is never on the line.
  const u = uMin + (uMax - uMin) * (0.12 + depth * 0.76);
  const centreV = (vMin + vMax) / 2;
  const v = centreV + side * ((vMax - vMin) / 2) * SIDE_REACH;

  const candidate = frame.toWorld(u, v);
  return clear(candidate, boundary, houseRing) ? candidate : inside(candidate, boundary);
}

/** A point a stride in from the named fence, level with the middle of the room. */
function alongFence(
  anchor: GardenAnchor,
  frame: DesignFrame | null,
  houseRing: Point[] | null,
  boundary: Point[],
): Point | null {
  if (!frame) return null;

  const box = boundingBox(boundary);
  const reach = Math.max(box.width, box.length);

  /*
   * Walked outward from the room's middle until it leaves the plot, then pulled back a stride. A
   * plot is an arbitrary polygon, so "the right fence" is not an edge that can be looked up — it is
   * whichever edge you meet going right, which is what this measures.
   */
  const direction =
    anchor === 'along-back-fence'
      ? frame.axis
      : anchor === 'along-right-fence'
        ? frame.cross
        : { x: -frame.cross.x, y: -frame.cross.y };

  const from = frame.toWorld(reach * 0.35, 0);
  let last: Point | null = null;

  for (let step = 0; step <= reach; step += 0.25) {
    const at = { x: from.x + direction.x * step, y: from.y + direction.y * step };
    if (!pointInPolygon(at, boundary)) break;
    last = at;
  }

  if (!last) return null;

  const pulled = {
    x: last.x - direction.x * FENCE_STANDOFF,
    y: last.y - direction.y * FENCE_STANDOFF,
  };

  return clear(pulled, boundary, houseRing) ? pulled : inside(pulled, boundary);
}

/** 0 at the house, 1 at the far end. */
function depthOf(anchor: GardenAnchor): number {
  if (anchor.startsWith('back-')) return 1;
  if (anchor.startsWith('front-')) return 0;
  return 0.5;
}

/** -1 left, 0 centre, +1 right — as you look out of the garden doors. */
function sideOf(anchor: GardenAnchor): number {
  if (anchor.endsWith('-left')) return -1;
  if (anchor.endsWith('-right')) return 1;
  return 0;
}

function clear(point: Point, boundary: Point[], houseRing: Point[] | null): boolean {
  return pointInPolygon(point, boundary) && !(houseRing && pointInPolygon(point, houseRing));
}

/**
 * The point itself if it is on the plot, else the plot's centroid.
 *
 * A last resort rather than a guess about *where*: the placer still samples a legal region and
 * still verifies with `geometryIsLegal`, so this only nudges which end of that region is preferred.
 */
function inside(point: Point, boundary: Point[]): Point {
  return pointInPolygon(point, boundary) ? point : polygonCentroid(boundary);
}
