import type { Point } from '@garden-studio/schema';
import {
  boundingBox,
  directionFromDegrees,
  edgeLength,
  midpoint,
  polygonCentroid,
  polygonEdges,
  rayPolygonIntersection,
  rotatePoint,
} from './boundary-geometry';
import { housePolygon, houseSize, type HouseFootprint } from './house';

/**
 * The measuring layer: how far the house sits from each fence, how big it is, and whether an
 * edge has lined up with something. Pure geometry — the canvas decides how to draw it.
 */

/**
 * `plot-*` ids are open-ended because a plot has as many edges as the user drew. The rest name the
 * house's four sides and its two spans, which are fixed.
 */
export type DimensionGuideId =
  'top' | 'right' | 'bottom' | 'left' | 'width' | 'depth' | `plot-${number}`;

export interface DimensionGuide {
  id: DimensionGuideId;
  from: Point;
  to: Point;
  /** Metres. */
  distance: number;
}

/** A family hatchback, in metres. Big enough to be familiar, small enough to sit beside a plot. */
export const SIZE_ANCHOR_CAR = { width: 4.5, depth: 1.8 };

/** Clear air between the plot and the car parked beside it, so the two outlines never touch. */
const SIZE_ANCHOR_GAP = 1.5;

/**
 * Where the car parks: just below the plot's bottom-left corner, in world metres.
 *
 * Outside the plot rather than inside so it never covers the garden, and positioned in world
 * coordinates rather than pinned to a corner of the screen so it zooms and pans with the drawing —
 * which is the whole point. A scale bar in the corner is read as a caption and ignored; a car
 * sitting next to the plot gets compared to it whether the user means to or not, and on a plot
 * drawn ten times too large it shrinks to a speck.
 */
export function sizeAnchorAt(polygon: Point[]): Point | null {
  if (polygon.length < 3) return null;

  const box = boundingBox(polygon);
  return { x: box.minX, y: box.minY + box.length + SIZE_ANCHOR_GAP };
}

export interface AlignmentGuide {
  axis: 'x' | 'y';
  /** Metres along that axis — the canvas draws a full-height or full-width line here. */
  at: number;
}

/**
 * Each side of the house is described in its own frame, so a rotated house still reports a
 * sensible "top" and "left". `bearing` is the outward direction before rotation.
 */
const SIDES: {
  id: Extract<DimensionGuideId, 'top' | 'right' | 'bottom' | 'left'>;
  bearing: number;
}[] = [
  { id: 'top', bearing: 270 },
  { id: 'right', bearing: 0 },
  { id: 'bottom', bearing: 90 },
  { id: 'left', bearing: 180 },
];

/**
 * The offset from each house wall out to the boundary, measured along the wall's own normal
 * from its midpoint. A side whose ray never reaches the boundary is dropped rather than
 * reported as zero.
 */
export function houseOffsetGuides(
  boundary: Point[],
  house: HouseFootprint | null,
): DimensionGuide[] {
  if (!house || boundary.length < 3) return [];

  const { width, depth } = houseSize(house);
  const guides: DimensionGuide[] = [];

  for (const side of SIDES) {
    const outward = directionFromDegrees(side.bearing + house.rotation);
    // Half the span across the axis this side faces: left and right are half a width out.
    const reach = (side.bearing % 180 === 0 ? width : depth) / 2;
    const from = {
      x: house.centre.x + outward.x * reach,
      y: house.centre.y + outward.y * reach,
    };

    const to = rayPolygonIntersection(from, outward, boundary);
    if (!to) continue;

    guides.push({ id: side.id, from, to, distance: edgeLength(from, to) });
  }

  return guides;
}

/** The house's own width and depth, drawn across the footprint as in the design. */
export function houseSpanGuides(house: HouseFootprint | null): DimensionGuide[] {
  if (!house) return [];

  const { width, depth } = houseSize(house);
  const across = (dx: number, dy: number) => ({
    from: rotatePoint(
      { x: house.centre.x - dx, y: house.centre.y - dy },
      house.centre,
      house.rotation,
    ),
    to: rotatePoint(
      { x: house.centre.x + dx, y: house.centre.y + dy },
      house.centre,
      house.rotation,
    ),
  });

  return [
    { id: 'width', ...across(width / 2, 0), distance: width },
    { id: 'depth', ...across(0, depth / 2), distance: depth },
  ];
}

/**
 * Each plot edge as a dimension line, pushed clear of the boundary.
 *
 * The line is drawn at the offset position while `distance` reports the **true** edge length —
 * which works because `DimensionGuide` carries its distance as its own field rather than deriving
 * it from `from`/`to`. That is the whole reason this is a data change and not a new renderer:
 * `MeasurementGuides` already draws the dashed line, both arrowheads and the midpoint chip.
 *
 * Outward is decided against the centroid, so a concave plot pushes its notch edges the right way
 * instead of folding them inside itself.
 */
