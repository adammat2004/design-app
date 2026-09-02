import { z } from 'zod';
import type { MaterialId } from './materials.js';

/**
 * The product geometry behind a material: how big one unit of it is, and how they are laid out.
 *
 * This is the half of a material's pattern that is *not* presentation. A 600 × 600 slab on a 10 mm
 * joint is a fact about a product — it is what a costing pass will count, and what tells a
 * landscaper how many slabs to order — so it belongs in the shared package next to `cost`, while
 * the tones it draws in stay in the web app beside `MATERIAL_FILLS`. Same seam `materials.ts`
 * already draws, for the same reason.
 *
 * **Millimetres, and only here.** Every coordinate in the app is metres; these are product
 * dimensions, quoted the way products are quoted. The renderer divides by `MM_PER_METRE` once, at
 * its top edge, and nothing downstream of that sees a millimetre.
 */

/**
 * How units are laid out across a surface.
 *
 * Four cases cover twenty of the twenty-seven materials, which is the whole point of the union:
 * a new material should be a manifest entry, not a new renderer.
 */
export const PatternTypeSchema = z.enum(['grid', 'board', 'scatter', 'stripe']);
export type PatternType = z.infer<typeof PatternTypeSchema>;

/** Millimetres. Shared by the two modular patterns. */
const moduleFields = {
  moduleSize: z.object({ w: z.number().positive(), h: z.number().positive() }),
  jointWidth: z.number().nonnegative(),
};

export const MaterialPatternSchema = z.discriminatedUnion('patternType', [
  /** Slabs and tiles: a straight, unstaggered grid. */
  z.object({ patternType: z.literal('grid'), ...moduleFields }),

  /**
   * Boards and planks. The same grid, staggered half a module row on row, because a deck laid
   * with its butt joints in line is a deck laid wrong.
   */
  z.object({ patternType: z.literal('board'), ...moduleFields }),

  /**
   * Individual things sitting on a ground: planting, bark, gravel, chippings.
   *
   * Density rather than a module size, because that is how planting is actually specified — five
   * to a square metre — and because it is what makes a bed of shrubs and a bed of ground cover
   * different things rather than the same thing at two scales.
   *
   * **Densities here are drawn densities, not planting schedules.** A border really planted at
   * five a square metre closes up in a season; drawn at five a square metre it reads as scattered
   * dots on mud, because a plan shows one instant and a garden is judged by how it will look. The
   * numbers below are chosen so that `density × the mean unit's area` comes to appreciably more
   * than 1 — units overlap, and the bed reads as planting rather than as soil. Do not treat these
   * as a quantity to order.
   */
  z.object({
    patternType: z.literal('scatter'),
    /** Units per square metre, as drawn. */
    density: z.number().positive(),
    /** Millimetres across. One unit's spread, drawn somewhere in this range. */
    sizeRange: z.object({ min: z.number().positive(), max: z.number().positive() }),
    /** Points around one unit's outline. 4 reads as gravel, 9 reads as a shrub. */
    lobes: z.number().int().min(3).max(16),
    /**
     * What one unit *is*, as a shape.
     *
     * Added because size, density and hue turned out not to be enough. Every planting material
     * drew the same round lobed blob and differed only in those three, which is why ornamental
     * grasses read as pale cauliflower and a hedge read as loose bobbles rather than a clipped
     * mass. Colour can stand in for form up to a point — `wildflower` and `mixed-border` work
     * precisely because their colour variation does the work — but a grass is a different *shape*
     * from a shrub, not a different shade of one.
     *
     * Optional, and resolved through `scatterForm` rather than defaulted here. `MATERIAL_PATTERNS`
     * is a hand-written manifest of literals that never goes through `.parse()`, so a Zod
     * `.default()` would look like it applied and never actually fire. Absent means `blob`, which
     * is what every scatter did before this existed — so nothing changes without opting in.
     */
    form: z.enum(['blob', 'tufted', 'clipped-mass']).optional(),
  }),

  /**
   * Mown bands. Turf, and the only pattern with no discrete unit at all — which is why it cannot
   * be expressed as a grid with a very long module: there is nothing to count.
   */
  z.object({
    patternType: z.literal('water'),
    /**
     * Millimetres between ripple crests, or 0 for a surface held still.
     *
     * Water is the one material where *stillness* is a design statement: a formal pool is meant to
     * be a mirror and a naturalistic pond is meant to move, and drawing both the same loses the
     * distinction the user chose between.
     */
    rippleSpacing: z.number().nonnegative(),
  }),

  z.object({
    patternType: z.literal('stripe'),
    /** Millimetres. One band — a mower's cutting width. */
    bandWidth: z.number().positive(),
    /** Degrees clockwise, added to the surface's own pattern rotation. */
    angle: z.number(),
  }),
]);
export type MaterialPattern = z.infer<typeof MaterialPatternSchema>;

