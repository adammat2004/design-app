import { z } from 'zod';
import { DesignElementSchema, ElementCategorySchema } from './concepts.js';
import { MaterialIdSchema } from './materials.js';
import { ZoneIdSchema } from './zone-id.js';

/**
 * The design assistant's contract.
 *
 * **The assistant never writes coordinates.** A request comes in as a sentence and goes out as a
 * list of `ProposedChange`s — each one a complete `DesignElement` in the same shape the canvas, the
 * store and the generator already speak, paired with the element it would replace. Nothing
 * downstream parses prose, and nothing upstream invents geometry that has not been checked.
 *
 * That matters more here than anywhere else in the wizard, because this is the one screen with a
 * language model between intent and geometry. So the diff is a proposal, not an instruction: the
 * user reviews it line by line, and the editor store re-checks every accepted line against the
 * house and the boundary before it lands. The server filters too — but the store is the guarantee.
 */

/* ---------------------------------------------------------------- structured intent */

export const IntentTargetSchema = z.object({
  /** Ids taken from the inventory in the prompt. The planner drops anything it cannot find. */
  elementIds: z.array(z.string()).min(1).max(8),
});
export type IntentTarget = z.infer<typeof IntentTargetSchema>;

export const IntentFootprintSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    width: z.number().min(0.3).max(20),
    depth: z.number().min(0.3).max(20),
  }),
  z.object({ kind: z.literal('point'), radius: z.number().min(0.2).max(5) }),
  z.object({ kind: z.literal('strip'), width: z.number().min(0.2).max(3) }),
]);
export type IntentFootprint = z.infer<typeof IntentFootprintSchema>;

/**
 * What the model is allowed to ask for.
 *
 * **There is no field here that can hold a coordinate**, and that is the whole design. Sizes are
 * allowed because they are relative to the object; positions exist only as *relations* — towards
 * the house, in the back garden, along the boundary. If the model wanted to write `x: 4.2` there is
 * nowhere to put it, which is what turns "the assistant never writes coordinates" from a prompt
 * instruction into a property of the type.
 */
export const DesignIntentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('resize'),
    target: IntentTargetSchema,
    /** 1 is no change. The planner clamps, and reports what it actually achieved. */
    factor: z.number().min(0.25).max(4),
  }),
  z.object({
    kind: z.literal('move'),
    target: IntentTargetSchema,
    towards: z.enum(['house', 'boundary', 'zone']),
    /** Required when `towards` is 'zone'; ignored otherwise. */
    zone: ZoneIdSchema.optional(),
    away: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('material'),
    target: IntentTargetSchema,
    materialId: MaterialIdSchema,
  }),
  z.object({
    kind: z.literal('recategorise'),
    target: IntentTargetSchema,
    category: ElementCategorySchema,
  }),
  z.object({
    kind: z.literal('add'),
    category: ElementCategorySchema,
    name: z.string().min(1).max(60),
    footprint: IntentFootprintSchema,
    zone: ZoneIdSchema.optional(),
    affinity: z.enum(['near-house', 'far-from-house', 'along-boundary', 'any']).default('any'),
  }),
  z.object({ kind: z.literal('remove'), target: IntentTargetSchema }),
  z.object({
    kind: z.literal('reduce-cost'),
    maxChanges: z.number().int().min(1).max(6).default(5),
  }),
]);
export type DesignIntent = z.infer<typeof DesignIntentSchema>;

/**
 * What the model returns.
 *
 * `reply` is the only prose in the system that the model writes. It is deliberately asked for in
 * the conditional — "I've proposed", not "I've made" — because the changes have not happened yet
 * and may not survive the planner.
 */
export const AssistantIntentEnvelopeSchema = z.object({
  reply: z.string().min(1).max(600),
  intents: z.array(DesignIntentSchema).max(6),
  suggestions: z.array(z.string().min(1).max(60)).min(3).max(4),
});
export type AssistantIntentEnvelope = z.infer<typeof AssistantIntentEnvelopeSchema>;

/* ---------------------------------------------------------------- the wire contract */

export const ChangeKindSchema = z.enum(['resize', 'move', 'material', 'add', 'remove']);
export type ChangeKind = z.infer<typeof ChangeKindSchema>;

export const ProposedChangeSchema = z.object({
  id: z.string(),
  kind: ChangeKindSchema,
  /** The element this acts on. Null only for `kind: 'add'`. */
  elementId: z.string().nullable(),
  /** What to call it in the list — the element's name, or the category for an unnamed fill. */
  label: z.string(),
  /** Display strings, both measured off geometry. Never fabricated prose. */
  before: z.string(),
  after: z.string(),
  /** The element as it would be if this line is accepted. */
  next: DesignElementSchema,
  /** The element as it is now, so the store can tell a stale proposal from a fresh one. */
  previous: DesignElementSchema.nullable(),
});
export type ProposedChange = z.infer<typeof ProposedChangeSchema>;

export const AssistantProposalSchema = z.object({
  reply: z.string(),
  changes: z.array(ProposedChangeSchema).default([]),
  /** 3–4 follow-up chips. Always present, even when nothing could be proposed. */
  suggestions: z.array(z.string()).default([]),
  /**
   * What was asked for but could not be placed legally, with the reason.
   *
   * The planner writes these, never the model. That split is the point: the model writes the
   * prose, the planner writes the facts — so the assistant cannot claim it did something it did
   * not do, which is the one failure that would make the feature untrustworthy.
   */
  unplaceable: z.array(z.object({ description: z.string(), reason: z.string() })).default([]),
});
export type AssistantProposal = z.infer<typeof AssistantProposalSchema>;

/**
 * The request. Just the sentence.
 *
 * It used to carry the elements, zones, boundary, house and unit. The server has all five in the
 * stored plan, and sending them again would mean the assistant could be asked to reason about a
 * garden that is not the one saved.
 */
export const ProposeRequestSchema = z.object({
  message: z.string().min(1).max(1000),
});
export type ProposeRequest = z.infer<typeof ProposeRequestSchema>;
