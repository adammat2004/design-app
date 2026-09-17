import { RepairKindSchema, type RepairKind } from './design-score.js';

/**
 * What can actually be done about each kind of fault, and where.
 *
 * **There were three of these tables and they agreed only by hand.** `repair.ts` had `UNAVAILABLE`
 * for the generator's candidate loop, `review-loop.ts` had `UNPERFORMABLE` for the editor, and
 * `intentsFor` had a third opinion expressed as a `switch` with no default case — so a repair kind
 * was performable in the editor if and only if somebody had remembered to add a branch. Three
 * sources for one decision is the defect this codebase keeps writing down, and this is it removed.
 *
 * A capability is stated per side because the two genuinely differ. The generator adjusts a
 * *candidate* — it can bar a slot and redraw the whole layout, and it cannot turn a rectangle,
 * because every placement it makes inherits the design frame's own bearing. The editor changes
 * *elements* — it can turn one, and it cannot redraw the composition's beds.
 *
 * A reason rather than a boolean, and the reason is shown. A limitation that is written down can be
 * closed; one that looks like an action and silently achieves nothing is the thing a user presses
 * twice and then stops trusting.
 */

/** What a repair does to the garden, as the planner's own vocabulary. */
export type RepairVerb =
  | 'move'
  | 'resize'
  | 'reshape'
  | 'rotate'
  | 'remove'
  | 'reroute'
  /** Lay a route that does not exist yet, rather than redraw one that does. */
  | 'add-route';

export interface RepairCapability {
  /** How a planner would carry it out, or `null` where nothing could. */
  verb: RepairVerb | null;
  /** `'performable'`, or why the editor's planner cannot do it. */
  editor: 'performable' | string;
  /** `'performable'`, or why the generator's candidate loop cannot do it. */
  generator: 'performable' | string;
}

export const REPAIR_CAPABILITIES: Record<RepairKind, RepairCapability> = {
  'shrink-terrace': {
    verb: 'resize',
    editor: 'performable',
    generator: 'performable',
  },
  'widen-path': {
    verb: 'resize',
    editor: 'performable',
    generator: 'performable',
  },
  'drop-optional': {
    verb: 'remove',
    editor: 'performable',
    generator: 'performable',
  },
  /*
   * The three move faults. They were unperformable in the editor for one reason — the scorer said
   * what was wrong and never where the thing should go — and `IssueGuidance` is that reason closed.
   */
  'move-to-zone': {
    verb: 'move',
    editor: 'performable',
    generator: 'performable',
  },
  'move-destination': {
    verb: 'move',
    editor: 'performable',
    generator: 'performable',
  },
  'move-tree': {
    verb: 'move',
    editor: 'performable',
    generator: 'performable',
  },
  reroute: {
    verb: 'reroute',
    editor: 'performable',
    generator: 'performable',
  },
  align: {
    verb: 'rotate',
    editor: 'performable',
    /*
     * Every placement a composition makes inherits the frame's own bearing through `fitInSlot`, so
     * `misaligned` can only ever be raised against something the PostGIS sampler placed — and no
     * adjustment to a candidate reaches the sampler. The fix belongs there rather than here.
     */
    generator: 'rotation is set by the frame, so only a sampled placement can be out of true',
  },
  'enlarge-lawn': {
    verb: 'reshape',
    /*
     * A lawn grows by taking ground off whatever is beside it, and one reshape does not say which.
     * The planner's own `reshape` does both halves or neither for exactly this reason; what is
     * missing is the scorer saying which neighbour should give the ground up.
     */
    editor: 'the lawn can only grow by taking ground from whatever is beside it',
    generator: 'performable',
  },
  'merge-beds': {
    verb: null,
    editor: "redrawing the beds is the composition's decision, not an edit to one of them",
    generator: "the beds are the composition's, not this candidate's",
  },
};

/** Whether the editor's planner can carry this out. */
export function performableInEditor(kind: RepairKind | undefined): boolean {
  return kind !== undefined && REPAIR_CAPABILITIES[kind].editor === 'performable';
}

/** Whether the generator's candidate loop can carry this out. */
export function performableInGenerator(kind: RepairKind | undefined): boolean {
  return kind !== undefined && REPAIR_CAPABILITIES[kind].generator === 'performable';
}

/** Why the editor cannot do it, or `null` when it can. */
export function editorCannot(kind: RepairKind): string | null {
  const reason = REPAIR_CAPABILITIES[kind].editor;
  return reason === 'performable' ? null : reason;
}

/** Every kind, so a test can walk the table and find one nobody answered for. */
export const REPAIR_KINDS: RepairKind[] = RepairKindSchema.options;
