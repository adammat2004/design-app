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

import { RISE } from '../../render/camera';
import type { AssetRenderQuality } from './quality';

export type AssetKind = 'texture' | 'face' | 'sprite';

/**
 * Which specification a family was drawn to.
 *
 * There are two cameras in this library and they are not interchangeable. `plan` is what everything
 * here was until now: strictly overhead, orthographic, flat even light, no perspective — the right
 * picture for 2D Plan, where the drawing has to read as a measurable footprint. `elevated` is the
 * Visualise camera: tilted about 12° from vertical, so a vertical face is visible below the top of
 * the thing and the object communicates its height.
 *
 * A field rather than two manifests, because a query has to be able to say which it wants and fall
 * back to the other when a file has not been generated yet. **Absent means `plan`**, which is what
 * makes adding the elevated library a no-op for every existing query: `assetsMatching` defaults to
 * `plan` and therefore returns exactly what it returned before any of this existed.
 *
 * The full contract is `docs/visualise-asset-style.md`, and the 12° is not free-floating — it is
 * `RISE` in `lib/render/projection.ts` stated in words. Change one and you must change the other,
 * or a photographed shed will not stand on a drawn one.
 */
export type AssetCamera = 'plan' | 'elevated';

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
  /** Renderer-only QA and transform policy. Older catalogue entries use conservative defaults. */
  render?: Partial<AssetRenderQuality>;
  kind: AssetKind;
  /**
   * What this is, for a query to match against. Required rather than optional, so classifying a
   * new family is a compile error rather than something to remember — the same reason
   * `CATEGORY_HEIGHTS` is total.
   */
  taxon: AssetTaxon;
  /** Which camera this was drawn to. Absent means `plan`; see `AssetCamera`. */
  camera?: AssetCamera;
  /**
   * How tall the thing is, in metres. Elevated families only.
   *
   * Not a duplicate of `heightFor`, and it must never be read as one: `heights.ts` answers what an
   * element *is* for shadows and the schedule, and this answers how much of the image above the
   * footprint band is the object's height. They agree in practice and the audit sheet is where a
   * disagreement would show, but the authority is `heights.ts` — this is a framing number.
   *
   * With `RISE` it gives the frame: `imageHeight = metres.h + heightMetres × RISE`. That one line
   * is why a pot, a sofa and a seven-metre tree can share a placement routine.
   */
  heightMetres?: number;
  /**
   * Where the thing actually stands within its own frame, as a fraction of the image, when that is
   * not the centre.
   *
   * Absent means centred for a plan sprite, which is what every one of them is — the prompt says
   * "centred and filling the frame". For an **elevated** family absent means the centre of the
   * footprint band at the bottom of the frame (`elevatedAnchor`), which is where an object drawn to
   * the specification stands. Stated explicitly only when that is untrue: a tree whose trunk is off
   * to one side of a leaning canopy.
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
  procedural?: 'soft-shadow' | 'light-pool';
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

/* ---------------------------------------------------------------- the elevated camera
 *
 * Everything below is the Visualise library, and it is a different specification rather than a
 * variation on the one above. `docs/visualise-asset-style.md` is the contract; this constant is it
 * in the form a model is given, and the two are meant to be read together.
 *
 * Four things in here are load-bearing and none of them is stylistic:
 *
 * - **"tilted twelve degrees from vertical"** is `RISE` in `lib/render/projection.ts`. The renderer
 *   lifts a point `h × RISE` up the screen and extrudes the fence, the house and the shed by the
 *   same rule, so an asset drawn at a different angle stands at a different angle from the drawn
 *   things beside it. Nothing downstream can detect that; only the sheet shows it.
 * - **"orthographic"** keeps the footprint an unforeshortened plan. With perspective, a sprite's
 *   footprint is a trapezium that no rect can hold, and the placement routine has nothing to key on.
 * - **"no shadow on the ground"** is the hybrid: the renderer casts the shadow, because a baked one
 *   rotates with the object and is fixed at one hour. This is the single most important sentence in
 *   the prompt and the one a model is most likely to ignore, which is why the QA pass measures it.
 * - **"light from the upper left"** is `LIGHT_DIRECTION`. Two suns in one drawing is the most
 *   obvious way a render gives itself away.
 */
