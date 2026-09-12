import type { Point } from '../geometry/primitives.js';
import { geometryOutline } from './features.js';
import { isWallingMaterial } from './materials.js';
import { resolveSymbol } from './symbols.js';
import type { DesignElement } from './concepts.js';

/**
 * Where the ground changes level, derived from the elements that stand above or below it.
 *
 * ## The model is local, and that is a refusal rather than a simplification
 *
 * There is no ground surface here: no spot levels, no contours, no fall across the plot. A real
 * site has all three and they come off a survey — which is exactly the kind of fact `site.location`
 * is nullable to avoid inventing. So a level change is not "the garden slopes 1:20 to the north",
 * it is "this terrace is 450 mm up", stated per element on `DesignElement.elevation` and true of
 * nothing else.
 *
 * What follows from that is the shape of this file. A retaining structure is **not a thing anybody
 * places**; it is what the edge of a raised element *is*. Derived, for the same reason edging is
 * derived from the bed it follows: a wall stored beside a terrace is a wall that can be left behind
 * when the terrace moves.
 *
 * ## Which sides
 *
 * Every side except the ones against the house, and the reason is physical rather than tidy. The
 * ground drops away from a raised terrace on every free edge, so every free edge needs holding —
 * but where a terrace meets the building there is no drop and no upstand, only floor meeting wall.
 * The boundary is deliberately **not** excluded, unlike in `edgingRuns`: a terrace raised against
 * the fence really does need retaining there, and the fence is not holding it up.
 */

/** One face of a level change: a run along an element's edge, and how far it stands proud. */
export interface LevelBand {
  /** The element this belongs to. */
  hostId: string;
  /** World metres. The edge the face stands on, at least two points. */
  points: Point[];
  /**
   * Metres of exposed face, always positive.
   *
   * A sunken area's face is the same height as a raised one's — the difference is which side of it
   * the ground is on, and `sunken` says which.
   */
  rise: number;
  /** Whether the ground beyond this face is higher than the element rather than lower. */
  sunken: boolean;
  /**
   * What the wall is built of, or `null` for a plain upstand in the host's own paving.
   *
   * `null` is not a gap: most raised terraces are retained in the material they are paved with, and
   * a caller draws that as the host's own tone darkened. A value here means the user chose to make
   * the wall a different material from the thing it holds up, and the caller draws its real face.
   */
  walling: string | null;
  /** The host's own material, for the caller that has to draw the plain upstand. */
  material: string | undefined;
  /** Metres. Summed by nothing yet; carried so a schedule can report a face area later. */
  length: number;
}

/**
 * Below this a level change is a kerb rather than a step, and draws as one.
 *
 * 75 mm, which is about where a change stops being something you step up and starts being
 * something you trip on. Below it the upstand would be a line a pixel wide at any plan zoom and
 * would read as an edging course rather than as a change of level — and edging is a different
 * thing the user may already have asked for on the same element.
 */
export const MIN_LEVEL_CHANGE = 0.075;

/** Below this a face is a tessellation artefact rather than a length of wall. */
const MIN_FACE_LENGTH = 0.15;

/**
 * Every exposed face of every element that does not sit on grade.
 *
 * `house` is the footprint, and the only thing excluded: see the note above about which sides. A
 * caller without one gets every side, which is the honest answer for a plan with no building.
 */
export function levelBands(
  elements: DesignElement[],
  exclude: { house?: Point[] } = {},
): LevelBand[] {
  const house = exclude.house && exclude.house.length >= 3 ? exclude.house : null;
  const bands: LevelBand[] = [];

  for (const element of elements) {
    if (element.hidden) continue;

    const elevation = element.elevation ?? 0;
    if (Math.abs(elevation) < MIN_LEVEL_CHANGE) continue;

    /*
     * A point has no perimeter to retain. A tree standing in a raised bed is carried up by the bed
     * it is in, and giving it a plinth of its own would draw a ring round every shrub on a terrace.
     */
    if (element.shape.kind === 'point') continue;

    /*
     * A flight of steps carries an elevation — it has to, because that is what its nosings are
     * counted from — but it is the thing that *resolves* a level change rather than one that needs
     * holding back. Retaining it draws a wall round the very route down off the terrace, which is
     * both wrong and the one place a reader's eye goes.
     */
    if (resolveSymbol(element) === 'steps') continue;

    const outline = geometryOutline(element.shape);
    if (outline.length < 3) continue;

    const segments = segmentsOf(outline);
    const kept = segments.map(
      (segment) =>
        segmentLength(segment) >= MIN_FACE_LENGTH &&
        !(house && segmentLiesOn(segment, house)),
    );

    for (const chain of chainsOf(segments, kept)) {
      bands.push({
        hostId: element.id,
        points: chain,
        rise: Math.abs(elevation),
        sunken: elevation < 0,
        walling: isWallingMaterial(element.retaining) ? element.retaining! : null,
        material: element.material,
        length: chainLength(chain),
      });
    }
  }

  return bands;
}

