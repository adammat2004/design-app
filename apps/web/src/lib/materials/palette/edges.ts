import type { ElementCategory } from '@garden-studio/schema';

/**
 * The cut edge where a surface meets whatever it sits on.
 *
 * This is the line that turns "a shape on grass" into "a bed". A real border has a spade-cut edge,
 * gravel is physically held in by something, and a pool has a defined lip — and on a drawing those
 * marks do most of the work of saying which of the two surfaces is the object and which is the
 * ground it lies on.
 *
 * **Keyed on the surface's own category, not on the pair of categories that meet.**
 *
 * The pair was the original intent and it turned out to fight the architecture. An edge is drawn on
 * the *upper* surface's outline, and every surface is rasterised independently and clipped to its
 * own outline — the upper element genuinely does not know what is underneath it. Teaching it would
 * mean putting its neighbours in the cache key, which destroys the independence the whole renderer
 * rests on: moving one bed would invalidate every surface near it. That is exactly the coupling the
 * shadow layer was given its own pass to avoid.
 *
 * Little is lost. Looking at the cases concretely, the upper surface decides its own edge in nearly
 * all of them: a border has a cut edge whether it sits on lawn or on gravel, and gravel needs
 * containment either way. The pair only matters for the tone of the line, and that is a subtlety
 * well below what a plan at 1:100 can show.
 *
 * Widths are **millimetres**, like every other product dimension in the manifest — see
 * `MATERIAL_PATTERNS`. The renderer divides by `MM_PER_METRE` once, at its top edge.
 */
export interface EdgeSpec {
  /** Real width of the edge on the ground, in millimetres. */
  widthMm: number;
  colour: string;
}

/**
 * `null` means no edge, and it is the right answer more often than not.
 *
 * A lawn has no edge of its own — whatever abuts it draws the line. A structure carries its own
 * outline already. Paving is defined by its own courses running out to the boundary, and adding a
 * line round it reads as a border round a photograph.
 */
export const CATEGORY_EDGES: Record<ElementCategory, EdgeSpec | null> = {
  /*
   * Tuned down hard from the first attempt, which used 60 mm of near-black and read as a picture
   * frame round every bed rather than as a cut in the ground. A spade edge on a drawing is a fine
   * line that says "this stops here" — the moment it competes with the planting inside it, it has
   * stopped describing the garden and started decorating it.
   */

  /** A spade-cut edge: bare soil, a shade under the planting rather than a hard outline. */
  'planting-bed': { widthMm: 30, colour: '#6b5a46' },
  /** Aggregate has to be held in by something. Drawn as the edging, not as the gravel. */
  'gravel-mulch': { widthMm: 40, colour: '#8d8271' },
  /** A pool's lip: the coping or the cut bank, and what says the water has a depth. */
  'water-feature': { widthMm: 60, colour: '#5c6f78' },

  lawn: null,
  'paved-area': null,
  structure: null,
  'existing-feature': null,
};

export function edgeFor(category: ElementCategory): EdgeSpec | null {
  return CATEGORY_EDGES[category] ?? null;
}
