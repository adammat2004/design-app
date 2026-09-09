import type { Maturity } from './scene';

/**
 * How grown-in the planting is drawn.
 *
 * A plan shows one instant and a garden is judged by how it will look, which is the same argument
 * `material-patterns.ts` already makes about drawn densities. So the honest thing is not to pick
 * one moment and pretend it is the garden, but to say which moment is being drawn.
 *
 * ## Two knobs, and only one of them may touch the sampler
 *
 * - **`crown`** scales `placement.spread` *after* sampling. It must never be folded into
 *   `PlantingLayer.spread`, because `cellSize` is derived from that spread — shrinking it would
 *   renumber every cell and slide the whole bed sideways as the user moved a slider, which is the
 *   exact failure the world-anchored grid exists to prevent.
 * - **`density`** multiplies `PlantingLayer.share`, which is the sampler's acceptance term.
 *
 * ## Why the density knob is safe, and why that is a property rather than a hope
 *
 * In `samplePlanting`, acceptance is `random() > share * drift * graded ? skip : keep`, and that
 * draw sits at a *fixed position* in each cell's sequence — the third, after the two jitter
 * draws. Lowering `share` therefore lowers the bar in every cell independently and can only
 * **remove** plants: every survivor keeps the identical position, spread, rotation and variant it
 * had, because those draws come afterwards and are untouched.
 *
 * So `year-1 ⊆ year-3 ⊆ mature`, positionally, and a young garden is literally the mature one
 * with plants taken out rather than a different garden that happens to be sparser. There is a
 * test pinning it. Nothing else in this file may break that ordering.
 *
 * ## What this is not
 *
 * Not a planting schedule and not a quantity. `quantities.ts` never sees a `RenderPlant`, and the
 * schedule still reports beds in square metres with a dash where a count would be a lie. This
 * changes how grown-in the picture looks and nothing about what was specified or what it costs.
 */
export interface MaturityFactors {
  /** Multiplies a placement's drawn spread. */
  crown: number;
  /** Multiplies a layer's `share`, the sampler's acceptance term. */
  density: number;
}

export const MATURITY: Record<Maturity, MaturityFactors> = {
  /*
   * Nursery stock in its first season: a little over half its eventual spread, and thinned. A bed
   * planted at final spacing genuinely does show mulch between the plants in year one — around
   * 45% covered, measured — and drawing it closed up is the lie this setting exists to expose.
   */
  'year-1': { crown: 0.55, density: 0.72 },
  /* Knitting together, about 83% covered. Most perennials have met by now; the shrubs have not. */
  'year-3': { crown: 0.82, density: 0.9 },
  /*
   * What the design is for: full spread, nothing thinned, and about 93% covered — inside the
   * 70-95% band a mature bed should read at. Deliberately not 100%: a few dark gaps between
   * crowns are what keeps individual plants legible instead of one flat mat of green.
   */
  mature: { crown: 1, density: 1 },
};

export const MATURITY_ORDER: Maturity[] = ['year-1', 'year-3', 'mature'];

export const MATURITY_LABELS: Record<Maturity, string> = {
  'year-1': 'Year 1',
  'year-3': 'Year 3',
  mature: 'Mature',
};
