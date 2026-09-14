import { polygonArea, polygonCentroid, type DesignScore, type Point } from '@garden-studio/schema';
import type { Candidate } from './candidates.js';
import type { LayoutPreview } from './layout-generator.js';

/**
 * Three concepts that are genuinely different, rather than three rolls of one.
 *
 * The screen offers three cards side by side, which is a promise that they are three answers. The
 * old generator kept that promise by accident — it drew all three templates, so they could not help
 * differing — and would have broken it the moment anything chose a layout on merit. A field of
 * candidates scored by one objective will happily return the same plan three times with a parameter
 * nudged, which is worse than the accident it replaced.
 *
 * **The signature is taken from the placed result, never from the parameters.** Two parameter sets
 * that make no difference on a particular plot — a lawn bias on a room too tight to shift the lawn,
 * a destination on a plan with no far room — produce identical gardens, and a signature over the
 * inputs would call them different. What is compared is what was drawn.
 */

/** What makes two plans the same plan. */
export interface Signature {
  archetype: string;
  /** Where the biggest room is, to the nearest two metres: the plan's centre of gravity. */
  anchor: string;
  /** The share of the composed area the terrace takes, to a tenth. */
  terraceShare: number;
  /** The open panel's share, to a tenth, and its rough shape. */
  lawnShare: number;
  lawnShape: string;
  /** Which features were seated, in order. A plan that fits more is a different plan. */
  seated: string;
  /** Where each feature ended up, on a two-metre grid. */
  cells: string;
}

/**
 * How alike two plans are, 0 to 1.
 *
 * Weighted, because the parts are not equally telling. Two plans on the same composition with the
 * features in the same places are the same plan whatever their lawn shares; two on different
 * compositions are different however much else they share.
 */
const WEIGHTS: Record<keyof Signature, number> = {
  archetype: 3,
  anchor: 1,
  terraceShare: 1,
  lawnShare: 1,
  lawnShape: 1,
  seated: 2,
  cells: 3,
};

export function signatureOf(preview: LayoutPreview): Signature {
  const areas = preview.placed.map((item) => polygonArea(item.ring));
  const composed =
    areas.reduce((total, area) => total + area, 0) +
    (preview.lawn ? polygonArea(preview.lawn.ring) : 0);

  const biggest = preview.placed.reduce<{ ring: Point[]; area: number } | null>(
    (best, item, index) =>
      best === null || areas[index]! > best.area ? { ring: item.ring, area: areas[index]! } : best,
    null,
  );

  const terrace = preview.placed.find((item) => item.slotId === 'terrace');
  const lawnArea = preview.lawn ? polygonArea(preview.lawn.ring) : 0;

  return {
    archetype: preview.archetype,
    anchor: biggest ? cell(polygonCentroid(biggest.ring)) : 'none',
    terraceShare: composed > 0 && terrace ? bucket(polygonArea(terrace.ring) / composed) : 0,
    lawnShare: composed > 0 ? bucket(lawnArea / composed) : 0,
    /*
     * The panel's shape rather than its outline. A rounded rectangle and the rectangle it came from
     * are the same decision; a kidney and a rectangle are not.
     */
    lawnShape: preview.lawn
      ? `${preview.lawn.category}:${preview.lawn.ring.length > 8 ? 'curved' : 'straight'}`
      : 'none',
    seated: preview.placed
      .map((item) => item.feature)
      .sort()
      .join(','),
    cells: preview.placed
      .map((item) => `${item.feature}@${cell(polygonCentroid(item.ring))}`)
      .sort()
      .join('|'),
  };
}

export function similarity(a: Signature, b: Signature): number {
  let shared = 0;
  let total = 0;
  for (const key of Object.keys(WEIGHTS) as (keyof Signature)[]) {
    const weight = WEIGHTS[key];
    total += weight;
    if (a[key] === b[key]) shared += weight;
  }
  return total === 0 ? 1 : shared / total;
}

/** Above this two plans are the same plan wearing different materials. */
export const TOO_ALIKE = 0.7;

export interface Scored {
  candidate: Candidate;
  score: DesignScore;
}

/**
 * The best candidate that is not too like the ones already chosen.
 *
 * **A penalty rather than a filter**, and the difference matters on a small plot. Refusing
 * everything over the threshold outright would leave a garden that genuinely has one good answer
 * with no second or third card at all; weighing likeness against quality means a near-duplicate can
 * still be offered when nothing better exists, and is passed over whenever something does.
 */
export function pickDistinct(field: Scored[], already: Signature[]): Scored | null {
  if (field.length === 0) return null;

  const ranked = field
    .map((entry) => {
      const signature = signatureOf(entry.candidate.preview);
      const likeness =
        already.length === 0
          ? 0
          : Math.max(...already.map((other) => similarity(signature, other)));
      const repeated = already.some((other) => other.archetype === signature.archetype);
      return { entry, likeness, value: valueOf(entry, likeness, repeated) };
    })
    .sort((a, b) => b.value - a.value || a.entry.candidate.id.localeCompare(b.entry.candidate.id));

  return ranked[0]?.entry ?? null;
}

/**
 * What a candidate is worth: how well it came out, **and** how well its composition suited the job.
 *
 * Both, and dropping either is a mistake with a name. Score alone throws the style away entirely —
 * on a deep plot a destination garden out-drew the terrace-and-lawn plan a modern brief had asked
 * for, because the score measures how well an arrangement worked and knows nothing about what was
 * wanted. Fit alone is the state before this phase: one plan per composition, never compared.
 *
 * The fit is the strategic judgement — can this plot hold this composition, and is it the kind of
 * garden they asked for — and the design score is the tactical one, whether this particular
 * arrangement of it came out well. Weighted towards the score, because within a composition that
 * suits the plot the arrangement is what is actually being chosen.
 */
const SCORE_WEIGHT = 0.65;
const FIT_WEIGHT = 0.35;

/** How much likeness to an already-chosen concept costs. A penalty, never a filter. */
const LIKENESS_PENALTY = 0.4;

/**
 * What it costs to offer a composition that is already on the table.
 *
 * Large on purpose, and larger than the gaps the score usually produces. Three cards headed
 * "Terrace and lawn", "Terrace and lawn" and "Formal axis" read as a mistake even when the two
 * share a name and not a drawing — the promise a comparison screen makes is three *answers*, and a
 * user cannot see a parameter. So a repeat has to be markedly better rather than marginally, which
 * is what this number says; on a plot that genuinely supports only one composition it is paid and
 * the repeat still appears, because a card saying nothing is worse.
 */
const REPEAT_ARCHETYPE_PENALTY = 0.25;

function valueOf(entry: Scored, likeness: number, repeatedArchetype: boolean): number {
  return (
    entry.score.total * SCORE_WEIGHT +
    entry.candidate.fit.score * FIT_WEIGHT -
    likeness * LIKENESS_PENALTY -
    (repeatedArchetype ? REPEAT_ARCHETYPE_PENALTY : 0)
  );
}

/** Two-metre cells, so a plan is "the same" when its rooms are within a stride of each other. */
function cell(point: Point): string {
  return `${Math.round(point.x / 2)},${Math.round(point.y / 2)}`;
}

function bucket(share: number): number {
  return Math.round(Math.min(1, Math.max(0, share)) * 10) / 10;
}
