import type { DesiredFeature, StyleDirection } from '@garden-studio/schema';

/**
 * The artwork on the brief screen: one isometric vignette per garden space, one photograph per
 * style direction.
 *
 * **Deliberately not part of `materials/assets/`.** That manifest is the *plan renderer's*: its
 * entries are seam-scored, tinted towards a material's palette, preloaded into a raster cache keyed
 * on `assetVersion()` and checked against disk by `audit:assets`. A picture on a card has none of
 * those properties — it is never tiled, never tinted and never measured — so putting it there would
 * mean four subsystems carrying a case they do not need, and a fourth `AssetKind` rippling through
 * `assetsMatching`, `MATERIAL_ASSETS` and the taxonomy tests.
 *
 * What it does share is the *discipline*, and that is the part worth copying:
 *
 * - **The prompt is the specification.** "What a seating area is" is this sentence, not a file
 *   somebody once generated. Regenerating with a better model is re-running the tool.
 * - **Generated once, offline, and checked in.** `tools/assets/src/generate-brief.ts` writes them;
 *   the app never calls a model.
 * - **A missing file is a supported state.** The path is derived from the id, so nothing has to be
 *   kept in sync, and `SpaceCard` falls back to a drawn placeholder when the image does not load.
 *   The screen works with no artwork at all, which is what lets this ship before the pictures do.
 */

export interface BriefArt {
  /** Also the filename stem: `space-dining` is `/brief/space-dining.webp`. */
  id: string;
  /**
   * What the picture shows, for a reader who cannot see it.
   *
   * Not empty, unlike the plan's sprites: those are decoration beside a label that already says
   * what the thing is, and here the picture *is* the explanation of a choice.
   */
  alt: string;
  /** Output size after downsampling. Wider for the styles, which are photographs of a whole garden. */
  sizePx: { w: number; h: number };
  prompt: string;
}

export const BRIEF_ART_BASE = '/brief/';

export function briefArtFile(id: string): string {
  return `${BRIEF_ART_BASE}${id}.webp`;
}

/* ---------------------------------------------------------------- prompt fragments */

/**
 * The spaces, and why they are miniatures rather than photographs.
 *
 * A photograph of somebody else's pergola is a picture of *their* garden: the eye reads the fence,
 * the house behind it and the light, and the question stops being "do I want one of these" and
 * becomes "do I want that". A small isometric model on a plain ground reads as a *component* —
 * here is the thing, here is roughly what it comes with, it will be yours. It is the same reason an
 * interior-design app shows you a room in a box.
 *
 * Three constraints in here are load-bearing rather than stylistic:
 *
 * - **A plain off-white ground with a soft contact shadow**, so sixteen of them sit in a grid
 *   without sixteen different backgrounds fighting each other and the page.
 * - **A square-ish plot cut off cleanly**, so each card shows a comparable amount of garden. Given
 *   a free hand the model draws a whole garden at whatever scale it likes and the pergola card ends
 *   up with a pergola the size of a thumbnail.
 * - **No people and no text.** A person sets a scale and a season and dates the picture; baked-in
 *   labels fight the card's own caption and cannot be translated.
 */
const ISOMETRIC =
  'A small isometric 3D render of one square section of a garden, seen from above at a thirty-' +
  'degree angle, sitting on a plain off-white background with a soft contact shadow beneath it. ' +
  'Photorealistic materials and planting, soft even studio daylight, gentle shadows. The plot is ' +
  'cut off cleanly at its edges like a model on a table. Contemporary British garden design. ' +
  'A single plot in one image — never a diptych, a split view, a before-and-after or a grid of ' +
  'variations. No people, no animals, no text, no labels, no watermark, no border, nothing ' +
  'outside the plot.';

