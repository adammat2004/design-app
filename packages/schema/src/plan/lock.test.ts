import { describe, expect, it } from 'vitest';
import { isGroundLayer, isLocked, isUserLocked, type DesignElement } from './concepts.js';
import {
  LOCKED_REFUSAL,
  lockRefusal,
  resolveOperation,
  USER_LOCKED_REFUSAL,
} from './operations.js';

const boundary = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 16 },
  { x: 0, y: 16 },
];

function patio(over: Partial<DesignElement> = {}): DesignElement {
  return {
    id: 'p1',
    category: 'paved-area',
    role: 'feature',
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 5, y: 5 }, width: 3, depth: 3, rotation: 0 },
    ...over,
  };
}

const context = (element: DesignElement) => ({ elements: [element], boundary, bindings: {} });

describe('locks', () => {
  it('tells the ground layer from a user’s lock', () => {
    const ground = patio({ role: 'fill', fillKind: 'base' });
    expect(isGroundLayer(ground)).toBe(true);
    expect(isLocked(ground)).toBe(true);
    expect(isUserLocked(ground)).toBe(false);

    const held = patio({ locked: true });
    expect(isGroundLayer(held)).toBe(false);
    expect(isLocked(held)).toBe(true);
    expect(lockRefusal(held)).toBe(USER_LOCKED_REFUSAL);
    expect(lockRefusal(ground)).toBe(LOCKED_REFUSAL);
  });

  /** The designer changes nothing about a locked element, its material included. */
  it('refuses every AI operation on a user-locked element', () => {
    const held = patio({ locked: true });
    const operations = [
      { kind: 'move', elementId: 'p1', to: { x: 6, y: 6 } },
      { kind: 'remove', elementId: 'p1' },
      { kind: 'setProperty', elementId: 'p1', changes: { material: 'porcelain' } },
    ] as const;
    for (const operation of operations) {
      const resolved = resolveOperation(operation as never, context(held));
      expect(resolved).toEqual({ ok: false, reason: USER_LOCKED_REFUSAL });
    }
  });

  it('still lets the AI re-materialise the ground layer', () => {
    const ground = patio({ role: 'fill', fillKind: 'base' });
    const resolved = resolveOperation(
      { kind: 'setProperty', elementId: 'p1', changes: { material: 'porcelain' } } as never,
      context(ground),
    );
    expect(resolved.ok).toBe(true);
  });
});