/** The two patterns made of countable units, which is what a takeoff can divide an area by. */
export type ModularPattern = Extract<MaterialPattern, { patternType: 'grid' | 'board' }>;

export const MM_PER_METRE = 1000;

/**
 * Which materials have a pattern.
 *
 * `Partial` on purpose, and this is the one place it differs from `MATERIAL_FILLS`. A material
 * without a colour is a bug — it would draw as nothing — so that record is total and a missing
 * entry is a compile error. A material without a *pattern* is a legitimate answer: powder-coated
 * steel and still water have no texture at this scale, and they fall back to the flat fill they
 * have always had.
 */
export const MATERIAL_PATTERNS: Partial<Record<MaterialId, MaterialPattern>> = {
  /* ---- paved-area ---- */
  'stone-pavers': { patternType: 'grid', moduleSize: { w: 600, h: 600 }, jointWidth: 10 },
  concrete: { patternType: 'grid', moduleSize: { w: 900, h: 600 }, jointWidth: 8 },
  porcelain: { patternType: 'grid', moduleSize: { w: 600, h: 600 }, jointWidth: 5 },
  /*
   * Stepping stones are a grid whose "joint" is most of it — the gap is lawn, not mortar, which
   * is why the tone behind them is green. Expressing it this way rather than as a scatter keeps
   * them in line, which is the entire point of stepping stones.
   */
  'stepping-stones': { patternType: 'grid', moduleSize: { w: 450, h: 450 }, jointWidth: 260 },
  'timber-decking': { patternType: 'board', moduleSize: { w: 3600, h: 145 }, jointWidth: 6 },
  'gravel-paving': {
    patternType: 'scatter',
    density: 260,
    sizeRange: { min: 26, max: 52 },
    lobes: 5,
  },

  /* ---- lawn ---- */
  'standard-turf': { patternType: 'stripe', bandWidth: 1200, angle: 0 },
  'hardwearing-turf': { patternType: 'stripe', bandWidth: 1400, angle: 0 },
  /** Tighter and more regular than real grass, which is exactly how artificial turf reads. */
  'artificial-turf': { patternType: 'stripe', bandWidth: 800, angle: 0 },
  /** Sparse on purpose — a meadow is grass with flowers in it, so the ground shows and should. */
  wildflower: {
    patternType: 'scatter',
    density: 18,
    sizeRange: { min: 130, max: 320 },
    lobes: 6,
  },

  /* ---- planting-bed ---- */
  'mixed-border': {
    patternType: 'scatter',
    density: 5.5,
    sizeRange: { min: 420, max: 820 },
    lobes: 9,
  },
  shrubs: { patternType: 'scatter', density: 2.4, sizeRange: { min: 700, max: 1250 }, lobes: 9 },
  'ornamental-grasses': {
    form: 'tufted',
    patternType: 'scatter',
    /*
     * Denser than the blob-era value of 8, and the reason is the form rather than the planting.
     * The rule above — density x mean unit area comfortably over 1 — was calibrated against solid
     * blobs. A rosette of leaves covers perhaps half the ground a blob of the same radius does,
     * so the same number left a bed of grasses reading as soil with stars on it.
     */
    density: 15,
    sizeRange: { min: 340, max: 640 },
    lobes: 7,
  },
  /** Dense enough to close up into a mass, which is what distinguishes a hedge from a row. */
  hedging: {
    patternType: 'scatter',
    form: 'clipped-mass',
    density: 6.5,
    sizeRange: { min: 450, max: 680 },
    lobes: 8,
  },
  /*
   * The four water materials, which had no manifest at all and drew as a flat blue shape. Water is
   * a focal point — a plan with beautifully rendered paving next to a flat blob has exactly one
   * obviously unfinished element and it is the one the eye goes to.
   */
  'naturalistic-pond': { patternType: 'water', rippleSpacing: 260 },
  rill: { patternType: 'water', rippleSpacing: 150 },
  'formal-pool': { patternType: 'water', rippleSpacing: 0 },
  'water-bowl': { patternType: 'water', rippleSpacing: 0 },

  'ground-cover': {
    patternType: 'scatter',
    density: 18,
    sizeRange: { min: 250, max: 430 },
    lobes: 7,
  },

  /* ---- gravel-mulch ---- */
  'bark-mulch': {
    patternType: 'scatter',
    density: 130,
    sizeRange: { min: 45, max: 105 },
    lobes: 4,
  },
  'decorative-gravel': {
    patternType: 'scatter',
    density: 240,
    sizeRange: { min: 24, max: 46 },
    lobes: 5,
  },
  'play-bark': { patternType: 'scatter', density: 95, sizeRange: { min: 60, max: 130 }, lobes: 4 },
  'slate-chippings': {
    patternType: 'scatter',
    density: 170,
    sizeRange: { min: 32, max: 64 },
    lobes: 4,
  },

  /* ---- structure ---- */
  softwood: { patternType: 'board', moduleSize: { w: 2400, h: 120 }, jointWidth: 5 },
  'painted-timber': { patternType: 'board', moduleSize: { w: 2400, h: 140 }, jointWidth: 4 },
  hardwood: { patternType: 'board', moduleSize: { w: 3000, h: 130 }, jointWidth: 5 },
};

