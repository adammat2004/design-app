import { z } from 'zod';

/**
 * An opening in the boundary: "0.9 m wide, 3.2 m along the edge that starts at corner v3".
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
 *
 * ## Three kinds, one type
 *
 * A pedestrian gate, a driveway and an open gap are all "a break in this side, this wide, here" —
 * the same key, the same position, the same fit rule against their neighbours. What differs is
 * what the generator makes of them: a side path starts at a pedestrian gate, a car stands inside a
 * vehicle one, and an open gap has no leaf to draw. That is a `kind`, not three types, for the
 * reason `OpeningType` is one enum rather than a door type and a window type. The name `Gate` is
 * kept for the field that stores them, because a stored plan has `gates` and always will.
 */

export const GateKindSchema = z.enum([
  /** A garden gate: a person and a wheelie bin. The default, and what every stored gate was. */
  'pedestrian',
  /**
   * A driveway: wide enough for a car, and the front garden's most visible feature. The gap is the
   * capture; the paved drive behind it is a design decision the generator makes later.
   */
  'vehicle',
  /** No gate at all — a gap in the hedge, an open frontage. Nothing to draw a leaf for. */
  'open',
]);
export type GateKind = z.infer<typeof GateKindSchema>;

export const GateSchema = z.object({
  id: z.string(),
  /** The boundary edge runs from the vertex with this id to the next vertex in outline order. */
  edgeVertexId: z.string(),
  /** Metres from that vertex to the gate's centre. */
  offsetAlongEdge: z.number().nonnegative(),
  width: z.number().positive().default(0.9),
  /** Defaulted, so a plan stored before kinds existed reads back as the pedestrian gates it had. */
  kind: GateKindSchema.default('pedestrian'),
});
export type Gate = z.infer<typeof GateSchema>;

/**
 * What each kind is before the user adjusts it, and how deep a keep-clear it needs inside.
 *
 * Real sizes: a 900 mm garden gate, a 3 m drive. The threshold is what the placer keeps free of
 * planting behind the gap — a metre to open a gate and step through, five for a car to stand.
 */
export const GATE_DEFAULTS: Record<GateKind, { width: number; thresholdDepth: number }> = {
  pedestrian: { width: 0.9, thresholdDepth: 1 },
  vehicle: { width: 3, thresholdDepth: 5 },
  open: { width: 3, thresholdDepth: 1 },
};

export const GATE_LABELS: Record<GateKind, string> = {
  pedestrian: 'Gate',
  vehicle: 'Driveway',
  open: 'Open gap',
};

/** Narrower than this and a person does not fit through it. */
export const MIN_GATE_WIDTH = 0.6;

/** A single pedestrian gate. Wide enough for a wheelie bin, which is what the side path carries. */
export const GATE_DEFAULT_WIDTH = GATE_DEFAULTS.pedestrian.width;

/** How far inside the fence a pedestrian gate needs kept clear so it can open and be walked through. */
export const GATE_THRESHOLD_DEPTH = GATE_DEFAULTS.pedestrian.thresholdDepth;

/** How deep a keep-clear this gate needs inside the boundary. */
export function gateThresholdDepth(gate: Pick<Gate, 'kind'>): number {
  return GATE_DEFAULTS[gate.kind].thresholdDepth;
}

/** Whether something walks through it as a matter of course — a car space is not a path's start. */
export function isPedestrianGate(gate: Pick<Gate, 'kind'>): boolean {
  return gate.kind === 'pedestrian';
}
