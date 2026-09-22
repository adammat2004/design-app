import { z } from 'zod';
import { PointSchema, polygonIsSimple, type Point } from '../geometry/primitives.js';
import { DesignElementSchema, isLocked, type DesignElement } from './concepts.js';
import { MIN_FEATURE_SIDE, moveGeometry, type PlanGeometry } from './features.js';
import { elementIsLegal } from './footprint.js';

/**
 * What an AI designer is allowed to do to a layout, as data.
 *
 * This is the contract between the reasoning half of the system and the half that draws: an agent
 * (or a scripted demonstration) produces `DesignOperation[]`, and the editor animates them against
 * the real `DesignElement[]` the user can edit by hand. The renderer is never told what to paint —
 * it goes on reading the same store it always did, one operation at a time.
 *
 * Three properties are load-bearing, and each is a property of the *type* rather than a promise
 * anyone has to keep:
 *
 * 1. **An operation is a script, not a diff.** There is nowhere to put a `from`, so an operation
 *    cannot disagree with the plan it is applied to: the starting state is read from the live
 *    elements at the moment the operation runs. That is also what makes Replay a re-run rather than
 *    a recording — it plays the same operations from the same recorded snapshot.
 * 2. **There is no field for presentation.** No opacity, no scale, no ghost, no easing curve. How a
 *    change is drawn while it happens is derived by the executor and thrown away; what is stored is
 *    only ever a finished, legal `DesignElement`. Same reasoning as `DesignIntent` having no field
 *    that can hold a coordinate.
 * 3. **Nothing here decides legality.** `resolveOperation` does, against the same
 *    `elementIsLegal` and `isLocked` the editor's own gestures answer to — so an operation can
 *    never animate a change the store would refuse to keep. An animation that showed a change the
 *    plan did not accept would be the one lie this feature cannot afford.
 *
 * The vocabulary is deliberately small. Anything that cannot be said in it is not a limitation to
 * work around with a `custom` escape hatch — it is a missing operation kind, and adding one is a
 * compile error in the executor until it is answered.
 */

/* ---------------------------------------------------------------- who and when */

/**
 * Which specialist is at work.
 *
 * A label on the operation, never five conversations. The design system already runs as passes over
 * one plan — a layout grammar, a circulation pass, a planting pass, a scorer — and this names the
 * pass that produced an operation so the activity panel can say what is happening. Nothing branches
 * on it; it is there to be read by a person.
 */
export const AgentRoleSchema = z.enum(['lead', 'layout', 'circulation', 'planting', 'reviewer']);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

/** The stage of the redesign an operation belongs to, which is what the stage strip reads. */
export const RunPhaseSchema = z.enum(['analyse', 'layout', 'circulation', 'planting', 'review']);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RUN_PHASES: RunPhase[] = ['analyse', 'layout', 'circulation', 'planting', 'review'];

/**
 * An element id, or `$name` standing for something an earlier `add` in the same run creates.
 *
 * Ids cannot be written into a script ahead of time — the editor allocates them (`e-N`) and a
 * generated concept's are `c<seed>-<index>-eN`, which change every time concepts are regenerated.
 * A reference bound at prepare time keeps a run replayable: the same script run twice binds the
 * same `$pergola` to the same new id, so the second run reproduces the first exactly.
 */
const ElementRefSchema = z.string().min(1).max(80);

const baseFields = {
  id: z.string().min(1).max(40),
  agent: AgentRoleSchema,
  phase: RunPhaseSchema,
  /** The chip drawn beside the cursor while this runs. Short enough to read in passing. */
  label: z.string().min(1).max(40),
  /** The sentence the activity panel shows against the agent. Why, not what. */
  reason: z.string().max(160).optional(),
  /** Milliseconds. Absent takes `DEFAULT_DURATION[kind]`, which is where the motion rules live. */
  duration: z.number().int().min(0).max(5000).optional(),
  /** A beat after this operation before the next starts. Absent takes `DEFAULT_PAUSE`. */
  pauseAfter: z.number().int().min(0).max(2000).optional(),
};

