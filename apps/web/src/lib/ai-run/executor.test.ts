import { describe, expect, it, vi } from 'vitest';
import {
  DesignRunSchema,
  geometryArea,
  polygonArea,
  type DesignElement,
  type DesignRun,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';
import { manualClock } from './clock';
import { createRunController, type RunSink } from './controller';
import { evaluateRun } from './evaluate';
import { easeOutBack, progress, windowFade } from './easing';
import {
  alignRings,
  interpolateGeometry,
  matchVertexCount,
  prefixAlongLength,
  polylineLength,
  shortestArc,
} from './interpolate';
import { MAX_RUN_MS, prepareRun, type PreparedRun } from './prepare';

const PLOT: Point[] = [
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
    shape: { kind: 'rect', centre: { x: 10, y: 4 }, width: 6, depth: 4, rotation: 0 },
    ...over,
  } as DesignElement;
}

function bed(): DesignElement {
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
      points: [{ x: 2, y: 12 }, { x: 18, y: 12 }, { x: 18, y: 15 }, { x: 2, y: 15 }],
    },
  } as DesignElement;
}

function route(): DesignElement {
  return {
    id: 'e-3',
    category: 'paved-area',
    role: 'feature',
    name: 'Path to the shed',
    zone: 'back',
    shape: { kind: 'polyline', width: 0.9, points: [{ x: 10, y: 6 }, { x: 16, y: 16 }] },
  } as DesignElement;
}

function op(over: Record<string, unknown>) {
  return { id: 'op', agent: 'layout', phase: 'layout', label: 'Working', ...over };
}

function run(operations: Record<string, unknown>[]): DesignRun {
  return DesignRunSchema.parse({
    id: 'run-1',
    request: 'Make the garden better for entertaining, but keep the lawn.',
    operations,
  });
}

function prepare(operations: Record<string, unknown>[], elements: DesignElement[]): PreparedRun {
  let next = 0;
  return prepareRun(run(operations), elements, {
    boundary: PLOT,
    allocateId: () => `e-${(next += 1) + 100}`,
  });
}

/* ---------------------------------------------------------------- easing */

describe('easing', () => {
  it('clamps progress either side of its window', () => {
    expect(progress(-5, 0, 100)).toBe(0);
    expect(progress(50, 0, 100)).toBe(0.5);
    expect(progress(500, 0, 100)).toBe(1);
  });

  it('treats a zero-length window as already over', () => {
    // A refused operation gets no time; asking where it is must not divide by zero.
    expect(progress(0, 0, 0)).toBe(1);
    expect(progress(-1, 0, 0)).toBe(0);
  });

  it('fades in at one end of a window and out at the other', () => {
    expect(windowFade(0, 0, 1000)).toBeCloseTo(0, 5);
    expect(windowFade(500, 0, 1000)).toBeCloseTo(1, 5);
    expect(windowFade(1000, 0, 1000)).toBeCloseTo(0, 5);
  });

  it('overshoots only where something is arriving', () => {
    const peak = Math.max(...Array.from({ length: 50 }, (_x, i) => easeOutBack(0.5 + i / 100)));
    expect(peak).toBeGreaterThan(1);
    expect(easeOutBack(1)).toBeCloseTo(1, 10);
  });
});

/* ---------------------------------------------------------------- interpolation */