/**
 * The styles, and why these *are* photographs.
 *
 * A style is the one question on the screen that a diagram cannot answer. "Natural" against
 * "Traditional" is a difference of planting density, edge treatment and colour temperature, and a
 * simplified render flattens exactly those. So the style cards go the other way from the spaces:
 * a real garden, wide, with enough of it in frame to read as a place.
 *
 * Overcast daylight throughout, because bright sun is itself a style and would make whichever
 * garden got it look like the nice one.
 */
const STYLE_PHOTO =
  'A wide photograph of a real residential garden, taken from standing height, in soft even ' +
  'overcast daylight. Realistic British planting and materials, in good condition and recently ' +
  'maintained. No people, no animals, no text, no watermark.';

const SPACE_PX = { w: 640, h: 480 };
const STYLE_PX = { w: 768, h: 512 };

function space(id: DesiredFeature, alt: string, scene: string): BriefArt {
  return { id: `space-${id}`, alt, sizePx: SPACE_PX, prompt: `${ISOMETRIC} ${scene}` };
}

function style(id: StyleDirection, alt: string, scene: string): BriefArt {
  return { id: `style-${id}`, alt, sizePx: STYLE_PX, prompt: `${STYLE_PHOTO} ${scene}` };
}

/* ---------------------------------------------------------------- the spaces
 *
 * Each scene describes a *used* space rather than an object on its own: the pergola has paving and
 * seating under it and planting around it, because what the user is choosing is the place, not the
 * structure. A card showing a bare pergola on grass would be asking a different question.
 *
 * `other` has no entry: there is no picture of "something else", and its card is dashed and
 * icon-only for exactly that reason.
 */

export const SPACE_ART: Record<Exclude<DesiredFeature, 'other'>, BriefArt> = {
  seating: space(
    'seating',
    'A paved seating area with an outdoor sofa and armchairs, surrounded by planting',
    'A paved terrace with a low outdoor sofa, two armchairs and a coffee table on it, with ' +
      'generous mixed planting and a small tree around the edges.',
  ),
  dining: space(
    'dining',
    'An outdoor dining table and chairs on paving, surrounded by planting',
    'A paved dining area with a long timber table and six chairs set for a meal, with tall ' +
      'grasses and leafy planting around it and a pot of herbs at one corner.',
  ),
  pergola: space(
    'pergola',
    'A timber pergola over a paved seating area with climbing plants',
    'A timber pergola with slatted beams standing over a paved area with a sofa and chairs ' +
      'beneath it, climbing plants growing up two of its posts, and planting beds along the edges.',
  ),
  firePit: space(
    'firePit',
    'A circular fire pit with seating arranged around it on gravel',
    'A circular fire pit set in a rounded area of pale gravel, with four low chairs and a bench ' +
      'arranged around it and soft planting behind them. The fire is lit.',
  ),
  hotTub: space(
    'hotTub',
    'A hot tub set into a timber deck with planting around it',
    'A square hot tub set into a raised timber deck, its cover off and the water still, with ' +
      'tall grasses and a screen of slatted timber behind it and a towel folded on the deck.',
  ),
  outdoorKitchen: space(
    'outdoorKitchen',
    'An outdoor kitchen run with a built-in grill, counter and stools',
    'An outdoor kitchen: a run of built-in units with a stainless grill, a stone worktop and a ' +
      'small sink, with three stools at a counter and planting behind.',
  ),
  gardenRoom: space(
    'gardenRoom',
    'A small modern garden studio with glazed doors and a path to it',
    'A small contemporary garden room with a flat roof, full-height glazed sliding doors and ' +
      'dark timber cladding, a paved path leading to it and planting along both sides.',
  ),
  greenhouse: space(
    'greenhouse',
    'A glasshouse with staging inside and vegetable beds beside it',
    'A pitched-roof glasshouse with an aluminium frame and plants on staging visible inside, ' +
      'standing on a gravel base with a low raised bed of vegetables beside it.',
  ),
  vegPatch: space(
    'vegPatch',
    'Timber raised beds planted with vegetables and herbs',
    'Three timber raised beds planted with rows of vegetables and herbs, a narrow gravel path ' +
      'between them, a watering can at one end and canes with beans growing up them.',
  ),
  plantingBeds: space(
    'plantingBeds',
    'Deep mixed borders of flowering perennials, grasses and shrubs',
    'Two deep mixed borders of flowering perennials, ornamental grasses and low shrubs in soft ' +
      'purples, whites and greens, edged neatly against a narrow strip of paving.',
  ),
  lawn: space(
    'lawn',
    'A neatly mown lawn with planted borders around its edges',
    'A neatly mown rectangular lawn with crisp edges, framed on three sides by planted borders ' +
      'of shrubs and grasses, with one small tree at a corner.',
  ),
  water: space(
    'water',
    'A small contemporary pond with planting and stone at its edge',
    'A small still pond with a stone edge, water lilies on the surface, marginal planting and ' +
      'grasses along one side and a few boulders at the edge.',
  ),
  play: space(
    'play',
    'A play area with a climbing frame and slide on soft ground',
    'A children’s play area with a timber climbing frame, a slide and a swing standing on ' +
      'soft bark, with a strip of lawn in front and shrubs behind.',
  ),
  /*
   * The one card whose scene is a *time* rather than a thing, and the one the model got wrong
   * first time: "the same garden at dusk" was read as an instruction to compare, and it returned a
   * before-and-after diptych. Nothing about the lighting needs the daytime half — a reader looking
   * at a warm-lit plot understands it immediately — so the phrase is gone and `ISOMETRIC` now
   * refuses a split view outright, which protects every other card from the same reading.
   */
  lighting: space(
    'lighting',
    'A garden path and planting lit after dark by low bollards and an uplit tree',
    'A garden after dark, lit only by its own lights: a paved path with low warm bollard lights ' +
      'along one side, a small tree uplit from its base, and planting glowing softly in pools of ' +
      'warm light. Deep blue evening shadows on the plot itself, and the background still plain ' +
      'and pale.',
  ),
  storage: space(
    'storage',
    'A timber garden store with bins and a bike beside it',
    'A compact timber garden store with a pitched roof and double doors, standing on a paved ' +
      'base with a wheelie bin beside it and a bicycle leaning against the wall, screened by a ' +
      'hedge.',
  ),
};

