import type { PlantingLayer, Point } from '@garden-studio/schema';
import { moduleRandom } from '../prng';

/**
 * Where the plants go.
 *
 * A pure function of `(outline, layer, seed)` — no canvas, no assets, no drawing. That is not
 * tidiness: it is what keeps open the door the plan cares about. A future "explode this bed into
 * individual plants" action has to place the real elements *exactly* where the drawn ones were, and
 * the only way that is true by construction is if both call this.
 *
 * ## Why not Poisson-disc
 *
 * Bridson's algorithm is the textbook answer for scattered points that do not clump, and it is the
 * wrong tool here. It is **sequence-ordered**: each sample depends on the active list built by
 * every sample before it, so the placement of a plant depends on the order the polygon was walked.
 * Drag one vertex and every plant in the bed moves.
 *
 * The existing scatter painter avoids that with a jittered grid keyed on the cell — the placement
 * of cell (col, row) is a pure function of (seed, col, row) and of nothing else — which is why
 * re-clipping a bed after a drag repaints only the cells that changed. That property is worth more
 * than blue-noise purity, and everything here is built to preserve it:
 *
 * ```
 *   spatially hashed          sequence ordered
 *   ────────────────          ────────────────
 *   cell (7, 3) is always     plant #412 depends on plants #1..411
 *   the same plant            → any edit repaints the whole bed
 *   → edits are local
 * ```
 *
 * Every number below comes from `moduleRandom(seed, col, row)`. No accumulators, no counters, and
 * nothing that reads a neighbouring cell's *result*.
 *
 * ## What replaces the rejection step
 *
 * Real Poisson sampling rejects a candidate that lands too near an accepted one. That comparison is
 * inherently order-dependent, so it is not done. Three things stand in for it, and between them
 * they do the job a border actually needs:
 *
 * - **The cell is the spacing.** One unit per cell, cell size derived from the layer's own spread,
 *   so units of one layer cannot pile up.
 * - **Layers are separate grids.** A backdrop shrub at 1.4 m cells and an edging plant at 0.4 m
 *   cells interleave without either knowing about the other, and overlap between *different*
 *   layers is what a planted border looks like anyway.
 * - **Acceptance is weighted, not uniform.** Drift noise and edge affinity thin a layer where it
 *   should be thin, which is what stops an even grid reading as bedding-out.
 */

export interface Placement {
  /** World metres. */
  at: Point;
  /** Metres across — the plant's drawn spread, between the layer's own bounds. */
  spread: number;
  /** Radians. Sprites are turned so a repeated family does not read as a stamp. */
  rotation: number;
  /** Which variant of the layer's family to draw, as a unit interval. */
  variant: number;
  /** 0 at the bed's centre, 1 at its edge. Kept so a caller can shade or sort by it. */
  edgeness: number;
  /** Which palette tone, as a unit interval. Drawn here so the painter needs no generator. */
  tone: number;
  /** Whether this plant carries a flower on top, as a unit interval against the share. */
  flower: number;
}

/** Cells are sized from the layer's mean spread, so a bigger plant is planted further apart. */
export function cellSize(layer: PlantingLayer): number {
  const mean = (layer.spread.min + layer.spread.max) / 2;
  /*
   * Tighter than the spread, deliberately, and this is the drawn-density rule `material-patterns`
   * already warns about: a border really planted at its mature spread has bare soil between every
   * plant for two seasons, and a plan showing that reads as a failure rather than as a new garden.
   *
   * 0.6 rather than the 0.8 first tried. The layers thin themselves by rejection — `share`, drift
   * and the front-to-back grade all refuse cells — so the *surviving* plants have to sit closer
   * together than a planting schedule would space them or the bed comes out as scattered plants on
   * a field of bark. Judged on the whole-plan sheet rather than on a swatch, because a swatch of
   * any bed looks planted and a plan is where a sparse one shows.
   */
  return Math.max(0.12, mean * 0.6);
}

/**
 * Smooth value noise on world coordinates, in 0-1.
 *
 * **Keyed on the world, not on the cell index.** A drift has to stay where it is when the bed's
 * outline changes — if it were keyed on cell indices, dragging the bed's edge would renumber the
 * cells and slide every drift sideways, which is the exact failure the whole spatial-hash design
 * exists to avoid. Two beds that overlap in space also share their drifts, which is right: they are
 * in the same garden.
 *
 * Bilinear rather than a gradient noise, because it is a handful of lines and the difference is
 * invisible under plants. `scale` is the drift's size in metres.
 */
