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
   *
   * ## The value ladder, and why these numbers moved
   *
   * These palettes were all written to be "a nice green", and the result was that they were all
   * the *same* nice green: turf, ground cover, mixed border and ornamental grasses sat inside one
   * narrow band of lightness, and shrubs and hedging sat inside another that overlapped it. Six
   * materials, two clusters, no hierarchy — which is why a generated plan read as one carpet of
   * vegetation with a lawn cut out of it rather than as a garden with layers.
   *
   * They are now a deliberate ladder, light to dark:
   *
   * ```
   *   lighter │ ornamental-grasses   buff, and separated by HUE as well as value —
   *           │                      a grass really is straw-coloured, and hue is the
   *           │                      one axis nothing else in the garden is using
   *           │ standard-turf        light, cool, flat, almost no spread
   *           │ wildflower           light ground, strong flower accents
   *           │ ground-cover         clearly below the lawn it abuts
   *           │ mixed-border         mid, warm, the WIDEST spread on purpose
   *           │ shrubs               darker, denser, tighter spread
   *   darker  │ hedging              darkest, tightest — a clipped mass is one body
   * ```
   *
   * The gaps matter more than the absolute values: adjacent rows are far enough apart to survive
   * being tinted into a photograph at `SPRITE_TINT`, which is where these tones actually reach the
   * pixels. Before that tint existed, retuning this file could not have fixed any of it — the
   * sprite path ignored the palette entirely.
   */
  'mixed-border': {
    palette: ['#6f9c58', '#87b06d', '#5c8a48', '#8d7a99', '#9cb474'],
    jointColour: '#8a7963',
  },
  shrubs: {
    palette: ['#547e46', '#628f52', '#48703c', '#6d9a5c'],
    jointColour: '#8a7963',
  },
  /*
   * The one planting that leaves green. Ornamental grasses read as pale straw from above, and
   * saying so in hue rather than in value is what finally separated them from turf — they had been
   * *lighter* than the lawn and still the same colour, which made a bed of grasses look like a
   * patch of unusually bright lawn rather than like a different plant.
   */
  'ornamental-grasses': {
    palette: ['#c3c495', '#cfcda4', '#b5b684', '#d8d4b2'],
    jointColour: '#8a7963',
  },
  hedging: {
    palette: ['#3f6437', '#4a7340', '#365a30', '#537e47'],
    jointColour: '#2f4a2a',
  },
  'ground-cover': {
    palette: ['#7ba169', '#88ad76', '#6d9459', '#93b881'],
    jointColour: '#7d8f6c',
  },

  /* ---- gravel-mulch: background from the middle of the palette, as above ---- */
  /*
   * ## Why these spreads widened
   *
   * Every aggregate was written as four tones inside about a ±8% band, which is roughly true of a
   * *single* chipping and quite wrong about a barrow of them. The visible cost was at plan zoom:
   * once the units are drawn flat rather than lit, a tight palette makes a bark bed and a slate bed
   * two flat rectangles of colour, and the thing that says "this is loose material" — that no two
   * pieces are the same — never appears at the scale the garden is actually read at.
   *
   * Roughly ±18% now. Still inside one family, because that is the rule these palettes were
   * written under and it is right: an aggregate's ground is drawn from the middle of its *own*
   * tones, so a contrasting ground would read as gravel scattered on mud rather than as a body of
   * gravel. `palette.test.ts` pins that.
   */
  'bark-mulch': {
    palette: ['#8f6c46', '#a8845c', '#c19a6f', '#7d5d3c', '#b28f66'],
    jointColour: '#9d7c56',
  },
  'decorative-gravel': {
    palette: ['#cbc5b3', '#ddd8ca', '#eeeade', '#bdb7a4', '#d8d2c2'],
    jointColour: '#d5d0c0',
  },
  'play-bark': {
    palette: ['#a87f52', '#c09a6c', '#d6b287', '#986f45', '#c9a577'],
    jointColour: '#b59063',
  },
  /*
   * Darker and greyer than they were. At the old blue-grey a bed of slate chippings read as a
   * pool of water on the plan — which is a real confusion between two materials that are both
   * flat, cool and mid-toned, and the more so once every water material got its own surface
   * treatment and slate did not.
   */
  'slate-chippings': {
    palette: ['#55585d', '#666a6f', '#787c82', '#474a4e', '#6f7278'],
    jointColour: '#5f6367',
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