/* ---------------------------------------------------------------- the operations */

/**
 * A whole target rectangle rather than a delta, and that is the difference between a terrace that
 * grows away from the house and one that drifts.
 *
 * Every size in this file is absolute for the same reason: an operation applied to a plan that has
 * moved on since it was written should either be refused or land exactly where it says, never land
 * somewhere relative to a state nobody can see any more.
 */
const RectTargetSchema = z.object({
  centre: PointSchema,
  width: z.number().positive(),
  depth: z.number().positive(),
  rotation: z.number().default(0),
});

const PointTargetSchema = z.object({ at: PointSchema, radius: z.number().positive() });

/**
 * The properties an operation may set.
 *
 * Deliberately not `DesignElementSchema.partial()`: `shape` belongs to the geometry operations, and
 * `id`, `role` and `fillKind` are identity — an operation that could flip a feature into a base fill
 * could make the ground unmovable behind the user's back.
 */
const PropertyChangesSchema = DesignElementSchema.pick({
  name: true,
  category: true,
  material: true,
  edging: true,
  retaining: true,
  elevation: true,
  height: true,
  symbol: true,
  plantId: true,
  plantingStyle: true,
  zone: true,
  hidden: true,
})
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, 'A setProperty must change something.');

const leafOperations = [
  /** Overlay only: the sweep that reads the plan before anything is touched. */
  z.object({ ...baseFields, kind: z.literal('analyse') }),
  /** Panel only: a sentence with nothing on the canvas to show for it. */
  z.object({ ...baseFields, kind: z.literal('note') }),
  z.object({ ...baseFields, kind: z.literal('select'), elementId: ElementRefSchema }),
  z.object({
    ...baseFields,
    kind: z.literal('inspect'),
    elementIds: z.array(ElementRefSchema).min(1).max(8),
  }),
  z.object({
    ...baseFields,
    kind: z.literal('move'),
    /** The target *anchor*, the same contract `moveGeometry` and `setPosition` take. */
    to: PointSchema,
    elementId: ElementRefSchema,
    /** Show the destination outline and an arrow to it before the thing sets off. */
    ghost: z.boolean().default(false),
  }),
  z.object({
    ...baseFields,
    kind: z.literal('resize'),
    elementId: ElementRefSchema,
    to: z.union([RectTargetSchema, PointTargetSchema]),
  }),
  z.object({
    ...baseFields,
    kind: z.literal('rotate'),
    elementId: ElementRefSchema,
    /** Absolute degrees clockwise. The executor takes the short way round. */
    degrees: z.number(),
  }),
  z.object({
    ...baseFields,
    kind: z.literal('reshape'),
    elementId: ElementRefSchema,
    to: z.object({
      points: z.array(PointSchema).min(3),
      cornerRadius: z.number().nonnegative().optional(),
    }),
  }),
  z.object({
    ...baseFields,
    kind: z.literal('reroute'),
    elementId: ElementRefSchema,
    to: z.object({
      points: z.array(PointSchema).min(2),
      width: z.number().positive().optional(),
    }),
  }),
  z.object({
    ...baseFields,
    kind: z.literal('setProperty'),
    elementId: ElementRefSchema,
    changes: PropertyChangesSchema,
  }),
  z.object({
    ...baseFields,
    kind: z.literal('add'),
    /** What later operations call it. Bound to a real id when the run is prepared. */
    ref: ElementRefSchema,
    /** Everything but the id, which is the editor's to allocate. */
    element: DesignElementSchema.omit({ id: true }),
  }),
  z.object({ ...baseFields, kind: z.literal('remove'), elementId: ElementRefSchema }),
] as const;

export const LeafOperationSchema = z.discriminatedUnion('kind', leafOperations);
export type LeafOperation = z.infer<typeof LeafOperationSchema>;