export function plotDimensionGuides(polygon: Point[], offset: number): DimensionGuide[] {
  if (polygon.length < 3) return [];

  const centre = polygonCentroid(polygon);

  return polygonEdges(polygon).map((edge) => {
    const dx = edge.end.x - edge.start.x;
    const dy = edge.end.y - edge.start.y;
    const length = Math.hypot(dx, dy);

    // A zero-length edge has no normal; leaving it in place is harmless because it is culled below.
    const normal = length === 0 ? { x: 0, y: 0 } : { x: -dy / length, y: dx / length };

    const mid = midpoint(edge.start, edge.end);
    const outward = (mid.x - centre.x) * normal.x + (mid.y - centre.y) * normal.y >= 0 ? 1 : -1;

    const shift = { x: normal.x * offset * outward, y: normal.y * offset * outward };

    return {
      id: `plot-${edge.index}` as const,
      from: { x: edge.start.x + shift.x, y: edge.start.y + shift.y },
      to: { x: edge.end.x + shift.x, y: edge.end.y + shift.y },
      distance: length,
    };
  });
}

/** Within this much, an edge counts as lined up — in metres. */
export const ALIGNMENT_THRESHOLD = 0.3;

/**
 * The coordinates a shape can line itself up against, split by axis. Building the targets
 * separately from the matching is what lets one engine serve "is this wall level with that
 * fence post" on step 1 and "is this path edge level with that patio edge" on step 2.
 */
export interface SnapTargets {
  x: number[];
  y: number[];
}

/** The three lines any shape offers on each axis: its two edges and its middle. */
export function boxSnapLines(polygon: Point[]): SnapTargets {
  if (polygon.length === 0) return { x: [], y: [] };

  const box = boundingBox(polygon);

  return {
    x: [box.minX, box.minX + box.width / 2, box.minX + box.width],
    y: [box.minY, box.minY + box.length / 2, box.minY + box.length],
  };
}

/** Every corner of a polygon as a snap target, which is how the boundary contributes. */
export function cornerSnapLines(polygon: Point[]): SnapTargets {
  return { x: polygon.map((point) => point.x), y: polygon.map((point) => point.y) };
}

export function collectSnapTargets(sources: SnapTargets[]): SnapTargets {
  return {
    x: sources.flatMap((source) => source.x),
    y: sources.flatMap((source) => source.y),
  };
}

/**
 * The lines a shape has come into agreement with — what the canvas draws as a dashed guide.
 * Deduplicated per axis so two features lined up on the same coordinate flash one line.
 */
export function alignmentGuidesFor(subject: Point[], targets: SnapTargets): AlignmentGuide[] {
  if (subject.length === 0) return [];

  const candidates = boxSnapLines(subject);
  const guides: AlignmentGuide[] = [];

  for (const axis of ['x', 'y'] as const) {
    for (const value of candidates[axis]) {
      const match = targets[axis].find((target) => Math.abs(target - value) <= ALIGNMENT_THRESHOLD);
      if (match === undefined) continue;
      if (guides.some((guide) => guide.axis === axis && Math.abs(guide.at - match) < 1e-6)) {
        continue;
      }

      guides.push({ axis, at: match });
    }
  }

  return guides;
}

/**
 * How far to nudge a shape so it lands on whatever it is nearly lined up with, per axis. Snap
 * uses the same threshold the guides display at, so the line the user sees is the line they get,
 * and the nearest match wins when several are in range.
 */
export function snapDeltaToTargets(subject: Point[], targets: SnapTargets): Point {
  if (subject.length === 0) return { x: 0, y: 0 };

  const candidates = boxSnapLines(subject);
  const delta = { x: 0, y: 0 };

  for (const axis of ['x', 'y'] as const) {
    let best: { delta: number; distance: number } | null = null;

    for (const value of candidates[axis]) {
      for (const target of targets[axis]) {
        const distance = Math.abs(target - value);
        if (distance > ALIGNMENT_THRESHOLD) continue;
        if (!best || distance < best.distance) best = { delta: target - value, distance };
      }
    }

    if (best) delta[axis] = best.delta;
  }

  return delta;
}

/**
 * Lines the house has come into agreement with, against the boundary's corners — which is what
 * a user actually eyeballs: "is this wall level with that fence post".
 */
export function alignmentGuides(boundary: Point[], house: HouseFootprint | null): AlignmentGuide[] {
  if (!house || boundary.length < 3) return [];

  return alignmentGuidesFor(housePolygon(house), cornerSnapLines(boundary));
}

/** Pulls a proposed house centre onto any boundary corner it is nearly lined up with. */
export function snapCentreToAlignment(
  boundary: Point[],
  house: HouseFootprint,
  centre: Point,
): Point {
  if (boundary.length < 3) return centre;

  const delta = snapDeltaToTargets(housePolygon({ ...house, centre }), cornerSnapLines(boundary));

  return { x: centre.x + delta.x, y: centre.y + delta.y };
}
