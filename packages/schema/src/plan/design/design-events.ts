import { z } from 'zod';
import { ElementCategorySchema } from '../concepts.js';
import { LayoutArchetypeIdSchema } from './vocabulary.js';

/**
 * What a person did with the design they were offered.
 *
 * The design agent can say how good it thinks a plan is; it has never had any way to find out
 * whether it was right. Every number in the evaluation harness is the scorer marking the
 * generator's homework against rules the same author wrote, which is circular by construction —
 * a well-calibrated scorer and a badly-calibrated one produce equally confident tables. These
 * events are the only source of an outside opinion the project can have without a user study:
 * which concept people chose, and what they immediately changed about it.
 *
 * **Nothing in `generation/design/**` imports this, and nothing ever should.** A scorer that read
 * its own feedback would close the loop and stop being inspectable — "why did it choose this" would
 * become "because people like it", which is not a sentence anybody can argue with or test. The
 * events are recorded for a human to read and for a future calibration pass to reason about
 * offline. That restriction is the whole design.
 *
 * **It records what changed, never what the garden looks like.** An event carries an element's
 * category and how far it moved, not its position or its outline — the plan itself is already
 * stored, so duplicating geometry here would create a second copy that can disagree with it, and
 * telemetry that can be wrong about the thing it describes is worse than none.
 */

/**
 * The things worth knowing about, and deliberately only these.
 *
 * Each one answers a question the scorer cannot. Choosing a concept says which of three strategies a
 * person preferred, against a recommendation that claims to know. Regenerating says all three were
 * wrong. Deleting or moving an element in the first minutes of editing says the generator put it
 * somewhere a person did not want it, which is the closest thing to a ground truth this project can
 * get at. Exporting says the design was good enough to keep.
 *
 * Not recorded: opening a screen, hovering, scrolling, how long anything took. Those measure the
 * interface rather than the design, and every one of them is a decision nobody made.
 */
export const DesignEventKindSchema = z.enum([
  'concept_chosen',
  'concept_regenerated',
  'element_added',
  'element_moved',
  'element_resized',
  'element_deleted',
  'layout_reset',
  'plan_exported',
]);
export type DesignEventKind = z.infer<typeof DesignEventKindSchema>;

export const DesignEventSchema = z.object({
  kind: DesignEventKindSchema,
  /** The concept this is about, where the action names one. */
  conceptId: z.string().max(80).optional(),
  /**
   * Which composition the concept was drawn from.
   *
   * The single most useful field here, and the reason the events are worth recording at all: it is
   * what turns "someone deleted a shed" into "people delete the shed on destination-garden plans",
   * which is a statement about the *design* rather than about one person's afternoon.
   */
  strategy: LayoutArchetypeIdSchema.optional(),
  elementId: z.string().max(80).optional(),
  category: ElementCategorySchema.optional(),
  /**
   * How much changed, in metres or as a factor depending on the event.
   *
   * One loose number rather than a discriminated union per event kind, because the alternative is
   * eight payload shapes for a table nothing branches on. A reader who cares what `delta` means for
   * `element_resized` reads the emitter; a reader who does not is not misled, because the field is
   * optional and absent wherever it would be meaningless.
   */
  delta: z.number().finite().optional(),
});
export type DesignEvent = z.infer<typeof DesignEventSchema>;

/**
 * What the endpoint accepts.
 *
 * A batch, because the editor produces these in bursts — dragging three elements in ten seconds is
 * three events — and a request per gesture would put the telemetry in the way of the thing it is
 * measuring. Capped at twenty, so a runaway emitter costs one rejected request rather than a table.
 */
export const RecordDesignEventsSchema = z.object({
  events: z.array(DesignEventSchema).min(1).max(20),
});
export type RecordDesignEvents = z.infer<typeof RecordDesignEventsSchema>;

/**
 * What it answers.
 *
 * A count rather than the rows. The client is not waiting on this and must never act on it: the
 * whole emitter is fire-and-forget, so returning anything a caller might branch on would invite
 * exactly the coupling that keeps telemetry out of the way of the app.
 */
export const RecordDesignEventsResultSchema = z.object({
  recorded: z.number().int().min(0),
});
export type RecordDesignEventsResult = z.infer<typeof RecordDesignEventsResultSchema>;
