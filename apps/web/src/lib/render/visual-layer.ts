import type { DesignElement, PlantingRole } from '@garden-studio/schema';
import type { VisualLayer } from './scene';

/**
 * The visual stack, top last.
 *
 * A plan drawn only as "ground, then everything else" has no way to say that a shrub stands over
 * the perennials at its feet and under the tree above it, and that flatness is most of what makes
 * a render read as a diagram. This is the order things are stacked in the finished picture.
 *
 * **Nothing sorts by this yet.** Draw order is still the ground/object split `scenePasses` has
 * always produced. The table lands with the scene so both backends can be given the hierarchy in
 * one change later, judged on its own sheet — reordering the drawing and introducing the seam at
 * the same time would make any pixel difference impossible to attribute to either.
 */
export const LAYER_ORDER: Record<VisualLayer, number> = {
  base: 0,
  surface: 1,
  groundcover: 2,
  edge: 3,
  perennial: 4,
  grass: 5,
  furniture: 6,
  structure: 7,
  shrub: 8,
  specimen: 9,
  tree: 10,
  house: 11,
  lighting: 12,
};

/**
 * Which layer an element draws in.
 *
 * Keyed on category *and* geometry kind, because that pair is what decides the drawing everywhere
 * else in this renderer too: a `planting-bed` polygon is a bed, and a `planting-bed` point is a
 * tree. Category alone would put a tree canopy underneath the lawn.
 */
export function layerForElement(element: DesignElement): VisualLayer {
  const point = element.shape.kind === 'point';

  switch (element.category) {
    case 'planting-bed':
      // A point in the planting category is a plant: a specimen shrub if it names one, else a tree.
      if (point) return element.symbol?.startsWith('shrub-') ? 'shrub' : 'tree';
      return element.fillKind === 'base' ? 'base' : 'surface';
    case 'structure':
      return 'structure';
    case 'furniture':
      return 'furniture';
    case 'lighting':
      return 'lighting';
    case 'existing-feature':
      /*
       * Grouped with furniture rather than given a layer of its own, and the reason is the
       * ordering gate: `scenePasses` today ranks furniture and existing features equally and lets
       * array order break the tie. A layer of its own would silently reorder a plan that has both.
       * It gets its own slot when the hierarchy is switched on and the change can be seen.
       */
      return 'furniture';
    case 'lawn':
    case 'paved-area':
    case 'gravel-mulch':
    case 'water-feature':
      return element.fillKind === 'base' ? 'base' : 'surface';
  }
}

/**
 * Which layer a scheme role's infill draws in.
 *
 * The roles describe what a plant is *for* in the bed; the layers describe how tall it is. They
 * mostly agree, and where they do not the height wins — a mass planting of ornamental grass
 * stands above the ground cover at the front whatever its role is called.
 */
export function layerForPlantingRole(role: PlantingRole, taxonType: string): VisualLayer {
  if (role === 'edge') return taxonType === 'ground-cover' ? 'groundcover' : 'edge';
  if (role === 'specimen') return 'specimen';
  if (role === 'backdrop') return 'shrub';
  // mass and mid, which is most of a bed.
  if (taxonType === 'grass-ornamental') return 'grass';
  if (taxonType === 'shrub') return 'shrub';
  if (taxonType === 'ground-cover') return 'groundcover';
  return 'perennial';
}