/**
 * How many risers a flight climbing this far needs, and how tall each one is.
 *
 * **Derived, never stored.** A flight's rise is its element's own `elevation`, so the tread count
 * follows from it — and a stored count is a count that can disagree with the height it climbs the
 * moment somebody edits one of them.
 *
 * `RISER_TARGET` is 170 mm, which is the middle of what Approved Document K allows for a private
 * stair and what a garden flight is actually built to. The real riser is the rise divided by a
 * whole number of steps, so it lands near 170 rather than on it — which is how stairs work: you
 * cannot build two thirds of a step.
 *
 * **`ceil`, not `round`, and that is a correctness fix rather than a preference.** Rounding to the
 * nearest whole number of steps lets the riser overshoot the target by half a step: a 230 mm rise
 * rounds to one riser of 230 mm, which is steeper than Approved Document K allows for a private
 * stair at all. Taking the ceiling means the riser can only ever come out at or below the target —
 * the flight errs shallow, always, which is the right way for a garden step to be wrong. A property
 * test walks every rise from 100 mm to 2 m and holds the whole band.
 */
export const RISER_TARGET = 0.17;

export interface StepFlight {
  risers: number;
  /** Metres. The equal height each step actually gets, close to `RISER_TARGET`. */
  riserHeight: number;
}

export function stepFlight(rise: number): StepFlight | null {
  const climb = Math.abs(rise);
  if (climb < MIN_LEVEL_CHANGE) return null;

  const risers = Math.max(1, Math.ceil(climb / RISER_TARGET));

  return { risers, riserHeight: climb / risers };
}

/* ---------------------------------------------------------------- geometry */

/*
 * The same four helpers `edging.ts` uses, and deliberately copied rather than shared.
 *
 * They are twenty lines of segment arithmetic, and the two callers want them to mean subtly
 * different things — `edgingRuns` drops the sides against the boundary, this one keeps them. A
 * shared helper taking a flag for that would make one file's rule readable only by going and
 * reading the other's, which is the coupling both modules exist to avoid.
 */

function segmentsOf(ring: Point[]): [Point, Point][] {
  return ring.map((point, index) => [point, ring[(index + 1) % ring.length]!] as [Point, Point]);
}

function segmentLength([a, b]: [Point, Point]): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function segmentLiesOn([a, b]: [Point, Point], ring: Point[]): boolean {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return [a, mid, b].every((point) => distanceToRing(point, ring) <= 0.06);
}

function chainsOf(segments: [Point, Point][], kept: boolean[]): Point[][] {
  if (kept.every((keep) => !keep)) return [];

  if (kept.every((keep) => keep)) {
    return [[...segments.map(([a]) => a), segments[0]![0]]];
  }

  const start = kept.findIndex(
    (keep, index) => keep && !kept[(index - 1 + kept.length) % kept.length],
  );
  const chains: Point[][] = [];
  let current: Point[] = [];

  for (let step = 0; step < segments.length; step += 1) {
    const index = (start + step) % segments.length;
    if (kept[index]) {
      if (current.length === 0) current.push(segments[index]![0]);
      current.push(segments[index]![1]);
      continue;
    }
    if (current.length >= 2) chains.push(current);
    current = [];
  }

  if (current.length >= 2) chains.push(current);

  return chains;
}

function chainLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  }
  return total;
}

function distanceToRing(point: Point, ring: Point[]): number {
  let best = Infinity;
  for (const [a, b] of segmentsOf(ring)) {
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));

  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
