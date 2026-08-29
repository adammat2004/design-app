import type { ElementCategory } from './concepts';
import { STATUS_COLOURS } from './feature-colours';

/**
 * One source for surface colour on a generated plan, used by the Konva canvas, the SVG card
 * thumbnails and the legend swatches. A plain map rather than CSS custom properties for the
 * same reason `zone-colours.ts` is one: Konva cannot read variables off the document, and a
 * split definition is a split definition.
 *
 * The hexes are lifted from `brief/StyleThumbnail.tsx`, so a concept renders in the same
 * greens and greys as the style motifs the user picked from on step 3.
 */

export interface CategoryStyle {
  fill: string;
  stroke: string;
  label: string;
}

export const CATEGORY_COLOURS: Record<ElementCategory, CategoryStyle> = {
  lawn: { fill: '#cfe0c4', stroke: '#adc9a0', label: 'Lawn' },
  'planting-bed': { fill: '#94b884', stroke: '#6f9a5f', label: 'Planting bed' },
  'paved-area': { fill: '#dfe3dc', stroke: '#b9bfb3', label: 'Paved area' },
  'gravel-mulch': { fill: '#e6e2d6', stroke: '#c4bda8', label: 'Gravel / mulch' },
  structure: { fill: '#c8b394', stroke: '#95795a', label: 'Structure' },
  'water-feature': { fill: '#a8cadf', stroke: '#5f93b5', label: 'Water feature' },
  /*
   * Carried over from step 2 rather than given a colour of its own. A feature the user chose
   * to keep should look on the concept exactly as it looked when they kept it — a second
   * palette for the same object would read as a different object.
   */
  'existing-feature': {
    fill: STATUS_COLOURS.keep.fill,
    stroke: STATUS_COLOURS.keep.stroke,
    label: 'Existing feature',
  },
};

/** Legend order, which is also the order surfaces stack on the plan. */
export const CATEGORY_ORDER: ElementCategory[] = [
  'lawn',
  'planting-bed',
  'paved-area',
  'gravel-mulch',
  'structure',
  'water-feature',
  'existing-feature',
];