/**
 * Things that happen together.
 *
 * The only concurrency in the vocabulary, and it covers every case the design work actually has:
 * furniture following the terrace it stands on, five lights arriving one after another, two beds
 * trading the same strip of ground. A dependency graph was considered and rejected — order *is* the
 * dependency here, because each operation reads its starting state from the one before it, and a
 * graph would buy a scheduler and a cycle check for a kind of parallelism nothing needs.
 *
 * Not recursive: a group of groups is a timeline nobody can read, and it would let a script hide
 * arbitrary nesting from the panel that has to narrate it.
 */
export const GroupOperationSchema = z.object({
  ...baseFields,
  kind: z.literal('group'),
  children: z.array(LeafOperationSchema).min(1).max(12),
  /** Milliseconds between children starting, which is what makes a group read as a hand at work. */
  stagger: z.number().int().min(0).max(500).default(0),
});
export type GroupOperation = z.infer<typeof GroupOperationSchema>;

export const DesignOperationSchema = z.union([LeafOperationSchema, GroupOperationSchema]);
export type DesignOperation = z.infer<typeof DesignOperationSchema>;

/**
 * A whole redesign: what was asked for, and what the designers did about it.
 *
 * `summary` is written by whoever authored the operations — the script, or later the planner from
 * what it actually placed. It is never composed client-side from the operation list, for the reason
 * the assistant's `unplaceable` entries are written by the planner and not the model: a sentence
 * assembled from intentions can claim something the plan does not show.
 */
export const DesignRunSchema = z.object({
  id: z.string().min(1).max(60),
  request: z.string().max(1000),
  operations: z.array(DesignOperationSchema).min(1).max(60),
  summary: z.string().max(240).optional(),
});
export type DesignRun = z.infer<typeof DesignRunSchema>;

/* ---------------------------------------------------------------- motion defaults */

/**
 * How long each kind takes when the script does not say.
 *
 * These are the motion rules, in one place so a run composed by an agent moves like a run written by
 * hand: a single move reads in about half a second, a geometry transform wants a second or more to
 * be followed, and anything under a quarter of a second is a jump rather than a change.
 */
export const DEFAULT_DURATION: Record<DesignOperation['kind'], number> = {
  analyse: 1300,
  note: 900,
  select: 400,
  inspect: 1200,
  move: 600,
  resize: 1200,
  rotate: 600,
  reshape: 1000,
  reroute: 2000,
  setProperty: 700,
  add: 700,
  remove: 500,
  group: 700,
};

/** The beat between operations. Without it a run reads as a machine emptying a queue. */
export const DEFAULT_PAUSE = 300;

export function durationOf(operation: DesignOperation): number {
  if (operation.kind === 'group') {
    const longest = operation.children.reduce(
      (most, child, index) =>
        Math.max(most, index * operation.stagger + (child.duration ?? DEFAULT_DURATION[child.kind])),
      0,
    );
    return operation.duration ?? longest;
  }
  return operation.duration ?? DEFAULT_DURATION[operation.kind];
}

/* ---------------------------------------------------------------- refusals */

/*
 * The two sentences the editor already says when it will not accept an edit.
 *
 * Exported from here and imported by the store rather than written twice: a run and a drag refuse
 * for exactly the same reasons, and two copies of a refusal are two copies that can drift into
 * describing the same rule differently.
 */
export const FENCE_REFUSAL = 'That goes over the property boundary.';
export const LOCKED_REFUSAL =
  'That is the ground layer for its zone — change its material instead.';
export const MISSING_REFUSAL = 'That element is no longer on the plan.';

/* ---------------------------------------------------------------- resolution */

export type ResolvedOperation =
  | { ok: true; effect: 'none' }
  | { ok: true; effect: 'replace'; before: DesignElement; after: DesignElement }
  | { ok: true; effect: 'append'; after: DesignElement }
  | { ok: true; effect: 'delete'; before: DesignElement }
  | { ok: false; reason: string };

