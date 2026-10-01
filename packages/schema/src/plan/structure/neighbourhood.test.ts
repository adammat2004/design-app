import { describe, expect, it } from 'vitest';
import { rotatePoint } from '../../geometry/primitives.js';
import type { DesignElement } from '../concepts.js';
import { SYMBOLS } from '../symbols.js';
import { localFrame, structureInterior, type LocalPoint } from './neighbourhood.js';

const pergola = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'p1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 0 },
  ...over,
});

const table = (over: Partial<DesignElement> = {}): DesignElement => ({
  id: 'table',
  category: 'furniture',
  role: 'feature',
  zone: 'back',
  symbol: 'dining-set-4',
  shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 2.4, depth: 2.4, rotation: 0 },
  ...over,
});

const near = (a: LocalPoint, b: LocalPoint) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.z).toBeCloseTo(b.z, 6);
};

describe('the local frame', () => {
  /** X along the width, Z towards the open front — the frame the 3D model is drawn in. */
  it('puts a thing along the width on X and a thing in front on Z, however it is turned', () => {
    for (const rotation of [0, 30, 210]) {
      const centre = { x: 10, y: 12 };
      const frame = localFrame(pergola({ shape: { kind: 'rect', centre, width: 3, depth: 3, rotation } }))!;
      near(frame.toLocal(rotatePoint({ x: centre.x + 2, y: centre.y }, centre, rotation)), { x: 2, z: 0 });
      near(frame.toLocal(rotatePoint({ x: centre.x, y: centre.y + 3 }, centre, rotation)), { x: 0, z: 3 });
    }
  });

  it('maps a point there and back', () => {
    const frame = localFrame(
      pergola({ shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 3, depth: 3, rotation: 37 } }),
    )!;
    const plan = { x: 13.2, y: 9.1 };
    const back = frame.toPlan(frame.toLocal(plan));
    expect(back.x).toBeCloseTo(plan.x);
    expect(back.y).toBeCloseTo(plan.y);
  });
});

describe('what stands inside it', () => {
  it('is the table under it, in its frame, at the table’s own height', () => {
    expect(structureInterior(pergola(), [table()])).toMatchObject([
      { id: 'table', kind: 'furniture', symbol: 'dining-set-4', height: SYMBOLS['dining-set-4'].height, base: 0 },
    ]);
  });

  it('measures a piece’s height from the structure’s own raised base', () => {
    const pieces = structureInterior(pergola({ elevation: 0.34 }), [table({ elevation: 0.34 })])!;
    expect(pieces[0]!.base).toBeCloseTo(0, 9);
  });

  it('leaves out what is not wholly inside, and anything hidden', () => {
    const outside = table({ id: 'far', shape: { kind: 'rect', centre: { x: 16, y: 12 }, width: 1, depth: 1, rotation: 0 } });
    expect(structureInterior(pergola(), [outside, table({ hidden: true })])).toEqual([]);
  });

  it('is nothing for an element with no 3D editor', () => {
    expect(structureInterior(pergola({ symbol: 'shed' }), [table()])).toBeNull();
  });
});
