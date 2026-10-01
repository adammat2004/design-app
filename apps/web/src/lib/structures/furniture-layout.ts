/**
 * Where the pieces of a furniture set stand inside its footprint — one answer for the drawn boxes
 * and the photographed models.
 *
 * A dining set is a table and chairs round it; a lounge set a sofa along the back and a low table in
 * front. `furnitureParts` draws those as boxes when no model has loaded, and `tools/assets
 * fetch:models` composes the real table and chairs at the same places, so the moment a model arrives
 * nothing moves: a chair the boxes put at the end of the table is where the model's chair is too.
 *
 * Coordinates are the footprint's own: `a` along its width from one corner, `b` along its depth, the
 * back of the set at `b = d` (a sofa's back, a bench's back) and its front at `b = 0`. A chair's
 * `facing` is the way it looks — towards the table.
 */
export type Facing = 'a-' | 'a+' | 'b-' | 'b+';

export type LayoutRect = { a0: number; a1: number; b0: number; b1: number };

/** Seat and table heights, in metres: a dining chair and the table it is pulled up to. */
export const SEAT = 0.44;
export const TABLE = 0.74;

/** How far the table stands in from the footprint's edge: a chair's depth and room to pull it out. */
const TABLE_INSET = 0.6;
/** How far a chair's centre stands in from the footprint's edge. */
const CHAIR_INSET = 0.3;

export function diningLayout(
  symbol: 'dining-set-4' | 'dining-set-6',
  w: number,
  d: number,
): { table: LayoutRect; chairs: { a: number; b: number; facing: Facing }[] } {
  const table = { a0: TABLE_INSET, a1: w - TABLE_INSET, b0: TABLE_INSET, b1: d - TABLE_INSET };
  const chairs: { a: number; b: number; facing: Facing }[] =
    symbol === 'dining-set-4'
      ? [
          { a: w / 2, b: CHAIR_INSET, facing: 'b+' },
          { a: w / 2, b: d - CHAIR_INSET, facing: 'b-' },
          { a: CHAIR_INSET, b: d / 2, facing: 'a+' },
          { a: w - CHAIR_INSET, b: d / 2, facing: 'a-' },
        ]
      : [
          { a: w / 3, b: CHAIR_INSET, facing: 'b+' },
          { a: (2 * w) / 3, b: CHAIR_INSET, facing: 'b+' },
          { a: w / 3, b: d - CHAIR_INSET, facing: 'b-' },
          { a: (2 * w) / 3, b: d - CHAIR_INSET, facing: 'b-' },
          { a: CHAIR_INSET, b: d / 2, facing: 'a+' },
          { a: w - CHAIR_INSET, b: d / 2, facing: 'a-' },
        ];
  return { table, chairs };
}

/** A lounge set: the sofa along the back, and a low table in front of it. */
export function loungeLayout(
  w: number,
  d: number,
): { sofa: LayoutRect; table: LayoutRect; deep: number } {
  const deep = Math.min(0.85, d * 0.4);
  return {
    deep,
    sofa: { a0: 0.1, a1: w - 0.1, b0: d - deep, b1: d - 0.05 },
    table: { a0: w / 2 - 0.5, a1: w / 2 + 0.5, b0: 0.45, b1: 1.05 },
  };
}