/**
 * A material's pattern, or `null` for the flat-fill path.
 *
 * Takes a plain string because `DesignElement.material` is one — a stored document must not become
 * unparseable because the catalogue was edited, which is the same reason `findMaterial` is written
 * this way.
 */
export function materialPattern(id: string | undefined): MaterialPattern | null {
  if (!id) return null;

  return MATERIAL_PATTERNS[id as MaterialId] ?? null;
}

/** Whether a material draws as a pattern rather than a flat colour. */
export function hasPattern(id: string | undefined): boolean {
  return materialPattern(id) !== null;
}

/** Whether a pattern is made of countable units. Narrows for `modulePitchMetres`. */
export function isModular(pattern: MaterialPattern): pattern is ModularPattern {
  return pattern.patternType === 'grid' || pattern.patternType === 'board';
}

/**
 * The pitch of one module including its joint, in metres — the distance from a module's leading
 * edge to the next one's.
 *
 * Exported because it is what a future costing pass divides an area by, and having the renderer
 * and the estimate derive it separately is exactly how the two come to disagree. Narrowed to the
 * modular patterns: a lawn has no module, and asking how many turfs are in it is the wrong
 * question — that one is sold by the roll, by area.
 */
export function modulePitchMetres(pattern: ModularPattern): { x: number; y: number } {
  return {
    x: (pattern.moduleSize.w + pattern.jointWidth) / MM_PER_METRE,
    y: (pattern.moduleSize.h + pattern.jointWidth) / MM_PER_METRE,
  };
}

/**
 * Roughly how many units cover a square metre. The scatter equivalent of `modulePitchMetres`, and
 * the number a planting schedule is written in.
 */
export function unitsPerSquareMetre(pattern: MaterialPattern): number | null {
  if (pattern.patternType === 'scatter') return pattern.density;
  if (pattern.patternType === 'stripe' || pattern.patternType === 'water') return null;

  const pitch = modulePitchMetres(pattern);
  return 1 / (pitch.x * pitch.y);
}

/**
 * What one scattered unit is shaped like, resolved.
 *
 * Total by construction, so no renderer has to decide what an absent `form` means — the same
 * reason `patternAnchor` and `heightFor` exist.
 */
export function scatterForm(
  pattern: Extract<MaterialPattern, { patternType: 'scatter' }>,
): 'blob' | 'tufted' | 'clipped-mass' {
  return pattern.form ?? 'blob';
}