export interface ResolveContext {
  elements: DesignElement[];
  boundary: Point[];
  /** `$ref` → the id an `add` was given when the run was prepared. */
  bindings: Record<string, string>;
}

/** A reference resolves to a literal id, or to whatever an earlier `add` in this run was given. */
export function resolveRef(ref: string, bindings: Record<string, string>): string | null {
  if (!ref.startsWith('$')) return ref;
  return bindings[ref] ?? null;
}

function find(ref: string, context: ResolveContext): DesignElement | null {
  const id = resolveRef(ref, context.bindings);
  if (!id) return null;
  return context.elements.find((element) => element.id === id) ?? null;
}

/**
 * Whether a **resize** has gone below the smallest thing a handle may produce.
 *
 * Only a resize. The minimum is a rule about dragging something smaller than it is usable at, which
 * is why the editor applies it in `resizeElementLive` and `setCanopyDiameter` and nowhere else —
 * plenty of legitimate elements are already under it, and a bollard light is 160 mm across. Applying
 * it to `add` would have an AI unable to place the lighting the generator places routinely.
 */
function tooSmallToResize(shape: PlanGeometry): boolean {
  if (shape.kind === 'rect') return shape.width < MIN_FEATURE_SIDE || shape.depth < MIN_FEATURE_SIDE;
  if (shape.kind === 'point') return shape.radius * 2 < MIN_FEATURE_SIDE;
  return false;
}

/**
 * What an operation would do to the plan, or why it will not happen.
 *
 * Called once per operation *before* anything animates, against the state that operation will
 * actually land on. That ordering is the whole point: a refused operation is reported in the panel
 * and skipped, so the canvas never shows a change the store would then reject. It answers to the
 * same three rules the editor's own gestures do — the ground layer of a zone cannot be moved or
 * removed, nothing may cross the fence, and nothing may be shrunk below the minimum side — because
 * an AI that could do what a person cannot would be a second set of rules to reason about.
 *
 * Pure: no store, no clock, no canvas. The server can run it against a stored document and get the
 * same answer the browser will.
 */
