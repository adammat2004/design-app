import { z } from 'zod';

/**
 * What a planting bed is made of, as layers.
 *
 * ## The defect this exists to fix
 *
 * A bed was a **uniform field of one material**. Whatever `mixed-border` resolved to, the whole
 * polygon got it at one density and one size range — so a forty square metre border was four
 * hundred near-identical units, and every bed in the plan read as the same carpet at a different
 * scale. Phases B, C and D made the units themselves better and more varied; none of them could
 * fix the composition, because there was no composition to fix.
 *
 * A designed border is not a field. It is layers, and they are the thing a planting plan actually
 * specifies:
 *
 * ```
 *   backdrop   the tall things at the back, few and large — structure through winter
 *   mass       the body of it: repeated groups of one or two plants, most of the area
 *   mid        smaller things woven through the mass
 *   accent     occasional colour, deliberately sparse
 *   edge       low plants along the front, spilling over whatever it abuts
 *   specimen   one or two singular plants that anchor the whole bed
 * ```
 *
 * ## Why this is in `packages/schema`
 *
 * Same reason `heights.ts` is. `heightBand` and `spread` are facts about the garden, not about the
 * drawing: the shadow model reads height, a 3D view would read both, and a planting schedule would
 * read spread. The *renderer* for these layers lives in `apps/web`, on the usual seam — this file
 * says what a cottage border is, and nothing in it knows what a pixel is.
 *
 * ## What is deliberately not here
 *
 * No species. No Latin names, no flowering months, no soil or aspect requirements. A scheme names
 * the *kind* of plant a layer wants and lets the asset taxonomy answer with whatever the library
 * holds — which is what keeps adding a plant a manifest entry rather than a schema change. A real
 * plant database is a different product and pretending to one here would make the plan claim
 * horticultural knowledge it does not have.
 */

export const PlantingStyleSchema = z.enum([
  /** Repetition, restraint, strong form. Few species, large groups, evergreen structure. */
  'contemporary',
  /** Dense, mixed, generous. Many species, small groups, colour through the season. */
  'cottage',
  /** Drifts and grasses. Reads as a plant community rather than as an arrangement. */
  'naturalistic',
  /** Ground cover and shrubs that need nothing. Few layers, high coverage, no accents. */
  'low-maintenance',
  /** Bold outlines and negative space. Sparse, with the gaps as deliberate as the plants. */
  'architectural',
  /** Flowering mass over form: nectar plants in quantity, left standing. */
  'pollinator',
]);
export type PlantingStyle = z.infer<typeof PlantingStyleSchema>;

/** What a layer is *for*, which is what decides where in the bed it goes. */
export const PlantingRoleSchema = z.enum([
  'backdrop',
  'mass',
  'mid',
  'accent',
  'edge',
  'specimen',
]);
export type PlantingRole = z.infer<typeof PlantingRoleSchema>;

export interface PlantingLayer {
  role: PlantingRole;
  /**
   * What kind of plant, resolved against the asset taxonomy — `{ type: 'perennial' }` and so on.
   *
   * A loose shape rather than an imported `TaxonQuery`, because that type lives in `apps/web` and
   * the dependency must not run that way. The renderer narrows it; a key it does not understand is
   * ignored rather than fatal, which is the same tolerance `material` and `symbol` are stored with.
   */
  taxon: { type: string | string[]; tags?: string[] };
  /** Metres. Mature height, read by the shadow model — see `MATERIAL_HEIGHTS`. */
  heightBand: { min: number; max: number };
  /** Metres. Mature spread, which decides how big the thing is drawn and how far apart. */
  spread: { min: number; max: number };
  /** Share of the bed's area this layer covers, 0-1. The layers need not sum to 1: they overlap. */
  share: number;
  /**
   * 0 spreads the layer evenly, 1 gathers it into drifts.
   *
   * The single most stylistically loaded number here. Even spacing reads as municipal bedding;
   * strong clumping reads as a plant community that seeded itself. Neither is right in general and
   * that is exactly why it is per layer per style.
   */
  clustering: number;
  /**
   * −1 pushes the layer to the middle of the bed, +1 to its edge, 0 is indifferent.
   *
   * What makes a bed read as *planted* rather than *filled*. Real borders are graded — low things
   * at the front, tall at the back — and a bed with no such gradient looks like a texture swatch
   * however good its plants are.
   */
  edgeAffinity: number;
}