export const ELEVATED =
  'Photorealistic architectural landscape visualisation render of a single object, seen from ' +
  'almost directly overhead — a near-nadir aerial view, only about twelve degrees off vertical. ' +
  'The top surfaces are seen in true plan: square on, their real shape, NOT foreshortened and NOT ' +
  'squashed. Only a narrow sliver of the front faces shows below the top, about a tenth of the ' +
  "object's height. This is NOT a three-quarter view, NOT an isometric view, NOT a product " +
  'photograph taken from the side, and NOT a perspective view: the camera is nearly straight down. ' +
  'Orthographic projection with parallel vertical edges and no perspective convergence. Soft hazy ' +
  'daylight from the upper left at about fifty-five degrees elevation, gentle self-shadowing with ' +
  'no hard-edged shadow and plenty of ambient fill so the shaded side stays readable. No cast ' +
  'shadow on the ground, no ground plane, no base, no reflection. The object isolated on a fully ' +
  'transparent background with clean cut-out edges and no white fringe, centred left to right, ' +
  'its front facing the bottom of the frame, filling the frame with a narrow margin and nothing ' +
  'clipped or cropped at any edge. Natural slightly desaturated colour, neutral white balance, ' +
  'restrained contrast. No text, no watermark, no logo.';

const ELEVATED_TREE = `${ELEVATED} A single tree, its canopy seen from above and slightly in front so the foliage has real depth, layered branches reading through the crown, and a short length of trunk visible where the canopy is thinner.`;

const ELEVATED_SHRUB = `${ELEVATED} A single shrub, a rounded mass of foliage with visible depth, lit across the top and shading into darkness underneath so it reads as a body rather than a disc.`;

const ELEVATED_PLANT = `${ELEVATED} A single herbaceous plant, one clump standing up off the ground with its foliage seen from above and slightly in front, so the stems and the height of the clump are both visible.`;

const ELEVATED_FURNITURE = `${ELEVATED} A single piece of outdoor garden furniture, its seat tops and frame seen from above and slightly in front, so the legs and the front edge are visible and the piece reads as standing on the ground.`;

const ELEVATED_PLANTER = `${ELEVATED} A single garden container, its rim and planting seen from above and a little of its outer side visible below, so the container reads as having real height.`;

/**
 * A material for a vertical face — and the one elevated family that is lit *flat*.
 *
 * A skin is drawn onto a face whose brightness the renderer computes from that face's own normal
 * against the scene light, exactly as the roof planes already are. Baked light here would be light
 * applied twice: the face that happens to point away from the sun would be shaded by the renderer
 * and shaded again by the photograph, and the two would not agree when the sun moved.
 *
 * So this is a `texture` in every respect that matters and shares `TILE`'s discipline — flat, even,
 * seamless, no shadows. The only thing that makes it "elevated" is what it is used for.
 */
