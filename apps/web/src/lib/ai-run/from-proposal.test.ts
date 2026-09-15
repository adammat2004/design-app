import { describe, expect, it } from 'vitest';
import {
  DesignRunSchema,
  leavesOf,
  type DesignElement,
  type ProposedChange,
} from '@garden-studio/schema';
import { proposedChangeToOperations, runFromProposal } from './from-proposal';
import { prepareRun } from './prepare';

const PLOT = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

function patio(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-1',
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    zone: 'back',
    material: 'porcelain',
    shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 4, depth: 3, rotation: 0 },
    ...over,
  } as DesignElement;
}

function bed(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-2',
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    zone: 'back',
    material: 'shrubs',
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [{ x: 2, y: 2 }, { x: 10, y: 2 }, { x: 10, y: 5 }, { x: 2, y: 5 }],
    },
    ...over,
  } as DesignElement;
}

function route(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-3',
    category: 'paved-area',
    role: 'feature',
    name: 'Path to the store',
    zone: 'back',
    shape: { kind: 'polyline', width: 0.9, points: [{ x: 6, y: 6 }, { x: 14, y: 14 }] },
    ...over,
  } as DesignElement;
}

/** A line of the assistant's diff, in the shape the planner actually returns. */
function change(over: Partial<ProposedChange> & { id: string; kind: ProposedChange['kind'] }): ProposedChange {
  return {
    elementId: over.previous?.id ?? null,
    label: 'Seating patio',
    before: '12 m²',
    after: '18 m²',
    next: patio(),
    previous: null,
    ...over,
  } as ProposedChange;
}

describe('one line of a diff', () => {
  it('reads a resize off the elements rather than off the planner\'s word for it', () => {
    const [operation] = proposedChangeToOperations(
      change({
        id: 'ch1',
        kind: 'resize',
        previous: patio(),
        next: patio({ shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 6, depth: 4, rotation: 0 } }),
      }),
    );

    expect(operation).toMatchObject({
      kind: 'resize',
      elementId: 'e-1',
      to: { centre: { x: 8, y: 8 }, width: 6, depth: 4, rotation: 0 },
    });
  });

  it('draws a moved bed as the reshape the document says it is', () => {
    /*
     * The planner calls this a move; an outline carries its own position, so what actually differs
     * is every corner. Animating the planner's word for it would slide a bed that the document says
     * was redrawn.
     */
    const moved = bed({
      shape: { kind: 'polygon', cornerRadius: 0,
        points: [{ x: 3, y: 3 }, { x: 11, y: 3 }, { x: 11, y: 6 }, { x: 3, y: 6 }] },
    });

    const [operation] = proposedChangeToOperations(
      change({ id: 'ch2', kind: 'move', previous: bed(), next: moved }),
    );

    expect(operation?.kind).toBe('reshape');
  });

  it('draws a re-routed path as a route being redrawn', () => {
    const [operation] = proposedChangeToOperations(
      change({
        id: 'ch3',
        kind: 'move',
        previous: route(),
        next: route({ shape: { kind: 'polyline', width: 1.2,
          points: [{ x: 6, y: 6 }, { x: 10, y: 9 }, { x: 14, y: 14 }] } }),
      }),
    );

    expect(operation).toMatchObject({ kind: 'reroute', phase: 'circulation', agent: 'circulation' });
  });

  it('tells a turn apart from a move', () => {
    const turned = patio({ shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 4, depth: 3, rotation: 30 } });
    const [operation] = proposedChangeToOperations(
      change({ id: 'ch4', kind: 'move', previous: patio(), next: turned }),
    );

    expect(operation).toMatchObject({ kind: 'rotate', degrees: 30 });
  });

  it('carries a material swap as a property change with nothing to animate', () => {
    const [operation] = proposedChangeToOperations(
      change({
        id: 'ch5',
        kind: 'material',
        previous: patio(),
        next: patio({ material: 'stone-pavers' }),
      }),
    );

    expect(operation).toMatchObject({ kind: 'setProperty', changes: { material: 'stone-pavers' } });
  });

  it('splits a line that both moves and re-materialises a thing', () => {
    const operations = proposedChangeToOperations(
      change({
        id: 'ch6',
        kind: 'move',
        previous: patio(),
        next: patio({
          material: 'stone-pavers',
          shape: { kind: 'rect', centre: { x: 12, y: 12 }, width: 4, depth: 3, rotation: 0 },
        }),
      }),
    );

    expect(operations.map((operation) => operation.kind)).toEqual(['move', 'setProperty']);
  });

  it('turns an addition into an add with a reference of its own', () => {
    const [operation] = proposedChangeToOperations(
      change({ id: 'ch7', kind: 'add', elementId: null, previous: null, next: patio({ id: 'ignored' }) }),
    );

    expect(operation).toMatchObject({ kind: 'add', ref: '$ch7' });
    // The id is the editor's to allocate, so the change's own must not travel with it.
    expect(operation && 'element' in operation && 'id' in operation.element).toBe(false);
  });

  it('files planting with the planting designer and paving with the layout designer', () => {
    const planting = proposedChangeToOperations(
      change({ id: 'ch8', kind: 'remove', previous: bed(), next: bed() }),
    );
    const paving = proposedChangeToOperations(
      change({ id: 'ch9', kind: 'remove', previous: patio(), next: patio() }),
    );

    expect(planting[0]).toMatchObject({ phase: 'planting', agent: 'planting' });
    expect(paving[0]).toMatchObject({ phase: 'layout', agent: 'layout' });
  });

  it('says nothing about a change that changed nothing', () => {
    expect(proposedChangeToOperations(
      change({ id: 'ch10', kind: 'move', previous: patio(), next: patio() }),
    )).toEqual([]);
  });

  it('does not morph a bed into the identical bed to change its material', () => {
    /*
     * Every line of the diff carries a whole element on each side, so a material swap arrives with
     * an outline too — an equal one. Animating it would be a second of nothing in the middle of a
     * run whose whole claim is that each movement means something.
     */
    const operations = proposedChangeToOperations(
      change({ id: 'ch11', kind: 'material', previous: bed(), next: bed({ material: 'mixed-border' }) }),
    );

    expect(operations.map((operation) => operation.kind)).toEqual(['setProperty']);
  });
});

