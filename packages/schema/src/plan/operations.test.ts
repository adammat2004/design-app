import { describe, expect, it } from 'vitest';
import {
  DesignOperationSchema,
  DesignRunSchema,
  FENCE_REFUSAL,
  LOCKED_REFUSAL,
  MISSING_REFUSAL,
  applyResolved,
  durationOf,
  leavesOf,
  resolveOperation,
  resolveRef,
  subjectOf,
  type LeafOperation,
  type ResolveContext,
} from './operations.js';
import type { DesignElement } from './concepts.js';

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
    shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 4, depth: 3, rotation: 0 },
    ...over,
  } as DesignElement;
}

function bed(points: { x: number; y: number }[], over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'e-2',
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    zone: 'back',
    material: 'shrubs',
    shape: { kind: 'polygon', cornerRadius: 0, points },
    ...over,
  } as DesignElement;
}

/** The ground layer of a zone: the one thing no operation may move, resize or remove. */
function groundLayer(): DesignElement {
  return bed(PLOT, { id: 'e-9', category: 'lawn', role: 'fill', fillKind: 'base' });
}

function context(elements: DesignElement[], bindings: Record<string, string> = {}): ResolveContext {
  return { elements, boundary: PLOT, bindings };
}

/** Enough of an operation to be valid; the tests override what they are about. */
function op(over: Partial<LeafOperation> & { kind: LeafOperation['kind'] }): LeafOperation {
  return {
    id: 'op-1',
    agent: 'layout',
    phase: 'layout',
    label: 'Doing something',
    ...over,
  } as LeafOperation;
}

describe('the schema', () => {
  it('parses a group of staggered moves', () => {
    const parsed = DesignOperationSchema.parse({
      id: 'op-3',
      agent: 'layout',
      phase: 'layout',
      label: 'Moving the dining set',
      kind: 'group',
      stagger: 70,
      children: [
        { id: 'op-3a', agent: 'layout', phase: 'layout', label: 'a', kind: 'move', elementId: 'e-1', to: { x: 1, y: 1 } },
      ],
    });

    expect(parsed.kind).toBe('group');
    // `ghost` defaults rather than being required of every author.
    expect(leavesOf(parsed)[0]).toMatchObject({ kind: 'move', ghost: false });
  });

  it('refuses a group inside a group', () => {
    const nested = {
      id: 'op-4', agent: 'layout', phase: 'layout', label: 'x', kind: 'group', stagger: 0,
      children: [{ id: 'op-4a', agent: 'layout', phase: 'layout', label: 'y', kind: 'group', stagger: 0, children: [] }],
    };

    expect(DesignOperationSchema.safeParse(nested).success).toBe(false);
  });

  it('drops an id an add tried to bring with it', () => {
    /*
     * Not `.strict()`, deliberately: these will be stored with a plan once replay has to survive a
     * reload, and a schema that refuses an unknown key is a stored row that stops parsing the day a
     * field is added. Dropping is the safe half — what makes it honest is that `resolveOperation`
     * reads the id from the run's bindings and never from here, so an id written into a script has
     * no way to reach the plan and collide with a real element.
     */
    const parsed = DesignOperationSchema.parse({
      id: 'op-5', agent: 'planting', phase: 'planting', label: 'Adding a shrub', kind: 'add',
      ref: '$shrub',
      element: { id: 'e-99', category: 'planting-bed', role: 'feature', zone: 'back',
        shape: { kind: 'point', at: { x: 5, y: 5 }, radius: 0.6 } },
    });

    expect(parsed.kind === 'add' && 'id' in parsed.element).toBe(false);

    const resolved = resolveOperation(parsed as LeafOperation, context([], { $shrub: 'e-7' }));
    expect(resolved).toMatchObject({ ok: true, after: { id: 'e-7' } });
  });

  it('refuses a setProperty that changes nothing', () => {
    expect(DesignOperationSchema.safeParse({
      id: 'op-6', agent: 'planting', phase: 'planting', label: 'x', kind: 'setProperty',
      elementId: 'e-1', changes: {},
    }).success).toBe(false);
  });

  it('has nowhere to put presentation state', () => {
    const keys = new Set<string>();
    for (const option of DesignOperationSchema.options) {
      const shape = option instanceof Object && 'options' in option ? option.options : [option];
      for (const member of shape as { shape: Record<string, unknown> }[])
        for (const key of Object.keys(member.shape)) keys.add(key);
    }

    // The executor derives these and throws them away; an operation that could carry one would be
    // a renderer instruction hiding in the design record.
    for (const forbidden of ['opacity', 'scale', 'easing', 'colour', 'color', 'from'])
      expect(keys.has(forbidden)).toBe(false);
  });

  it('caps a run so a runaway agent cannot script an afternoon', () => {
    const one = { id: 'op-1', agent: 'lead', phase: 'analyse', label: 'x', kind: 'analyse' };
    const run = { id: 'run-1', request: 'Better for entertaining', operations: Array.from({ length: 61 }, () => one) };

    expect(DesignRunSchema.safeParse(run).success).toBe(false);
  });
});