export interface PlantingScheme {
  style: PlantingStyle;
  /** The ground the plants stand on. A `MaterialId`, loosely typed for the usual reason. */
  base: string;
  /** Painted in order, back to front. Layer order is draw order. */
  layers: PlantingLayer[];
}

/* ---------------------------------------------------------------- the schemes */

const BACKDROP_SHRUB: Omit<PlantingLayer, 'share' | 'clustering' | 'edgeAffinity'> = {
  role: 'backdrop',
  taxon: { type: 'shrub' },
  heightBand: { min: 1.2, max: 2 },
  spread: { min: 0.9, max: 1.4 },
};

const MASS_PERENNIAL: Omit<PlantingLayer, 'share' | 'clustering' | 'edgeAffinity'> = {
  role: 'mass',
  taxon: { type: 'perennial' },
  heightBand: { min: 0.5, max: 1 },
  spread: { min: 0.4, max: 0.7 },
};

const MID_GRASS: Omit<PlantingLayer, 'share' | 'clustering' | 'edgeAffinity'> = {
  role: 'mid',
  taxon: { type: 'grass-ornamental' },
  heightBand: { min: 0.6, max: 1.2 },
  spread: { min: 0.4, max: 0.8 },
};

const EDGE_COVER: Omit<PlantingLayer, 'share' | 'clustering' | 'edgeAffinity'> = {
  role: 'edge',
  taxon: { type: 'ground-cover' },
  heightBand: { min: 0.15, max: 0.4 },
  spread: { min: 0.25, max: 0.5 },
};

const ACCENT_FLOWER: Omit<PlantingLayer, 'share' | 'clustering' | 'edgeAffinity'> = {
  role: 'accent',
  taxon: { type: 'perennial', tags: ['flowering'] },
  heightBand: { min: 0.4, max: 0.9 },
  spread: { min: 0.3, max: 0.5 },
};

const SPECIMEN_ARCHITECTURAL: Omit<PlantingLayer, 'share' | 'clustering' | 'edgeAffinity'> = {
  role: 'specimen',
  taxon: { type: 'shrub', tags: ['architectural'] },
  heightBand: { min: 1, max: 1.8 },
  spread: { min: 1, max: 1.5 },
};

/**
 * The six schemes.
 *
 * Each is a claim about how that style of garden is actually planted, and the numbers carry it:
 * `contemporary` is few layers, heavily clustered, because repetition of one plant in large groups
 * *is* the style; `cottage` is every layer at once, barely clustered, because the point is that no
 * two square metres are the same. Reading the tables against each other is the quickest way to see
 * whether a style has been given a real identity or just a different hue.
 */
const SCHEMES: Record<PlantingStyle, PlantingScheme> = {
  contemporary: {
    style: 'contemporary',
    base: 'bark-mulch',
    layers: [
      { ...BACKDROP_SHRUB, share: 0.3, clustering: 0.8, edgeAffinity: -0.6 },
      { ...MID_GRASS, share: 0.45, clustering: 0.9, edgeAffinity: 0 },
      { ...EDGE_COVER, share: 0.25, clustering: 0.6, edgeAffinity: 0.8 },
    ],
  },
  cottage: {
    style: 'cottage',
    base: 'bark-mulch',
    layers: [
      { ...BACKDROP_SHRUB, share: 0.15, clustering: 0.3, edgeAffinity: -0.7 },
      { ...MASS_PERENNIAL, share: 0.45, clustering: 0.2, edgeAffinity: -0.1 },
      { ...ACCENT_FLOWER, share: 0.25, clustering: 0.25, edgeAffinity: 0.1 },
      { ...EDGE_COVER, share: 0.3, clustering: 0.2, edgeAffinity: 0.7 },
    ],
  },
  naturalistic: {
    style: 'naturalistic',
    base: 'bark-mulch',
    layers: [
      { ...MID_GRASS, share: 0.5, clustering: 0.85, edgeAffinity: -0.2 },
      { ...MASS_PERENNIAL, share: 0.4, clustering: 0.8, edgeAffinity: 0 },
      { ...ACCENT_FLOWER, share: 0.15, clustering: 0.9, edgeAffinity: 0.2 },
    ],
  },
  'low-maintenance': {
    style: 'low-maintenance',
    base: 'decorative-gravel',
    layers: [
      { ...BACKDROP_SHRUB, share: 0.35, clustering: 0.7, edgeAffinity: -0.4 },
      { ...EDGE_COVER, share: 0.4, clustering: 0.5, edgeAffinity: 0.5 },
    ],
  },
  architectural: {
    style: 'architectural',
    base: 'slate-chippings',
    layers: [
      { ...SPECIMEN_ARCHITECTURAL, share: 0.18, clustering: 0.9, edgeAffinity: -0.3 },
      { ...MID_GRASS, share: 0.28, clustering: 0.85, edgeAffinity: 0.2 },
    ],
  },
  pollinator: {
    style: 'pollinator',
    base: 'bark-mulch',
    layers: [
      { ...MASS_PERENNIAL, share: 0.5, clustering: 0.5, edgeAffinity: -0.1 },
      { ...ACCENT_FLOWER, share: 0.4, clustering: 0.45, edgeAffinity: 0.1 },
      { ...MID_GRASS, share: 0.2, clustering: 0.6, edgeAffinity: -0.3 },
    ],
  },
};