describe('a whole proposal', () => {
  const changes: ProposedChange[] = [
    change({
      id: 'ch1', kind: 'material', previous: bed(), next: bed({ material: 'mixed-border' }),
      label: 'Rear border',
    }),
    change({
      id: 'ch2', kind: 'resize', previous: patio(),
      next: patio({ shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 6, depth: 4, rotation: 0 } }),
    }),
  ];

  it('is a run the schema accepts, ordered the way a designer would work', () => {
    const run = runFromProposal(changes, 'More planting, bigger terrace', 'assistant-m1')!;

    expect(() => DesignRunSchema.parse(run)).not.toThrow();
    // Layout before planting, whatever order the planner answered in.
    expect(run.operations.map((operation) => operation.phase)).toEqual([
      'layout', 'layout', 'planting', 'planting',
    ]);
  });

  it('selects each element once before working on it', () => {
    const run = runFromProposal(changes, 'x', 'assistant-m1')!;
    const kinds = run.operations.flatMap(leavesOf).map((leaf) => leaf.kind);

    expect(kinds).toEqual(['select', 'resize', 'select', 'setProperty']);
  });

  it('produces a run the executor accepts in full', () => {
    const run = runFromProposal(changes, 'x', 'assistant-m1')!;
    let counter = 0;
    const prepared = prepareRun(run, [patio(), bed()], {
      boundary: PLOT,
      allocateId: () => `e-${(counter += 1) + 100}`,
    });

    expect(prepared.refused).toEqual([]);
    expect(prepared.result).not.toBe(prepared.initial);
  });

  /*
   * A run used to carry a `summary` counted off the proposal, which is a claim about an outcome
   * made before anything was attempted — so a request whose last two lines the planner then refused
   * still reported four changes. What happened is measured afterwards, by `composeOutcome`.
   */
  it('makes no claim about its own result, because it has not run yet', () => {
    const run = runFromProposal(changes, 'Say something untrue', 'assistant-m1')!;

    expect(run.summary).toBeUndefined();
    /* The request is kept verbatim, as the label for the revision — but it is not an outcome. */
    expect(run.request).toBe('Say something untrue');
  });

  it('is nothing at all when every line was unticked', () => {
    expect(runFromProposal([], 'x', 'assistant-m1')).toBeNull();
  });
});
