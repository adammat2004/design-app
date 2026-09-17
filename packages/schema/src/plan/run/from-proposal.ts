import {
  DEFAULT_DURATION,
  type AgentRole,
  type DesignElement,
  type DesignOperation,
  type DesignRun,
  type LeafOperation,
  type PlanGeometry,
  type ProposedChange,
  type RunPhase,
} from '../../index.js';

/**
 * The assistant's diff, turned into something that can be watched happening.
 *
 * `ProposedChange` already carries the element on both sides — `previous` and `next`, whole and
 * real — which is everything an operation needs. So the assistant needs no new endpoint, no new
 * field on the wire and no second model call to gain the animation: the same reply that draws the
 * textual diff today also answers "what would this look like being done".
 *
 * **Client-side, and that is not laziness.** Putting `operations` on `AssistantProposalSchema` was
 * the obvious move and it is wrong twice over: it would make `assistant.ts` import `operations.ts`
 * while `operations.ts` imports `assistant.ts` for the change type, which is exactly the cycle
 * `zone-id.ts` exists to avoid — and it would put a presentation decision (how to animate a change)
 * in the contract between the two halves of the system. The server says what should change; how
 * that is shown is the editor's business.
 *
 * **Derived from the elements, not from `kind`.** The planner's `kind` says what it meant to do;
 * `previous` and `next` say what actually differs. Reading the elements means the animation cannot
 * disagree with the change it is animating — a "resize" that turns out to have moved a bed's
 * outline is drawn as the reshape it is.
 */

/** Which stage of a redesign a change belongs to, and therefore which designer performs it. */
function phaseFor(element: DesignElement): RunPhase {
  if (element.shape.kind === 'polyline') return 'circulation';
  switch (element.category) {
    case 'planting-bed':
    case 'lawn':
    case 'lighting':
      return 'planting';
    default:
      return 'layout';
  }
}

const AGENT_FOR: Record<RunPhase, AgentRole> = {
  analyse: 'lead',
  layout: 'layout',
  circulation: 'circulation',
  planting: 'planting',
  review: 'reviewer',
};

/** The order a designer would work in, rather than the order the planner happened to answer in. */
const PHASE_ORDER: RunPhase[] = ['analyse', 'layout', 'circulation', 'planting', 'review'];

/** Whether two lists of corners describe the same outline. */
function samePoints(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => point.x === b[index]!.x && point.y === b[index]!.y)
  );
}

/** What is different about the shape, in the vocabulary of operations. */
function geometryChange(
  previous: PlanGeometry,
  next: PlanGeometry,
): {
  kind: 'move' | 'resize' | 'rotate' | 'reshape' | 'reroute';
  payload: Record<string, unknown>;
} | null {
  if (previous.kind !== next.kind) return null;

  switch (next.kind) {
    case 'rect': {
      const from = previous as Extract<PlanGeometry, { kind: 'rect' }>;
      const resized = from.width !== next.width || from.depth !== next.depth;
      const turned = from.rotation !== next.rotation;
      const moved = from.centre.x !== next.centre.x || from.centre.y !== next.centre.y;

      /* A resize target carries the whole rectangle, so it covers a turn and a shift as well. */
      if (resized) {
        return {
          kind: 'resize',
          payload: {
            to: {
              centre: next.centre,
              width: next.width,
              depth: next.depth,
              rotation: next.rotation,
            },
          },
        };
      }
      if (turned && !moved) return { kind: 'rotate', payload: { degrees: next.rotation } };
      if (moved || turned) return { kind: 'move', payload: { to: next.centre, ghost: true } };
      return null;
    }

    case 'point': {
      const from = previous as Extract<PlanGeometry, { kind: 'point' }>;
      if (from.radius !== next.radius)
        return { kind: 'resize', payload: { to: { at: next.at, radius: next.radius } } };
      if (from.at.x !== next.at.x || from.at.y !== next.at.y)
        return { kind: 'move', payload: { to: next.at } };
      return null;
    }

    /*
     * An outline carries its own position, so there is no separate "moved" case to tell apart: a
     * bed that has been shifted and a bed that has been reshaped are both new lists of corners, and
     * drawing both as a morph is the truthful picture of what the document now says.
     *
     * The corners are compared rather than assumed different, because a line of the diff that only
     * changes a bed's *material* still arrives with a whole element on each side — and an outline
     * morphing into the identical outline is a second of nothing, in the middle of a run whose
     * whole claim is that every movement means something.
     */
    case 'polygon': {
      const from = previous as Extract<PlanGeometry, { kind: 'polygon' }>;
      if (samePoints(from.points, next.points) && from.cornerRadius === next.cornerRadius)
        return null;
      return {
        kind: 'reshape',
        payload: { to: { points: next.points, cornerRadius: next.cornerRadius } },
      };
    }

    case 'polyline': {
      const from = previous as Extract<PlanGeometry, { kind: 'polyline' }>;
      if (samePoints(from.points, next.points) && from.width === next.width) return null;
      return { kind: 'reroute', payload: { to: { points: next.points, width: next.width } } };
    }
  }
}

