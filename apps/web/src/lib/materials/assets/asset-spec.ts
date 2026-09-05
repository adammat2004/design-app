/**
 * What the plan's textures and sprites are — the one hand-written list.
 *
 * The images themselves are generated once, offline, by `tools/assets` (an image model behind one
 * function, with a key) and checked in under `apps/web/public/assets/`. The app never calls a
 * model: at runtime an asset is a file, and a missing file means the painter draws what it drew
 * before this existed. That is what keeps `pnpm dev` and the whole test suite working with no key,
 * which they have to — this gets handed to a marker.
 *
 * Presentation, so it lives here rather than in `packages/schema`, on the same seam `tones.ts`
 * sits on. Nothing in here is geometry: a sprite's `metres` is the *natural* size it is drawn at,
 * and the element's rect or radius is always the geometry of record. A sprite is fitted inside
 * that, never the other way round.
 *
 * Three kinds:
 *
 * - `face` — one module's surface: a slab, a tile, a run of wood grain. Painted per module by the
 *   grid/board painter, tinted to the palette tone the module already had, so slab counts, joints
 *   and courses are exactly what they were.
 * - `texture` — a seamless tile of a mass: gravel, turf, bark, water. Tiled in pattern space from
 *   the plan origin, so two abutting surfaces line up at the seam for the reason modules do.
 * - `sprite` — one thing, from above, on a transparent ground: a shrub, a tree canopy, a dining
 *   set. Placed by the seeded scatter (planting) or by an element's symbol (furniture).
 *
 * The prompts are here because they *are* the specification of the asset — the sentence that says
 * what a "shrub-1" is. Regenerating with a better model is re-running the tool; nothing else moves.
 */

export type AssetKind = 'texture' | 'face' | 'sprite';

/**
 * What sort of thing an asset is, so a consumer can *ask* for one instead of naming it.
 *
 * This is the change that makes hundreds of assets tractable. Every material's sprites used to be
 * a hand-written list of family ids in `MATERIAL_ASSETS`, so adding one perennial meant editing
 * that table — and forgetting to meant generating an asset the app never drew. With a taxon, a
 * mixed border asks for *perennials* and every family that says it is one joins automatically.
 *
 * Deliberately **not** applied to everything. A face and a texture resolve one-to-one — the
 * photograph of a porcelain tile is the photograph of that product, and letting `porcelain` pick up
 * a limestone face by family resemblance would be worse than a lookup table, not better. The query
 * exists where the answer is genuinely open-ended, which is vegetation: that is where the hundreds
 * of assets will land, and it is what the planting engine needs.
 *
 * `group` is coarse and closed; `type` is the useful axis and is a free string so a new kind of
 * plant needs no enum edit; `tags` are what a query narrows on.
 */
export type AssetGroup =
  | 'vegetation'
  | 'structure'
  | 'furniture'
  | 'feature'
  | 'architectural'
  | 'surface'
  | 'effect';

export interface AssetTaxon {
  group: AssetGroup;
  /** 'tree-deciduous', 'shrub', 'grass-ornamental', 'dining-set', 'paving-stone'… */
  type: string;
  /** 'evergreen', 'flowering', 'architectural', 'spring'… Queried against, never displayed. */
  tags?: readonly string[];
}

export interface AssetFamily {
  kind: AssetKind;
  /**
   * What this is, for a query to match against. Required rather than optional, so classifying a
   * new family is a compile error rather than something to remember — the same reason
   * `CATEGORY_HEIGHTS` is total.
   */
  taxon: AssetTaxon;
  /**
   * Where the thing actually stands within its own frame, as a fraction of the image, when that is
   * not the centre.
   *
   * Absent means centred, which is what every sprite generated so far is — the prompt says
   * "centred and filling the frame". It exists for the things that are coming: a tree whose trunk
   * is off to one side of a leaning canopy, a bench seen from above whose seat is not its centroid.
   */
  anchor?: { x: number; y: number };
  /**
   * Whether this asset may be carried towards a material's palette.
   *
   * Plant sprites and mass textures are — that is how `MATERIAL_TONES` reaches the pixels at all,
   * and without it a hedge, a shrub bed and a ground cover are three photographs of the same green.
   * A piece of furniture is not: tinting a teak dining set towards a planting palette would make it
   * green. Absent means not recolourable, so the safe answer is the default.
   */
  recolourable?: boolean;
  /**
   * Real-world size of one image, in metres.
   *
   * For a texture, the ground one tile covers. For a sprite, its natural footprint. For a face it
   * is informational only — a face is stretched to whatever module the manifest quotes.
   */
  metres: { w: number; h: number };
  /** Output size, pixels. Generated larger and downsampled. */
  sizePx: { w: number; h: number };
  /** How many variants to generate. Files are `<id>-<n>.webp`, 1-based. */
  variants: number;
  /** Transparent background. Sprites only. */
  transparent: boolean;
  prompt: string;
  /** Not generated by a model; the tool draws it itself. The soft shadow disc, for one. */
  procedural?: 'soft-shadow';
}