describe('interpolation', () => {
  it('returns the target by identity at the end', () => {
    // What lands on the plan must be the operation's own value, never a re-derived one.
    const from = patio().shape;
    const to = { ...from, width: 9 } as typeof from;
    expect(interpolateGeometry(from, to, 1)).toBe(to);
    expect(interpolateGeometry(from, to, 0)).toBe(from);
  });

  it('takes the short way round a rotation', () => {
    // 350 -> 10 crosses zero; the naive lerp winds 340 degrees backwards through 180.
    expect(shortestArc(350, 10, 0.5)).toBeCloseTo(360, 6);
    expect(shortestArc(10, 350, 0.5)).toBeCloseTo(0, 6);
  });

  it('keeps a fixed edge fixed while a rectangle grows', () => {
    // The terrace grows away from the house wall: the operation carries the whole target rect, so
    // the edge that must not move simply does not.
    const from = { kind: 'rect', centre: { x: 10, y: 4 }, width: 6, depth: 4, rotation: 0 } as const;
    const to = { kind: 'rect', centre: { x: 10, y: 3 }, width: 6, depth: 6, rotation: 0 } as const;

    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const live = interpolateGeometry(from, to, p);
      if (live.kind !== 'rect') throw new Error('expected a rect');
      expect(live.centre.y + live.depth / 2).toBeCloseTo(6, 10);
    }
  });

  it('adds vertices to the shorter ring without changing the ground it covers', () => {
    const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    const grown = matchVertexCount(square, 9);

    expect(grown).toHaveLength(9);
    expect(Math.abs(polygonArea(grown))).toBeCloseTo(Math.abs(polygonArea(square)), 10);
  });

  it('matches the winding before morphing, so a bed cannot fold through itself', () => {
    const clockwise = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    const anticlockwise = [...clockwise].reverse();

    const aligned = alignRings(clockwise, anticlockwise);

    // Same ring, now walked the same way round, so every vertex travels a short distance.
    for (const [index, point] of aligned.entries()) {
      const origin = clockwise[index]!;
      expect(Math.hypot(point.x - origin.x, point.y - origin.y)).toBeLessThan(0.001);
    }
  });

  it('picks the rotation of the target that moves the vertices least', () => {
    const square = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }];
    // The same square listed from the next corner along.
    const shifted = [{ x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 0, y: 0 }];

    expect(alignRings(square, shifted)).toEqual(square);
  });

  it('morphs a bed into an outline with a different number of corners', () => {
    const from: PlanGeometry = { kind: 'polygon', cornerRadius: 0,
      points: [{ x: 2, y: 12 }, { x: 18, y: 12 }, { x: 18, y: 15 }, { x: 2, y: 15 }] };
    const to: PlanGeometry = { kind: 'polygon', cornerRadius: 0,
      points: [{ x: 2, y: 11 }, { x: 10, y: 11 }, { x: 18, y: 12 }, { x: 18, y: 15 }, { x: 2, y: 15 }] };

    const half = interpolateGeometry(from, to, 0.5);
    if (half.kind !== 'polygon') throw new Error('expected a polygon');

    expect(half.points).toHaveLength(5);
    // Half way between two sane outlines is a sane outline, not a knot.
    expect(Math.abs(polygonArea(half.points))).toBeGreaterThan(0);
    expect(interpolateGeometry(from, to, 1)).toBe(to);
  });

  it('grows a route along itself, and every prefix is still a route', () => {
    const points = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 4 }];
    const total = polylineLength(points);
    expect(total).toBeCloseTo(7, 10);

    for (let step = 0; step <= 10; step += 1) {
      const prefix = prefixAlongLength(points, (total * step) / 10);
      expect(prefix.length).toBeGreaterThanOrEqual(2);
      expect(polylineLength(prefix)).toBeCloseTo((total * step) / 10, 6);
    }
    expect(prefixAlongLength(points, total)).toEqual(points);
  });
});

/* ---------------------------------------------------------------- prepare */