const SKIN = `${TILE} A material seen face-on, as it appears on a vertical surface.`;

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
    prompt: `${FACE} A block of nine small cropped granite setts laid square in a three-by-three grid, mid grey with subtle blue and warm flecks, each sett slightly domed and tumbled, the narrow sand joints between them part of the picture.`,
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
    prompt: `${FACE} The top face of a single clay stock brick, warm red-brown with a slightly sandy weathered texture and faint colour variation. One brick only, no mortar and no neighbouring bricks.`,
  },
  'face-kerb-concrete': {
    kind: 'face',
    taxon: { group: 'surface', type: 'kerb', tags: ['concrete', 'edging'] },
    metres: { w: 0.45, h: 0.15 },
    sizePx: { w: 768, h: 256 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} The top face of a single pressed concrete garden kerb, light grey with a fine even aggregate speckle and slightly softened arrises. One unit only, no joints visible.`,
  },
  'face-edging-setts': {
    kind: 'face',
    taxon: { group: 'surface', type: 'paving-sett', tags: ['granite', 'edging'] },
    metres: { w: 0.1, h: 0.1 },
    sizePx: { w: 256, h: 256 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} The top face of a single small cropped granite sett, mid grey with blue and warm flecks and a tumbled, slightly domed surface. One sett only, filling the frame, no joints.`,
  },
  'face-sleeper-timber': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['sleeper', 'edging', 'walling'] },
    metres: { w: 2.4, h: 0.2 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} Sawn softwood railway-sleeper timber, the grain running exactly left to right across the frame, coarse and slightly weathered grey-brown with saw marks. No board edges visible.`,
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
    prompt: `${FACE} The top face of a single block of coursed natural walling stone, buff-grey sandstone with a slightly riven surface and weathered edges. One block only, no mortar and no neighbouring blocks.`,
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
    /*
     * Two, because a board face is chosen per board: at one variant a pergola's rafters and a
     * shed's cladding are the identical strip of grain repeated down the whole structure, which is
     * the one thing real timber never looks like.
     */
    variants: 2,
    transparent: false,
    prompt: `${FACE} Pale pressure-treated softwood timber, the grain running exactly left to right across the frame. No board edges visible. Each variant a different board, one straight-grained and one with visible knots.`,
  },
  'face-hardwood': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['hardwood'] },
    metres: { w: 3, h: 0.13 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} Rich mid-brown oiled hardwood timber, the grain running exactly left to right across the frame. No board edges visible. Each variant a different board, one straight-grained and one more figured.`,
  },
  'face-painted-timber': {
    kind: 'face',
    taxon: { group: 'surface', type: 'timber-board', tags: ['painted'] },
    metres: { w: 2.4, h: 0.14 },
    sizePx: { w: 1024, h: 683 },
    variants: 2,
    transparent: false,
    prompt: `${FACE} Timber painted a soft pale sage-grey, the grain faintly showing through and running exactly left to right across the frame. No board edges visible. Each variant a slightly different board, one freshly painted and one very faintly weathered.`,
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
    /*
     * Four rather than two. `tree-evergreen` is the only symbol this family answers, so a garden
     * that asks for evergreens draws from this pool alone — at two, a pair of them side by side is
     * visibly the same photograph twice. Note the prompt now names a species per variant where it
     * used to describe one generic conifer: the tool reuses existing raws, so variants 1 and 2 keep
     * the pictures they have and only 3 and 4 are generated. Pass `--force` to redo all four.
     */
    variants: 4,
    transparent: true,
    prompt: `${SPRITE} The crown of a single conifer seen from directly above, dense dark green needled foliage radiating from the centre in a near-circular outline. Each variant a different conifer: pine, spruce, juniper, cedar.`,
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
    prompt: `${SPRITE} A square outdoor hot tub with its cover off, seen from directly above: a moulded acrylic shell with contoured seats and jets, still clear water with a faint reflection, and a slim dark cabinet surround. Each variant a different surround: grey composite, dark timber.`,
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
    prompt: `${SPRITE} A small cylindrical garden spike spotlight seen from directly above, switched off and unlit, so only the dark metal body and the plain glass lens are visible. Variant one powder-coated matt black, variant two brushed stainless steel.`,
  },
  'light-bollard': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['bollard', 'path'] },
    metres: { w: 0.16, h: 0.16 },
    sizePx: { w: 192, h: 192 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} The top of a garden bollard path light seen from directly above, a plain circular metal cap with a narrow slot around its rim, switched off and unlit. Variant one powder-coated matt black, variant two solid brass weathered to a dull bronze.`,
  },
  'light-recessed': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['recessed', 'deck', 'step'] },
    metres: { w: 0.08, h: 0.08 },
    sizePx: { w: 128, h: 128 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} A small round recessed deck light set flush into a surface, seen from directly above as a plain metal ring around a dark lens, switched off and unlit. Variant one brushed stainless steel, variant two solid brass.`,
  },
  'light-wall': {
    kind: 'sprite',
    taxon: { group: 'feature', type: 'light-fitting', tags: ['wall', 'up-down'] },
    metres: { w: 0.22, h: 0.12 },
    sizePx: { w: 256, h: 140 },
    variants: 2,
    transparent: true,
    prompt: `${SPRITE} A rectangular wall-mounted up-and-down garden light seen from directly above, its long side running left to right, showing the plain metal top of the fitting with an open slot at each end, switched off and unlit. Variant one powder-coated matt black, variant two brushed stainless steel.`,
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
    prompt: `${PLANT} A clipped evergreen topiary ball about seventy centimetres across, seen from directly above as an even dense circle of tiny leaves with a crisp sheared outline and no gaps. Each variant a different plant: box, yew.${TINTABLE}`,
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

  'tree-japanese-maple': {
    kind: 'sprite',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['acer', 'red-leaf'] },
    metres: { w: 4, h: 4 },
    sizePx: { w: 768, h: 768 },
    variants: 3,
    transparent: true,
    prompt: `${SPRITE} A red Japanese maple (Acer palmatum) crown, detailed palmate burgundy and crimson leaves with layered branches, subtle warm tips and leaf-scale ambient shading. Each variant a different cultivar, ranging from deep burgundy through crimson to a lighter coral-red.`,
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
    prompt: 'A radial warm-white glow, brightest at the centre and fading to nothing at the edge.',
    procedural: 'light-pool',
  },

  /* ================================================================ the elevated library
   *
   * Drawn to `docs/visualise-asset-style.md` and used only by Visualise. Everything above is the
   * plan camera and keeps drawing 2D Plan exactly as it does today; `assetsMatching` defaults to
   * `camera: 'plan'`, so **appending these changes no existing query's answer** — which is the one
   * thing the append-only rule above could not have promised on its own.
   *
   * Three conventions hold for every family here and are worth stating once:
   *
   * - **`metres` is the footprint, not the picture.** A tree's `metres` is its canopy spread on the
   *   ground; `heightMetres` is how far up the trunk the crown sits. The image is taller than
   *   `metres.h` by exactly `heightMetres × RISE`, which `elevatedFrame` computes and a test pins
   *   against `sizePx`. Nothing here is geometry: the element's rect or radius is still the record.
   * - **Never `recolourable`.** The tint is a proportional multiply and these carry their own light,
   *   so a multiply would darken them exactly where they are already shaded. Variety comes from the
   *   variant and from a small lightness wash, which is what the plan library used a tint for.
   * - **Structures are absent on purpose.** No shed, pergola, gazebo, raised bed, fence or house.
   *   Those are whatever polygon the placer or the user gave them, at any rotation, so they are
   *   extruded from their own outline and skinned with the `skin-*` textures below. A photograph
   *   stretched into an arbitrary rectangle puts its posts in the wrong places.
   * ================================================================ */

  /* ---- trees: the deepest objects in the drawing, and the ones that must overhang ---- */
  'vis-tree-deciduous': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['broadleaf'] },
    metres: { w: 4, h: 4 },
    heightMetres: 7,
    sizePx: { w: 746, h: 1024 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_TREE} A mature broadleaf garden tree about four metres across and seven metres tall, a deep rounded canopy of small green leaves with real thickness, gaps showing darker foliage and branch structure within it. Each variant a different tree: birch, hornbeam, rowan.`,
  },
  'vis-tree-multistem': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['multi-stem'] },
    metres: { w: 3.5, h: 3.5 },
    heightMetres: 4,
    sizePx: { w: 824, h: 1024 },
    variants: 2,
    transparent: true,
    prompt: `${ELEVATED_TREE} A multi-stem ornamental tree about three and a half metres across and four metres tall, several slender trunks splaying from the base and clearly visible below a light open canopy. Each variant a different tree: amelanchier, multi-stem birch.`,
  },

  /* ---- shrubs: the backdrop and the body of every bed ---- */
  'vis-shrub-evergreen': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['evergreen', 'mounded'] },
    metres: { w: 1, h: 1 },
    heightMetres: 1.3,
    sizePx: { w: 401, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_SHRUB} An evergreen garden shrub about a metre across and a little over a metre tall, dense small leaves forming a rounded mound. Each variant a different shrub: pittosporum, viburnum tinus, choisya.`,
  },
  'vis-shrub-flowering': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'shrub', tags: ['deciduous', 'flowering'] },
    metres: { w: 1.3, h: 1.3 },
    heightMetres: 1.5,
    sizePx: { w: 411, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_SHRUB} A flowering deciduous garden shrub about one and a third metres across and one and a half metres tall, looser and more open than an evergreen, with flowers scattered across the top of the mass rather than covering it. Each variant a different shrub: hydrangea, philadelphus, weigela.`,
  },

  /* ---- grasses: the layer that shows the camera angle most clearly ---- */
  'vis-grass': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'grass-ornamental', tags: ['tufted'] },
    metres: { w: 0.5, h: 0.5 },
    heightMetres: 1.1,
    sizePx: { w: 349, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_PLANT} An ornamental grass about half a metre across and a metre tall, fine arching blades radiating from a tight base and falling outwards, so the clump reads as a fountain of foliage with height rather than a flat rosette. Each variant a different grass: stipa, miscanthus, calamagrostis.`,
  },

  /* ---- furniture: one asset each, free to rotate; see the style doc on why ---- */
  'vis-dining-6': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'furniture', type: 'dining-set', tags: ['seats-6'] },
    metres: { w: 3.2, h: 2.4 },
    heightMetres: 0.75,
    sizePx: { w: 768, h: 614 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} A six-seat outdoor dining set: a rectangular teak table with its long side running left to right, three chairs along each side, their seats and backs visible and their legs standing on the ground.`,
  },
  'vis-sofa-set': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'furniture', type: 'lounge-set' },
    metres: { w: 3, h: 2.4 },
    heightMetres: 0.8,
    sizePx: { w: 768, h: 658 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} An outdoor lounge set: a low corner sofa in pale grey weatherproof cushions on a dark woven frame, arranged around a small square coffee table, the cushion tops and the sofa's front edge both visible.`,
  },

  'vis-lounger': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'furniture', type: 'lounger' },
    metres: { w: 0.7, h: 1.9 },
    heightMetres: 0.4,
    sizePx: { w: 271, h: 768 },
    variants: 2,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} A single outdoor sun lounger seen lengthways, its back raised at a shallow angle at the top end, a pale cushion on a slatted teak frame. Variant one reclined flat, variant two with the backrest propped up.`,
  },
  'vis-bench': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'furniture', type: 'bench' },
    metres: { w: 1.6, h: 0.6 },
    heightMetres: 0.9,
    sizePx: { w: 768, h: 380 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} A two-seat garden bench in weathered teak, its slatted seat and the top rail of its back both visible, its long side running left to right and its back along the top edge.`,
  },
  'vis-bbq': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'furniture', type: 'bbq' },
    metres: { w: 1.4, h: 0.7 },
    heightMetres: 0.9,
    sizePx: { w: 768, h: 489 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} A freestanding outdoor barbecue on a stainless steel cart, its closed lid and side shelf seen from above, on castors, its long side running left to right.`,
  },
  'vis-fire-pit': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'fire-pit' },
    metres: { w: 1.2, h: 1.2 },
    heightMetres: 0.4,
    sizePx: { w: 717, h: 768 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} A round corten steel fire bowl on a low base, the bowl's rim and the ash and charred logs inside it both visible, unlit and cold with no flame and no glow.`,
  },
  'vis-parasol': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'furniture', type: 'parasol' },
    metres: { w: 2.7, h: 2.7 },
    heightMetres: 2.4,
    sizePx: { w: 646, h: 768 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED_FURNITURE} A large open garden parasol in natural canvas, seen almost from above so the canopy is a broad shallow octagon with its ribs reading through the fabric, the pole and base just visible beneath the near edge.`,
  },

  /* ---- play and growing: the things a family garden is furnished with ---- */
  'vis-raised-bed': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'raised-bed', tags: ['vegetable'] },
    metres: { w: 2, h: 1 },
    heightMetres: 0.45,
    sizePx: { w: 768, h: 421 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED} A timber raised vegetable bed made of stacked softwood sleepers, its long side running left to right, planted with rows of leafy vegetables, the near face of the timber visible below the soil line.`,
  },
  'vis-swing': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['swing'] },
    metres: { w: 3, h: 2 },
    heightMetres: 2.2,
    sizePx: { w: 768, h: 632 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED} A wooden A-frame garden swing set with two seats hanging on ropes, the top beam running left to right, the splayed legs and the seats below all visible.`,
  },
  'vis-slide': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['slide'] },
    metres: { w: 1.2, h: 2.6 },
    heightMetres: 1.6,
    sizePx: { w: 313, h: 768 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED} A children's garden slide, the ladder and platform at the top of the frame and the green chute running down towards the bottom of the picture.`,
  },
  'vis-trampoline': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'play-equipment', tags: ['trampoline'] },
    metres: { w: 3, h: 3 },
    heightMetres: 0.9,
    sizePx: { w: 722, h: 768 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED} A round garden trampoline with a black jumping mat and a blue padded edge, its legs just visible beneath the near rim, with no safety net.`,
  },

  /* ---- containers: the smallest thing whose height has to read ---- */
  'vis-planter': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'planter' },
    metres: { w: 0.6, h: 0.6 },
    heightMetres: 0.9,
    sizePx: { w: 582, h: 768 },
    variants: 2,
    transparent: true,
    prompt: `${ELEVATED_PLANTER} A square garden planter about six hundred millimetres across, its rim and a little of its outer face visible, holding a clipped evergreen ball that stands proud of it. Variant one a dark powder-coated metal trough, variant two an oak sleeper planter.`,
  },

  /* ---- the herbaceous layer, and the reason Visualise stopped being half flat ----
   *
   * The first elevated wave drew the things you notice — trees, shrubs, grasses, furniture — and
   * left the layer that actually covers a bed. Measured on the quality fixtures, **8,271 plant
   * instances per run were still being drawn with flat plan art inside Visualise**: perennials,
   * flowers and ground cover, which are most of the planting in every generated garden. The result
   * was a view where a shrub stood up and the border around it lay flat, which reads worse than a
   * consistently flat drawing would.
   *
   * Many-to-one wherever the difference does not survive the camera, exactly as `plant-grass` and
   * `plant-grass-tall` already share `vis-grass`: from twelve degrees off vertical a mounded
   * perennial and a ferny one are the same silhouette at the same height, and the palette's tint
   * carries what is left. Variety comes from the variant, never from a tint — elevated art is never
   * `recolourable`, because these carry their own light and a multiply would darken what is already
   * shaded.
   */
  'vis-perennial-mound': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['mounded'] },
    metres: { w: 0.6, h: 0.6 },
    heightMetres: 0.6,
    sizePx: { w: 422, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_PLANT} A mounded herbaceous perennial about six hundred millimetres across and as tall, a dense soft dome of leaves standing off the ground with the stems just visible beneath the near edge. Each variant a different perennial: hardy geranium, alchemilla, heuchera.`,
  },
  'vis-perennial-spire': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'perennial', tags: ['spire', 'flowering'] },
    metres: { w: 0.5, h: 0.5 },
    heightMetres: 1,
    sizePx: { w: 359, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_PLANT} An upright flowering perennial about half a metre across and a metre tall, a clump of vertical flower spikes rising clear of a basal rosette, the spikes seen down their length so their height is unmistakable. Each variant a different perennial: salvia, veronicastrum, lupin.`,
  },
  'vis-flower': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'flower', tags: ['accent'] },
    metres: { w: 0.35, h: 0.35 },
    heightMetres: 0.5,
    sizePx: { w: 393, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_PLANT} A small flowering accent plant about a third of a metre across, a loose posy of open flowers held above a low tuft of foliage on slender stems. Each variant a different colour: white, soft yellow, deep pink.`,
  },
  'vis-ground-cover': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'ground-cover', tags: ['mat'] },
    metres: { w: 0.5, h: 0.5 },
    heightMetres: 0.25,
    sizePx: { w: 463, h: 512 },
    variants: 3,
    transparent: true,
    prompt: `${ELEVATED_PLANT} A low spreading ground-cover plant about half a metre across and only a quarter of a metre tall, a flat dense mat of small leaves hugging the ground with a soft irregular outline. Each variant a different ground cover: vinca, ajuga, creeping thyme.`,
  },

  /* ---- the rest of the trees ----
   *
   * `vis-tree-deciduous` and `vis-tree-multistem` were the whole tree library, so every ornamental,
   * fruit and evergreen tree in a generated plan fell back to its flat canopy — the most
   * conspicuous possible place for the two cameras to disagree, since a tree is the largest single
   * object in most gardens. Ornamental, maple and fruit share one family: at this camera they are
   * one broadleaf crown on a short trunk, and `canopiesForSymbol` has already chosen the species
   * before the twin is looked up, so nothing about that choice is lost.
   */
  'vis-tree-ornamental': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'tree-deciduous', tags: ['ornamental'] },
    metres: { w: 4, h: 4 },
    heightMetres: 5,
    sizePx: { w: 809, h: 1024 },
    variants: 2,
    transparent: true,
    prompt: `${ELEVATED_TREE} A small ornamental garden tree about four metres across and five metres tall, a rounded open crown on a short single trunk. Variant one in fresh green leaf, variant two carrying pale blossom across the top of the crown.`,
  },
  'vis-tree-conifer': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'vegetation', type: 'tree-evergreen', tags: ['conifer'] },
    metres: { w: 3, h: 3 },
    heightMetres: 6,
    sizePx: { w: 719, h: 1024 },
    variants: 2,
    transparent: true,
    /*
     * Described as what a conifer looks like *from above*, never as its outline from the side.
     *
     * The first attempt said "a dense conical crown narrowing to a point at the top" and got two
     * textbook side elevations — a Christmas-tree silhouette — which every automated check passed,
     * because they measure framing and aspect and cannot see a viewpoint. It is the failure the
     * style doc already records (the model rounding twelve degrees to a three-quarter shot), and a
     * conifer invites it more than anything else in the library: its side view is the way the shape
     * is always drawn. So the words describe tiers radiating around a centre and the growing tip
     * seen end-on, and the silhouette is not mentioned at all.
     */
    prompt: `${ELEVATED_TREE} An evergreen conifer about three metres across and six metres tall, looked down on from almost directly above: concentric tiers of dark needled branches radiating outwards like the spokes of a wheel from a single central leader, the growing tip seen end-on in the middle of the crown and the lower tiers spreading widest at the outside. The circular spread of the branches is the shape that reads, NOT a triangular outline and NOT a Christmas-tree silhouette seen from the side. Each variant a slightly different form: one tighter and denser, one more open.`,
  },

  /* ---- the one product in the structure library; see `hot-tub` in the plan camera ---- */
  'vis-hot-tub': {
    kind: 'sprite',
    camera: 'elevated',
    taxon: { group: 'feature', type: 'hot-tub' },
    metres: { w: 2.4, h: 2.4 },
    heightMetres: 0.9,
    sizePx: { w: 711, h: 768 },
    variants: 1,
    transparent: true,
    prompt: `${ELEVATED} A square garden hot tub about two and a half metres across, a dark grey cabinet with a moulded surround, its still water surface and moulded seats visible from above and a little of its near side showing below, with the cover off and no steam.`,
  },

  /* ---- skins: the materials the extrusions wear ----
   *
   * Textures, and lit flat like every other texture here — which is the point. A skin goes onto a
   * face whose brightness the renderer computes from that face's own normal against the scene light,
   * exactly as the roof planes already are. Art with baked light would be lit twice, and the two
   * would disagree the moment the sun moved.
   */
  'skin-fence-boards': {
    kind: 'texture',
    camera: 'elevated',
    taxon: { group: 'surface', type: 'timber-board', tags: ['fence', 'vertical', 'skin'] },
    metres: { w: 1.8, h: 1.8 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${SKIN} A close-boarded timber garden fence panel, vertical feather-edge boards of weathered softwood butted side by side with fine shadow lines between them, seen square on.`,
  },
  'skin-render': {
    kind: 'texture',
    camera: 'elevated',
    taxon: { group: 'surface', type: 'walling', tags: ['render', 'vertical', 'skin'] },
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${SKIN} A smooth painted render wall in a warm off-white, very fine even texture with no cracks, joints or staining, seen square on.`,
  },
  'skin-roof-slate': {
    kind: 'texture',
    camera: 'elevated',
    taxon: { group: 'architectural', type: 'roofing', tags: ['slate', 'skin'] },
    metres: { w: 2, h: 2 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${SKIN} A slate roof, overlapping courses of flat grey-blue slates in a regular running bond, their lower edges casting fine shadow lines, seen square on.`,
  },
  'skin-roof-felt': {
    kind: 'texture',
    camera: 'elevated',
    taxon: { group: 'architectural', type: 'roofing', tags: ['felt', 'shed', 'skin'] },
    metres: { w: 1.5, h: 1.5 },
    sizePx: { w: 512, h: 512 },
    variants: 1,
    transparent: false,
    prompt: `${SKIN} A mineral-finish roofing felt in dark charcoal grey, a fine even granular surface with a shallow overlap line, as found on a garden shed roof, seen square on.`,
  },
} as const satisfies Record<string, AssetFamily>;

export type AssetId = keyof typeof ASSET_FAMILIES;

export const ASSET_IDS = Object.keys(ASSET_FAMILIES) as AssetId[];

/**
 * The file an asset variant is written to, relative to `public/assets/`.
 *
 * **Camera first, then kind.** The two cameras are two libraries drawn to two different
 * specifications, and which one a file belongs to is the thing you most need to know about it —
 * so a directory listing answers it without reading the manifest, and `plan/` can be deployed,
 * measured or preloaded as a unit while `elevated/` is not.
 *
 * _This reverses_ `docs/visualise-asset-style.md` §10, which made the `vis-`/`skin-` id prefix the
 * only camera marker precisely so that no second place had to be kept in step. The prefix stays and
 * is still what `--only vis-` matches; what changed is that the library got big enough (181 files
 * across two cameras) for "which of these am I looking at" to be a question a listing should answer.
 *
 * Nothing resolves an asset *by* this path — the catalogue's `file` field is the only path the
 * renderer reads — so this function and the catalogue are the whole of the change, and a stale
 * catalogue entry fails to the procedural fallback rather than to an error.
 */
export function assetFile(id: AssetId, variant: number): string {
  const family: AssetFamily = ASSET_FAMILIES[id];
  const camera = family.camera ?? 'plan';
  const dir = family.kind === 'sprite' ? 'sprites' : 'textures';
  return `${camera}/${dir}/${id}-${variant}.webp`;
}

/**
 * How much ground an elevated asset's image covers, in metres.
 *
 * The frame is the footprint with the object's height leaning up the screen above it:
 *
 * ```
 * width  = metres.w                       the footprint's width
 * height = metres.h + heightMetres × RISE  the footprint's depth, plus the lift
 * ```
 *
 * Derived rather than declared, because declaring it would let a family's stated frame drift from
 * its stated height and there would be no way to tell which was wrong. One consequence worth
 * knowing: changing `RISE` reframes every elevated asset, which is exactly why it is not a setting.
 */
export function elevatedFrame(family: AssetFamily): { w: number; h: number } {
  return { w: family.metres.w, h: family.metres.h + (family.heightMetres ?? 0) * RISE };
}

/**
 * Where an elevated asset stands inside its own frame, as a fraction.
 *
 * The middle of the footprint band along the bottom. An object drawn to the specification has its
 * base at the bottom of the frame and its ground plane occupying the bottom `metres.h` of it, so
 * this is where the thing is actually standing — which is the point the renderer puts on the
 * element's own anchor.
 *
 * Note the asymmetry with a plan sprite, whose anchor is simply the middle of the image: a plan
 * sprite *is* its footprint, so the two coincide. Here they do not, and assuming they did would
 * float every object half its own height above the ground it stands on.
 */
export function elevatedAnchor(family: AssetFamily): { x: number; y: number } {
  const frame = elevatedFrame(family);
  if (frame.h <= 0) return { x: 0.5, y: 0.5 };
  return { x: 0.5, y: 1 - family.metres.h / 2 / frame.h };
}