/* ---------------------------------------------------------------- prompt fragments */

const FACE =
  'Photorealistic close-up photograph of the surface, shot from directly above, filling the entire ' +
  'frame edge to edge with no border, no joints, no gaps and no neighbouring pieces visible. Flat, ' +
  'even, diffuse daylight, no shadows, no highlights, no vignetting, no perspective.';

const TILE =
  'Seamless tileable photorealistic texture, shot from directly above at a fixed distance, evenly ' +
  'lit by soft diffuse daylight with no shadows, no highlights, no vignetting and no perspective. ' +
  'The pattern repeats without any visible edge.';

const SPRITE =
  'Photorealistic top-down orthographic view from directly above, as seen on an architectural ' +
  'landscape plan. Soft even daylight, no cast shadow on the ground, no ground visible, no ' +
  'background — the object isolated on a fully transparent background, centred and filling the frame.';

const PLANT = `${SPRITE} A single plant, its foliage seen from above.`;

/**
 * What a plant sprite has to be, now that the palette reaches it.
 *
 * Phases B and C established that a material's tones only touch a photograph through a
 * *proportional multiply* — `SPRITE_TINT` for a plant, `MASS_TEXTURE_TINT` for an aggregate. That
 * changes what to ask a model for, and it is worth stating rather than discovering again:
 *
 * - **Neutral and mid-toned.** A strongly-coloured photograph fights the tint instead of taking
 *   it, so `hedging` and `ground-cover` end up the same green however far apart their palettes are.
 *   The sprite supplies the *form*; the palette supplies the colour.
 * - **Evenly lit, no strong shading.** A multiply darkens what is already dark, so a photograph
 *   with its own deep shadows goes muddy exactly where the tint is strongest.
 * - **A clean alpha edge.** The tint is applied `source-atop`, so a soft edge tints in proportion
 *   to its opacity — which is right — but a matte-white halo tints to a coloured halo.
 *
 * Appended to the plant prompts rather than folded into `SPRITE`, because furniture wants the
 * opposite: it is never recoloured, so it should keep its own real colour.
 */
const TINTABLE =
  ' Neutral, mid-toned, desaturated foliage with even soft lighting and no deep shadows or bright ' +
  'highlights, so the plan can tint it. Clean cut-out edges with no white fringe.';

/* ---------------------------------------------------------------- the families */

