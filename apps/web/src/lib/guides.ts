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
import {
  alignmentGuidesFor,
  cornerSnapLines,
  snapDeltaToTargets,
  type AlignmentGuide,
} from '@garden-studio/schema';

/*
 * The alignment engine lives in the shared package now, beside the rest of the snapping, so all three
 * editors pull by one rule. Re-exported so every existing import keeps working.
 */
export {
  ALIGNMENT_THRESHOLD,
  alignmentGuidesFor,
  boxSnapLines,
  collectSnapTargets,
  cornerSnapLines,
  snapDeltaToTargets,
  type AlignmentGuide,
  type SnapTargets,
} from '@garden-studio/schema';

/**
 * The measuring layer: how far the house sits from each fence, how big it is, and whether an
 * edge has lined up with something. Pure geometry — the canvas decides how to draw it.
 */

/**
 * `plot-*` ids are open-ended because a plot has as many edges as the user drew. The rest name the
 * house's four sides and its two spans, which are fixed.
 */
export type DimensionGuideId =
  | 'top'
  | 'right'
  | 'bottom'
  | 'left'
  | 'width'
  | 'depth'
  | `plot-${number}`
  | `element-${number}`
  | `clear-${number}`;

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
export function plotDimensionGuides(
  polygon: Point[],
  offset: number,
  /* `element` for a selected shape's sides, so its guides never share a key with the plot's. */
  prefix: 'plot' | 'element' = 'plot',
): DimensionGuide[] {
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
      id: `${prefix}-${edge.index}` as const,
      from: { x: edge.start.x + shift.x, y: edge.start.y + shift.y },
      to: { x: edge.end.x + shift.x, y: edge.end.y + shift.y },
      distance: length,
    };
  });
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

/**
 * A path's length, leg by leg, as dimension lines offset to one side of its centreline — the figures
 * a path is set out by. Offset by half its width plus a margin, so the line sits clear of the strip.
 */
export function pathDimensionGuides(points: Point[], offset: number): DimensionGuide[] {
  const guides: DimensionGuide[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index]!;
    const end = points[index + 1]!;
    const length = edgeLength(start, end);
    if (length === 0) continue;
    const normal = { x: -(end.y - start.y) / length, y: (end.x - start.x) / length };
    guides.push({
      id: `element-${index}`,
      from: { x: start.x + normal.x * offset, y: start.y + normal.y * offset },
      to: { x: end.x + normal.x * offset, y: end.y + normal.y * offset },
      distance: length,
    });
  }
  return guides;
}
