import { describe, expect, it } from 'vitest';
import { rectToPolygon } from '../../geometry/shapes.js';
import type { DesignElement } from '../concepts.js';
import { resolveOperation } from '../operations.js';
import { seatsOn, sizeForSeats } from './capacity.js';
import { STRUCTURE_DEFINITIONS } from './definitions.js';
import {
  anchoredResize,
  describeStructureAlternative,
  describeStructureConflict,
  planStructureResize,
  structureConflicts,
  structureLimitRefusal,
  structurePins,
  type StructureResizeContext,
} from './resize.js';
import { structureSides } from './surroundings.js';

const BOUNDARY = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];
/** The house fills the top of the plot down to y = 4. */
const HOUSE = [
  { x: 2, y: 0 },
  { x: 18, y: 0 },
  { x: 18, y: 4 },
  { x: 2, y: 4 },
];

const pergola = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  material: 'hardwood',
  zone: 'back',
  height: 2.4,
  shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 0 },
  ...over,
});

const rectShape = (element: DesignElement) => {
  if (element.shape.kind !== 'rect') throw new Error('not a rect');
  return element.shape;
};

const context = (
  elements: DesignElement[] = [],
  house: StructureResizeContext['house'] = HOUSE,
) => ({
  elements,
  boundary: BOUNDARY,
  house,
});

const bed = (id: string, points: { x: number; y: number }[], name = 'Border'): DesignElement => ({
  id,
  category: 'planting-bed',
  role: 'fill',
  fillKind: 'accent',
  name,
  zone: 'back',
  shape: { kind: 'polygon', points, cornerRadius: 0 },
});

const terrace = (points: { x: number; y: number }[]): DesignElement => ({
  id: 't1',
  category: 'paved-area',
  role: 'feature',
  name: 'Terrace',
  zone: 'back',
  shape: { kind: 'polygon', points, cornerRadius: 0 },
});

const box = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

describe('planStructureResize — a free-standing structure', () => {
  it('changes the real footprint when the width changes, about its centre', () => {
    const result = planStructureResize(pergola(), { width: 4.5 }, context());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(rectShape(result.element)).toMatchObject({
      width: 4.5,
      depth: 3,
      centre: { x: 10, y: 12 },
    });
  });

  it('changes the real footprint when the depth changes', () => {
    const result = planStructureResize(pergola(), { depth: 3.5 }, context());
    expect(result.status === 'ok' && rectShape(result.element)).toMatchObject({
      width: 3,
      depth: 3.5,
    });
  });

  it('keeps its rotation', () => {
    const turned = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 30 },
    });
    const result = planStructureResize(turned, { width: 4.5, depth: 3.5 }, context());
    expect(result.status === 'ok' && rectShape(result.element).rotation).toBe(30);
  });

  it('reports a request for the size it already is as unchanged', () => {
    expect(planStructureResize(pergola(), { width: 3 }, context()).status).toBe('unchanged');
  });

  it('is unsupported for anything that is not a configurable structure', () => {
    expect(planStructureResize(pergola({ symbol: 'shed' }), { width: 4 }, context()).status).toBe(
      'unsupported',
    );
  });
});

describe('anchoring — the side it is against stays where it is', () => {
  /** Rear side flush with the house wall at y = 4. */
  const againstHouse = pergola({
    shape: { kind: 'rect', centre: { x: 10, y: 5.5 }, width: 3, depth: 3, rotation: 0 },
  });

  it('grows away from the house', () => {
    const pins = structurePins(againstHouse, context());
    expect(pins.rear?.kind).toBe('house');

    const result = planStructureResize(againstHouse, { depth: 4 }, context());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const before = structureSides(rectShape(againstHouse)).rear;
    const after = structureSides(rectShape(result.element)).rear;
    expect(after.a.y).toBeCloseTo(before.a.y);
    expect(rectShape(result.element).centre.y).toBeCloseTo(6);
  });

  it('holds its edge when turned, by the house rather than by the screen axes', () => {
    // Rotated 180°: the local rear is now the world bottom, so the house is against the *front*.
    const turned = { ...againstHouse, shape: { ...rectShape(againstHouse), rotation: 180 } };
    expect(structurePins(turned, context()).front?.kind).toBe('house');
    const result = planStructureResize(turned, { depth: 4 }, context());
    expect(result.status === 'ok' && rectShape(result.element).centre.y).toBeCloseTo(6);
  });

  it('grows away from the terrace it is flush with', () => {
    // Terrace to the left, its edge 0.2 m off the pergola's left side.
    const beside = terrace(box(4, 10, 8.3, 14));
    const result = planStructureResize(pergola(), { width: 4 }, context([beside]));
    expect(result.status === 'ok' && rectShape(result.element).centre.x).toBeCloseTo(10.5);
  });

  it('keeps its edge lined up with the patio it stands on', () => {
    // It stands on a patio whose left edge runs 0.2 m beyond its own left side.
    const under = terrace(box(8.3, 9, 16, 15));
    const result = planStructureResize(pergola(), { width: 4 }, context([under]));
    expect(result.status === 'ok' && rectShape(result.element).centre.x).toBeCloseTo(10.5);
  });

  it('pins the side 0.3 m off the fence, where the generator leaves rear rooms', () => {
    const byFence = pergola({
      shape: { kind: 'rect', centre: { x: 18.2, y: 12 }, width: 3, depth: 3, rotation: 0 },
    });
    expect(structurePins(byFence, context()).right?.kind).toBe('boundary');
    const result = planStructureResize(byFence, { width: 4 }, context());
    expect(result.status === 'ok' && rectShape(result.element).centre.x).toBeCloseTo(17.7);
  });

  it('grows about its centre when held on both sides of an axis', () => {
    const between = [terrace(box(4, 10, 8.4, 14)), { ...terrace(box(11.6, 10, 16, 14)), id: 't2' }];
    const pins = structurePins(pergola(), context(between));
    expect(pins.left && pins.right).toBeTruthy();
    // 3 m wide between terraces 3.2 m apart: 3.1 still fits centred.
    const result = planStructureResize(pergola(), { width: 3.1 }, context(between));
    expect(result.status === 'ok' && rectShape(result.element).centre.x).toBeCloseTo(10);
  });

  it('is exactly the pinned resize the planner and the editor share', () => {
    const pins = { rear: { kind: 'house' as const } };
    const grown = anchoredResize(againstHouse, { width: 3, depth: 5 }, pins);
    expect(rectShape(grown).centre).toEqual({ x: 10, y: 6.5 });
  });
});

