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

/**
 * How the courses are set out relative to each other.
 *
 * Every grid material was laid stack bond — every joint lining up in both directions — because
 * that was the only thing the renderer could do. It is also the one bond almost nobody uses for
 * paving, and it is why a patio here read as bathroom tiling: continuous cross joints are the
 * visual signature of a tiled wall, and breaking them is the visual signature of something laid on
 * the ground.
 *
 * Offsets are a fraction of the module pitch, applied per row. `board` keeps its own half stagger
 * by defaulting to `running`, so decking is unchanged.
 */
export const BondSchema = z.enum([
  /** Every joint aligned both ways. Correct for large-format porcelain, wrong for almost else. */
  'stack',
  /** Half-bond: each course offset half a module. The ordinary way slabs and bricks are laid. */
  'running',
  /** Third-bond, which is what a long thin unit wants — a half bond on a plank looks like a mistake. */
  'third',
  /**
   * A different offset every course, from the surface's own seed.
   *
   * Random *coursed*, not random: the courses are still straight lines of one height, which is how
   * sandstone and limestone are actually laid. Fully random sizes would need the grid abandoned,
   * and with it the shared-origin continuity that keeps two abutting patios in one course.
   */
  'random',
]);
export type Bond = z.infer<typeof BondSchema>;

/** Millimetres. Shared by the two modular patterns. */
const moduleFields = {
  moduleSize: z.object({ w: z.number().positive(), h: z.number().positive() }),
  jointWidth: z.number().nonnegative(),
  /**
   * Optional, and resolved through `bondFor` rather than defaulted here.
   *
   * `MATERIAL_PATTERNS` is a hand-written manifest of literals that never goes through `.parse()`,
   * so a Zod `.default()` would look like it applied and never fire — the same trap `scatterForm`
   * and `patternAnchor` exist to avoid. Absent means `stack` for a grid and `running` for a board,
   * which is exactly what each drew before this field existed.
   */
  bond: BondSchema.optional(),
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
   * A clipped hedge: one continuous body with a defined edge, running along its own line.
   *
   * **A hedge is not a scatter, and modelling it as one was the defect.** `hedging` was a scatter
   * with `form: 'clipped-mass'`, which drew overlapping blobs on a grid and merged them — so it had
   * no idea which way the hedge ran. The result was a camouflage pattern with pale holes in it
   * rather than a hedge: no ends, no long edges, no direction, and the lit side no more lit than
   * the shaded one. A row of shrubs and a clipped hedge are different things and the difference is
   * entirely directional.
   *
   * A run knows its line, so it can do the three things that read as a hedge: sit at a stated
   * width, cap its ends, and catch the light along one long edge.
   */
  z.object({
    patternType: z.literal('hedge'),
    /** Millimetres. One crown of foliage — the unit the run is built from. */
    crownSize: z.number().positive(),
    /**
     * Millimetres between crowns along the run.
     *
     * Deliberately *less* than `crownSize`: the crowns have to overlap or the hedge reads as a row
     * of separate bushes, which is the thing a clipped hedge is specifically not.
     */
    pitch: z.number().positive(),
  }),

  /**
   * Discrete pads set along a path: stepping stones, sleepers across gravel, a line of setts.
   *
   * **Not a grid, and modelling it as one was a real defect.** Stepping stones were a `grid` whose
   * joint was most of it, on the reasoning that a grid keeps them in line — which is the point of
   * stepping stones. But a grid is two-dimensional, so on a path a metre and a half wide it laid
   * *two* columns of pads with grass between, and every path in every generated plan read as a
   * ladder rather than as a way to walk. The stones were in line in the wrong direction.
   *
   * A pad run is one-dimensional by construction: pads march along the path's own centreline, one
   * abreast, and the ribbon's width decides only how big they may be.
   */
  z.object({
    patternType: z.literal('pads'),
    /** Millimetres. One pad. The pattern is a single file of these, whatever the strip's width. */
    padSize: z.object({ w: z.number().positive(), h: z.number().positive() }),
    /** Millimetres of ground between one pad and the next — a comfortable stride, not a joint. */
    gap: z.number().nonnegative(),
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
    /**
     * What sort of water this is, beyond how fast it moves.
     *
     * `rippleSpacing` alone was not enough to tell the four water materials apart: a formal pool
     * and a water bowl are both perfectly still, so they resolved to the same two numbers and drew
     * the same picture — and all four shared one photograph. This is the axis that separates them,
     * and each value names a real difference a designer would recognise:
     *
     * - `reflective` — a mirror. The sky in it, a hard defined lip, nothing growing.
     * - `still` — held water in a vessel: small, dark, no horizon to reflect.
     * - `moving` — a rill or a spill, where the direction of travel is the point.
     * - `planted` — a pond, with marginal planting round the edge and a dark unreadable middle.
     *
     * Optional and resolved by `waterSurface`, for the manifest-literal reason `bond` gives.
     */
    surface: z.enum(['reflective', 'still', 'moving', 'planted']).optional(),
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
  /*
   * Random coursed, which is how riven sandstone and limestone are actually laid — and the single
   * change that stops a patio reading as a tiled bathroom floor. A square module on a random bond
   * still gives a continuously varying vertical joint line, which is the signature.
   */
  'stone-pavers': {
    patternType: 'grid',
    moduleSize: { w: 600, h: 600 },
    jointWidth: 10,
    bond: 'random',
  },
  /** A rectangular flag on a half bond: the ordinary municipal and driveway paving. */
  concrete: {
    patternType: 'grid',
    moduleSize: { w: 900, h: 600 },
    jointWidth: 8,
    bond: 'running',
  },
  /*
   * The one material that really is stack bond, and it is stated rather than left to the default
   * so the reason is on the record: large-format porcelain is laid with continuous joints on
   * purpose, and a half bond on it would be the mistake.
   */
  porcelain: {
    patternType: 'grid',
    moduleSize: { w: 600, h: 600 },
    jointWidth: 5,
    bond: 'stack',
  },
  /*
   * Pads along the path, not a grid over it.
   *
   * This was a grid whose "joint" was most of it, on the reasoning that a grid keeps the stones in
   * line — which is the entire point of stepping stones. The reasoning was right and the shape was
   * wrong: a grid lines them up in *both* directions, so a path a metre and a half wide got two
   * columns of stones with grass down the middle and read as a ladder. Every path the generator has
   * ever drawn looked like that.
   *
   * 450 mm pads at a 380 mm gap is a stride of about 830 mm, which is a comfortable one.
   */
  'stepping-stones': { patternType: 'pads', padSize: { w: 450, h: 450 }, gap: 380 },
  /*
   * Third bond rather than the half stagger boards defaulted to. On a 3.6 m board a half bond puts
   * every other butt joint in exactly the same place down the whole deck, which reads as a
   * repeating error rather than as a laid floor.
   */
  'timber-decking': {
    patternType: 'board',
    moduleSize: { w: 3600, h: 145 },
    jointWidth: 6,
    bond: 'third',
  },
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
  /*
   * A run along its own line, not a field of blobs — see the `hedge` case above for what was wrong
   * with the scatter it replaced. 600 mm crowns at a 380 mm pitch overlap by a third, which closes
   * into one body while still varying along its length.
   */
  hedging: { patternType: 'hedge', crownSize: 600, pitch: 380 },
  /*
   * The four water materials, which had no manifest at all and drew as a flat blue shape. Water is
   * a focal point — a plan with beautifully rendered paving next to a flat blob has exactly one
   * obviously unfinished element and it is the one the eye goes to.
   */
  'naturalistic-pond': { patternType: 'water', rippleSpacing: 260, surface: 'planted' },
  rill: { patternType: 'water', rippleSpacing: 150, surface: 'moving' },
  'formal-pool': { patternType: 'water', rippleSpacing: 0, surface: 'reflective' },
  'water-bowl': { patternType: 'water', rippleSpacing: 0, surface: 'still' },

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
  /*
   * `pads` has no answer here, and that is not an omission. Pads march in single file along a
   * path, so what they cover is a *length* rather than an area — a takeoff wants "eighteen stones",
   * arrived at from the path's length, and dividing an area by a pad's footprint would report a
   * number for paving the path was never going to have.
   */
  if (
    pattern.patternType === 'stripe' ||
    pattern.patternType === 'water' ||
    pattern.patternType === 'pads' ||
    pattern.patternType === 'hedge'
  ) {
    return null;
  }

  const pitch = modulePitchMetres(pattern);
  return 1 / (pitch.x * pitch.y);
}

/**
 * How far apart consecutive pads sit, centre to centre, in metres.
 *
 * The pad equivalent of `modulePitchMetres`, and what a takeoff divides a path's length by.
 */
export function padPitchMetres(pattern: Extract<MaterialPattern, { patternType: 'pads' }>): number {
  return (pattern.padSize.h + pattern.gap) / MM_PER_METRE;
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

/**
 * How this material's courses are set out.
 *
 * A resolver rather than a Zod default, for the reason `scatterForm` is one: `MATERIAL_PATTERNS`
 * is hand-written literals that never go through `.parse()`.
 *
 * The two defaults differ, and that is what makes the field free to add. A `grid` with no bond is
 * `stack`, which is what every slab drew before; a `board` with no bond is `running`, which is the
 * half stagger the renderer had hardcoded for decking. Neither changes a pixel until a material
 * opts in.
 */
export function waterSurface(
  pattern: Extract<MaterialPattern, { patternType: 'water' }>,
): 'reflective' | 'still' | 'moving' | 'planted' {
  /*
   * Falls back to what `rippleSpacing` already implied, so a water material that never states a
   * surface draws what it drew before: still water reads as a mirror, moving water as a pond.
   */
  return pattern.surface ?? (pattern.rippleSpacing === 0 ? 'reflective' : 'planted');
}

export function bondFor(pattern: ModularPattern): Bond {
  return pattern.bond ?? (pattern.patternType === 'board' ? 'running' : 'stack');
}

/**
 * How far a course is offset, as a fraction of the module pitch.
 *
 * Takes the row and a seed so `random` can be *deterministic per course* — the same spatial-hash
 * discipline the scatter placement follows. Offsetting from the draw order instead would reshuffle
 * every course the moment a vertex moved and repaint the whole surface.
 *
 * Note the offset is a fraction rather than a distance: two abutting patios share a pattern origin
 * and therefore share a row index, so they take the same offset and their courses run through.
 */
export function bondOffset(bond: Bond, row: number, courseRandom: () => number): number {
  switch (bond) {
    case 'stack':
      return 0;
    case 'running':
      return row % 2 === 0 ? 0 : 0.5;
    case 'third':
      // Three-course repeat: 0, ⅓, ⅔ — a half bond on a long thin unit reads as a mistake.
      return (((row % 3) + 3) % 3) / 3;
    case 'random':
      /*
       * Quantised to eighths. A continuous offset produces slivers at the clip edge that read as
       * badly cut stone rather than as a coursed pattern, and a mason setting out random coursed
       * work is working to a module anyway.
       */
      return Math.floor(courseRandom() * 8) / 8;
  }
}