describe('prepareRun', () => {
  it('lays the operations out end to end with a beat between them', () => {
    const prepared = prepare(
      [
        op({ id: 'a', kind: 'select', elementId: 'e-1' }),
        op({ id: 'b', kind: 'move', elementId: 'e-1', to: { x: 10, y: 6 } }),
      ],
      [patio()],
    );

    expect(prepared.operations[0]).toMatchObject({ start: 0, end: 400 });
    // 400 + a 300 ms pause.
    expect(prepared.operations[1]).toMatchObject({ start: 700, end: 1300 });
    expect(prepared.total).toBe(1300);
  });

  it('staggers a group and lets it run as long as its slowest child', () => {
    const prepared = prepare(
      [op({ id: 'g', kind: 'group', stagger: 100, children: [
        op({ id: 'g1', kind: 'move', elementId: 'e-1', to: { x: 9, y: 4 } }),
        op({ id: 'g2', kind: 'move', elementId: 'e-2', to: { x: 10, y: 13 } }),
      ] })],
      [patio(), bed()],
    );

    expect(prepared.operations[0]!.leaves.map((leaf) => leaf.start)).toEqual([0, 100]);
    expect(prepared.operations[0]!.end).toBe(700);
  });

  it('gives a refused operation no time on the timeline, and says why', () => {
    const prepared = prepare(
      [
        op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 40, y: 4 } }),
        op({ id: 'b', kind: 'move', elementId: 'e-1', to: { x: 10, y: 6 } }),
      ],
      [patio()],
    );

    expect(prepared.refused).toEqual([
      { operationId: 'a', label: 'Working', reason: 'That goes over the property boundary.' },
    ]);
    // The refused operation is invisible: no duration, and no pause of its own either.
    expect(prepared.operations[0]).toMatchObject({ start: 0, end: 0 });
    expect(prepared.operations[1]!.start).toBe(0);
  });

  it('resolves each operation against the state the one before it left', () => {
    const prepared = prepare(
      [
        op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 10, y: 10 } }),
        op({ id: 'b', kind: 'resize', elementId: 'e-1', to: { centre: { x: 10, y: 10 }, width: 8, depth: 6, rotation: 0 } }),
      ],
      [patio()],
    );

    // The resize starts from where the move left it, not from where the run began.
    expect(prepared.operations[1]!.leaves[0]!.before!.shape).toMatchObject({ centre: { x: 10, y: 10 } });
    expect(prepared.result[0]!.shape).toMatchObject({ centre: { x: 10, y: 10 }, width: 8, depth: 6 });
  });

  it('binds an added element to a real id, and later operations follow it', () => {
    const prepared = prepare(
      [
        op({ id: 'a', kind: 'add', ref: '$shrub', element: {
          category: 'planting-bed', role: 'feature', name: 'Evergreen shrub', zone: 'back',
          shape: { kind: 'point', at: { x: 5, y: 8 }, radius: 0.6 } } }),
        op({ id: 'b', kind: 'move', elementId: '$shrub', to: { x: 6, y: 8 } }),
      ],
      [patio()],
    );

    expect(prepared.bindings).toEqual({ $shrub: 'e-101' });
    expect(prepared.refused).toEqual([]);
    expect(prepared.result.at(-1)).toMatchObject({ id: 'e-101', shape: { at: { x: 6, y: 8 } } });
  });

  it('binds the same references again when the same script is prepared again', () => {
    // Replay has to reproduce the plan exactly, which means the same new elements get the same ids.
    const script = [op({ id: 'a', kind: 'add', ref: '$shrub', element: {
      category: 'planting-bed', role: 'feature', zone: 'back',
      shape: { kind: 'point', at: { x: 5, y: 8 }, radius: 0.6 } } })];

    expect(prepare(script, [patio()]).bindings).toEqual(prepare(script, [patio()]).bindings);
  });

  it('groups the phases for the stage strip', () => {
    const prepared = prepare(
      [
        op({ id: 'a', phase: 'analyse', agent: 'lead', kind: 'analyse' }),
        op({ id: 'b', phase: 'layout', kind: 'select', elementId: 'e-1' }),
        op({ id: 'c', phase: 'layout', kind: 'move', elementId: 'e-1', to: { x: 10, y: 6 } }),
      ],
      [patio()],
    );

    expect(prepared.phases.map((span) => span.phase)).toEqual(['analyse', 'layout']);
  });

  /*
   * Twelve intents in one request compiles to more than anybody will sit and watch. Skip is always
   * there, but a control the user has to reach for because the default pacing is wrong is a default
   * that is wrong.
   */
  describe('a run too long to watch', () => {
    /** Enough moves to blow past the cap several times over. */
    const long = () =>
      Array.from({ length: 40 }, (_unused, index) =>
        op({
          id: `m${index}`,
          kind: 'move',
          elementId: 'e-1',
          to: { x: 10, y: 4 + (index % 3) },
        }),
      );

    it('is squeezed into the budget', () => {
      const prepared = prepare(long(), [patio()]);

      expect(prepared.total).toBeLessThanOrEqual(MAX_RUN_MS);
      expect(prepared.total).toBeGreaterThan(0);
    });

    /*
     * Scaled, not truncated. Zeroing the tail collapses several operations onto one instant and
     * makes the last thing the user sees a jump — which is the "spinner then a jump" this whole
     * feature exists to replace.
     */
    it('keeps every operation in order, and none of them instant', () => {
      const prepared = prepare(long(), [patio()]);

      for (let i = 1; i < prepared.operations.length; i += 1) {
        expect(prepared.operations[i]!.start).toBeGreaterThan(prepared.operations[i - 1]!.start);
      }
      for (const operation of prepared.operations) {
        expect(operation.end).toBeGreaterThan(operation.start);
      }
    });

    it('leaves a run that already fits exactly as it was', () => {
      const short = [op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 10, y: 6 } })];
      const prepared = prepare(short, [patio()]);

      expect(prepared.total).toBe(prepared.operations[0]!.end);
      expect(Number.isInteger(prepared.total)).toBe(true);
    });

    /** The plan it lands on is the same plan either way: pacing is presentation. */
    it('changes nothing about what the garden ends up as', () => {
      const squeezed = prepare(long(), [patio()]);
      const shape = squeezed.result[0]!.shape as Extract<PlanGeometry, { kind: 'rect' }>;

      expect(squeezed.result).toHaveLength(1);
      expect(shape.centre.y).toBe(4 + (39 % 3));
    });
  });
});

