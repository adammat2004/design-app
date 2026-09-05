import { z } from 'zod';

/**
 * What each side of the property is made of.
 *
 * The schema half only. The resolvers live in `boundary-styles.ts`, and the split is the same
 * load-bearing one `opening.ts` / `openings.ts` and `gate.ts` / `gates.ts` already keep: `site.ts`
 * needs this schema to put `boundaryStyles` on the site, and the resolvers need `boundaryPolygon`
 * back out of `site.ts` — a direct cycle if they shared a file.
 *
 * ## Why an edge needs a style at all
 *
 * Every plot in the app was drawn with a close-boarded timber fence round it, because that was the
 * only thing the renderer could draw. Real gardens are enclosed by very different things and the
 * difference is not decorative: a 1.8 m masonry wall and a 0.4 m railing throw different shadows,
 * cost different money, and change where you would sit. It is also the first thing a client says
 * about their garden — "there's a brick wall on that side" — and until now there was nowhere to
 * put the answer.
 *
 * ## Keyed on the edge's start vertex, exactly as a gate is
 *
 * `edgeVertexId` names the boundary vertex the edge *starts* at, so a style survives the corner
 * being dragged and survives the whole plot being moved or rescaled — the same positional identity
 * `Gate.edgeVertexId` and `Opening.wallId` rely on, and it fails in the same one way: inserting a
 * corner renumbers nothing but does split an edge, so the new half takes the default rather than
 * inheriting. That is the honest outcome; silently applying a wall to a side the user never
 * described would be worse.
 */

export const BoundaryKindSchema = z.enum([
  /** Close-boarded timber panels between posts. The default, and what every plot had before. */
  'fence',
  /** Masonry: brick or block, drawn as a coursed band with a coping line. */
  'wall',
  /** A living boundary — beech, yew, privet. Drawn by the same run painter a garden hedge uses. */
  'hedge',
  /** Metal railings or estate fencing: you can see through it, so the plan should too. */
  'railing',
  /**
   * No enclosure at all — an open frontage, or a side that runs into a neighbour's lawn.
   *
   * Drawn as a dashed cadastral line rather than as nothing, because "the boundary is here and
   * there is nothing built on it" and "we never asked" must not look the same on the drawing.
   */
  'open',
]);
export type BoundaryKind = z.infer<typeof BoundaryKindSchema>;

export const BoundaryEdgeStyleSchema = z.object({
  /** The boundary vertex this edge starts at — see the note above about positional identity. */
  edgeVertexId: z.string(),
  kind: BoundaryKindSchema,
  /**
   * Metres. Optional, and absent means the kind's own default rather than nothing: a height is a
   * fact about this particular wall, and most users will never state one.
   *
   * Read by the shadow model, which is why it is here rather than in the renderer's palette. A
   * boundary is the one thing in the garden that runs its whole length, so getting its height
   * wrong is visible everywhere at once.
   */
  height: z.number().positive().optional(),
});
export type BoundaryEdgeStyle = z.infer<typeof BoundaryEdgeStyleSchema>;

/** What a side is when nobody has said otherwise — a suburban garden's ordinary fence. */
export const DEFAULT_BOUNDARY_KIND: BoundaryKind = 'fence';

/**
 * How tall each kind stands when the user has not said.
 *
 * These are the ordinary British values: a 6-foot fence panel, a 6-foot garden wall, a hedge kept
 * a little above head height, and a railing you can see over. `open` is zero — there is nothing
 * there — which is also what stops it casting a shadow without a special case downstream.
 */
export const BOUNDARY_HEIGHTS: Record<BoundaryKind, number> = {
  fence: 1.8,
  wall: 1.8,
  hedge: 1.9,
  railing: 1.1,
  open: 0,
};

/** How thick each kind is on the ground, in metres — what the plan actually draws a band of. */
export const BOUNDARY_THICKNESS: Record<BoundaryKind, number> = {
  fence: 0.1,
  wall: 0.22,
  /** A boundary hedge is the one that takes real space, and users are always surprised by it. */
  hedge: 0.7,
  railing: 0.05,
  open: 0,
};

export function boundaryHeight(style: BoundaryEdgeStyle): number {
  return style.height ?? BOUNDARY_HEIGHTS[style.kind];
}
