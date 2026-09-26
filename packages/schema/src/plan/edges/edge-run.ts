import { z } from 'zod';
import { EdgeTreatmentSchema } from './treatments.js';

/**
 * The stored half of a boundary treatment: what the user decided, never where it is.
 *
 * The split is the one `opening.ts` / `openings.ts` and `gate.ts` / `gates.ts` already make, and for
 * the same reason — this file is the shape `site.ts`'s neighbour `concepts.ts` puts on an element,
 * and the resolvers need geometry that would import back. Keeping the schema a leaf is what stops
 * the cycle.
 *
 * **Nothing here is a coordinate.** A run is a side index and two distances along it, which is a
 * relation to the shape rather than a position in the garden — so a run cannot disagree with the
 * outline it belongs to, and there is no update step to forget. `plan/boundary/side-chains.ts`
 * turns it into a polyline on every read.
 */

/**
 * Who put this run here, and therefore who may take it away.
 *
 * The field exists so that regenerating, restyling or re-materialising a garden can rewrite what it
 * decided without touching what a person decided. A user who takes the brick off one side of a
 * patio has said something, and the next style change must not say it back. `auto` runs are the
 * system's own working; `user` and `agent` runs are intent and survive.
 */
export const EdgeSourceSchema = z.enum(['auto', 'agent', 'user']);
export type EdgeSource = z.infer<typeof EdgeSourceSchema>;

export const EdgeRunSchema = z.object({
  /** Unique within the host. `r1`, `r2` — see `nextEdgeRunId`. */
  id: z.string(),
  /** Which authored side, indexed by `sideChains`. Out of range is ignored rather than thrown on. */
  side: z.number().int().nonnegative(),
  /**
   * Which end of that side `from` and `to` are measured from.
   *
   * **Metres from the nearer end**, resolved when the run is created or dragged. Stretch a side and
   * a run anchored to its start keeps its distance from that corner, exactly as a gate does; one
   * anchored to the far end keeps its distance from that one. A fraction of the side would slide
   * both, and a course is bought by the metre.
   */
  anchor: z.enum(['start', 'end']).default('start'),
  /** Metres from the anchored end to the near end of the run. */
  from: z.number().nonnegative(),
  /** Metres from the anchored end to the far end of the run. Greater than `from`. */
  to: z.number().nonnegative(),
  treatment: EdgeTreatmentSchema,
  /** A `MaterialId`, overriding the treatment's default product. */
  materialId: z.string().optional(),
  /** Millimetres, overriding `EDGING_WIDTHS_MM`. Only where the treatment has a width at all. */
  widthMm: z.number().positive().optional(),
  /** Millimetres, overriding `EDGING_HEIGHTS`. Only where the treatment stands proud. */
  heightMm: z.number().positive().optional(),
  source: EdgeSourceSchema.default('auto'),
  /** Held against every automatic pass, including one the user has not seen. */
  locked: z.boolean().optional(),
});
export type EdgeRun = z.infer<typeof EdgeRunSchema>;

/**
 * How a surface's boundary is treated.
 *
 * Three modes rather than a nullable list, because "decide for me" and "leave it bare" are
 * different answers and a plan has to be able to say either. `auto` reads the neighbours and the
 * style; `none` is a stated refusal; `custom` is the user's own runs, and only then is `runs` read.
 */
export const EdgeTreatmentPlanSchema = z.object({
  mode: z.enum(['auto', 'none', 'custom']).default('auto'),
  runs: z.array(EdgeRunSchema).default([]),
});
export type EdgeTreatmentPlan = z.infer<typeof EdgeTreatmentPlanSchema>;

/** The plan a surface that has never been asked about has. */
export const AUTO_EDGES: EdgeTreatmentPlan = { mode: 'auto', runs: [] };

/** A fresh id, unique within the host. Ids are positional only in that they never repeat. */
export function nextEdgeRunId(runs: EdgeRun[]): string {
  let highest = 0;
  for (const run of runs) {
    const match = /^r(\d+)$/.exec(run.id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `r${highest + 1}`;
}

/**
 * Whether two plans say the same thing.
 *
 * `propertyChanges` diffs a whole element on each side of every line of a proposal, so a list
 * compared by identity reads as "changed" on every material swap — and every diff would carry a
 * phantom `setProperty` claiming the edging moved. Compared by value, as corners already are.
 */
export function sameEdgePlan(a: EdgeTreatmentPlan | undefined, b: EdgeTreatmentPlan | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.mode !== b.mode || a.runs.length !== b.runs.length) return false;

  return a.runs.every((run, index) => {
    const other = b.runs[index]!;
    return (
      run.id === other.id &&
      run.side === other.side &&
      run.anchor === other.anchor &&
      run.from === other.from &&
      run.to === other.to &&
      run.treatment === other.treatment &&
      run.materialId === other.materialId &&
      run.widthMm === other.widthMm &&
      run.heightMm === other.heightMm &&
      run.source === other.source &&
      run.locked === other.locked
    );
  });
}