export const ASSET_FAMILIES = {
  /* ---- faces: one module each ---- */
  'face-stone-paver': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-stone', tags: ['sandstone', 'riven'] },
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 4,
    transparent: false,
    prompt: `${FACE} A single riven natural sandstone paving slab, pale grey-buff with subtle warm veining and a gently uneven surface.`,
  },
  'face-concrete-slab': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-concrete', tags: ['cast'] },
    metres: { w: 0.9, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: false,
    prompt: `${FACE} A single smooth pressed concrete paving slab, light grey with a fine even speckle.`,
  },
  'face-porcelain-tile': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-porcelain', tags: ['manufactured'] },
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} A single large-format outdoor porcelain tile, very pale warm grey, almost uniform with faint stone-effect mottling.`,
  },
  'face-stepping-stone': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-stone', tags: ['pad'] },
    metres: { w: 0.45, h: 0.45 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: false,
    prompt: `${FACE} A single square natural sandstone stepping stone, grey-buff, slightly weathered.`,
  },
  'face-decking-wood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['decking'] },
    metres: { w: 3.6, h: 0.145 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} Warm honey-brown softwood decking timber, the grain running exactly left to right across the frame, with fine parallel grooves. No board edges visible.`,
  },
  'face-softwood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['softwood'] },
    metres: { w: 2.4, h: 0.12 },
    sizePx: { w: 1024, h: 683 },
    variants: 1,
    transparent: false,
    prompt: `${FACE} Pale pressure-treated softwood timber, the grain running exactly left to right across the frame. No board edges visible.`,
  },
  'face-hardwood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['hardwood'] },
    metres: { w: 3, h: 0.13 },
    sizePx: { w: 1024, h: 683 },
    variants: 1,
    transparent: false,
    prompt: `${FACE} Rich mid-brown oiled hardwood timber, the grain running exactly left to right across the frame. No board edges visible.`,
  },
  'face-painted-timber': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['painted'] },
    metres: { w: 2.4, h: 0.14 },
    sizePx: { w: 1024, h: 683 },
    variants: 1,
    transparent: false,
    prompt: `${FACE} Timber painted a soft pale sage-grey, the grain faintly showing through and running exactly left to right across the frame. No board edges visible.`,
  },

  /* ---- textures: seamless tiles ---- */
  'tex-gravel-paving': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'aggregate', tags: ['gravel', 'self-binding'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Compacted pea gravel path surface, small rounded pale buff and grey stones about 10 to 20 mm across, tightly packed.`,
  },
  'tex-decorative-gravel': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'aggregate', tags: ['gravel', 'decorative'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Decorative garden gravel, mixed cream, white and pale grey angular stones about 20 mm across, loosely laid.`,
  },
  'tex-slate-chippings': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'aggregate', tags: ['slate'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Blue-grey slate chippings, flat angular pieces about 40 mm across, loosely laid on a garden bed.`,
  },
  'tex-bark-mulch': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'aggregate', tags: ['bark', 'mulch'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Ornamental bark mulch on a garden border, warm brown shredded bark pieces of mixed size.`,
  },
  'tex-play-bark': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'aggregate', tags: ['bark', 'play'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Play-grade bark chippings, light golden-brown, rounded even pieces about 30 mm across.`,
  },
  'tex-standard-turf': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'turf', tags: ['mown'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} A freshly mown healthy lawn, fine mid-green grass blades, seen from directly above.`,
  },
  'tex-hardwearing-turf': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'turf', tags: ['mown', 'hardwearing'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} A hard-wearing family lawn, slightly coarser darker green grass with the odd broader blade, seen from directly above.`,
  },
  'tex-artificial-turf': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'turf', tags: ['artificial'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Artificial turf, very uniform bright green synthetic grass pile with a slight sheen, seen from directly above.`,
  },
  'tex-meadow-grass': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'turf', tags: ['meadow', 'long'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Long unmown meadow grass, mixed greens and straw tones, seen from directly above.`,
  },
  'tex-soil': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'soil', tags: ['bare'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} Dark crumbly garden topsoil, freshly raked, seen from directly above.`,
  },
  'tex-pond-water': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'water', tags: ['pond', 'planted'] },
    recolourable: true,
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} The surface of a still garden pond seen from directly above, deep green-teal water with gentle ripples and faint sky reflection, no plants, no fish.`,
  },
  'tex-pool-water': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'water', tags: ['pool', 'reflective'] },
    recolourable: true,
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} The surface of a formal reflecting pool seen from directly above, calm slate-blue water with soft caustic light patterns, no edges.`,
  },
  'tex-hedge-top': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'hedge-mass', tags: ['evergreen', 'clipped'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} The top of a dense clipped evergreen hedge, small dark green leaves tightly packed, seen from directly above.`,
  },
  'tex-house-floor': {
    kind: 'texture',
    taxon: { group: 'architectural', type: 'floor', tags: ['timber'] },
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${TILE} A pale oak engineered timber floor, wide boards running exactly top to bottom of the frame, seen from directly above.`,
  },

  /* ---- planting sprites ---- */
  'plant-perennial': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['mounded'] },
    recolourable: true,
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 256, h: 256 },
    variants: 6,
    transparent: true,
    prompt: `${PLANT} A flowering herbaceous perennial about sixty centimetres across, foliage with flowers showing on top. Each variant a different plant: lavender, salvia, geranium, echinacea, nepeta, alchemilla.`,
  },
  'plant-shrub': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['evergreen', 'mounded'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 256, h: 256 },
    variants: 6,
    transparent: true,
    prompt: `${PLANT} A rounded garden shrub about a metre across, mid-green foliage with natural variation and a slightly irregular outline. Each variant a different species: pittosporum, choisya, viburnum, hebe, euonymus, cornus.`,
  },
  'plant-ground-cover': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'ground-cover', tags: ['mat'] },
    recolourable: true,
    metres: { w: 0.4, h: 0.4 },
    sizePx: { w: 256, h: 256 },
    variants: 4,
    transparent: true,
    prompt: `${PLANT} A low spreading ground-cover plant about forty centimetres across, small dense leaves. Each variant different: vinca, ajuga, heuchera, pachysandra.`,
  },
  'plant-grass': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'grass-ornamental', tags: ['tufted'] },
    recolourable: true,
    metres: { w: 0.5, h: 0.5 },
    sizePx: { w: 256, h: 256 },
    variants: 5,
    transparent: true,
    prompt: `${PLANT} An ornamental grass about half a metre across, a rosette of fine arching blades radiating from the centre, pale green to straw. Each variant different: stipa, festuca, miscanthus, carex, pennisetum.`,
  },
  'plant-flower': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'flower', tags: ['accent'] },
    metres: { w: 0.3, h: 0.3 },
    sizePx: { w: 128, h: 128 },
    variants: 4,
    transparent: true,
    prompt: `${PLANT} A small cluster of wildflowers about thirty centimetres across, seen from above. Each variant a different colour: white ox-eye daisies, yellow buttercups, purple knapweed, red poppies.`,
  },
  'tree-canopy': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['broadleaf'] },
    recolourable: true,
    metres: { w: 4, h: 4 },
    sizePx: { w: 512, h: 512 },
    variants: 6,
    transparent: true,
    prompt: `${SPRITE} The canopy of a single deciduous garden tree seen from directly above, a roughly round leafy crown with an irregular lobed outline and visible depth in the foliage. Each variant a different tree: birch, rowan, crab apple, acer, amelanchier, cherry.`,
  },
  'tree-conifer': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-evergreen', tags: ['conifer'] },
    recolourable: true,
    metres: { w: 3, h: 3 },
    sizePx: { w: 512, h: 512 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} The crown of a single conifer seen from directly above, dense dark green needled foliage radiating from the centre in a near-circular outline.`,
  },

  /* ---- furniture and equipment sprites ---- */
  'furniture-dining-4': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'dining-set', tags: ['seats-4'] },
    metres: { w: 2.4, h: 2.4 },
    sizePx: { w: 512, h: 512 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} An outdoor dining set: a square table with four chairs, one on each side. Variant one in teak wood, variant two in dark grey aluminium with pale cushions.`,
  },
  'furniture-dining-6': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'dining-set', tags: ['seats-6'] },
    metres: { w: 3.2, h: 2.4 },
    sizePx: { w: 512, h: 384 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} An outdoor dining set: a long rectangular teak table, three chairs along each long side, the table running left to right.`,
  },
  'furniture-sofa-set': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'lounge-set' },
    metres: { w: 3, h: 2.4 },
    sizePx: { w: 512, h: 410 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} An outdoor lounge set: an L-shaped corner sofa with pale grey cushions and a low square coffee table in the corner it makes. Variant one in grey rattan, variant two in teak.`,
  },
  'furniture-lounger': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'lounger' },
    metres: { w: 0.7, h: 1.9 },
    sizePx: { w: 256, h: 512 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} A single sun lounger, its length running top to bottom of the frame. Variant one teak with a white cushion, variant two grey rattan with a taupe cushion.`,
  },
  'furniture-bbq': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'bbq' },
    metres: { w: 1.4, h: 0.7 },
    sizePx: { w: 512, h: 256 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} An outdoor kitchen unit with a built-in barbecue: a stainless steel grill with a worktop either side, the unit running left to right.`,
  },
  'furniture-fire-pit': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'fire-pit' },
    metres: { w: 1.2, h: 1.2 },
    sizePx: { w: 256, h: 256 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} A round steel fire pit bowl with a small fire burning in it, glowing embers and a little flame, seen from directly above.`,
  },
  'furniture-bench': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'bench' },
    metres: { w: 1.6, h: 0.6 },
    sizePx: { w: 512, h: 192 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} A slatted teak garden bench, running left to right, seen from directly above.`,
  },
  'furniture-parasol': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'parasol' },
    metres: { w: 2.7, h: 2.7 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} An open octagonal garden parasol in natural canvas, seen from directly above.`,
  },
  'furniture-planter': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'planter' },
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 256, h: 256 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} A square planter with a plant in it, seen from directly above. Variant one a corten steel planter with a clipped box ball, variant two a pale stone planter with an agapanthus.`,
  },
  'play-swing': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['swing'] },
    metres: { w: 3, h: 2 },
    sizePx: { w: 512, h: 342 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} A timber garden swing frame with two swing seats, the top beam running left to right, seen from directly above.`,
  },
  'play-slide': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['slide'] },
    metres: { w: 1.2, h: 2.6 },
    sizePx: { w: 256, h: 555 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} A small children's garden slide with a timber platform at the top of the frame and a green slide running down to the bottom, seen from directly above.`,
  },
  'play-trampoline': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['trampoline'] },
    metres: { w: 3, h: 3 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} A round garden trampoline with a black mat, blue padded edge and a safety net, seen from directly above.`,
  },
  'play-raised-bed': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'raised-bed', tags: ['vegetable'] },
    metres: { w: 2, h: 1 },
    sizePx: { w: 512, h: 256 },
    variants: 1,
    transparent: true,
    prompt: `${SPRITE} A rectangular timber raised vegetable bed running left to right, filled with rows of leafy vegetables, seen from directly above.`,
  },


  /* ================================================================ Phase D additions
   *
   * **Appended, never inserted.** A material's sprites are resolved by query and returned in
   * manifest order, and the scatter picks from that list by index — so where a family sits decides
   * what gets drawn. Inserting into the middle of a group shifts every family after it and changes
   * materials that have nothing to do with the one being added; appending confines the change to
   * the group that grew. It does *not* leave existing plans untouched — see `taxonomy.ts` on why
   * that is unavoidable and why it is the right trade.
   *
   * Sized as the plant's real mature spread, because `TaxonQuery.minMetres` filters on it and the
   * planting engine's height bands will key off it.
   * ================================================================ */

  /* ---- perennials: the mass and mid layers of a border ---- */
  'plant-perennial-upright': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['upright'] },
    recolourable: true,
    metres: { w: 0.5, h: 0.5 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} An upright herbaceous perennial about half a metre across, narrow leaves rising from a tight clump so the crown reads as a star from above. Each variant a different plant: veronicastrum, agastache, persicaria.${TINTABLE}`,
  },
  'plant-perennial-spire': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['spire', 'flowering'] },
    recolourable: true,
    metres: { w: 0.45, h: 0.45 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} A spire-forming perennial about forty-five centimetres across, a basal rosette of leaves with one or two flower spikes foreshortened to short bright bars from directly above. Each variant a different plant: digitalis, lupin, delphinium.${TINTABLE}`,
  },
  'plant-perennial-ferny': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['ferny', 'shade'] },
    recolourable: true,
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} A finely divided ferny perennial about sixty centimetres across, feathery fronds radiating outward with visible gaps between them. Each variant a different plant: dryopteris fern, astilbe, achillea.${TINTABLE}`,
  },

  /* ---- shrubs: the backdrop and structure layers ---- */
  'plant-shrub-architectural': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['architectural', 'evergreen'] },
    recolourable: true,
    metres: { w: 1.1, h: 1.1 },
    sizePx: { w: 640, h: 640 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} An architectural evergreen shrub about a metre across with a strong bold outline of few large leaves, so the shape reads clearly from above. Each variant a different plant: fatsia, phormium, yucca.${TINTABLE}`,
  },
  'plant-shrub-deciduous': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['deciduous', 'flowering'] },
    recolourable: true,
    metres: { w: 1.3, h: 1.3 },
    sizePx: { w: 640, h: 640 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} A deciduous garden shrub about one and a third metres across, looser and more open than an evergreen with visible gaps between the branches. Each variant a different species: philadelphus, weigela, hydrangea.${TINTABLE}`,
  },

  /* ---- grasses: the axis that separates a grass from a shrub ---- */
  'plant-grass-tall': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'grass-ornamental', tags: ['tall', 'upright'] },
    recolourable: true,
    metres: { w: 0.8, h: 0.8 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} A tall upright ornamental grass about eighty centimetres across, seen from directly above as a dense radiating burst of narrow blades. Each variant a different grass: calamagrostis, molinia, panicum.${TINTABLE}`,
  },

  /* ---- ground cover ---- */
  'plant-ground-cover-spreading': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'ground-cover', tags: ['spreading'] },
    recolourable: true,
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${PLANT} A spreading ground-cover plant about sixty centimetres across, irregular and loosely trailing at the edges rather than a tidy mound. Each variant different: geranium macrorrhizum, epimedium, lamium.${TINTABLE}`,
  },

  /* ---- trees: one canopy for every tree in every plan is the gap this closes ---- */
  'tree-ornamental': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['ornamental', 'blossom'] },
    recolourable: true,
    metres: { w: 4, h: 4 },
    sizePx: { w: 768, h: 768 },
    variants: 3,
    transparent: true,
    prompt: `${SPRITE} The canopy of a small ornamental tree about four metres across, seen from directly above, with a lighter more open crown than a forest tree. Each variant a different tree: flowering cherry, crab apple, amelanchier.${TINTABLE}`,
  },
  'tree-multistem': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['multi-stem'] },
    recolourable: true,
    metres: { w: 3.5, h: 3.5 },
    sizePx: { w: 768, h: 768 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} The canopy of a multi-stemmed small tree about three and a half metres across, seen from directly above as several overlapping crowns rising from one clump. Each variant a different tree: birch, amelanchier.${TINTABLE}`,
  },
  'tree-fruit': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['fruit'] },
    recolourable: true,
    metres: { w: 3, h: 3 },
    sizePx: { w: 768, h: 768 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} The canopy of a trained fruit tree about three metres across, seen from directly above, rounded and fairly dense. Each variant a different tree: apple, pear.${TINTABLE}`,
  },

  /* ---- hedge crowns: the units the boundary and garden hedge runs place ---- */
  'hedge-crown-beech': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'hedge-crown', tags: ['deciduous', 'beech'] },
    recolourable: true,
    metres: { w: 0.7, h: 0.7 },
    sizePx: { w: 384, h: 384 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} A short length of clipped beech hedge seen from directly above, a dense flat mass of small leaves filling a rounded square, with a crisp clipped edge.${TINTABLE}`,
  },
  'hedge-crown-yew': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'hedge-crown', tags: ['evergreen', 'yew'] },
    recolourable: true,
    metres: { w: 0.7, h: 0.7 },
    sizePx: { w: 384, h: 384 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} A short length of clipped yew hedge seen from directly above, a very dense dark mass of fine needles filling a rounded square, with a crisp clipped edge.${TINTABLE}`,
  },

  /* ---- drawn by the tool, not by a model ---- */
  'fx-soft-shadow': {
    kind: 'sprite',
    taxon: { group: 'effect', type: 'contact-shadow' },
    metres: { w: 1, h: 1 },
    sizePx: { w: 256, h: 256 },
    variants: 1,
    transparent: true,
    prompt: 'A radial soft black disc, opaque at the centre and fully transparent at the edge.',
    procedural: 'soft-shadow',
  },
} as const satisfies Record<string, AssetFamily>;

export type AssetId = keyof typeof ASSET_FAMILIES;

export const ASSET_IDS = Object.keys(ASSET_FAMILIES) as AssetId[];

/** The file an asset variant is written to, relative to `public/assets/`. */
export function assetFile(id: AssetId, variant: number): string {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const dir = family.kind === 'sprite' ? 'sprites' : 'textures';
  return `${dir}/${id}-${variant}.webp`;
}
