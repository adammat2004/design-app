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
    /**
     * What to move it towards.
     *
     * `element` is the useful one and was missing: "put the fire pit nearer the seating" is an
     * ordinary thing to ask, and the other three destinations cannot express it — the house, the
     * fence and a zone centroid are the only places anything could go. Still a relation, not a
     * position: the destination is named by id and the planner reads its anchor.
     */
    towards: z.enum(['house', 'boundary', 'zone', 'element']),
    /** Required when `towards` is 'zone'; ignored otherwise. */
    zone: ZoneIdSchema.optional(),
    /** Required when `towards` is 'element'; ignored otherwise. Must name a different element. */
    elementId: z.string().optional(),
    away: z.boolean().default(false),
  }),
  /**
   * Push one side of an outline out, or pull it in.
   *
   * The thing a user asks for constantly and the vocabulary could not say: "make the border
   * deeper". `resize` scales the whole shape about its own centre, which on a bed running the
   * width of the garden makes it longer as well as deeper — not what anybody means.
   *
   * `edge` is a **relation**, like every other position in this file: which side of the shape, said
   * in terms of the house rather than of the screen. `metres` is a size, which is allowed, because
   * it is relative to the object rather than a place to put it.
   */
  z.object({
    kind: z.literal('reshape'),
    target: IntentTargetSchema,
    edge: z.enum(['towards-house', 'away-from-house']),
    /** Positive deepens that side; negative pulls it back. */
    metres: z.number().min(-5).max(5),
  }),
  /**
   * Take the furniture with it.
   *
   * On its own, `attach` says "whatever is standing on these things should keep standing on them".
   * The planner adds the moves; the model does not have to know a dining set is on the terrace, and
   * could not say where to put it if it did.
   */
  z.object({ kind: z.literal('attach'), target: IntentTargetSchema }),
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
  /**
   * Redraw a route so that it does something better than it does now.
   *
   * **The objective, never the line.** A polyline is a list of coordinates and the model may not
   * write one, so what it says is what the path should *achieve*: go more directly, get clear of
   * these things, reach that one. The planner enumerates every legal route the router can draw
   * between the path's own ends and picks by the objective — which is the same set the generator
   * chooses from, so a rerouted path is a path the generator could have drawn.
   *
   * Three objectives and no more. `follow-edge` was the obvious fourth and is absent because the
   * router cannot draw it: an objective the planner has to refuse every time is a tick the design
   * ignores, which is the defect this codebase keeps catching itself committing.
   */
  z.object({
    kind: z.literal('reroute'),
    target: IntentTargetSchema,
    objective: z.enum(['direct', 'avoid', 'connect']).default('direct'),
    /** Required by `avoid`: what the route should stop crossing or squeezing past. */
    avoidElementIds: z.array(z.string()).max(8).optional(),
    /** Required by `connect`: the element the route should reach instead. */
    connectElementId: z.string().optional(),
  }),
  /**
   * Turn something to line up with something else.
   *
   * No angle, and that is the point. A free rotation is the one number in this vocabulary that
   * behaves like a coordinate — "put it at 37°" is a position in the same way "put it at x 4.2" is —
   * and no garden request needs one. What people say is "square it to the house", "line it up with
   * the fence", "turn it to match the pergola", and the planner resolves each against real geometry
   * and tries the quarter turns nearest where the thing already sits.
   */
  z.object({
    kind: z.literal('rotate'),
    target: IntentTargetSchema,
    to: z.enum(['house', 'boundary', 'element']),
    /** Required when `to` is 'element'; ignored otherwise. Must name a different element. */
    elementId: z.string().optional(),
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
 * `reply` is the only prose in the system that the model writes, and it is asked for in the
 * **future tense** — "I'll enlarge the terrace" — because the designer now performs the work on the
 * canvas rather than handing over a list to tick. Never the past tense: the planner may still refuse
 * a line, and what actually landed is counted by the editor and written into the done message.
 *
 * Twelve intents rather than six. Six is a sentence's worth of *one* change; a request like "make
 * this better for entertaining" is legitimately a terrace, a pergola, two paths and the lighting,
 * and a cap that cuts it in half turns a whole answer into an arbitrary half of one.
 */
export const AssistantIntentEnvelopeSchema = z.object({
  reply: z.string().min(1).max(600),
  intents: z.array(DesignIntentSchema).max(12),
  suggestions: z.array(z.string().min(1).max(60)).min(3).max(4),
});
export type AssistantIntentEnvelope = z.infer<typeof AssistantIntentEnvelopeSchema>;

/* ---------------------------------------------------------------- the wire contract */

/**
 * What a line of the diff is doing.
 *
 * `reshape` joined the five when the planner learned to push one side of an outline out. It is not
 * a `resize`: a resize scales about the anchor and keeps the shape, where a reshape moves some
 * corners and not others — and the editor's animation is derived from the elements rather than from
 * this, so calling it the wrong thing would only mislead a reader.
 *
 * `rotate` and `reroute` joined for the same reason: the executor has drawn both since the
 * operations schema was written, and `from-proposal` derives them from the geometry either way, so
 * these two names exist to stop the diff line calling a turn a move.
 */
export const ChangeKindSchema = z.enum([
  'resize',
  'reshape',
  'move',
  'rotate',
  'reroute',
  'material',
  'add',
  'remove',
]);
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
 * One turn of the conversation, as it is sent back on the next request.
 *
 * Text only, and short. What the designer needs from a previous turn is what was *said*, not what
 * was done — the inventory already carries the garden as it now stands, and a turn is only in the
 * history because the plan it described has since been redrawn. Sending the changes again would be
 * a second, staler description of the same elements, and the model has no way to tell which of the
 * two to believe.
 */
export const AssistantTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(600),
});
export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