describe('conflicts and alternatives', () => {
  /** A border to the right of the pergola, starting 0.5 m off its right side. */
  const border = bed('b1', box(12, 9, 15, 15), 'Rear border');

  it('refuses to grow into a bed, names it, and offers checked alternatives', () => {
    const result = planStructureResize(pergola(), { width: 5 }, context([border]));
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;

    expect(result.conflicts).toEqual([
      {
        kind: 'element',
        id: 'b1',
        category: 'planting-bed',
        name: 'Rear border',
        reason: 'overlaps',
      },
    ]);
    const fit = result.alternatives.find((alternative) => alternative.kind === 'fit');
    expect(fit).toBeDefined();
    expect(rectShape(fit!.element).width).toBeCloseTo(4, 1);
    expect(describeStructureAlternative(fit!, 'm')).toBe('Use 4.0 × 3.0 m');

    const shift = result.alternatives.find((alternative) => alternative.kind === 'shift');
    expect(shift).toBeDefined();
    expect(rectShape(shift!.element).width).toBe(5);
    // Every alternative has itself been checked: nothing it runs into.
    for (const alternative of result.alternatives) {
      expect(structureConflicts(pergola(), alternative.element, context([border]))).toEqual([]);
    }
  });

  it('does not shift along an axis it is pinned on', () => {
    const betweenHouseAndBorder = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 5.5 }, width: 3, depth: 3, rotation: 0 },
    });
    const below = bed('b2', box(7, 7.5, 13, 10));
    const result = planStructureResize(betweenHouseAndBorder, { depth: 4 }, context([below]));
    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    // Rear is against the house: no shift up or down, and a sideways shift cannot help.
    expect(result.alternatives.every((alternative) => alternative.kind === 'fit')).toBe(true);
  });

  it('never blocks on an overlap that was already there', () => {
    // A bed already under the left 0.5 m, over exactly the pergola's own depth.
    const under = bed('b3', box(7.5, 10.5, 9, 13.5));
    const result = planStructureResize(pergola(), { depth: 3.4 }, context([under]));
    expect(result.status).toBe('ok');
  });

  it('lets a canopy reach over it, but not a trunk stand in it', () => {
    const tree = (x: number): DesignElement => ({
      id: 'tree',
      category: 'planting-bed',
      role: 'feature',
      name: 'Tree',
      zone: 'back',
      symbol: 'tree-deciduous',
      shape: { kind: 'point', at: { x, y: 12 }, radius: 2 },
    });
    // Canopy reaches 2 m; the trunk is 0.24 m. Growing to 5 m puts the right side at x = 12.5.
    expect(planStructureResize(pergola(), { width: 5 }, context([tree(14)])).status).toBe('ok');
    expect(planStructureResize(pergola(), { width: 5 }, context([tree(12.3)])).status).toBe(
      'blocked',
    );
  });

  it('carries the furniture standing on it, and says when a shrink leaves it no room', () => {
    const table: DesignElement = {
      id: 'dining',
      category: 'furniture',
      role: 'feature',
      name: 'Dining set',
      zone: 'back',
      symbol: 'dining-set-4',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 2.4, depth: 2.4, rotation: 0 },
    };
    expect(planStructureResize(pergola(), { width: 4 }, context([table])).status).toBe('ok');
    const shrunk = planStructureResize(pergola(), { width: 2.2 }, context([table]));
    expect(shrunk.status === 'blocked' && shrunk.conflicts).toEqual([
      {
        kind: 'element',
        id: 'dining',
        category: 'furniture',
        name: 'Dining set',
        reason: 'no-longer-fits',
      },
    ]);
  });

  it('refuses to cross the boundary', () => {
    const byFence = pergola({
      shape: { kind: 'rect', centre: { x: 17.5, y: 12 }, width: 3, depth: 3, rotation: 0 },
    });
    const result = planStructureResize(byFence, { width: 6 }, context([], null));
    expect(result.status === 'blocked' && result.conflicts).toEqual([{ kind: 'boundary' }]);
  });

  it('refuses to grow into the house, but may touch it', () => {
    const near = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 6 }, width: 3, depth: 3, rotation: 0 },
    });
    // Nothing pins it (0.5 m off the wall), so it grows about its centre: 4 m deep touches the wall.
    expect(planStructureResize(near, { depth: 4 }, context()).status).toBe('ok');
    const into = planStructureResize(near, { depth: 5 }, context());
    expect(into.status === 'blocked' && into.conflicts).toEqual([{ kind: 'house' }]);
  });
});

