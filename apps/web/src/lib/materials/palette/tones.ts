import type { MaterialId } from '@garden-studio/schema';

/**
 * The tones a patterned material draws in.
 *
 * Presentation, so it lives here rather than in the shared package — the same seam
 * `material-colours.ts` sits on, and for the reason `materials.ts:12` gives: a server that renders
 * nothing has no business carrying hexes.
 *
 * These are **abstract tones**, not product colours. There is no manufacturer, no SKU and no price
 * anywhere in this file, and none should arrive: matching a material to a real product is a
 * separate lookup, and folding it in here would make the renderer's palette a commercial claim
 * about what the garden is paved with.
 *
 * Three to five per material. Fewer and the repeat is obvious; more and the surface reads as
 * speckled rather than as one product that varies.
 */
export interface MaterialTones {
  /** Unit tones — slabs, boards, plants, stones — picked between by the seeded PRNG. */
  palette: string[];
  /**
   * What sits behind the units. A mortar joint for paving, the soil under a bed, the lawn between
   * stepping stones. Named for the case it was introduced for; it is the background either way.
   */
  jointColour: string;
}

/**
 * `Partial`, matching `MATERIAL_PATTERNS`: a material with no pattern needs no tones, and
 * `resolvePattern` requires both halves before it will return an entry.
 */
