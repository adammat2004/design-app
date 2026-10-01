import { describe, expect, it } from 'vitest';
import { CLOSE_DISTANCE, draftStep, finishedGeometry } from './draw-draft';

const square = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 4 },
];
const roundTo = (raw: { x: number; y: number }) => ({ x: Math.round(raw.x), y: Math.round(raw.y) });

describe('draftStep', () => {
  /** Snapping first could carry the point out of range of the first corner the user aimed at. */
  it('closes on the raw pointer near the first corner', () => {
    expect(draftStep(square, { x: 0.3, y: 0.2 }, 'polygon', roundTo)).toEqual({ kind: 'close' });
    expect(draftStep(square, { x: CLOSE_DISTANCE + 0.1, y: 0 }, 'polygon', roundTo).kind).toBe('add');
  });

  it('never closes a path, or a polygon with too few corners', () => {
    expect(draftStep(square, { x: 0.1, y: 0.1 }, 'polyline', roundTo).kind).toBe('add');
    expect(draftStep(square.slice(0, 2), { x: 0.1, y: 0.1 }, 'polygon', roundTo).kind).toBe('add');
  });

  it('adds the snapped point, and ignores a double click’s repeat', () => {
    expect(draftStep(square, { x: 2.2, y: 5.9 }, 'polygon', roundTo)).toEqual({ kind: 'add', point: { x: 2, y: 6 } });
    expect(draftStep(square, { x: 4.2, y: 3.9 }, 'polygon', roundTo)).toEqual({ kind: 'ignore' });
  });
});

describe('finishedGeometry', () => {
  it('makes a shape only when it is one', () => {
    expect(finishedGeometry(square, 'polygon', 1)?.kind).toBe('polygon');
    expect(finishedGeometry(square.slice(0, 2), 'polygon', 1)).toBeNull();
    expect(finishedGeometry(square.slice(0, 2), 'polyline', 1.2)).toEqual({
      kind: 'polyline',
      points: square.slice(0, 2),
      width: 1.2,
    });
  });
});