/** The fields that are not the shape and are not identity, where they differ. */
function propertyChanges(previous: DesignElement, next: DesignElement): Record<string, unknown> {
  const fields = [
    'name',
    'category',
    'material',
    'edging',
    'retaining',
    'elevation',
    'height',
    'symbol',
    'plantId',
    'plantingStyle',
    'zone',
    'hidden',
  ] as const;

  const changes: Record<string, unknown> = {};
  for (const field of fields) if (previous[field] !== next[field]) changes[field] = next[field];
  return changes;
}

/** What one line of the diff becomes. Several operations, because a change can do two things. */
export function proposedChangeToOperations(change: ProposedChange): LeafOperation[] {
  const phase = phaseFor(change.next);
  const agent = AGENT_FOR[phase];
  const base = { agent, phase, label: change.label, reason: `${change.before} → ${change.after}` };

  if (change.kind === 'add') {
    const { id: _id, ...element } = change.next;
    return [
      {
        ...base,
        id: `${change.id}-add`,
        kind: 'add',
        ref: `$${change.id}`,
        element,
      } as LeafOperation,
    ];
  }

  if (!change.elementId) return [];

  if (change.kind === 'remove')
    return [
      {
        ...base,
        id: `${change.id}-remove`,
        kind: 'remove',
        elementId: change.elementId,
      } as LeafOperation,
    ];

  const previous = change.previous;
  if (!previous) return [];

  const out: LeafOperation[] = [];
  const geometry = geometryChange(previous.shape, change.next.shape);
  if (geometry)
    out.push({
      ...base,
      id: `${change.id}-${geometry.kind}`,
      kind: geometry.kind,
      elementId: change.elementId,
      ...geometry.payload,
    } as LeafOperation);

  const properties = propertyChanges(previous, change.next);
  if (Object.keys(properties).length > 0)
    out.push({
      ...base,
      id: `${change.id}-set`,
      kind: 'setProperty',
      elementId: change.elementId,
      changes: properties,
      /* A material swap has nothing to animate, so it wants only long enough to be read. */
      duration: DEFAULT_DURATION.setProperty,
    } as LeafOperation);

  return out;
}

/**
 * A whole proposal, as a run.
 *
 * Grouped into stages so it reads as a redesign rather than as a queue being emptied, and each
 * element is selected once before it is worked on — which is what makes the canvas show *which*
 * thing a line of the diff was about.
 */
export function runFromProposal(
  changes: ProposedChange[],
  request: string,
  id: string,
  /**
   * Who is doing it, where it is not the designer the element's category implies.
   *
   * The reviewer's corrections are the reason this exists: a reviewer moving a store is still the
   * reviewer, and filing it under the layout designer because a store is a structure would have the
   * panel narrate the wrong stage of a redesign that has already finished its layout.
   */
  as?: { agent: AgentRole; phase: RunPhase },
): DesignRun | null {
  const leaves = changes
    .flatMap(proposedChangeToOperations)
    .map((leaf) => (as ? { ...leaf, ...as } : leaf));
  if (leaves.length === 0) return null;

  const operations: DesignOperation[] = [];
  let selected: string | null = null;

  for (const phase of PHASE_ORDER) {
    for (const leaf of leaves) {
      if (leaf.phase !== phase) continue;

      /* One select per element, not one per line: two changes to the same bed are one selection. */
      const subject = 'elementId' in leaf ? leaf.elementId : null;
      if (subject && subject !== selected) {
        operations.push({
          id: `${leaf.id}-select`,
          agent: leaf.agent,
          phase: leaf.phase,
          label: leaf.label,
          kind: 'select',
          elementId: subject,
        } as DesignOperation);
        selected = subject;
      }
      if (!subject) selected = null;

      operations.push(leaf);
    }
  }

  /*
   * No summary. `DesignRun.summary` is optional and this deliberately leaves it unset.
   *
   * There used to be a `summarise` here that counted the proposal — "4 elements resized" — and it
   * was wrong whenever the planner refused a line, because the count was taken before anything had
   * been attempted. What the run did is measured afterwards from the garden itself, by
   * `composeOutcome`. A run cannot honestly describe its own result before it has run.
   */
  return { id, request, operations };
}
