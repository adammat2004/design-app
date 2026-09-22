import { findMaterial, type DesignElement, type MaterialId } from '@garden-studio/schema';
import { CATEGORY_COLOURS } from './concept-colours';

/**
 * What each material is drawn in.
 *
 * Split out from the catalogue for the same reason `zone-colours.ts` and `feature-colours.ts`
 * exist: palette data is presentation, and the shared package has no business carrying hexes to
 * a server that renders nothing. The override is deliberately a small shift within the
 * category's own family, so a paved area still reads as paved — but without it the Material
 * dropdown would be a control that visibly does nothing.
 *
 * Keyed off `MaterialId`, so adding a material to the catalogue without giving it a colour is a
 * compile error rather than a blank shape on the plan. `null` means "no override — use the
 * category colour", which is the honest answer for a feature carried over unchanged from step 2.
 */
export const MATERIAL_FILLS: Record<MaterialId, string | null> = {
  // paved-area
  'stone-pavers': '#dfe3dc',
  concrete: '#d6d8d3',
  porcelain: '#e6e8e4',
  'stone-setts': '#c9cbc2',
  'gravel-paving': '#e6e2d6',
  'timber-decking': '#d3c0a3',
  'stepping-stones': '#dcded8',
  // lawn
  'standard-turf': '#cfe0c4',
  'hardwearing-turf': '#c6dbba',
  'artificial-turf': '#bcd9ae',
  wildflower: '#d5e2b6',
  // planting-bed
  'mixed-border': '#94b884',
  shrubs: '#84ab77',
  'ornamental-grasses': '#a9c48f',
  hedging: '#7ea36f',
  'ground-cover': '#a2c193',
  // gravel-mulch
  'bark-mulch': '#d8c8a8',
  'decorative-gravel': '#e6e2d6',
  'play-bark': '#dcc9a4',
  'slate-chippings': '#cfcfc9',
  // structure
  softwood: '#c8b394',
  'painted-timber': '#d5c6ae',
  'dark-stained-timber': '#4b453d',
  hardwood: '#b89a72',
  'powder-coated-steel': '#b9bcb5',
  // water-feature
  'naturalistic-pond': '#a8cadf',
  'formal-pool': '#9dc3dc',
  rill: '#b0d2e5',
  'water-bowl': '#bcd8e8',
  // furniture — a sprite where there is one; these are the flat stand-in and the chip colour
  'teak-furniture': '#c9a06c',
  'rattan-furniture': '#a99a86',
  'steel-furniture': '#8d9195',
  // edging — the product's own colour; a run is painted, not tinted towards anything
  'brick-edging': '#a86b52',
  'concrete-kerb': '#c3c2bc',
  'sett-edging': '#9a9c95',
  'timber-sleeper': '#8a7150',
  /* No pattern entry, so this hex *is* the drawing: a 3 mm blade seen from above is a dark line. */
  'steel-edging': '#54585c',
  // walling — the top course of a retaining wall
  'walling-stone': '#b9b2a2',
  'brick-walling': '#a86b52',
  /* No pattern entry: a rendered wall is a smooth band of one colour, so this hex is the drawing. */
  'rendered-block': '#c6c3bb',
  // lighting — the fitting's own finish, which is what a sprite that is never tinted has to be
  'black-aluminium': '#3b3d40',
  'brushed-steel': '#9aa0a4',
  'antique-brass': '#9d7c46',
  // existing-feature
  existing: null,
};

/**
 * The colour an element is drawn in: its material's override if it has one, otherwise its
 * category's. One function, read by the Konva canvas, the SVG thumbnails and the legend alike, so
 * a material change cannot show up in one of the three and not the others.
 */
export function materialFill(element: DesignElement): string {
  const material = findMaterial(element.material);
  const override = material ? MATERIAL_FILLS[material.id] : null;

  return override ?? CATEGORY_COLOURS[element.category].fill;
}