/* ---------------------------------------------------------------- evaluate */

describe('evaluateRun', () => {
  const moveRun = () =>
    prepare([op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 10, y: 8 }, ghost: true })], [patio()]);

  it('offers the moving element to the renderer in place of the settled one', () => {
    const prepared = moveRun();
    const frame = evaluateRun(prepared, 300, PLOT);

    expect(frame.motion).toHaveLength(1);
    /*
     * Substituted rather than hidden and redrawn: the real renderer takes this element and paints it
     * in its own material, so a terrace being enlarged does not turn into a flat shape while it
     * moves. Nothing is suppressed, because nothing is being drawn twice.
     */
    expect(frame.motion[0]!.replacesSettled).toBe(true);
    expect(frame.suppress).toEqual([]);
    const shape = frame.motion[0]!.element.shape;
    if (shape.kind !== 'rect') throw new Error('expected a rect');
    // Half way through an eased move: past the start, short of the target.
    expect(shape.centre.y).toBeGreaterThan(4);
    expect(shape.centre.y).toBeLessThan(8);
  });

  it('commits nothing until an operation is over', () => {
    const prepared = moveRun();

    expect(evaluateRun(prepared, 0, PLOT).settledIndex).toBe(0);
    expect(evaluateRun(prepared, 599, PLOT).settledIndex).toBe(0);
    expect(evaluateRun(prepared, 600, PLOT).settledIndex).toBe(1);
  });

  it('is a pure function of the clock', () => {
    const prepared = moveRun();
    expect(evaluateRun(prepared, 250, PLOT)).toEqual(evaluateRun(prepared, 250, PLOT));
  });

  it('shows where a ghosted move is going before it sets off', () => {
    const prepared = moveRun();
    const ghost = evaluateRun(prepared, 120, PLOT).overlays.find((overlay) => overlay.kind === 'ghost');

    expect(ghost).toBeDefined();
    expect(ghost).toMatchObject({ to: { x: 10, y: 8 } });
  });

  it('outlines what it is working on even when no select operation asked for it', () => {
    const prepared = prepare(
      [op({ id: 'a', kind: 'resize', elementId: 'e-1', to: { centre: { x: 10, y: 5 }, width: 8, depth: 6, rotation: 0 } })],
      [patio()],
    );

    expect(evaluateRun(prepared, 600, PLOT).overlays.some((overlay) => overlay.kind === 'selection')).toBe(true);
  });

  it('shows the vertices a little before and after a reshape', () => {
    const points = [{ x: 2, y: 11 }, { x: 18, y: 11 }, { x: 18, y: 15 }, { x: 2, y: 15 }];
    const prepared = prepare([op({ id: 'a', phase: 'planting', kind: 'reshape', elementId: 'e-2', to: { points } })], [bed()]);

    const before = evaluateRun(prepared, -150, PLOT).overlays.find((o) => o.kind === 'vertices');
    const after = evaluateRun(prepared, 1150, PLOT).overlays.find((o) => o.kind === 'vertices');

    expect(before?.alpha ?? 0).toBeGreaterThan(0);
    expect(after?.alpha ?? 0).toBeGreaterThan(0);
  });

  it('marks only the corners that are going somewhere', () => {
    /*
     * The bed's far edge moves 1 m and the two corners against the fence stay put. Marking all four
     * would say the whole outline is being redrawn; a sweeping lawn has twenty-eight corners and
     * doing it there covers the garden in dots.
     */
    const points = [{ x: 2, y: 11 }, { x: 18, y: 11 }, { x: 18, y: 15 }, { x: 2, y: 15 }];
    const prepared = prepare([op({ id: 'a', phase: 'planting', kind: 'reshape', elementId: 'e-2', to: { points } })], [bed()]);

    const overlay = evaluateRun(prepared, 500, PLOT).overlays.find((o) => o.kind === 'vertices');

    expect(overlay?.kind === 'vertices' && overlay.points).toHaveLength(2);
  });

  it('draws the old route fading while the new one is built along', () => {
    const to = { points: [{ x: 10, y: 6 }, { x: 12, y: 11 }, { x: 16, y: 16 }] };
    const prepared = prepare([op({ id: 'a', phase: 'circulation', kind: 'reroute', elementId: 'e-3', to })], [route()]);

    // Early: the line is being set out, nothing built yet.
    const setting = evaluateRun(prepared, 300, PLOT);
    expect(setting.overlays.some((overlay) => overlay.kind === 'route')).toBe(true);
    expect(setting.motion.map((entry) => entry.key)).toEqual(['a:old']);

    // Later: the old path is fading and the new one is part built.
    const building = evaluateRun(prepared, 1200, PLOT);
    const old = building.motion.find((entry) => entry.key === 'a:old')!;
    const built = building.motion.find((entry) => entry.key === 'a:new')!;
    expect(old.opacity).toBeLessThan(1);
    expect(built.element.shape.kind).toBe('polyline');
    expect(geometryArea(built.element.shape)).toBeLessThan(geometryArea({ ...route().shape, ...to } as never));
  });

  it('pops an added element in without ever scaling its geometry', () => {
    const prepared = prepare(
      [op({ id: 'a', phase: 'planting', kind: 'add', ref: '$shrub', element: {
        category: 'planting-bed', role: 'feature', zone: 'back',
        shape: { kind: 'point', at: { x: 5, y: 8 }, radius: 0.6 } } })],
      [patio()],
    );

    const frame = evaluateRun(prepared, 350, PLOT);
    const entry = frame.motion[0]!;

    expect(entry.scale).toBeGreaterThan(0);
    expect(entry.scale).toBeLessThanOrEqual(1.2);
    // The geometry is the real thing all along; only the node is scaled.
    expect(entry.element.shape).toMatchObject({ radius: 0.6 });
    // Drawn over the top, because it is not on the plan for the renderer to substitute yet.
    expect(entry.replacesSettled).toBe(false);
    expect(frame.suppress).toEqual([]);
  });

  it('fades a removed element out before it goes', () => {
    const prepared = prepare([op({ id: 'a', kind: 'remove', elementId: 'e-1' })], [patio()]);
    const frame = evaluateRun(prepared, 250, PLOT);

    // A fade needs a per-element opacity, which the scene has nowhere to put — so the settled copy
    // is hidden and this one is drawn over the top instead.
    expect(frame.motion[0]!.opacity).toBeLessThan(1);
    expect(frame.motion[0]!.replacesSettled).toBe(false);
    expect(frame.suppress).toEqual(['e-1']);
    expect(evaluateRun(prepared, 500, PLOT).settledIndex).toBe(1);
  });

  it('glides one inspection frame between the things it is checking', () => {
    const prepared = prepare(
      [op({ id: 'a', phase: 'review', agent: 'reviewer', kind: 'inspect', elementIds: ['e-1', 'e-2'] })],
      [patio(), bed()],
    );

    const frames = [200, 600, 1000].map(
      (t) => evaluateRun(prepared, t, PLOT).overlays.find((overlay) => overlay.kind === 'frame'),
    );

    expect(frames.every((frame) => frame !== undefined)).toBe(true);
    // It travels: the box over the patio is not the box over the bed.
    expect(frames[0]!.kind === 'frame' && frames[2]!.kind === 'frame'
      && frames[0]!.box.minY !== frames[2]!.box.minY).toBe(true);
  });

  it('carries the label, the agent and the stage for the panel to read', () => {
    const prepared = prepare(
      [op({ id: 'a', phase: 'planting', agent: 'planting', label: 'Deepening the border',
        reason: 'Wrapping the border round the terrace', kind: 'select', elementId: 'e-2' })],
      [bed()],
    );

    expect(evaluateRun(prepared, 200, PLOT)).toMatchObject({
      chip: 'Deepening the border',
      agent: 'planting',
      phase: 'planting',
      status: 'Wrapping the border round the terrace',
    });
  });

  it('moves the cursor to what is about to be worked on', () => {
    const prepared = prepare(
      [
        op({ id: 'a', kind: 'select', elementId: 'e-1' }),
        op({ id: 'b', phase: 'planting', kind: 'select', elementId: 'e-2' }),
      ],
      [patio(), bed()],
    );

    const first = evaluateRun(prepared, 0, PLOT).cursor!;
    const second = evaluateRun(prepared, prepared.total, PLOT).cursor!;

    expect(first.y).toBeCloseTo(4, 1);
    expect(second.y).toBeGreaterThan(first.y);
  });
});

