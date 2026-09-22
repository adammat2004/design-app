import { polygonArea, pointInPolygon, type Point } from '@garden-studio/schema';
import { clamp01, NOT_APPLICABLE, type MeasuredIssue, type PrincipleResult } from './result.js';
import type { DesignSubject } from './subject.js';

/**
 * Is there anything overhead?
 *
 * The principle whose absence was measurable in the drawings long before it was measurable in the
 * score. Every other rule here can be satisfied by a garden with no trees in it: the paths reach
 * everything, the terrace is by the doors, the borders are the right depth, and the plan is still
 * a flat arrangement of rectangles with three specimens standing in open lawn. The professional
 * reference has about ten canopies over two hundred square metres, and what they give it —
 * enclosure, a scale to read the rest against, shade over the terrace, something interrupting the
 * view to the fence — is most of what makes it read as designed rather than as laid out.
 *
 * So the candidate loop needs a reason to prefer the fuller garden. It only ever prefers what it
 * can measure, and until this existed the extra trees the generator now plants were tolerated
 * rather than wanted: a candidate with three scored exactly as well as one with eleven.
 *
 * **Conditional, like `sun` and `maintenanceFit`.** A courtyard has nowhere to put a tree, and a
 * plan is not marked down for a question its plot never asked.
 *
 * **It has no authority over geometry.** Every canopy it reads was placed and checked long before
 * this ran; the worst it can do is rank one legal plan above another.
 */

/**
 * The share of the room a designed garden has under canopy, as a band.
 *
 * Read off the reference rather than chosen, and quoted as a range for the same reason
 * `COMPOSITION_BANDS` is: there is no single right answer, there is a span outside which something
 * has gone wrong in one direction or the other. Under the floor the garden is a flat plan; over the
 * ceiling it is a wood, and the lawn and borders underneath it are being drawn in shade nobody
 * asked for.
 */
export const CANOPY_BAND = { min: 0.15, max: 0.35 };

/**
 * A room smaller than this is not asked the question.
 *
 * About the size of a small courtyard. Below it the honest answer is that there is nowhere for a
 * tree to stand where it is not the entire garden, which is a fact about the plot rather than a
 * fault in the plan.
 */
const MIN_ROOM_FOR_TREES = 45;

/** How finely the cover is sampled. Coarse on purpose: this runs on every candidate. */
const SAMPLE_STEP = 0.5;

export function scoreCanopy(subject: DesignSubject): PrincipleResult {
  const room = subject.analysis.room;
  if (!room || room.length < 3) return NOT_APPLICABLE;

  const area = polygonArea(room);
  if (area < MIN_ROOM_FOR_TREES) return NOT_APPLICABLE;

  const cover = canopyCover(subject, room);
  const issues: MeasuredIssue[] = [];

  if (cover < CANOPY_BAND.min) {
    issues.push({
      code: 'sparse-canopy',
      principle: 'canopy',
      severity: cover < CANOPY_BAND.min / 2 ? 'major' : 'minor',
      message:
        subject.trees.length === 0
          ? 'There is not a tree in the garden, so nothing encloses it or gives it scale.'
          : `Only ${Math.round(cover * 100)}% of the garden is under canopy, against about a third in a designed plan.`,
      /*
       * Named by the trees that are there, because that is what a correction has to work from —
       * and an empty list where there are none is the honest answer rather than a gap: what is
       * wrong is the absence of an element, and an element that is not in the drawing has no id.
       */
      subjects: subject.trees.slice(0, 8).map((tree) => tree.id),
    });
  }

  return { score: bandScore(cover), issues };
}

/**
 * How much of the room stands under a crown, by sampling.
 *
 * Sampled rather than summed, because crowns overlap by design — a pair of boundary trees grown
 * together is one mass of foliage and not two — and adding their areas would report a garden of
 * four trees as more shaded than one of eight whose canopies happen to touch. It is the same
 * argument `measureComposition` makes about element areas, and the same answer: a grid classified
 * by what covers it cannot double count.
 */
function canopyCover(subject: DesignSubject, room: Point[]): number {
  if (subject.trees.length === 0) return 0;

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const point of room) {
    xMin = Math.min(xMin, point.x);
    xMax = Math.max(xMax, point.x);
    yMin = Math.min(yMin, point.y);
    yMax = Math.max(yMax, point.y);
  }

  let inside = 0;
  let covered = 0;
  for (let x = xMin + SAMPLE_STEP / 2; x < xMax; x += SAMPLE_STEP) {
    for (let y = yMin + SAMPLE_STEP / 2; y < yMax; y += SAMPLE_STEP) {
      const point = { x, y };
      if (!pointInPolygon(point, room)) continue;
      inside += 1;
      if (subject.trees.some((tree) => pointInPolygon(point, tree.ring))) covered += 1;
    }
  }

  return inside === 0 ? 0 : covered / inside;
}

/**
 * One inside the band, falling away outside it.
 *
 * Asymmetric on purpose: a bare garden is the fault this principle exists to find, and a shaded one
 * is a preference somebody may hold, so falling short costs more per point than overshooting. The
 * floor is 0 at no trees at all and the ceiling never quite reaches it — a garden under complete
 * canopy is a copse, but it is still a considered thing rather than a flat plan.
 */
function bandScore(cover: number): number {
  if (cover >= CANOPY_BAND.min && cover <= CANOPY_BAND.max) return 1;
  if (cover < CANOPY_BAND.min) return clamp01(cover / CANOPY_BAND.min);
  return clamp01(1 - (cover - CANOPY_BAND.max) / (1 - CANOPY_BAND.max) / 2);
}
