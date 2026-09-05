import { z } from 'zod';

/**
 * A gate in the boundary fence: "0.9 m wide, 3.2 m along the edge that starts at corner v3".
 *
 * A gate used to be a step-2 `FeatureKind` — a 0.45 m point placed anywhere inside the plot. That
 * reversed here, and the reason is what the generator needs from it: a point cannot say *which
 * fence* it is in, and the whole value of a gate is that the utility corner, the bins and the side
 * path go to the fence it opens through. So it is keyed on the boundary edge exactly as an
 * `Opening` is keyed on a house wall, for the same reasons `opening.ts` gives — the position is
 * derived from the edge every time, so it survives the corners being dragged with no update step.
 *
 * Leaf module, like `opening.ts`: `site.ts` needs the schema to put `gates` on the section, and the
 * resolvers in `gates.ts` need `boundaryPolygon` from `site.ts`. Same split, same cycle avoided.
 */
export const GateSchema = z.object({
  id: z.string(),
  /** The boundary edge runs from the vertex with this id to the next vertex in outline order. */
  edgeVertexId: z.string(),
  /** Metres from that vertex to the gate's centre. */
  offsetAlongEdge: z.number().nonnegative(),
  width: z.number().positive().default(0.9),
});
export type Gate = z.infer<typeof GateSchema>;

/** A single pedestrian gate. Wide enough for a wheelie bin, which is what the side path carries. */
export const GATE_DEFAULT_WIDTH = 0.9;

/** How far inside the fence a gate needs kept clear so it can open and be walked through. */
export const GATE_THRESHOLD_DEPTH = 1;