/** Every style, in a fixed order — for a picker, and for the preview sheet. */
export const PLANTING_STYLES: PlantingStyle[] = PlantingStyleSchema.options;

/**
 * What a bed of this material is mostly made of.
 *
 * **Style and material are two different questions and both have to survive.** The style says how a
 * bed is arranged — drifted or repeated, graded or even, sparse or dense. The material says what is
 * in it. Resolving only the style made every planting material draw the same picture: a bed of
 * `shrubs`, a bed of `ornamental-grasses` and a bed of `ground-cover` came out identical, because
 * with no style set they all fell back to the same layers. That is a plainly worse answer than the
 * uniform carpet it replaced — at least the carpet was a *different* carpet per material.
 *
 * So the material names a dominant plant, and it displaces whichever layers carry the body of the
 * scheme. A bed of shrubs planted cottage-style is still mostly shrubs; it is just arranged the way
 * a cottage garden arranges things.
 *
 * `mixed-border` is deliberately absent: a mixture is what it is, so it takes the style's own
 * layers untouched.
 */
const DOMINANT_TAXON: Record<string, string> = {
  shrubs: 'shrub',
  'ornamental-grasses': 'grass-ornamental',
  'ground-cover': 'ground-cover',
};

/** Which roles carry the body of a bed, and so take the material's dominant plant. */
const BODY_ROLES: PlantingRole[] = ['backdrop', 'mass', 'mid'];

/**
 * The scheme for a bed.
 *
 * Total by construction: an unknown or absent style resolves to `cottage` rather than to `null`,
 * because a bed always has to draw *something* and the alternative is a bare patch of soil for a
 * reason the user cannot see. Cottage is the fallback because it uses every layer, so a bed that
 * fell back still looks planted rather than sparse.
 *
 * The material then displaces the body layers — see `DOMINANT_TAXON`. The style's *structure* is
 * kept in every case: shares, clustering and edge affinity are what make a naturalistic bed
 * naturalistic, and they are as true of a bed of grasses as of a mixed one.
 */
export function schemeFor(style: string | undefined, material?: string): PlantingScheme {
  const parsed = PlantingStyleSchema.safeParse(style);
  const scheme = SCHEMES[parsed.success ? parsed.data : 'cottage'];

  const dominant = material === undefined ? undefined : DOMINANT_TAXON[material];
  if (!dominant) return scheme;

  return {
    ...scheme,
    layers: scheme.layers.map((layer) =>
      BODY_ROLES.includes(layer.role)
        ? // The tags go with the taxon they qualified; `flowering` means nothing to a ground cover.
          { ...layer, taxon: { type: dominant } }
        : layer,
    ),
  };
}

/**
 * The tallest thing a scheme plants, in metres.
 *
 * What the shadow model should use for a bed, in place of the flat per-material number in
 * `MATERIAL_HEIGHTS`: a bed with a two-metre backdrop shrub casts a very different shadow from a
 * bed of ground cover, and until now both were whatever their material said.
 */
export function schemeHeight(scheme: PlantingScheme): number {
  return scheme.layers.reduce((tallest, layer) => Math.max(tallest, layer.heightBand.max), 0);
}
