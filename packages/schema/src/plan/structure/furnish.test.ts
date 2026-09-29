import { describe, expect, it } from 'vitest';
import type { DesignElement } from '../concepts.js';
import { SYMBOLS } from '../symbols.js';
import {
  clampInside,
  clearInside,
  fitInside,
  pieceAt,
  pieceFor,
  piecesInside,
  standsInside,
  suitablePieces,
  swappedPiece,
  turnedPiece,
} from './furnish.js';

const gazebo = (rotation = 0): DesignElement => ({
  id: 'g1',
  category: 'structure',
  role: 'feature',
  name: 'Gazebo',
  symbol: 'gazebo',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 3.6, depth: 3.2, rotation },
});

const piece = (symbol: keyof typeof SYMBOLS): DesignElement => pieceFor(gazebo(), symbol, 'f1')!;

describe('what stands inside', () => {
  it('is the furniture wholly inside the outline, nothing else', () => {
    const table = pieceFor(gazebo(), 'dining-set-4', 't')!;
    const outside = pieceAt(pieceFor(gazebo(), 'bench', 'b')!, { x: 20, y: 20 });
    const hidden = { ...pieceFor(gazebo(), 'planter', 'p')!, hidden: true };
    expect(
      piecesInside(gazebo(), [gazebo(), table, outside, hidden]).map((item) => item.id),
    ).toEqual(['t']);
  });

  it('offers a gazebo somewhere to sit, and nothing to anything that is not a structure', () => {
    expect(suitablePieces(gazebo())).toContain('sofa-set');
    expect(suitablePieces(gazebo())).not.toContain('dining-set-6');
    expect(suitablePieces({ ...gazebo(), symbol: 'shed' })).toEqual([]);
  });
});

describe('placing a piece', () => {
  it('centres it with the furnishing margin clear, turning it to fit if it has to', () => {
    const table = pieceFor(gazebo(), 'dining-set-4', 't')!;
    expect(table).toMatchObject({ category: 'furniture', symbol: 'dining-set-4', height: 0.75 });
    expect(standsInside(gazebo(), table)).toBe(true);
    // A six-seater is 3.2 m long: with the margin it will not go into a 3.6 × 3.2 m gazebo either way.
    expect(pieceFor(gazebo(), 'dining-set-6', 't')).toBeNull();
    expect(fitInside(gazebo().shape, 'lounger')).toMatchObject({ width: 0.7, depth: 1.9 });
  });
});

describe('changing a piece', () => {
  it('swaps it for the new thing’s own size, where it stood', () => {
    const bench = pieceAt(piece('bench'), { x: 10.5, y: 10 });
    const lounger = swappedPiece(gazebo(), bench, 'lounger')!;
    expect(lounger).toMatchObject({ symbol: 'lounger', name: SYMBOLS.lounger.label, height: 0.4 });
    expect(lounger.shape).toMatchObject({ width: 0.7, depth: 1.9, centre: { x: 10.5, y: 10 } });
  });

  it('re-centres a swap that would not fit where it stood, and refuses one that fits nowhere', () => {
    const bench = pieceAt(piece('bench'), { x: 11.2, y: 10 });
    const sofa = swappedPiece(gazebo(), bench, 'sofa-set')!;
    expect(sofa.shape).toMatchObject({ centre: { x: 10, y: 10 } });
    expect(standsInside(gazebo(), sofa)).toBe(true);
    expect(swappedPiece(gazebo(), bench, 'dining-set-6')).toBeNull();
  });

  /** A table is placed with room to pull the chairs out, whether it is added or swapped in. */
  it('keeps the same clear floor round a swap as round a new piece', () => {
    const table = pieceFor(gazebo(), 'dining-set-4', 't')!;
    // A six-seater is inside a 3.6 × 3.2 m gazebo, but not with 0.3 m clear round it.
    expect(swappedPiece(gazebo(), table, 'dining-set-6')).toBeNull();
    expect(clearInside(gazebo(), table, 0.3)).toBe(true);
  });

  it('turns it a quarter only where it still fits', () => {
    const lounger = piece('lounger');
    expect(turnedPiece(gazebo(), lounger)!.shape).toMatchObject({ rotation: 90 });
    // A 3 × 2.4 m sofa turned in a 3.6 × 3.2 m gazebo is 3 m across a 3.2 m depth: still fits.
    expect(turnedPiece(gazebo(), piece('sofa-set'))).not.toBeNull();
    // A lounger fits a narrow structure lengthways and not across it.
    const narrow = {
      ...gazebo(),
      shape: { ...gazebo().shape, width: 1.5, depth: 2.6 },
    } as DesignElement;
    expect(turnedPiece(narrow, pieceFor(narrow, 'lounger', 'l')!)).toBeNull();
  });
});

describe('dragging a piece', () => {
  it('holds it wholly inside the structure however far it is dragged, at any turn', () => {
    for (const rotation of [0, 30, 145]) {
      const host = gazebo(rotation);
      const bench = pieceFor(host, 'bench', 'b')!;
      for (const wanted of [
        { x: 30, y: 10 },
        { x: -5, y: -5 },
        { x: 10, y: 11 },
      ]) {
        const at = clampInside(host, bench, wanted);
        expect(standsInside(host, pieceAt(bench, at))).toBe(true);
      }
    }
  });

  it('leaves a position that is already inside alone', () => {
    const bench = pieceFor(gazebo(), 'bench', 'b')!;
    const at = clampInside(gazebo(), bench, { x: 10.3, y: 9.8 });
    expect(at.x).toBeCloseTo(10.3);
    expect(at.y).toBeCloseTo(9.8);
  });
});