/* ---------------------------------------------------------------- the styles */

export const STYLE_ART: Record<Exclude<StyleDirection, 'other'>, BriefArt> = {
  modern: style(
    'modern',
    'A modern garden with large-format paving, rendered walls and architectural planting',
    'A modern garden: large-format pale porcelain paving in a clean grid, a smooth rendered wall, ' +
      'a rectangular raised bed of architectural planting, ornamental grasses and a multi-stem ' +
      'tree. Restrained palette, strong straight lines.',
  ),
  cottage: style(
    'cottage',
    'A natural garden with deep informal borders spilling over a winding path',
    'A relaxed naturalistic garden: deep informal borders of flowering perennials, foxgloves and ' +
      'ornamental grasses spilling over the edges of a winding gravel path, a timber bench and a ' +
      'small fruit tree. Soft, full and abundant.',
  ),
  formal: style(
    'formal',
    'A traditional garden with clipped hedges, symmetry and a central path',
    'A traditional formal garden: clipped box hedges in symmetrical beds either side of a central ' +
      'stone path, standard topiary in pots, a brick edge and a stone urn on the axis. Ordered and ' +
      'evergreen.',
  ),
  lowMaintenance: style(
    'lowMaintenance',
    'A minimalist garden of paving, gravel and a few architectural plants',
    'A minimalist low-maintenance garden: pale paving and a panel of light gravel with a steel ' +
      'edge, a handful of architectural evergreen shrubs and grasses well spaced in it, a single ' +
      'multi-stem tree, and no lawn. Calm, spare and open.',
  ),
};

/** Every piece of brief artwork, for the generator to walk. */
export const BRIEF_ART: BriefArt[] = [...Object.values(SPACE_ART), ...Object.values(STYLE_ART)];