describe('durations', () => {
  it('takes the kind default when the script does not say', () => {
    expect(durationOf(op({ kind: 'resize', elementId: 'e-1', to: { centre: { x: 1, y: 1 }, width: 2, depth: 2, rotation: 0 } }))).toBe(1200);
    expect(durationOf(op({ kind: 'move', elementId: 'e-1', to: { x: 1, y: 1 } }))).toBe(600);
  });

  it('gives a staggered group room for its last child', () => {
    const group = DesignOperationSchema.parse({
      id: 'op-7', agent: 'planting', phase: 'planting', label: 'Adding lights', kind: 'group', stagger: 100,
      children: ['a', 'b', 'c'].map((suffix) => ({
        id: `op-7${suffix}`, agent: 'planting', phase: 'planting', label: 'light', kind: 'move',
        elementId: 'e-1', to: { x: 1, y: 1 },
      })),
    });

    // Two staggers of 100 ms, then the last child's own 600 ms.
    expect(durationOf(group)).toBe(800);
  });
});

describe('resolveOperation', () => {
  it('moves a feature and leaves everything else alone', () => {
    const elements = [patio(), bed([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }])];
    const resolved = resolveOperation(
      op({ kind: 'move', elementId: 'e-1', to: { x: 12, y: 12 } }),
      context(elements),
    );

    expect(resolved).toMatchObject({ ok: true, effect: 'replace' });
    const next = applyResolved(elements, resolved);
    expect(next[0]!.shape).toMatchObject({ kind: 'rect', centre: { x: 12, y: 12 } });
    expect(next[1]).toBe(elements[1]);
  });

  it('refuses a move over the boundary, in the editor\'s own words', () => {
    const resolved = resolveOperation(
      op({ kind: 'move', elementId: 'e-1', to: { x: 19.5, y: 10 } }),
      context([patio()]),
    );

    expect(resolved).toEqual({ ok: false, reason: FENCE_REFUSAL });
  });

  it('refuses to touch the ground layer of a zone', () => {
    const ground = groundLayer();
    const elements = [ground];

    for (const operation of [
      op({ kind: 'move', elementId: 'e-9', to: { x: 10, y: 10 } }),
      op({ kind: 'remove', elementId: 'e-9' }),
    ])
      expect(resolveOperation(operation, context(elements))).toEqual({ ok: false, reason: LOCKED_REFUSAL });
  });

  it('still lets the ground layer change material', () => {
    // The one edit a base fill accepts: turning the lawn to gravel cannot open a gap in the ground.
    const resolved = resolveOperation(
      op({ kind: 'setProperty', elementId: 'e-9', changes: { material: 'decorative-gravel' } }),
      context([groundLayer()]),
    );

    expect(resolved).toMatchObject({ ok: true, effect: 'replace', after: { material: 'decorative-gravel' } });
  });

  it('refuses an element that is no longer on the plan', () => {
    expect(resolveOperation(op({ kind: 'move', elementId: 'e-404', to: { x: 5, y: 5 } }), context([patio()])))
      .toEqual({ ok: false, reason: MISSING_REFUSAL });
    expect(resolveOperation(op({ kind: 'select', elementId: 'e-404' }), context([patio()])))
      .toEqual({ ok: false, reason: MISSING_REFUSAL });
  });

  it('refuses a target of the wrong kind rather than coercing it', () => {
    const border = bed([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 4 }, { x: 2, y: 4 }]);

    // Resizing a twelve-vertex border into a box is not a smaller border.
    expect(resolveOperation(
      op({ kind: 'resize', elementId: 'e-2', to: { centre: { x: 5, y: 3 }, width: 4, depth: 2, rotation: 0 } }),
      context([border]),
    )).toMatchObject({ ok: false });

    expect(resolveOperation(op({ kind: 'rotate', elementId: 'e-2', degrees: 45 }), context([border])))
      .toMatchObject({ ok: false });

    expect(resolveOperation(
      op({ kind: 'reshape', elementId: 'e-1', to: { points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] } }),
      context([patio()]),
    )).toMatchObject({ ok: false });
  });

  it('refuses an outline that crosses itself', () => {
    // A bow tie has an ordinary vertex list and a quietly wrong area, so nothing downstream
    // would report it — the same guard `setEdgeLength` applies to the boundary.
    const resolved = resolveOperation(
      op({ kind: 'reshape', elementId: 'e-2', to: { points: [
        { x: 2, y: 2 }, { x: 8, y: 8 }, { x: 8, y: 2 }, { x: 2, y: 8 },
      ] } }),
      context([bed([{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 8, y: 8 }, { x: 2, y: 8 }])]),
    );

    expect(resolved).toEqual({ ok: false, reason: 'That outline would cross itself.' });
  });

  it('lets something genuinely small be placed', () => {
    /*
     * The minimum side is a rule about *dragging* a shape smaller than it is usable at, which is
     * where the editor applies it and nowhere else. A bollard light is 160 mm across, the generator
     * places them routinely, and an AI that could not would be held to a rule people are not.
     */
    const light = op({ kind: 'add', ref: '$light', element: {
      category: 'lighting', role: 'feature', name: 'Bollard light', zone: 'back',
      symbol: 'light-bollard', shape: { kind: 'point', at: { x: 10, y: 10 }, radius: 0.08 },
    } }) as LeafOperation;

    expect(resolveOperation(light, context([], { $light: 'e-5' }))).toMatchObject({ ok: true });
  });

  it('refuses a resize under the minimum side', () => {
    const resolved = resolveOperation(
      op({ kind: 'resize', elementId: 'e-1', to: { centre: { x: 10, y: 10 }, width: 0.1, depth: 3, rotation: 0 } }),
      context([patio()]),
    );

    expect(resolved).toMatchObject({ ok: false });
  });

  it('takes the short way round on a rotation', () => {
    const resolved = resolveOperation(op({ kind: 'rotate', elementId: 'e-1', degrees: -30 }), context([patio()]));

    expect(resolved).toMatchObject({ ok: true, after: { shape: { rotation: 330 } } });
  });

  it('adds an element at the id the run bound for it', () => {
    const elements = [patio()];
    const add = op({ kind: 'add', ref: '$shrub', element: {
      category: 'planting-bed', role: 'feature', name: 'Evergreen shrub', zone: 'back',
      shape: { kind: 'point', at: { x: 5, y: 5 }, radius: 0.6 },
    } }) as LeafOperation;

    const resolved = resolveOperation(add, context(elements, { $shrub: 'e-7' }));

    expect(resolved).toMatchObject({ ok: true, effect: 'append', after: { id: 'e-7' } });
    expect(applyResolved(elements, resolved)).toHaveLength(2);
  });

  it('refuses an add whose reference was never bound', () => {
    const add = op({ kind: 'add', ref: '$shrub', element: {
      category: 'planting-bed', role: 'feature', zone: 'back',
      shape: { kind: 'point', at: { x: 5, y: 5 }, radius: 0.6 },
    } }) as LeafOperation;

    expect(resolveOperation(add, context([]))).toEqual({ ok: false, reason: MISSING_REFUSAL });
  });

  it('refuses to add something over the fence', () => {
    const add = op({ kind: 'add', ref: '$tree', element: {
      category: 'planting-bed', role: 'feature', zone: 'back',
      shape: { kind: 'point', at: { x: 19.5, y: 10 }, radius: 1.6 },
    } }) as LeafOperation;

    expect(resolveOperation(add, context([], { $tree: 'e-8' }))).toEqual({ ok: false, reason: FENCE_REFUSAL });
  });

  it('resolves a later operation against what an earlier add created', () => {
    const bindings = { $shrub: 'e-7' };
    const added: DesignElement = {
      id: 'e-7', category: 'planting-bed', role: 'feature', zone: 'back',
      shape: { kind: 'point', at: { x: 5, y: 5 }, radius: 0.6 },
    };

    const resolved = resolveOperation(
      op({ kind: 'move', elementId: '$shrub', to: { x: 6, y: 6 } }),
      context([added], bindings),
    );

    expect(resolved).toMatchObject({ ok: true, after: { id: 'e-7', shape: { at: { x: 6, y: 6 } } } });
  });

  it('removes what it names and nothing else', () => {
    const elements = [patio(), bed([{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }])];
    const next = applyResolved(elements, resolveOperation(op({ kind: 'remove', elementId: 'e-1' }), context(elements)));

    expect(next.map((element) => element.id)).toEqual(['e-2']);
  });
});

describe('helpers', () => {
  it('reads a literal id straight through and a reference from the bindings', () => {
    expect(resolveRef('e-1', {})).toBe('e-1');
    expect(resolveRef('$pergola', { $pergola: 'e-4' })).toBe('e-4');
    expect(resolveRef('$pergola', {})).toBeNull();
  });

  it('names the element an operation is about', () => {
    expect(subjectOf(op({ kind: 'move', elementId: 'e-1', to: { x: 1, y: 1 } }))).toBe('e-1');
    expect(subjectOf(op({ kind: 'analyse' }))).toBeNull();
  });

  it('leaves the list untouched when an operation was refused', () => {
    const elements = [patio()];
    expect(applyResolved(elements, { ok: false, reason: FENCE_REFUSAL })).toBe(elements);
  });
});
