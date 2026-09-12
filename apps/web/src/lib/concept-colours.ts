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
  /** A warm neutral: furniture is drawn as a sprite, and this is its selection outline and its chip. */
  furniture: { fill: '#e2d3bd', stroke: '#9c8460', label: 'Furniture' },
  /*
   * A warm amber, and the one category whose colour is about the thing it *emits* rather than the
   * thing it is. Every fitting on the plan is a dark metal object a few centimetres across, so a
   * palette taken from the product would be an unreadable grey dot; the light is what the symbol
   * is for.
   */
  lighting: { fill: '#f5d98f', stroke: '#b98a2b', label: 'Lighting' },
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
  'furniture',
  'lighting',
  'existing-feature',
];