export function driftNoise(seed: string, at: Point, scale: number): number {
  const x = at.x / scale;
  const y = at.y / scale;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  // Smoothstep, so the field has no visible creases along the lattice.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const corner = (cx: number, cy: number) => moduleRandom(`${seed}:drift`, cx, cy)();

  const top = corner(x0, y0) * (1 - sx) + corner(x0 + 1, y0) * sx;
  const bottom = corner(x0, y0 + 1) * (1 - sx) + corner(x0 + 1, y0 + 1) * sx;

  return top * (1 - sy) + bottom * sy;
}

/** Distance from a point to the nearest edge of a ring, in metres. Zero outside. */
export function distanceToEdge(at: Point, outline: Point[]): number {
  let nearest = Infinity;

  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % outline.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;

    let t = 0;
    if (lengthSq > 1e-12) {
      t = ((at.x - a.x) * dx + (at.y - a.y) * dy) / lengthSq;
      t = Math.max(0, Math.min(1, t));
    }

    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const distance = Math.hypot(at.x - px, at.y - py);
    if (distance < nearest) nearest = distance;
  }

  return nearest === Infinity ? 0 : nearest;
}

export function pointInPolygon(at: Point, outline: Point[]): boolean {
  let inside = false;

  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const a = outline[i]!;
    const b = outline[j]!;
    const straddles = a.y > at.y !== b.y > at.y;
    if (straddles && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }

  return inside;
}

export interface SampleOptions {
  /** Rings this layer must not plant inside — a path crossing the bed, a structure standing in it. */
  exclusions?: Point[][];
  /** How deep the bed reads as "edge", in metres. Beyond this, `edgeness` has settled to 0. */
  edgeDepth?: number;
}

/**
 * One layer's plants, in a stable order.
 *
 * Cells are walked in row-major order over the outline's bounding box. That order decides *draw*
 * order and nothing else — no cell's outcome depends on any other, so walking it differently would
 * give the same set of plants in a different sequence.
 */
export function samplePlanting(
  outline: Point[],
  layer: PlantingLayer,
  seed: string,
  options: SampleOptions = {},
): Placement[] {
  if (outline.length < 3) return [];

  const cell = cellSize(layer);
  const edgeDepth = options.edgeDepth ?? Math.max(0.5, layer.spread.max * 1.5);
  const exclusions = options.exclusions ?? [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of outline) {
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }

  /*
   * Cell indices from the **world origin**, not from the bed's own corner — the same rule
   * `gridRange` follows. Anchoring to the corner would renumber every cell the moment a vertex
   * moved, which is precisely the repaint this design exists to avoid.
   */
  const minCol = Math.floor(minX / cell);
  const maxCol = Math.ceil(maxX / cell);
  const minRow = Math.floor(minY / cell);
  const maxRow = Math.ceil(maxY / cell);

  const placements: Placement[] = [];
  // Drifts are several plants across, or they read as noise rather than as planting.
  const driftScale = Math.max(1.5, cell * 6);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) {
      const random = moduleRandom(`${seed}:${layer.role}`, col, row);

      // Jitter inside the cell, so the grid never shows through as a lattice.
      const at = {
        x: (col + 0.15 + random() * 0.7) * cell,
        y: (row + 0.15 + random() * 0.7) * cell,
      };

      if (!pointInPolygon(at, outline)) continue;
      if (exclusions.some((ring) => pointInPolygon(at, ring))) continue;

      const depth = distanceToEdge(at, outline);
      const edgeness = Math.max(0, 1 - depth / edgeDepth);

      /*
       * Acceptance, and the three terms are the whole of the composition.
       *
       * `share` is the layer's own coverage. Drift multiplies it up or down over a few metres, so
       * the layer gathers into groups rather than spreading evenly. Edge affinity tilts it towards
       * the front or the middle of the bed, which is what grades a border — low things at the
       * front, tall behind — and is the single strongest cue that a bed was planted rather than
       * filled.
       */
      const drift = 1 - layer.clustering + layer.clustering * driftNoise(seed, at, driftScale) * 2;
      const graded = 1 + layer.edgeAffinity * (edgeness * 2 - 1);
      const chance = layer.share * drift * graded;

      if (random() > chance) continue;

      placements.push({
        at,
        spread: layer.spread.min + random() * (layer.spread.max - layer.spread.min),
        rotation: random() * Math.PI * 2,
        variant: random(),
        edgeness,
        tone: random(),
        flower: random(),
      });
    }
  }

  return placements;
}
