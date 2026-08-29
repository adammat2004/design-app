import { z } from 'zod';
import {
  boundingBox,
  polygonArea,
  polygonContainsPolygon,
  rotatePoint,
  scalePointAbout,
  PointSchema,
  type Point,
} from '../geometry/primitives.js';
import { rectangleOutline } from '../geometry/shapes.js';
import { OpeningSchema } from './opening.js';
import { ZoneIdSchema } from './zone-id.js';

/**
 * The property: an arbitrary boundary polygon, and the house placed inside it as a shape.
 *
 * The house is a footprint rather than a tag on one boundary edge, which is what lets front,
 * back and side gardens fall out of its position and rotation (see `computeZones`). Keeping
 * the outline centred on its own origin means rotation is a property, never baked into the
 * coordinates — so the Width/Depth fields and the rotation handle stay independent.
 */

export const BoundaryVertexSchema = PointSchema.extend({
  /** Stable across relettering, so React keys and drag targets survive an insert. */
  id: z.string(),
});
export type BoundaryVertex = z.infer<typeof BoundaryVertexSchema>;

/**
 * A corner of the house, with an id for the same reason a boundary vertex has one.
 *
 * The id is what lets anything be *attached* to a wall. A door recorded as "0.9 m along the third
 * edge" survives the house being moved or rotated, but not a resize — which rewrites `outline` —
 * and not a corner being inserted on a custom outline, which silently renumbers every edge after
 * it and moves every opening on them to a different wall. Positional identity is the one failure
 * mode this codebase cannot tolerate: it corrupts geometry without reporting anything.
 */
export const HouseVertexSchema = PointSchema.extend({
  id: z.string(),
});
export type HouseVertex = z.infer<typeof HouseVertexSchema>;

/**
 * What sort of wall this is.
 *
 * Terraced and semi-detached houses have party walls, which cannot hold openings and are a privacy
 * asset rather than a problem. Classifying them is also most of the input work saved: a mid-terrace
 * has two walls worth asking about, not four.
 */
export const WallKindSchema = z.enum(['external', 'party', 'garage']);
export type WallKind = z.infer<typeof WallKindSchema>;

/** The wall running from the outline vertex of this id to the next one, in outline order. */
export const HouseWallSchema = z.object({
  id: z.string(),
  kind: WallKindSchema.default('external'),
});
export type HouseWall = z.infer<typeof HouseWallSchema>;

export const HouseFootprintSchema = z.object({
  /** Outline in the house's own frame, centred on (0, 0). A rectangle is just four corners. */
  outline: z.array(HouseVertexSchema).min(3),
  /**
   * One entry per wall, parallel to `outline`. Defaults to empty so a stored plan written before
   * walls existed still parses; `houseWalls` resolves that absence rather than every caller having
   * to.
   */
  walls: z.array(HouseWallSchema).default([]),
  /**
   * Doors and windows, each parameterised on a wall id rather than a coordinate — see
   * `opening.ts`. Stored on the house because an opening is meaningless without its wall, which
   * also makes "delete the house" one total operation.
   */
  openings: z.array(OpeningSchema).default([]),
  centre: PointSchema,
  /** Degrees clockwise about the centre, matching `rectToPolygon` and Konva. */
  rotation: z.number(),
});
export type HouseFootprint = z.infer<typeof HouseFootprintSchema>;

export const SiteSectionSchema = z.object({
  vertices: z.array(BoundaryVertexSchema).default([]),
  /** False while the user is still clicking corners in draw mode. */
  closed: z.boolean().default(false),
  house: HouseFootprintSchema.nullable().default(null),
  /** Which computed zones the user wants designed — carried forward to steps 2, 3 and 4. */
  selectedZoneIds: z.array(ZoneIdSchema).default([]),
  /**
   * Degrees clockwise from screen-up to true north.
   *
   * The compass on every canvas has always been a drawing rather than data — it points up, and
   * nothing reads it. Storing the orientation is what turns it into something the plan can use:
   * shadow direction, sun-aware placement, and which windows face the light. Defaults to 0, so an
   * existing plan is unchanged and the compass keeps pointing exactly where it did.
   */
  orientation: z.number().default(0),
});
export type SiteSection = z.infer<typeof SiteSectionSchema>;

