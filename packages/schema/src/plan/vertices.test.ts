import { describe, expect, it } from 'vitest';
import type { DesignElement } from './concepts.js';
import { edgesAfterVertexEdit } from './edges/edit.js';
import type { PlanGeometry } from './features.js';
import {
  insertVertexAt,
  moveVertexAt,
  removeVertexAt,
  vertexEditRefusal,
  withCornerRadius,
} from './vertices.js';

const square: PlanGeometry = {
  kind: 'polygon',
  points: [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ],
  cornerRadius: 0,
};

const path: PlanGeometry = {
  kind: 'polyline',
  points: [
    { x: 0, y: 0 },
    { x: 3, y: 0 },
  ],
  width: 1,
};

describe('corner edits', () => {
  it('moves a corner', () => {
    const moved = moveVertexAt(square, 2, { x: 5, y: 5 });
    expect(moved?.kind === 'polygon' && moved.points[2]).toEqual({ x: 5, y: 5 });
  });

  /** A bow tie has an ordinary vertex list and a quietly wrong area; nothing downstream would say. */
  it('refuses a corner dragged through the outline', () => {
    expect(moveVertexAt(square, 2, { x: 4, y: -2 })).toBeNull();
    const crossed: PlanGeometry = {
      ...square,
      points: [square.points[0]!, square.points[2]!, square.points[1]!, square.points[3]!],
    };
    expect(vertexEditRefusal(crossed)).toBe('That outline would cross itself.');
  });

  it('inserts a corner on an edge, and not after a path’s last point', () => {
    const inserted = insertVertexAt(square, 0, { x: 2, y: -0.5 });
    expect(inserted?.kind === 'polygon' && inserted.points).toHaveLength(5);
    expect(inserted?.kind === 'polygon' && inserted.points[1]).toEqual({ x: 2, y: -0.5 });
    expect(insertVertexAt(path, 1, { x: 4, y: 0 })).toBeNull();
    expect(insertVertexAt(path, 0, { x: 1.5, y: 0.5 })?.kind).toBe('polyline');
  });

  it('removes a corner, but never below a shape', () => {
    const triangle = removeVertexAt(square, 3);
    expect(triangle?.kind === 'polygon' && triangle.points).toHaveLength(3);
    expect(triangle && removeVertexAt(triangle, 0)).toBeNull();
    expect(removeVertexAt(path, 0)).toBeNull();
  });

  it('refuses a shape too small to be one', () => {
    expect(moveVertexAt(path, 1, { x: 0.2, y: 0 })).toBeNull();
  });

  it('clamps a corner radius to what is drawn', () => {
    const rounded = withCornerRadius(square, 99);
    expect(rounded.kind === 'polygon' && rounded.cornerRadius).toBe(3);
    expect(withCornerRadius(path, 1)).toBe(path);
  });
});

describe('edgesAfterVertexEdit', () => {
  const bed = (edges: DesignElement['edges']): DesignElement => ({
    id: 'b1',
    category: 'planting-bed',
    role: 'feature',
    zone: 'back',
    shape: square,
    ...(edges ? { edges } : {}),
  });
  const custom = { mode: 'custom' as const, runs: [] };

  it('keeps the plan when the corner count holds', () => {
    const before = bed(custom);
    const after = { ...before, shape: moveVertexAt(square, 1, { x: 5, y: 0 })! };
    expect(edgesAfterVertexEdit(before, after).edges).toEqual(custom);
  });

  /** Side indices renumber, and a `none` host's stashed runs are exactly as stale as Custom's. */
  it('sends Custom and None back to automatic when a corner is added', () => {
    for (const mode of ['custom', 'none'] as const) {
      const before = bed({ mode, runs: [] });
      const after = { ...before, shape: insertVertexAt(square, 0, { x: 2, y: -0.5 })! };
      expect(edgesAfterVertexEdit(before, after).edges).toEqual({ mode: 'auto', runs: [] });
    }
  });

  it('leaves an unedged host alone', () => {
    const before = bed(undefined);
    const after = { ...before, shape: insertVertexAt(square, 0, { x: 2, y: -0.5 })! };
    expect(edgesAfterVertexEdit(before, after).edges).toBeUndefined();
  });
});