/* ---------------------------------------------------------------- the controller */

function harness(prepared: PreparedRun) {
  const commits: { elements: DesignElement[]; index: number }[] = [];
  const selected: (string | null)[] = [];
  const finished: string[] = [];
  const sink: RunSink = {
    commit: (elements, index) => commits.push({ elements, index }),
    frame: () => {},
    select: (id) => selected.push(id),
    finished: (status) => finished.push(status),
  };
  const clock = manualClock();
  const controller = createRunController({ prepared, clock, sink, plot: PLOT });
  return { commits, selected, finished, clock, controller };
}

describe('the controller', () => {
  const twoMoves = () =>
    prepare(
      [
        op({ id: 'a', kind: 'move', elementId: 'e-1', to: { x: 10, y: 8 } }),
        op({ id: 'b', kind: 'move', elementId: 'e-1', to: { x: 12, y: 8 } }),
      ],
      [patio()],
    );

  it('commits once per operation, at its boundary', () => {
    const { commits, clock, controller } = harness(twoMoves());
    controller.play();

    clock.advance(300);
    expect(commits).toHaveLength(0);

    clock.advance(300);
    expect(commits.map((entry) => entry.index)).toEqual([0]);

    clock.advance(1000);
    expect(commits.map((entry) => entry.index)).toEqual([0, 1]);
  });

  it('catches up in order after a long frame gap', () => {
    // A backgrounded tab must still apply what it slept through, and in the right order.
    const { commits, clock, controller } = harness(twoMoves());
    controller.play();
    clock.advance(5000);

    expect(commits.map((entry) => entry.index)).toEqual([0, 1]);
    expect(commits.at(-1)!.elements[0]!.shape).toMatchObject({ centre: { x: 12, y: 8 } });
  });

  it('holds its place across a pause rather than racing to catch up', () => {
    const { commits, clock, controller } = harness(twoMoves());
    controller.play();
    clock.advance(300);

    controller.pause();
    clock.advance(10_000);
    expect(commits).toHaveLength(0);

    controller.resume();
    clock.advance(300);
    expect(commits.map((entry) => entry.index)).toEqual([0]);
  });

  it('applies everything remaining when the animation is skipped', () => {
    const { commits, finished, clock, controller } = harness(twoMoves());
    controller.play();
    clock.advance(100);

    controller.skipToEnd();

    expect(commits.map((entry) => entry.index)).toEqual([0, 1]);
    expect(finished).toEqual(['complete']);
    // And it stops: no further frames, no second finish.
    clock.advance(5000);
    expect(finished).toEqual(['complete']);
  });

  it('keeps what has landed when it is stopped, and abandons the rest', () => {
    /*
     * Stop used to restore the run's starting point. It reads as the safer answer and is the worse
     * one: a Stop that discards teaches people not to press it. Only settled operations are in the
     * plan, so what stays is a garden the run actually described; going back is Undo's job.
     */
    const prepared = twoMoves();
    const { commits, finished, clock, controller } = harness(prepared);
    controller.play();
    clock.advance(700);

    controller.cancel();

    expect(commits.map((entry) => entry.index)).toEqual([0]);
    expect(commits.at(-1)!.elements[0]!.shape).toMatchObject({ centre: { x: 10, y: 8 } });
    expect(finished).toEqual(['cancelled']);
  });

  it('commits nothing at all when it is stopped before the first operation lands', () => {
    const { commits, finished, clock, controller } = harness(twoMoves());
    controller.play();
    clock.advance(100);

    controller.cancel();

    // Nothing had settled, so there is nothing to keep — and still no restore commit.
    expect(commits).toEqual([]);
    expect(finished).toEqual(['cancelled']);
  });

  it('selects what the agent is working on, and clears it at the end', () => {
    const { selected, clock, controller } = harness(twoMoves());
    controller.play();
    clock.advance(100);

    expect(selected[0]).toBe('e-1');

    clock.advance(5000);
    expect(selected.at(-1)).toBeNull();
  });

  it('reports one finish however many frames run', () => {
    const { finished, clock, controller } = harness(twoMoves());
    controller.play();
    clock.advance(10_000);
    clock.advance(10_000);

    expect(finished).toEqual(['complete']);
  });

  it('stops asking for frames once it is disposed', () => {
    const prepared = twoMoves();
    const clock = manualClock();
    const frame = vi.fn();
    const controller = createRunController({
      prepared, clock, plot: PLOT,
      sink: { commit: () => {}, frame, select: () => {}, finished: () => {} },
    });

    controller.play();
    const seen = frame.mock.calls.length;
    controller.dispose();
    clock.advance(5000);

    expect(frame.mock.calls.length).toBe(seen);
  });

  it('scrubs to any point without playing', () => {
    const prepared = twoMoves();
    const { commits, controller } = harness(prepared);

    controller.seek(prepared.total);
    expect(commits.map((entry) => entry.index)).toEqual([0, 1]);
    expect(controller.elapsed()).toBe(prepared.total);
  });
});