export function resolveOperation(
  operation: LeafOperation,
  context: ResolveContext,
): ResolvedOperation {
  const geometryChange = (
    before: DesignElement,
    shape: PlanGeometry,
    options: { resizing?: boolean } = {},
  ): ResolvedOperation => {
    if (isLocked(before)) return { ok: false, reason: LOCKED_REFUSAL };
    if (options.resizing && tooSmallToResize(shape))
      return { ok: false, reason: `${before.name ?? 'That'} would be too small.` };
    if (shape.kind === 'polygon' && !polygonIsSimple(shape.points))
      return { ok: false, reason: 'That outline would cross itself.' };
    /* `elementIsLegal`, so a tree is judged on its trunk exactly as the editor's own drag is. */
    if (!elementIsLegal({ ...before, shape }, context.boundary))
      return { ok: false, reason: FENCE_REFUSAL };
    return { ok: true, effect: 'replace', before, after: { ...before, shape } };
  };

  switch (operation.kind) {
    case 'analyse':
    case 'note':
      return { ok: true, effect: 'none' };

    case 'select':
    case 'inspect': {
      const refs = operation.kind === 'select' ? [operation.elementId] : operation.elementIds;
      const missing = refs.some((ref) => !find(ref, context));
      return missing ? { ok: false, reason: MISSING_REFUSAL } : { ok: true, effect: 'none' };
    }

    case 'move': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };
      return geometryChange(before, moveGeometry(before.shape, operation.to));
    }

    case 'resize': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };

      /*
       * A target of the wrong kind is refused rather than coerced. "Resize this bed to a rectangle"
       * is not a smaller version of a bed — it is a different shape, and quietly replacing a
       * twelve-vertex border with a box is the sort of help nobody asked for.
       */
      if ('radius' in operation.to) {
        if (before.shape.kind !== 'point')
          return { ok: false, reason: 'That is not something with a radius.' };
        return geometryChange(before, { ...before.shape, ...operation.to }, { resizing: true });
      }
      if (before.shape.kind !== 'rect')
        return { ok: false, reason: 'That is not a rectangle to resize.' };
      return geometryChange(before, { ...before.shape, ...operation.to }, { resizing: true });
    }

    case 'rotate': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };
      if (before.shape.kind !== 'rect')
        return { ok: false, reason: 'Only a rectangle has a rotation.' };
      const rotation = ((operation.degrees % 360) + 360) % 360;
      return geometryChange(before, { ...before.shape, rotation });
    }

    case 'reshape': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };
      if (before.shape.kind !== 'polygon')
        return { ok: false, reason: 'That is not an outline to reshape.' };
      return geometryChange(before, {
        ...before.shape,
        points: operation.to.points,
        ...(operation.to.cornerRadius === undefined ? {} : { cornerRadius: operation.to.cornerRadius }),
      });
    }

    case 'reroute': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };
      if (before.shape.kind !== 'polyline')
        return { ok: false, reason: 'That is not a route to redraw.' };
      return geometryChange(before, {
        ...before.shape,
        points: operation.to.points,
        ...(operation.to.width === undefined ? {} : { width: operation.to.width }),
      });
    }

    case 'setProperty': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };
      /*
       * No locked check and no legality check, matching `commitElement(..., {checkGeometry: false})`:
       * none of these fields can move anything, and turning the lawn to gravel is exactly the edit a
       * base fill is meant to accept.
       */
      return { ok: true, effect: 'replace', before, after: { ...before, ...operation.changes } };
    }

    case 'add': {
      const id = context.bindings[operation.ref];
      /* An `add` whose id was never allocated means a broken prepare, not a broken plan. */
      if (!id) return { ok: false, reason: MISSING_REFUSAL };
      if (context.elements.some((element) => element.id === id))
        return { ok: false, reason: 'That element is already on the plan.' };

      const after: DesignElement = { ...operation.element, id };
      if (!elementIsLegal(after, context.boundary)) return { ok: false, reason: FENCE_REFUSAL };
      return { ok: true, effect: 'append', after };
    }

    case 'remove': {
      const before = find(operation.elementId, context);
      if (!before) return { ok: false, reason: MISSING_REFUSAL };
      if (isLocked(before)) return { ok: false, reason: LOCKED_REFUSAL };
      return { ok: true, effect: 'delete', before };
    }
  }
}

/**
 * The resolved operation, folded into the element list.
 *
 * Returns the same array when nothing changed, so a caller can compare by identity. Note what is
 * *not* here: `associatePlants`. Re-homing a plant to the bed it now sits in is the store's rule and
 * it runs on every write there, so doing it here as well would be a second answer to a settled
 * question — and this module has to stay usable on the server, where there is no store at all.
 */
export function applyResolved(
  elements: DesignElement[],
  resolved: ResolvedOperation,
): DesignElement[] {
  if (!resolved.ok) return elements;

  switch (resolved.effect) {
    case 'none':
      return elements;
    case 'replace':
      return elements.map((element) =>
        element.id === resolved.before.id ? resolved.after : element,
      );
    case 'append':
      return [...elements, resolved.after];
    case 'delete':
      return elements.filter((element) => element.id !== resolved.before.id);
  }
}

/** Every leaf an operation contains: itself, or a group's children in order. */
export function leavesOf(operation: DesignOperation): LeafOperation[] {
  return operation.kind === 'group' ? operation.children : [operation];
}

/** Which element an operation acts on, where it names exactly one. */
export function subjectOf(operation: LeafOperation): string | null {
  if ('elementId' in operation) return operation.elementId;
  if (operation.kind === 'add') return operation.ref;
  return null;
}
