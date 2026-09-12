import { z } from 'zod';
import { FeatureKindSchema, FeatureStatusSchema, PlacedFeatureSchema } from './features.js';
import { ZoneIdSchema } from './zone-id.js';

/**
 * The garden assistant's contract — step 2's "tell me what you have and I will map it".
 *
 * A sibling of `assistant.ts`, not a second AI system, and it keeps that file's one load-bearing
 * property: **there is no field here that can hold a coordinate.** Position exists only as a small
 * bounded vocabulary of places — `back-left`, `along-the-right-fence`, `outside-the-back-door` —
 * which a deterministic helper resolves against the boundary, the house and the garden door. If the
 * model wanted to write `x: 4.2` there is nowhere to put it.
 *
 * The other difference from `assistant.ts` is deliberate and is about *this* screen rather than
 * about trust. Step 5's diff is reviewed line by line because it rewrites a finished design. Here
 * the user is describing a garden that already exists, an approximate shed in the right corner is
 * the whole ask, and a review queue between "I have a shed" and a shed appearing would make the
 * fast path slower than drawing it by hand. So changes apply straight away — as one undo entry.
 */

/* ---------------------------------------------------------------- structured actions */

/**
 * Where a thing goes, in words.
 *
 * Resolved against the `DesignFrame` off the garden door — the same frame the generator composes
 * in — so "back-left" means "far from the house, to the left as you look out of the doors" rather
 * than anything about the screen. A plan with no house falls back to the plot's own quadrants
 * oriented by the street.
 *
 * Bounded on purpose: an open string would have the model inventing places the resolver cannot
 * answer, and "somewhere near the old apple tree" has no deterministic reading.
 */
export const GardenAnchorSchema = z.enum([
  'back-left',
  'back-centre',
  'back-right',
  'mid-left',
  'centre',
  'mid-right',
  'front-left',
  'front-centre',
  'front-right',
  'along-left-fence',
  'along-right-fence',
  'along-back-fence',
  'outside-back-door',
  'outside-front-door',
  'beside-house-left',
  'beside-house-right',
]);
export type GardenAnchor = z.infer<typeof GardenAnchorSchema>;

/**
 * A stated size, when the user gives one.
 *
 * Optional throughout: `FEATURE_DEFINITIONS` already knows how big a shed starts, and a user who
 * says "there's a shed in the corner" has not said it is 2.5 m wide — they have said there is a
 * shed. Inventing a measurement would be the same mistake as inventing a latitude.
 */
export const GardenFootprintSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    width: z.number().min(0.3).max(30),
    depth: z.number().min(0.3).max(30),
  }),
  z.object({ kind: z.literal('point'), radius: z.number().min(0.2).max(8) }),
]);
export type GardenFootprint = z.infer<typeof GardenFootprintSchema>;

export const GardenActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('add'),
    feature: FeatureKindSchema,
    at: GardenAnchorSchema,
    /** Narrows the search to one garden. Omitted means "wherever the anchor lands". */
    zone: ZoneIdSchema.optional(),
    /** "Two mature trees along the right fence" is one action, not two. */
    count: z.number().int().min(1).max(4).default(1),
    size: GardenFootprintSchema.optional(),
    name: z.string().min(1).max(40).optional(),
  }),
  z.object({ kind: z.literal('move'), featureId: z.string(), to: GardenAnchorSchema }),
  z.object({
    kind: z.literal('resize'),
    featureId: z.string(),
    /** 1 is no change. The planner clamps to what actually fits and reports what it achieved. */
    factor: z.number().min(0.25).max(4),
  }),
  z.object({ kind: z.literal('delete'), featureId: z.string() }),
  z.object({
    kind: z.literal('status'),
    featureId: z.string(),
    status: FeatureStatusSchema,
    replaceWith: z.string().max(60).nullable().default(null),
  }),
  /**
   * Which gardens to redesign.
   *
   * Zones only. A custom redesign outline is a *drawing*, and there is no bounded way to say one in
   * words — so the model can say "just the back garden" and cannot say "this shape here".
   */
  z.object({ kind: z.literal('scope'), zones: z.array(ZoneIdSchema).min(1).max(4) }),
]);
export type GardenAction = z.infer<typeof GardenActionSchema>;

/** What the model returns. `reply` is the only prose in the system the model writes. */
export const GardenEnvelopeSchema = z.object({
  reply: z.string().min(1).max(400),
  actions: z.array(GardenActionSchema).max(8),
  suggestions: z.array(z.string().min(1).max(60)).max(4).default([]),
});
export type GardenEnvelope = z.infer<typeof GardenEnvelopeSchema>;

/* ---------------------------------------------------------------- the wire contract */

export const GardenChangeKindSchema = z.enum(['add', 'move', 'resize', 'delete', 'status']);
export type GardenChangeKind = z.infer<typeof GardenChangeKindSchema>;

export const GardenChangeSchema = z.object({
  id: z.string(),
  kind: GardenChangeKindSchema,
  /** The feature this acts on. Null only for `kind: 'add'`. */
  featureId: z.string().nullable(),
  /** What to call it in the acknowledgement — "shed", "Rear patio". */
  label: z.string(),
  /** The feature as it would be once this lands. */
  next: PlacedFeatureSchema,
  /** As it is now, so the store can tell a stale change from a fresh one. Null for an add. */
  previous: PlacedFeatureSchema.nullable(),
});
export type GardenChange = z.infer<typeof GardenChangeSchema>;

/** Which zones the assistant was asked to design, or null when it said nothing about scope. */
export const GardenScopeChangeSchema = z.object({ zones: z.array(ZoneIdSchema).min(1) });
export type GardenScopeChange = z.infer<typeof GardenScopeChangeSchema>;

export const GardenProposalSchema = z.object({
  reply: z.string(),
  changes: z.array(GardenChangeSchema).default([]),
  scope: GardenScopeChangeSchema.nullable().default(null),
  suggestions: z.array(z.string()).default([]),
  /**
   * What was asked for but could not be placed, with a measured reason.
   *
   * The planner writes these, never the model — the same split `assistant.ts` rests on. It means
   * the assistant cannot claim it mapped a shed it could not fit, which is the one failure that
   * would make the feature untrustworthy.
   */
  unplaceable: z.array(z.object({ description: z.string(), reason: z.string() })).default([]),
});
export type GardenProposal = z.infer<typeof GardenProposalSchema>;

/** The request. Just the sentence — the server reads the stored plan for everything else. */
export const ProposeGardenRequestSchema = z.object({
  message: z.string().min(1).max(1000),
});
export type ProposeGardenRequest = z.infer<typeof ProposeGardenRequestSchema>;
