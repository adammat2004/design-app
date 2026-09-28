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
 * The subjects are here because they *are* the specification of the asset — the sentence that says
 * what a "shrub-1" is. Everything the sentence does not say — the camera, the light, the background,
 * the framing — is `asset-style.ts`, and `composePrompt` joins the two. Regenerating with a better
 * model is re-running the tool; nothing else moves.
 *
 * **Regenerate in place; append, never insert or remove.** A material's sprites are resolved by
 * query and returned in manifest order, and the scatter picks from that list by index — so a
 * family added or removed changes which photograph every saved bed draws (see
 * `taxonomy.ts` on why that is unavoidable and acceptable). Replacing the *files* under an existing
 * id changes nothing but the picture, which is what a library upgrade is meant to change. New
 * families go at the end of their group.
 */

import type { AssetTemplate } from './asset-style';
import type { AssetRenderQuality } from './quality';

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
  'vegetation' | 'structure' | 'furniture' | 'feature' | 'architectural' | 'surface' | 'effect';

export interface AssetTaxon {
  group: AssetGroup;
  /** 'tree-deciduous', 'shrub', 'grass-ornamental', 'dining-set', 'paving-stone'… */
  type: string;
  /** 'evergreen', 'flowering', 'architectural', 'spring'… Queried against, never displayed. */
  tags?: readonly string[];
}

export interface AssetFamily {
  /**
   * Renderer-only transform policy, spread over `assetQuality`'s derived defaults: may this be
   * quarter-turned or mirrored to break a tiling grid, should it be desaturated at draw time.
   * Stated on the family because a policy about a family belongs on the family — there used to be
   * a set of texture ids in the renderer that said the same thing from the wrong side.
   */
  render?: Partial<AssetRenderQuality>;
  /**
   * A correction the tool bakes into the file at processing time, from the raw. Distinct from
   * `render`, which the renderer applies at draw time: a baked correction fixes the plan, the
   * cards and the export at once and is applied exactly once however many surfaces overlap, which
   * is why it is the right home for "this family is over-saturated at source". Textures only.
   */
  correction?: { saturation?: number };
  kind: AssetKind;
  /**
   * What this is, for a query to match against. Required rather than optional, so classifying a
   * new family is a compile error rather than something to remember — the same reason
   * `CATEGORY_HEIGHTS` is total.
   */
  taxon: AssetTaxon;
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
  /**
   * Which `asset-style.ts` template this family is drawn with: the camera, the light and the
   * framing for its kind of subject. Explicit rather than derived from `kind` and `taxon`, because
   * a planter and a fire pit are both `feature` and only the author knows which framing is right.
   */
  template: AssetTemplate;
  /**
   * The object-specific description — the one sentence a family author writes. What the thing is,
   * its size in words, what distinguishes it. Never the camera, the light or the background: those
   * are the template's, and a subject that restates them can only disagree with it.
   */
  subject: string;
  /**
   * What each variant *is*, one phrase per variant, when the variants are different things — a
   * species, a finish, a cultivar — rather than different draws of the same thing. Length must equal
   * `variants`. Absent, the variants are asked to differ in arrangement and detail, which is enough
   * for a paving slab and not for a shrub.
   */
  variantSubjects?: readonly string[];
  /** Not generated by a model; the tool draws it itself. The soft shadow disc, for one. */
  procedural?: 'soft-shadow' | 'light-pool';
}

/* ---------------------------------------------------------------- the families
 *
 * The camera, the light, the background and the framing are `asset-style.ts` — one template per
 * kind of subject, versioned. A family names its template and writes its subject; `composePrompt`
 * joins them. Nothing about the shared visual system is stated in this file.
 */