describe('saying what is wrong', () => {
  it('names what is in the way in words a person can act on', () => {
    expect(describeStructureConflict({ kind: 'boundary' })).toBe('It would cross the boundary.');
    expect(describeStructureConflict({ kind: 'house' })).toBe('It would run into the house.');
    expect(
      describeStructureConflict({
        kind: 'element',
        id: 'b1',
        category: 'planting-bed',
        name: 'Rear border',
        reason: 'overlaps',
      }),
    ).toBe('The rear border is in the way.');
    expect(
      describeStructureConflict({
        kind: 'element',
        id: 'p',
        category: 'paved-area',
        reason: 'overlaps',
      }),
    ).toBe('A path is in the way.');
    expect(
      describeStructureConflict({
        kind: 'element',
        id: 'd',
        category: 'furniture',
        name: 'Dining set',
        reason: 'no-longer-fits',
      }),
    ).toBe('The dining set would no longer fit in it.');
  });
});

describe('limits', () => {
  it('holds a request to the product range and says it did', () => {
    const result = planStructureResize(pergola(), { width: 40 }, context());
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(rectShape(result.element).width).toBe(
      STRUCTURE_DEFINITIONS.pergola!.dimensions.width.max,
    );
    expect(result.clamped).toBe(true);
  });

  /** A pergola generated before the limits existed may shrink towards them, never grow further. */
  it('is monotone for a structure already beyond them', () => {
    const oversized = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 7, depth: 3, rotation: 0 },
    });
    expect(planStructureResize(oversized, { width: 8 }, context()).status).toBe('unchanged');
    const smaller = planStructureResize(oversized, { width: 6.5 }, context());
    expect(smaller.status === 'ok' && rectShape(smaller.element).width).toBe(6.5);

    expect(
      structureLimitRefusal(oversized, {
        ...oversized,
        shape: { ...rectShape(oversized), width: 8 },
      }),
    ).toMatch(/at most 6 m wide/);
    expect(
      structureLimitRefusal(oversized, {
        ...oversized,
        shape: { ...rectShape(oversized), width: 6.5 },
      }),
    ).toBeNull();
  });

  it('holds the designer to the same range', () => {
    const refused = resolveOperation(
      { kind: 'resize', elementId: 'p1', to: { width: 9, depth: 3 } } as never,
      { elements: [pergola()], boundary: BOUNDARY, bindings: {} },
    );
    expect(refused).toEqual({ ok: false, reason: 'A pergola can be at most 6 m wide.' });
  });
});

describe('capacity', () => {
  it('sizes a dining structure from the tables the generator furnishes with', () => {
    const definition = STRUCTURE_DEFINITIONS.pergola!;
    expect(sizeForSeats(definition, 4)).toEqual({ long: 3, short: 3 });
    expect(sizeForSeats(definition, 6)).toEqual({ long: 3.8, short: 3 });
    expect(sizeForSeats(definition, 8)).toEqual({ long: 4.6, short: 3 });
    expect(sizeForSeats(definition, 12)).toEqual({ long: 6, short: 3 });
  });

  it('reads how many it seats off the furniture standing in it', () => {
    const table: DesignElement = {
      id: 'dining',
      category: 'furniture',
      role: 'feature',
      zone: 'back',
      symbol: 'dining-set-4',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 2.4, depth: 2.4, rotation: 0 },
    };
    expect(seatsOn(pergola(), [pergola(), table])).toBe(4);
    expect(seatsOn(pergola(), [pergola()])).toBeNull();
  });

  it('resizes for a number of people, running the table along the longer side', () => {
    const long = pergola({
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3.5, rotation: 0 },
    });
    const result = planStructureResize(long, { seats: 8 }, context());
    expect(result.status === 'ok' && rectShape(result.element)).toMatchObject({
      width: 3,
      depth: 4.6,
    });
  });

  it('draws the footprint it measures', () => {
    const result = planStructureResize(pergola(), { width: 4 }, context());
    expect(result.status === 'ok' && rectToPolygon(rectShape(result.element))).toHaveLength(4);
  });
});