/**
 * The request: the sentence, what was said just before it, and what they are pointing at.
 *
 * It used to carry the elements, zones, boundary, house and unit. The server has all five in the
 * stored plan, and sending them again would mean the assistant could be asked to reason about a
 * garden that is not the one saved. There are two exceptions and **neither is a description of the
 * garden**, which is the line that decides what may be here at all.
 *
 * `history` is what was *said*: **"a bit more" is the second thing anybody types**, and with no
 * history it resolves to nothing. Four turns, because the inventory says what the garden is now and
 * older turns describe a garden that has been redrawn since.
 *
 * `selection` is what they are *pointing at* — the element selected on the canvas as they typed. It
 * is deixis, not geometry: "make this bigger" is a complete sentence at the screen and an unanswerable
 * one on the wire, and without it the designer's only correct move is to ask which element they mean
 * about the one they have already clicked. Ids only, resolved against the stored plan; an id naming
 * nothing is dropped, exactly as the planner drops one.
 *
 * An array although the editor selects one element, so multi-select needs no change to this contract.
 *
 * Both are optional with a default, so an older client and every existing test still parse.
 */
export const ProposeRequestSchema = z.object({
  message: z.string().min(1).max(1000),
  history: z.array(AssistantTurnSchema).max(8).default([]),
  selection: z.array(z.string()).max(8).default([]),
});
export type ProposeRequest = z.infer<typeof ProposeRequestSchema>;

/**
 * Whether this server can interpret a sentence at all.
 *
 * Asked once when the editor opens, so the panel can say "the designer needs an API key" *before*
 * somebody types a request and waits for it to fail. It reports only what is configured — it
 * cannot tell a missing key from a transient upstream failure, because `toHttpException` maps four
 * different states to 503, so a 503 arriving mid-conversation is rendered as a failed message
 * rather than as "no key".
 */
export const AssistantAvailabilitySchema = z.object({ model: z.boolean() });
export type AssistantAvailability = z.infer<typeof AssistantAvailabilitySchema>;

/**
 * A redesign asked for in the planner's own vocabulary, with no model in the loop.
 *
 * The design reviewer is a scorer, not a conversation: it reads a layout, names a fault and the
 * elements it is about, and the fix for that fault is a `DesignIntent` chosen from a table. There
 * is no sentence anywhere in that, so there is nothing for a language model to do — and routing it
 * through one would make a deterministic, offline, free correction into a paid call that can fail.
 *
 * The planner is the same one the chat uses, so a reviewer's correction is placed by exactly the
 * rules a user's request is: `geometryIsLegal`, the same placer, the same refusal to invent a
 * position for something that does not fit.
 */
export const RedesignRequestSchema = z.object({
  intents: z.array(DesignIntentSchema).min(1).max(6),
  /**
   * The layout to plan against, where it is not the one on the server.
   *
   * The reviewer asks about a garden mid-redesign, which is saved nowhere: the run holds the
   * editor's gesture open and autosave is suppressed for its duration. Without this the planner
   * would answer about the last *stored* plan — which is how this was first built, and the symptom
   * was a correction computed from widths the user had already changed. Absent means the stored
   * layout, which is what the chat wants.
   */
  elements: z.array(DesignElementSchema).max(400).optional(),
});
export type RedesignRequest = z.infer<typeof RedesignRequestSchema>;

/** What it answers: the planner's facts, and none of the model's prose. */
export const RedesignResultSchema = z.object({
  changes: z.array(ProposedChangeSchema).default([]),
  unplaceable: z.array(z.object({ description: z.string(), reason: z.string() })).default([]),
});
export type RedesignResult = z.infer<typeof RedesignResultSchema>;
