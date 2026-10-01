import type { PbrSetId } from './pbr/pbr-spec';

/**
 * Which set dresses what, and how hard — the rendering choices the schema does not make.
 *
 * A structure's frame and roof finishes name their set in `STRUCTURE_FINISHES` (`finish.texture`),
 * because that is data the AR builder needs too. Everything here is the web view's own business:
 * furniture, cushions, the floor laid inside a structure, the polycarbonate's ribbing, and how
 * strongly each set's normal map is allowed to speak.
 */

/**
 * How strongly each set's relief shows. A photograph's normal map is measured at the surface it was
 * shot from; the finish it dresses here can be smoother — paint fills the grain, powder coat is a
 * satin film over metal — so the relief is scaled down rather than a second, flatter set shipped.
 */
export const NORMAL_SCALE: Record<PbrSetId, number> = {
  'timber-oak': 1,
  'timber-pine': 1,
  'timber-painted': 0.45,
  'powder-coat': 0.5,
  wicker: 1,
  fabric: 0.8,
  stone: 0.8,
  concrete: 0.6,
  gravel: 1,
  'polycarbonate-flutes': 1,
};

/** The furniture materials and the set each is made of. A teak table is the oak set, tinted. */
export const FURNITURE_SETS: Record<string, PbrSetId> = {
  'teak-furniture': 'timber-oak',
  'rattan-furniture': 'wicker',
  'steel-furniture': 'powder-coat',
};

export const CUSHION_SET: PbrSetId = 'fabric';

/** A translucent roof panel's ribbing. */
export const PANEL_SET: PbrSetId = 'polycarbonate-flutes';

/**
 * A structure's floor: the plan painter's raster stays its colour — its joints are the plan's
 * joints — and a set gives it relief and roughness underneath, read through the second UV channel
 * in metres. `set: null` is a floor that takes roughness only: porcelain is smooth, and decking's
 * grain runs the way its boards do, which a detail map laid in plan metres cannot follow.
 */
export const FLOOR_DETAIL: Record<string, { set: PbrSetId | null; roughness: number }> = {
  'stone-pavers': { set: 'stone', roughness: 0.85 },
  'stone-setts': { set: 'stone', roughness: 0.8 },
  concrete: { set: 'concrete', roughness: 0.85 },
  porcelain: { set: null, roughness: 0.4 },
  'timber-decking': { set: null, roughness: 0.75 },
  'gravel-paving': { set: 'gravel', roughness: 0.95 },
};