export interface HouseSize {
  width: number;
  depth: number;
}

/** Smallest house the tools will produce, in metres — below this the handles overlap. */
export const MIN_HOUSE_SIDE = 1;

/**
 * Ids for a freshly built outline. Positional (`h0`, `h1`, …) because a new house has no history
 * to preserve — what matters is that they exist and stay put from here on.
 */
export function identifyOutline(points: Point[]): HouseVertex[] {
  return points.map((point, index) => ({ x: point.x, y: point.y, id: `h${index}` }));
}

/** One external wall per edge — the starting assumption, corrected by the user where it is wrong. */
export function defaultWalls(outline: readonly unknown[]): HouseWall[] {
  return outline.map((_, index) => ({ id: `w${index}`, kind: 'external' as const }));
}

/**
 * The walls, resolved.
 *
 * Total by construction: a footprint stored before walls existed has an empty array, and a house
 * whose outline has since grown a corner has fewer walls than edges. Deriving the gap here means no
 * caller has to remember either case, and a wall is never missing for a corner that exists.
 */
export function houseWalls(house: HouseFootprint): HouseWall[] {
  if (house.walls.length === house.outline.length) return house.walls;

  return house.outline.map(
    (_, index) => house.walls[index] ?? { id: `w${index}`, kind: 'external' as const },
  );
}

export function rectangleHouse(centre: Point, width: number, depth: number): HouseFootprint {
  const outline = identifyOutline(rectangleOutline(width, depth));

  return { outline, walls: defaultWalls(outline), openings: [], centre, rotation: 0 };
}

/** The boundary polygon, stripped of the vertex ids the editor carries around. */
export function boundaryPolygon(site: Pick<SiteSection, 'vertices'>): Point[] {
  return site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
}

/** The footprint in world coordinates — what gets drawn, measured and tested for fit. */
export function housePolygon(house: HouseFootprint): Point[] {
  return house.outline.map((point) =>
    rotatePoint(
      { x: house.centre.x + point.x, y: house.centre.y + point.y },
      house.centre,
      house.rotation,
    ),
  );
}

/**
 * The local-frame bounding box. Exact for a rectangle, and the only sensible reading of
 * "width and depth" for a custom outline — which is what the Selected object panel shows.
 */
export function houseSize(house: HouseFootprint): HouseSize {
  const box = boundingBox(house.outline);
  return { width: box.width, depth: box.length };
}

export function houseArea(house: HouseFootprint | null): number {
  return house ? polygonArea(housePolygon(house)) : 0;
}

/**
 * The house rescaled along with the plot around it.
 *
 * Both halves matter and the second is easy to forget: `centre` moves about the plot's centre so
 * the house keeps its position *within* the plot, and `outline` — which lives in the house's own
 * frame, centred on (0, 0) — is scaled about that local origin so the building itself shrinks.
 * Scaling only the centre leaves a full-size house on a tenth-size plot, which then fails
 * `houseFitsInside` and silently refuses the rescale.
 *
 * Rotation is untouched: scaling is uniform, so angles are preserved.
 */
export function scaleHouseAbout(
  house: HouseFootprint,
  centre: Point,
  factor: number,
): HouseFootprint {
  return {
    ...house,
    // Spread, so the vertex ids survive a rescale along with everything else attached to them.
    outline: house.outline.map((point) => ({ ...point, x: point.x * factor, y: point.y * factor })),
    centre: scalePointAbout(house.centre, centre, factor),
  };
}

export function houseFitsInside(boundary: Point[], house: HouseFootprint): boolean {
  return polygonContainsPolygon(boundary, housePolygon(house));
}
