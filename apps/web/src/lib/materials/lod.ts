import { MM_PER_METRE, type MaterialPattern } from '@garden-studio/schema';

/**
 * How much detail is worth drawing at this zoom.
 *
 * These thresholds all existed already and each was right, but they lived in three different files
 * and nothing named the idea they share. Two of them had even been discovered twice — the renderer
 * skips module shading below twelve pixels, and `ElementDrawing` independently decided a canopy
 * under four pixels is noise rather than a tree. Two correct instincts, written separately, with no
 * rule between them.
 *
 * ```
 *   pxPerMetre rises ──────────────────────────────────────────────────▶
 *
 *   MASS                    UNITS                        DETAIL
 *   one averaged tone       units drawn flat             units drawn lit
 *   │                       │                            │
 *   └ a slab at 2 px is     └ a gravel chip at 1.5 px    └ below 12 px a bevel and its
 *     joints aliasing to      is grain, which is what      shadow are a pixel each and
 *     grey haze                gravel looks like            read as dither, not as light
 * ```
 *
 * The floors differ by pattern type on purpose, and the difference is not an oversight: a slab
 * stops reading at three pixels, but a gravel chipping genuinely *is* about a pixel and a half at a
 * normal editing zoom. Raising the aggregate floor to match the module one made every gravel in the
 * app fall back to a flat colour and read as dead beige card.
 */

export type DetailTier =
  /** Too small for units to read. One averaged tone, and no fill calls wasted producing haze. */
  | 'mass'
  /** Units drawn, flat. */
  | 'units'
  /** Units drawn with their lit and shaded edges. */
  | 'detail';

/** The smallest module, in pixels, still worth drawing individually. */
export const MIN_DRAWN_MODULE_PX = 3;

/**
 * The scatter equivalent, and deliberately lower — see the note above about gravel. A stone drawn
 * at a pixel and a half is grain rather than a stone, which is exactly what gravel looks like from
 * standing height.
 */
export const MIN_DRAWN_UNIT_PX = 1.4;

/**
 * Below this many pixels across, a drawn thing gets no lit or shaded edge.
 *
 * At three or four pixels a highlight and a shadow are a pixel each and read as noise — they make
 * the surface look dithered rather than lit. The flat tone alone is more honest.
 */
export const MIN_SHADED_PX = 12;

/**
 * Below this many pixels a symbol is drawn as a dot rather than as itself.
 *
 * Separate from the surface floors because it is a different question: a tree canopy at four pixels
 * is not a coarse tree, it is a smudge, and a dot at least reads as "something is here".
 */
export const MIN_DRAWN_SYMBOL_PX = 4;

/**
 * How much detail this pattern warrants at this zoom.
 *
 * Note the tier is decided **per surface**, from the pattern's own quoted dimensions, not per unit.
 * A scatter's units vary in size within one surface, and each still checks `shadesAt` for its own
 * radius — so a bed can be in the `detail` tier while its smallest blobs individually go unshaded.
 * That is deliberate: the tier says what is worth attempting, and the per-unit check says what is
 * worth drawing.
 */
export function tierFor(pattern: MaterialPattern, pxPerMetre: number): DetailTier {
  switch (pattern.patternType) {
    case 'grid':
    case 'board': {
      const smallest =
        (Math.min(pattern.moduleSize.w, pattern.moduleSize.h) / MM_PER_METRE) * pxPerMetre;
      if (smallest < MIN_DRAWN_MODULE_PX) return 'mass';
      return shadesAt(smallest) ? 'detail' : 'units';
    }

    /*
     * A pad is a module by every measure that matters here — a discrete unit of a stated size — so
     * it takes the module floor rather than the scatter one. Only its *layout* differs.
     */
    case 'pads': {
      const smallest = (Math.min(pattern.padSize.w, pattern.padSize.h) / MM_PER_METRE) * pxPerMetre;
      if (smallest < MIN_DRAWN_MODULE_PX) return 'mass';
      return shadesAt(smallest) ? 'detail' : 'units';
    }

    /*
     * A hedge is judged on its crown, which is a unit of a stated size — so it takes the module
     * floor. Never a mass, though: a hedge is a *boundary* as much as a surface, and a garden that
     * loses its internal divisions when you zoom out has lost its structure, not just its detail.
     */
    case 'hedge': {
      const crown = (pattern.crownSize / MM_PER_METRE) * pxPerMetre;
      return shadesAt(crown) ? 'detail' : 'units';
    }

    case 'scatter': {
      const largest = (pattern.sizeRange.max / MM_PER_METRE) * pxPerMetre;
      if (largest < MIN_DRAWN_UNIT_PX) return 'mass';
      return shadesAt(largest) ? 'detail' : 'units';
    }

    case 'stripe': {
      // A band is metres wide; it only stops reading when the whole surface is a few pixels.
      const band = (pattern.bandWidth / MM_PER_METRE) * pxPerMetre;
      return band < MIN_DRAWN_MODULE_PX ? 'mass' : 'units';
    }

    case 'water':
      /*
       * Never a mass. Water is a body of colour before it is a texture, so at any zoom where the
       * shape is visible at all there is something worth drawing — and the ripples and the crests
       * drop out on their own thresholds inside the renderer.
       */
      return 'detail';
  }
}

/**
 * Below this many pixels a texture tile is not drawn and the flat tone stands in.
 *
 * A photograph of gravel resampled to six pixels is a grey smear with a visible repeat, where the
 * palette's mean is at least the right colour. Textures are metres across, so this only bites
 * zoomed right out — the same region where modules have already given way to a mass.
 */
export const MIN_TEXTURED_TILE_PX = 8;

/**
 * The thinnest a cut edge is drawn, in pixels.
 *
 * A 30 mm spade cut round a bed is under a pixel at the zoom a whole plan is read at. Drawn at its
 * true width it vanishes there — which is backwards, because the line that says "this is a bed and
 * not a patch of the lawn" is needed most at the scale where you are reading the garden as a whole,
 * and least when you are zoomed in far enough to see the planting itself.
 *
 * Slightly under one so it lands as a hairline rather than as a hard rule. What keeps it from
 * becoming clutter is that a surface which has fallen to the `mass` tier draws no edge at all.
 */
export const MIN_CUT_EDGE_PX = 0.9;

/** Whether something this many pixels across is worth lighting. */
export function shadesAt(sizePx: number): boolean {
  return sizePx >= MIN_SHADED_PX;
}