export const MATERIAL_TONES: Partial<Record<MaterialId, MaterialTones>> = {
  /* ---- paved-area ---- */
  /*
   * Riven natural stone. Tuned against `.material-preview/`, and the first attempt was too wide a
   * spread — it mixed a warm beige with a cool grey-green and read as two products laid
   * alternately, a chessboard rather than a patio. Real stone varies within one narrow family.
   */
  'stone-pavers': {
    palette: ['#dcdcd5', '#e3e2db', '#d5d6cf', '#dedbd2', '#d8dad3'],
    jointColour: '#b2b5ac',
  },
  concrete: {
    palette: ['#d8d9d5', '#dedfdb', '#d2d3cf', '#dbdbd6'],
    jointColour: '#b0b2ad',
  },
  /** Manufactured, so it varies less than stone — that uniformity is what reads as porcelain. */
  porcelain: {
    palette: ['#e7e8e4', '#eaebe7', '#e3e4e0', '#e5e6e1'],
    jointColour: '#c3c5bf',
  },
  /** The gap is grass, not mortar, so the background is the lawn it is set into. */
  'stepping-stones': {
    palette: ['#dcdcd5', '#d6d7d0', '#e0e0d9'],
    jointColour: '#b7cfa8',
  },
  'timber-decking': {
    palette: ['#c9ab84', '#d2b691', '#c1a17a', '#cdb089'],
    jointColour: '#8a7454',
  },
  /*
   * Aggregates get a background drawn from the *middle* of their own palette, not a contrasting
   * one. A bed of gravel is a solid mass of stone; the individual stones are texture on it, not
   * objects sitting on something else. The first attempt used a darker contrasting ground and
   * every aggregate read as sparse dots scattered on mud.
   */
  'gravel-paving': {
    palette: ['#ded9cb', '#e5e1d4', '#d3cdbd', '#dad4c4', '#e8e4d8'],
    jointColour: '#cfc9b9',
  },

  /* ---- water-feature ---- */
  /*
   * Water is lit from *above* and coloured from *below*: the tone is the pool floor seen through
   * depth, and the light comes back off the surface. So the palette is the body and the joint
   * colour is the deeper margin, and the specular the renderer adds is neither of them.
   *
   * A naturalistic pond reads greener because it is alive; a formal pool reads bluer and flatter
   * because it is meant to be a mirror.
   */
  'naturalistic-pond': {
    palette: ['#5e7f7a', '#688a83', '#567670', '#628480'],
    jointColour: '#3f5c59',
  },
  'formal-pool': {
    palette: ['#5a7793', '#63809c', '#54708b', '#5f7d99'],
    jointColour: '#3d566d',
  },
  rill: { palette: ['#5d7c95', '#66849c', '#57748d'], jointColour: '#41586c' },
  'water-bowl': { palette: ['#5b7a90', '#648398'], jointColour: '#3f5665' },

  /* ---- lawn ---- */
  /*
   * Two bands and nothing else: a mown stripe is one grass catching the light two ways, so the
   * two tones have to be close. The first attempt spread them far enough apart that a lawn read
   * as two different materials laid in strips.
   */
  'standard-turf': { palette: ['#a4c68b', '#9dc084'], jointColour: '#9dc084' },
  'hardwearing-turf': { palette: ['#9cbf83', '#96b97d'], jointColour: '#96b97d' },
  'artificial-turf': { palette: ['#8cc27b', '#87bd76'], jointColour: '#87bd76' },
  wildflower: {
    palette: ['#c9d98d', '#e0d071', '#b8cd7e', '#d4a8c4', '#cfd9a0'],
    jointColour: '#9fb877',
  },

  /* ---- planting-bed ---- */
  /*
   * A mixed border is the one place a wide spread of tone is right — it is the point of a mixed
   * border. The soil behind is a mid brown rather than the near-black first tried: at these
   * densities enough of it shows between plants that a dark ground made the whole bed read as
   * earth with things on it rather than as planting.
   *
   * Every tone here is foliage. An earth-brown entry was tried and had to go — drawn as a plant
   * it read as a bare patch, which is exactly the thing the soil colour is already saying.
   */
  'mixed-border': {
    palette: ['#7fa86a', '#93b87c', '#6d9a5c', '#95849f', '#a8bd83'],
    jointColour: '#8a7963',
  },
  shrubs: {
    palette: ['#6f9a5f', '#7ea86c', '#628a54', '#86ad73'],
    jointColour: '#8a7963',
  },
  'ornamental-grasses': {
    palette: ['#a9c48f', '#b6cd9c', '#9bb882', '#c2cfa4'],
    jointColour: '#8a7963',
  },
  hedging: {
    palette: ['#5f8a52', '#6b9a5c', '#557d49', '#739f63'],
    jointColour: '#55764a',
  },
  'ground-cover': {
    palette: ['#8fb37f', '#9cbe8b', '#82a672', '#a6c795'],
    jointColour: '#7d8f6c',
  },

  /* ---- gravel-mulch: background from the middle of the palette, as above ---- */
  'bark-mulch': {
    palette: ['#a8845c', '#b89268', '#977452', '#af8b61'],
    jointColour: '#9d7c56',
  },
  'decorative-gravel': {
    palette: ['#ddd8ca', '#e4e0d3', '#d1ccbc', '#d8d2c2'],
    jointColour: '#d5d0c0',
  },
  'play-bark': {
    palette: ['#c09a6c', '#cba777', '#b28d60', '#c5a070'],
    jointColour: '#b59063',
  },
  'slate-chippings': {
    palette: ['#7f8489', '#8d9298', '#71767b', '#868b91'],
    jointColour: '#7b8085',
  },

  /* ---- structure ---- */
  softwood: {
    palette: ['#c8b394', '#d1bd9f', '#bfa989', '#cbb798'],
    jointColour: '#8a7658',
  },
  'painted-timber': {
    palette: ['#d5c6ae', '#dccfb9', '#cbbca3', '#d8cab2'],
    jointColour: '#9c8f78',
  },
  hardwood: {
    palette: ['#b89a72', '#c2a67e', '#ac8e67', '#bda077'],
    jointColour: '#7d6446',
  },
};

/**
 * Everything the renderer needs about a material, in one object.
 *
 * The two halves are stored apart — product geometry in the shared package, tones here — but the
 * renderer takes them together, so this is where they are joined. Splitting storage and joining at
 * the point of use keeps both files honest about what they are for without making the renderer
 * reach into two catalogues.
 */