export const ASSET_FAMILIES = {
  /* ---- faces: one module each ---- */
  'face-stone-paver': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-stone', tags: ['sandstone', 'riven'] },
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 4,
    transparent: false,
    template: 'face',
    subject:
      'A single riven natural sandstone paving slab, pale grey-buff with subtle warm veining and a gently uneven surface.',
  },
  'face-concrete-slab': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-concrete', tags: ['cast'] },
    metres: { w: 0.9, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: false,
    template: 'face',
    subject: 'A single smooth pressed concrete paving slab, light grey with a fine even speckle.',
  },
  'face-porcelain-tile': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-porcelain', tags: ['manufactured'] },
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'A single large-format outdoor porcelain tile, very pale warm grey, almost uniform with faint stone-effect mottling.',
  },
  /*
   * The gap that was open longest, and the least excusable one: `stone-setts` is what
   * `circulationFor` hands every access route and what `front.ts` forces on every front path, so a
   * sett was the most-drawn paving in the app and the only one with no photograph behind it.
   *
   * Quoted at the module the manifest quotes — 300 mm — rather than at a single 100 mm sett,
   * because a face fills whatever module `MATERIAL_PATTERNS` names and that entry is a 300 mm grid.
   * So the picture has to be the group of nine, joints and all, not one stone.
   */
  'face-stone-setts': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-sett', tags: ['granite', 'cropped'] },
    metres: { w: 0.3, h: 0.3 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: false,
    template: 'face',
    subject:
      'A block of nine small cropped granite setts laid square in a three-by-three grid, mid grey with subtle blue and warm flecks, each sett slightly domed and tumbled, the narrow sand joints between them part of the picture.',
  },
  /* ---- edging and walling: the products sold by the metre ---- */
  /*
   * Quoted at the **module the manifest quotes**, not at the run. A face is stretched to whatever
   * `MATERIAL_PATTERNS` names, so `face-edging-brick` has to be one brick seen from above — the
   * painter lays the course. Getting this wrong is how a face ends up drawing a course of courses.
   */
  'face-edging-brick': {
    kind: 'face',
    taxon: { group: 'surface', type: 'brick', tags: ['clay', 'edging', 'walling'] },
    metres: { w: 0.102, h: 0.215 },
    sizePx: { w: 256, h: 512 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'The top face of a single clay stock brick, warm red-brown with a slightly sandy weathered texture and faint colour variation. One brick only, no mortar and no neighbouring bricks.',
  },
  'face-kerb-concrete': {
    kind: 'face',
    taxon: { group: 'surface', type: 'kerb', tags: ['concrete', 'edging'] },
    metres: { w: 0.45, h: 0.15 },
    sizePx: { w: 768, h: 256 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'The top face of a single pressed concrete garden kerb, light grey with a fine even aggregate speckle and slightly softened arrises. One unit only, no joints visible.',
  },
  'face-edging-setts': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-sett', tags: ['granite', 'edging'] },
    metres: { w: 0.1, h: 0.1 },
    sizePx: { w: 256, h: 256 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'The top face of a single small cropped granite sett, mid grey with blue and warm flecks and a tumbled, slightly domed surface. One sett only, filling the frame, no joints.',
  },
  'face-sleeper-timber': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['sleeper', 'edging', 'walling'] },
    metres: { w: 2.4, h: 0.2 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'Sawn softwood railway-sleeper timber, the grain running exactly left to right across the frame, coarse and slightly weathered grey-brown with saw marks. No board edges visible.',
  },
  /*
   * The one face that is walling rather than edging, and the only one that is not a single unit:
   * a retaining wall seen from above is the *top course*, so the coursing and its joints are the
   * picture. Quoted at the module `walling-stone` names.
   */
  'face-walling-stone': {
    kind: 'face',
    taxon: { group: 'surface', type: 'walling', tags: ['stone', 'coursed', 'retaining'] },
    metres: { w: 0.3, h: 0.1 },
    sizePx: { w: 768, h: 256 },
    variants: 3,
    transparent: false,
    template: 'face',
    subject:
      'The top face of a single block of coursed natural walling stone, buff-grey sandstone with a slightly riven surface and weathered edges. One block only, no mortar and no neighbouring blocks.',
  },
  'face-stepping-stone': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-stone', tags: ['pad'] },
    metres: { w: 0.45, h: 0.45 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: false,
    template: 'face',
    subject: 'A single square natural sandstone stepping stone, grey-buff, slightly weathered.',
  },
  'face-decking-wood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['decking'] },
    metres: { w: 3.6, h: 0.145 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'Warm honey-brown softwood decking timber, the grain running exactly left to right across the frame, with fine parallel grooves. No board edges visible.',
  },
  'face-softwood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['softwood'] },
    metres: { w: 2.4, h: 0.12 },
    sizePx: { w: 1024, h: 683 },
    /*
     * Two, because a board face is chosen per board: at one variant a pergola's rafters and a
     * shed's cladding are the identical strip of grain repeated down the whole structure, which is
     * the one thing real timber never looks like.
     */
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'Pale pressure-treated softwood timber, the grain running exactly left to right across the frame. No board edges visible.',
    variantSubjects: ['a straight-grained board', 'a board with visible knots'],
  },
  'face-hardwood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['hardwood'] },
    metres: { w: 3, h: 0.13 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'Rich mid-brown oiled hardwood timber, the grain running exactly left to right across the frame. No board edges visible.',
    variantSubjects: ['a straight-grained board', 'a more figured board'],
  },
  'face-painted-timber': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['painted'] },
    metres: { w: 2.4, h: 0.14 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    template: 'face',
    subject:
      'Timber painted a soft pale sage-grey, the grain faintly showing through and running exactly left to right across the frame. No board edges visible.',
    variantSubjects: ['a freshly painted board', 'a very faintly weathered board'],
  },

  /* ---- textures: seamless tiles ---- */
  /*
   * `render` is the renderer's transform policy for a family. Only an isotropic ground may be
   * quarter-turned and mirrored to break the tiling grid — boards, stripes and anything with baked
   * light may not — and the eight that may say so here rather than in a set the renderer keeps.
   */
  'tex-gravel-paving': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'surface', type: 'aggregate', tags: ['gravel', 'self-binding'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'Compacted pea gravel path surface, small rounded pale buff and grey stones about 10 to 20 mm across, tightly packed.',
  },
  'tex-decorative-gravel': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'surface', type: 'aggregate', tags: ['gravel', 'decorative'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'Decorative garden gravel, mixed cream, white and pale grey angular stones about 20 mm across, loosely laid.',
  },
  'tex-slate-chippings': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'surface', type: 'aggregate', tags: ['slate'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'Blue-grey slate chippings, flat angular pieces about 40 mm across, loosely laid on a garden bed.',
  },
  'tex-bark-mulch': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'surface', type: 'aggregate', tags: ['bark', 'mulch'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'Ornamental bark mulch on a garden border, warm brown shredded bark pieces of mixed size.',
  },
  /*
   * Corrected at source: play bark is the loudest object in any plan that has one, measured at
   * 0.509 against a scene target of 0.334. The renderer used to pull it down at draw time; the
   * tool now bakes the same 0.68 into the file from the raw, which fixes the cards and the export
   * as well and cannot be applied twice where two bark surfaces overlap.
   */
  'tex-play-bark': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    correction: { saturation: 0.68 },
    taxon: { group: 'surface', type: 'aggregate', tags: ['bark', 'play'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'Play-grade bark chippings, light golden-brown, rounded even pieces about 30 mm across.',
  },
  'tex-standard-turf': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'vegetation', type: 'turf', tags: ['mown'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject: 'A freshly mown healthy lawn, fine mid-green grass blades, seen from directly above.',
  },
  'tex-hardwearing-turf': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'vegetation', type: 'turf', tags: ['mown', 'hardwearing'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'A hard-wearing family lawn, slightly coarser darker green grass with the odd broader blade, seen from directly above.',
  },
  'tex-artificial-turf': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'turf', tags: ['artificial'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'Artificial turf, very uniform bright green synthetic grass pile with a slight sheen, seen from directly above.',
  },
  'tex-meadow-grass': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'turf', tags: ['meadow', 'long'] },
    recolourable: true,
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject: 'Long unmown meadow grass, mixed greens and straw tones, seen from directly above.',
  },
  'tex-soil': {
    kind: 'texture',
    render: { rotation: 'quarter-turn', mirror: true },
    taxon: { group: 'surface', type: 'soil', tags: ['bare'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject: 'Dark crumbly garden topsoil, freshly raked, seen from directly above.',
  },
  'tex-pond-water': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'water', tags: ['pond', 'planted'] },
    recolourable: true,
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'The surface of a still garden pond seen from directly above, deep green-teal water with gentle ripples and faint sky reflection, no plants, no fish.',
  },
  'tex-pool-water': {
    kind: 'texture',
    taxon: { group: 'surface', type: 'water', tags: ['pool', 'reflective'] },
    recolourable: true,
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'The surface of a formal reflecting pool seen from directly above, calm slate-blue water with soft caustic light patterns, no edges.',
  },
  'tex-hedge-top': {
    kind: 'texture',
    taxon: { group: 'vegetation', type: 'hedge-mass', tags: ['evergreen', 'clipped'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'The top of a dense clipped evergreen hedge, small dark green leaves tightly packed, seen from directly above.',
  },
  'tex-house-floor': {
    kind: 'texture',
    taxon: { group: 'architectural', type: 'floor', tags: ['timber'] },
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'tile',
    subject:
      'A pale oak engineered timber floor, wide boards running exactly top to bottom of the frame, seen from directly above.',
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
    template: 'plant',
    subject:
      'A flowering herbaceous perennial about sixty centimetres across, foliage with flowers showing on top.',
    variantSubjects: ['lavender', 'salvia', 'geranium', 'echinacea', 'nepeta', 'alchemilla'],
  },
  'plant-shrub': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['evergreen', 'mounded'] },
    recolourable: true,
    metres: { w: 1, h: 1 },
    sizePx: { w: 256, h: 256 },
    variants: 6,
    transparent: true,
    template: 'plant',
    subject:
      'A rounded garden shrub about a metre across, mid-green foliage with natural variation and a slightly irregular outline.',
    variantSubjects: ['pittosporum', 'choisya', 'viburnum', 'hebe', 'euonymus', 'cornus'],
  },
  'plant-ground-cover': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'ground-cover', tags: ['mat'] },
    recolourable: true,
    metres: { w: 0.4, h: 0.4 },
    sizePx: { w: 256, h: 256 },
    variants: 4,
    transparent: true,
    template: 'plant',
    subject:
      'A low spreading ground-cover plant about forty centimetres across, small dense leaves.',
    variantSubjects: ['vinca', 'ajuga', 'heuchera', 'pachysandra'],
  },
  'plant-grass': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'grass-ornamental', tags: ['tufted'] },
    recolourable: true,
    metres: { w: 0.5, h: 0.5 },
    sizePx: { w: 256, h: 256 },
    variants: 5,
    transparent: true,
    template: 'plant',
    subject:
      'An ornamental grass about half a metre across, a rosette of fine arching blades radiating from the centre, pale green to straw.',
    variantSubjects: ['stipa', 'festuca', 'miscanthus', 'carex', 'pennisetum'],
  },
  'plant-flower': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'flower', tags: ['accent'] },
    metres: { w: 0.3, h: 0.3 },
    sizePx: { w: 128, h: 128 },
    variants: 4,
    transparent: true,
    template: 'plant',
    subject: 'A small cluster of wildflowers about thirty centimetres across, seen from above.',
    variantSubjects: [
      'white ox-eye daisies',
      'yellow buttercups',
      'purple knapweed',
      'red poppies',
    ],
  },
  'tree-canopy': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['broadleaf'] },
    recolourable: true,
    metres: { w: 4, h: 4 },
    sizePx: { w: 512, h: 512 },
    variants: 6,
    transparent: true,
    template: 'sprite',
    subject:
      'The canopy of a single deciduous garden tree seen from directly above, a roughly round leafy crown with an irregular lobed outline and visible depth in the foliage.',
    variantSubjects: ['birch', 'rowan', 'crab apple', 'acer', 'amelanchier', 'cherry'],
  },
  'tree-conifer': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-evergreen', tags: ['conifer'] },
    recolourable: true,
    metres: { w: 3, h: 3 },
    sizePx: { w: 512, h: 512 },
    /*
     * Four rather than two. `tree-evergreen` is the only symbol this family answers, so a garden
     * that asks for evergreens draws from this pool alone — at two, a pair of them side by side is
     * visibly the same photograph twice. Note the prompt now names a species per variant where it
     * used to describe one generic conifer: the tool reuses existing raws, so variants 1 and 2 keep
     * the pictures they have and only 3 and 4 are generated. Pass `--force` to redo all four.
     */
    variants: 4,
    transparent: true,
    template: 'sprite',
    subject:
      'The crown of a single conifer seen from directly above, dense dark green needled foliage radiating from the centre in a near-circular outline.',
    variantSubjects: ['pine', 'spruce', 'juniper', 'cedar'],
  },

  /* ---- furniture and equipment sprites ---- */
  'furniture-dining-4': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'dining-set', tags: ['seats-4'] },
    metres: { w: 2.4, h: 2.4 },
    sizePx: { w: 512, h: 512 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject: 'An outdoor dining set: a square table with four chairs, one on each side.',
    variantSubjects: ['a teak wood set', 'a dark grey aluminium set with pale cushions'],
  },
  'furniture-dining-6': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'dining-set', tags: ['seats-6'] },
    metres: { w: 3.2, h: 2.4 },
    sizePx: { w: 512, h: 384 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      'An outdoor dining set: a long rectangular teak table, three chairs along each long side, the table running left to right.',
  },
  'furniture-sofa-set': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'lounge-set' },
    metres: { w: 3, h: 2.4 },
    sizePx: { w: 512, h: 410 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'An outdoor lounge set: an L-shaped corner sofa with pale grey cushions and a low square coffee table in the corner it makes.',
    variantSubjects: ['a grey rattan frame', 'a teak frame'],
  },
  'furniture-lounger': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'lounger' },
    metres: { w: 0.7, h: 1.9 },
    sizePx: { w: 256, h: 512 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject: 'A single sun lounger, its length running top to bottom of the frame.',
    variantSubjects: ['teak with a white cushion', 'grey rattan with a taupe cushion'],
  },
  'furniture-bbq': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'bbq' },
    metres: { w: 1.4, h: 0.7 },
    sizePx: { w: 512, h: 256 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      'An outdoor kitchen unit with a built-in barbecue: a stainless steel grill with a worktop either side, the unit running left to right.',
  },
  'furniture-fire-pit': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'fire-pit' },
    metres: { w: 1.2, h: 1.2 },
    sizePx: { w: 256, h: 256 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      'A round steel fire pit bowl with a small fire burning in it, glowing embers and a little flame, seen from directly above.',
  },
  /*
   * The one *structure* in this library that is photographed rather than drawn.
   *
   * Everything under `symbols/structures.ts` — the shed, the pergola, the garden room, the
   * greenhouse — is whatever rectangle the placer gave it at whatever rotation, so a photograph
   * stretched to fit would put its posts and its ridge in the wrong places. A hot tub is not like
   * that: it is a product, it comes in one size, and 2.4 m square is what the generator places and
   * what the editor offers. So it takes the `furniture-fire-pit` route instead.
   */
  'feature-hot-tub': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'hot-tub' },
    metres: { w: 2.4, h: 2.4 },
    sizePx: { w: 384, h: 384 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'A square outdoor hot tub with its cover off, seen from directly above: a moulded acrylic shell with contoured seats and jets, still clear water with a faint reflection, and a slim dark cabinet surround.',
    variantSubjects: ['grey composite', 'dark timber'],
  },
  'furniture-bench': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'bench' },
    metres: { w: 1.6, h: 0.6 },
    sizePx: { w: 512, h: 192 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject: 'A slatted teak garden bench, running left to right, seen from directly above.',
  },
  'furniture-parasol': {
    kind: 'sprite',
    taxon: { group: 'furniture', type: 'parasol' },
    metres: { w: 2.7, h: 2.7 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject: 'An open octagonal garden parasol in natural canvas, seen from directly above.',
  },
  'furniture-planter': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'planter' },
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 256, h: 256 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject: 'A square planter with a plant in it, seen from directly above.',
    variantSubjects: [
      'a corten steel planter with a clipped box ball',
      'a pale stone planter with an agapanthus',
    ],
  },
  'play-swing': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['swing'] },
    metres: { w: 3, h: 2 },
    sizePx: { w: 512, h: 342 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      'A timber garden swing frame with two swing seats, the top beam running left to right, seen from directly above.',
  },
  'play-slide': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['slide'] },
    metres: { w: 1.2, h: 2.6 },
    sizePx: { w: 256, h: 555 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      "A small children's garden slide with a timber platform at the top of the frame and a green slide running down to the bottom, seen from directly above.",
  },
  'play-trampoline': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['trampoline'] },
    metres: { w: 3, h: 3 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      'A round garden trampoline with a black mat, blue padded edge and a safety net, seen from directly above.',
  },
  'play-raised-bed': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'raised-bed', tags: ['vegetable'] },
    metres: { w: 2, h: 1 },
    sizePx: { w: 512, h: 256 },
    variants: 1,
    transparent: true,
    template: 'sprite',
    subject:
      'A rectangular timber raised vegetable bed running left to right, filled with rows of leafy vegetables, seen from directly above.',
  },

  /* ---- lighting: the fitting, not the light it throws ---- */
  /*
   * Four fittings, each one a small dark object photographed from above — which is the whole
   * difficulty and the reason these prompts insist on the fitting being *off*.
   *
   * An image model asked for a garden light draws a glowing light, and a glow baked into a sprite
   * is a claim the plan cannot retract: it would burn at midday, and at night it would sit under
   * the real pool of light `fx-light-pool` throws and fight it. The fitting and the light it casts
   * are two separate things here for the same reason the contact shadow and the cast-shadow layer
   * are: one is what the object *is*, the other is what the sun and the hour make of it.
   *
   * Not `recolourable`. The finish is the product — powder-coated black, brushed steel, solid
   * brass — so tinting one towards another material's palette would draw a brass fitting green.
   * Same rule as furniture.
   */
  'light-spike': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['spike', 'uplight'] },
    metres: { w: 0.12, h: 0.12 },
    sizePx: { w: 192, h: 192 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'A small cylindrical garden spike spotlight seen from directly above, switched off and unlit, so only the dark metal body and the plain glass lens are visible.',
    variantSubjects: ['powder-coated matt black', 'brushed stainless steel'],
  },
  'light-bollard': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['bollard', 'path'] },
    metres: { w: 0.16, h: 0.16 },
    sizePx: { w: 192, h: 192 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'The top of a garden bollard path light seen from directly above, a plain circular metal cap with a narrow slot around its rim, switched off and unlit.',
    variantSubjects: ['powder-coated matt black', 'solid brass weathered to a dull bronze'],
  },
  'light-recessed': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['recessed', 'deck', 'step'] },
    metres: { w: 0.08, h: 0.08 },
    sizePx: { w: 128, h: 128 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'A small round recessed deck light set flush into a surface, seen from directly above as a plain metal ring around a dark lens, switched off and unlit.',
    variantSubjects: ['brushed stainless steel', 'solid brass'],
  },
  'light-wall': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['wall', 'up-down'] },
    metres: { w: 0.22, h: 0.12 },
    sizePx: { w: 256, h: 140 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'A rectangular wall-mounted up-and-down garden light seen from directly above, its long side running left to right, showing the plain metal top of the fitting with an open slot at each end, switched off and unlit.',
    variantSubjects: ['powder-coated matt black', 'brushed stainless steel'],
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
    template: 'plant',
    subject:
      'An upright herbaceous perennial about half a metre across, narrow leaves rising from a tight clump so the crown reads as a star from above.',
    variantSubjects: ['veronicastrum', 'agastache', 'persicaria'],
  },
  'plant-perennial-spire': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['spire', 'flowering'] },
    recolourable: true,
    metres: { w: 0.45, h: 0.45 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    template: 'plant',
    subject:
      'A spire-forming perennial about forty-five centimetres across, a basal rosette of leaves with one or two flower spikes foreshortened to short bright bars from directly above.',
    variantSubjects: ['digitalis', 'lupin', 'delphinium'],
  },
  'plant-perennial-ferny': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['ferny', 'shade'] },
    recolourable: true,
    metres: { w: 0.6, h: 0.6 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    template: 'plant',
    subject:
      'A finely divided ferny perennial about sixty centimetres across, feathery fronds radiating outward with visible gaps between them.',
    variantSubjects: ['dryopteris fern', 'astilbe', 'achillea'],
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
    template: 'plant',
    subject:
      'An architectural evergreen shrub about a metre across with a strong bold outline of few large leaves, so the shape reads clearly from above.',
    variantSubjects: ['fatsia', 'phormium', 'yucca'],
  },
  'plant-shrub-deciduous': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['deciduous', 'flowering'] },
    recolourable: true,
    metres: { w: 1.3, h: 1.3 },
    sizePx: { w: 640, h: 640 },
    variants: 3,
    transparent: true,
    template: 'plant',
    subject:
      'A deciduous garden shrub about one and a third metres across, looser and more open than an evergreen with visible gaps between the branches.',
    variantSubjects: ['philadelphus', 'weigela', 'hydrangea'],
  },

  /*
   * Clipped evergreen structure, and the reason it is its own family rather than a tag.
   *
   * `plant-shrub-architectural` is a *bold* shape — fatsia, phormium — which is the opposite thing
   * from a sphere of box. The formal template's whole vocabulary is repetition of an identical
   * clipped form, and drawing that with the architectural family gives three different bold
   * outlines where the design calls for one shape repeated. `clipped-mass` already exists as a
   * `scatterForm` for the same reason at bed scale; this is its specimen.
   */
  'plant-shrub-topiary': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['evergreen', 'clipped', 'formal'] },
    recolourable: true,
    metres: { w: 0.7, h: 0.7 },
    sizePx: { w: 512, h: 512 },
    variants: 2,
    transparent: true,
    template: 'plant',
    subject:
      'A clipped evergreen topiary ball about seventy centimetres across, seen from directly above as an even dense circle of tiny leaves with a crisp sheared outline and no gaps.',
    variantSubjects: ['box', 'yew'],
  },

  /*
   * A climber belongs here and is deliberately not here yet.
   *
   * Nothing in the library covers a fence, a wall or a pergola, so every boundary in every plan is
   * bare — but a climber is the one plant drawn against a *vertical* surface, and there is no pass
   * that draws one. Declaring the family would have `generate` pay for pictures nothing reads,
   * which is the exact failure `taxonomy.test.ts`'s reachability check exists to catch (it caught
   * this one). It lands with the boundary-planting pass, not before it.
   */

  /* ---- grasses: the axis that separates a grass from a shrub ---- */
  'plant-grass-tall': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'grass-ornamental', tags: ['tall', 'upright'] },
    recolourable: true,
    metres: { w: 0.8, h: 0.8 },
    sizePx: { w: 512, h: 512 },
    variants: 3,
    transparent: true,
    template: 'plant',
    subject:
      'A tall upright ornamental grass about eighty centimetres across, seen from directly above as a dense radiating burst of narrow blades.',
    variantSubjects: ['calamagrostis', 'molinia', 'panicum'],
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
    template: 'plant',
    subject:
      'A spreading ground-cover plant about sixty centimetres across, irregular and loosely trailing at the edges rather than a tidy mound.',
    variantSubjects: ['geranium macrorrhizum', 'epimedium', 'lamium'],
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
    template: 'sprite',
    subject:
      'The canopy of a small ornamental tree about four metres across, seen from directly above, with a lighter more open crown than a forest tree.',
    variantSubjects: ['flowering cherry', 'crab apple', 'amelanchier'],
  },
  'tree-multistem': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['multi-stem'] },
    recolourable: true,
    metres: { w: 3.5, h: 3.5 },
    sizePx: { w: 768, h: 768 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'The canopy of a multi-stemmed small tree about three and a half metres across, seen from directly above as several overlapping crowns rising from one clump.',
    variantSubjects: ['birch', 'amelanchier'],
  },
  'tree-fruit': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['fruit'] },
    recolourable: true,
    metres: { w: 3, h: 3 },
    sizePx: { w: 768, h: 768 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'The canopy of a trained fruit tree about three metres across, seen from directly above, rounded and fairly dense.',
    variantSubjects: ['apple', 'pear'],
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
    template: 'sprite',
    subject:
      'A short length of clipped beech hedge seen from directly above, a dense flat mass of small leaves filling a rounded square, with a crisp clipped edge.',
  },
  'hedge-crown-yew': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'hedge-crown', tags: ['evergreen', 'yew'] },
    recolourable: true,
    metres: { w: 0.7, h: 0.7 },
    sizePx: { w: 384, h: 384 },
    variants: 2,
    transparent: true,
    template: 'sprite',
    subject:
      'A short length of clipped yew hedge seen from directly above, a very dense dark mass of fine needles filling a rounded square, with a crisp clipped edge.',
  },

  'tree-japanese-maple': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['acer', 'red-leaf'] },
    metres: { w: 4, h: 4 },
    sizePx: { w: 768, h: 768 },
    variants: 3,
    transparent: true,
    template: 'sprite',
    subject:
      'A red Japanese maple (Acer palmatum) crown, detailed palmate burgundy and crimson leaves with layered branches, subtle warm tips and leaf-scale ambient shading.',
    variantSubjects: [
      'a deep burgundy cultivar',
      'a crimson cultivar',
      'a lighter coral-red cultivar',
    ],
  },

  /* ---- drawn by the tool, not by a model ---- */
  'fx-soft-shadow': {
    kind: 'sprite',
    taxon: { group: 'effect', type: 'contact-shadow' },
    metres: { w: 1, h: 1 },
    sizePx: { w: 256, h: 256 },
    variants: 1,
    transparent: true,
    template: 'procedural',
    subject: 'A radial soft black disc, opaque at the centre and fully transparent at the edge.',
    procedural: 'soft-shadow',
  },
  /*
   * The pool of light a fitting throws, and it is drawn rather than photographed for the same
   * reason the contact shadow is: it is a *gradient*, and asking an image model for one buys
   * banding, a colour cast and a JPEG-shaped halo in place of arithmetic that is four lines long
   * and exactly right.
   *
   * Warm rather than white — 2700 K is what garden lighting actually is, and a neutral pool reads
   * as moonlight — and much wider-tailed than the shadow disc, because a beam has no edge.
   */
  'fx-light-pool': {
    kind: 'sprite',
    taxon: { group: 'effect', type: 'light-pool' },
    metres: { w: 1, h: 1 },
    sizePx: { w: 256, h: 256 },
    variants: 1,
    transparent: true,
    template: 'procedural',
    subject: 'A radial warm-white glow, brightest at the centre and fading to nothing at the edge.',
    procedural: 'light-pool',
  },

  /*
   * The covering of a pitched roof, tiled in each roof plane's own frame so a slate is 300 mm on
   * every roof at every rotation (`ROOF_SKINS`). Drawn to the `skin` template, whose wording is kept
   * exactly as the file was generated from so its prompt hash still matches.
   */
  'skin-roof-slate': {
    kind: 'texture',
    taxon: { group: 'architectural', type: 'roofing', tags: ['slate', 'skin'] },
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    template: 'skin',
    subject:
      'A slate roof, overlapping courses of flat grey-blue slates in a regular running bond, their lower edges casting fine shadow lines, seen square on.',
  },
} as const satisfies Record<string, AssetFamily>;

export type AssetId = keyof typeof ASSET_FAMILIES;

export const ASSET_IDS = Object.keys(ASSET_FAMILIES) as AssetId[];

/**
 * The file an asset variant is written to, relative to `public/assets/`.
 *
 * `plan/` first, then kind. The prefix is the camera the whole library is drawn to — strictly
 * overhead, for the plan — and is kept so the files already on disk and in the catalogue need not
 * move.
 *
 * Nothing resolves an asset *by* this path — the catalogue's `file` field is the only path the
 * renderer reads — so this function and the catalogue are the whole of the layout, and a stale
 * catalogue entry fails to the procedural fallback rather than to an error.
 */
export function assetFile(id: AssetId, variant: number): string {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const dir = family.kind === 'sprite' ? 'sprites' : 'textures';
  return `plan/${dir}/${id}-${variant}.webp`;
}
