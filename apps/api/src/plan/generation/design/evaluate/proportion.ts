import { minExtent, type DesignIssue } from '@garden-studio/schema';
import type { Band } from '../../composition-rules.js';
import { bandsFor } from '../../knowledge/emphasis-bands.js';
import { LAWN_FLOOR, TERRACE_FLOOR } from '../../layout/sketch.js';
import type { Measured } from './measure.js';
import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type PrincipleResult,
  type MeasuredIssue,
} from './result.js';
import type { DesignSubject } from './subject.js';

/**
 * Is the garden proportioned like a garden?
 *
 * The one principle that was already half-built. `measureComposition` samples a grid over the zones
 * and reports what share of the ground reads as hard landscaping, lawn, planting and base showing
 * through; `COMPOSITION_BANDS` says what those shares should be, derived from a hand-traced
 * professional plan rather than from this generator's own output. Both existed and neither had ever
 * run at generation time — the bands were a test assertion, so a badly proportioned concept was
 * caught in CI and still shown to the user.
 *
 * The bands are reused rather than re-derived, which matters: they are the one piece of this system
 * calibrated against a real design, and a second set of numbers beside them would be exactly the
 * "two sources for one decision" this codebase has been bitten by before. A band is a pass/fail; a
 * *score* wants a gradient, so the distance past the edge of a band is what costs marks.
 *
 * On top of the shares: the terrace has to be big enough to hold a table, the lawn big enough to be
 * a lawn rather than a strip, and the ground should not be mostly leftover.
 */

/** How far past a band's edge a share may drift before the principle scores nothing for it. */
const BAND_RUNOUT = 0.2;

/** A leftover piece of designed ground smaller than this is a pocket nobody will use. */
const POCKET_AREA = 4;

export function scoreProportion(
  subject: DesignSubject,
  measured: Measured | null,
): PrincipleResult {
  if (measured === null) return NOT_APPLICABLE;
  const { report } = measured;

  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  /*
   * The two things every share fault is about, resolved once.
   *
   * Every proportion issue used to carry an empty `subjects` list, which made all of them
   * unreachable by any repair: `subjectsOf` resolves an issue to elements, and an issue about "the
   * garden" resolves to nothing. A share is about the whole plan, but the *thing to change* is
   * always the terrace or the grass, and naming it is what turns a reading into a correction.
   */
  const terrace = largestPaved(subject);
  const lawnPanels = subject.panels
    .filter((panel) => panel.category === 'lawn')
    .sort((a, b) => b.area - a.area);

  const courtyard = report.courtyard || !lawnAllowed(subject);
  const { traced: bands, brief } = bandsFor(subject.brief.emphasis, courtyard);

  /*
   * Scored against the concept's own bands and reported against the traced ones.
   *
   * The score is what separates two plans the wide bands cannot: a garden built round one open
   * panel and a garden built round eating outside are both inside the traced band and only one of
   * them is the plan this concept said it was. What is *reported* as `hard-excessive` stays the
   * traced band, because that fault is a claim about gardens rather than about this brief.
   */
  parts.push(withinBand(report.shares.hard, brief.hard));
  parts.push(withinBand(report.shares.lawn, brief.lawn));
  parts.push(withinBand(report.shares.planting, brief.planting));
  parts.push(withinBand(report.shares.undesigned, brief.undesigned));

  issues.push(...offBrief(subject, report.shares, bands, brief));

  if (report.shares.hard > bands.hard.max) {
    issues.push({
      code: 'hard-excessive',
      principle: 'proportion',
      severity: 'major',
      message: `${pct(report.shares.hard)} of the garden is hard landscaping, over the ${pct(bands.hard.max)} a plan this size should need.`,
      subjects: terrace ? [terrace.id] : [],
      repair: 'shrink-terrace',
      guidance: { targetAreaFactor: bands.hard.max / report.shares.hard },
    });
  }
  if (report.shares.undesigned > bands.undesigned.max) {
    issues.push({
      code: 'leftover-pocket',
      principle: 'proportion',
      severity: 'major',
      message: `${pct(report.shares.undesigned)} of the ground has nothing designed onto it.`,
      subjects: lawnPanels.slice(0, 4).map((panel) => panel.id),
      repair: 'enlarge-lawn',
      guidance: { targetAreaFactor: 1 + (report.shares.undesigned - bands.undesigned.max) },
    });
  }

  /* ---- the terrace holds a table ---- */
  const roomDepth = subject.analysis.roomDepth;
  if (report.terrace) {
    const floor =
      roomDepth === null ? TERRACE_FLOOR.depth : Math.min(TERRACE_FLOOR.depth, roomDepth);
    parts.push(clamp01(report.terrace.minDimension / Math.max(0.1, floor)));
    if (report.terrace.minDimension < floor - 0.05) {
      issues.push({
        code: 'terrace-too-shallow',
        principle: 'proportion',
        severity: 'major',
        message: `The terrace is ${report.terrace.width.toFixed(1)} × ${report.terrace.depth.toFixed(1)} m, under the ${floor.toFixed(1)} m a table and chairs need.`,
        subjects: terrace ? [terrace.id] : [],
        repair: 'enlarge-lawn',
        /* Squared, because the factor is on area and the shortfall is measured on a side. */
        guidance: { targetAreaFactor: (floor / report.terrace.minDimension) ** 2 },
      });
    }
    /*
     * And is not most of the garden. The terrace share cap lives in `terraceDepth` as a rule the
     * sketch obeys; here it is measured on what was actually drawn, which catches the case where
     * the terrace was fine and everything else fell through.
     */
    const terraceShare = (report.terrace.width * report.terrace.depth) / report.sampledArea;
    if (terraceShare > 0.5 && !courtyard) {
      issues.push({
        code: 'terrace-oversized',
        principle: 'proportion',
        severity: 'minor',
        message: `The terrace is ${pct(terraceShare)} of the garden.`,
        subjects: terrace ? [terrace.id] : [],
        repair: 'shrink-terrace',
        guidance: { targetAreaFactor: 0.5 / terraceShare },
      });
    }
  } else if (roomDepth !== null && !courtyard) {
    issues.push({
      code: 'terrace-too-shallow',
      principle: 'proportion',
      severity: 'critical',
      message: 'There is no terrace at the doors at all.',
      subjects: [],
    });
    parts.push(0);
  }

  /* ---- the lawn is a lawn ---- */
  if (report.lawn) {
    parts.push(clamp01(report.lawn.minDimension / LAWN_FLOOR.minDimension));
    if (report.lawn.minDimension < LAWN_FLOOR.minDimension - 0.05) {
      issues.push({
        code: 'lawn-sliver',
        principle: 'proportion',
        severity: 'major',
        message: `The lawn is ${report.lawn.minDimension.toFixed(1)} m across: a strip to mow rather than a panel to use.`,
        subjects: lawnPanels.slice(0, 1).map((panel) => panel.id),
        repair: 'enlarge-lawn',
        guidance: { targetAreaFactor: LAWN_FLOOR.minDimension / report.lawn.minDimension },
      });
    }
    if (report.lawn.area < LAWN_FLOOR.area - 0.05) {
      issues.push({
        code: 'lawn-sliver',
        principle: 'proportion',
        severity: 'minor',
        message: `The lawn is ${report.lawn.area.toFixed(0)} m², under the ${LAWN_FLOOR.area} m² worth mowing.`,
        subjects: lawnPanels.slice(0, 1).map((panel) => panel.id),
        repair: 'enlarge-lawn',
        guidance: { targetAreaFactor: LAWN_FLOOR.area / Math.max(0.1, report.lawn.area) },
      });
    }
  }

  /*
   * ---- lawn continuity ----
   *
   * One of the explicit design rules: open ground should be *one* panel. Two lawns of similar size
   * is a garden cut in half by something drawn across it, which is a fault the composition shares
   * cannot see — they measure how much grass there is, not how many pieces it is in. This is the
   * measurement that only the realised tier can really make, because it is PostGIS's bed-cutting
   * that fragments a lawn the sketch drew as one rectangle.
   */
  const lawns = subject.panels.filter((panel) => panel.category === 'lawn');
  if (lawns.length > 1) {
    const largest = Math.max(...lawns.map((panel) => panel.area));
    const total = lawns.reduce((sum, panel) => sum + panel.area, 0);
    parts.push(clamp01(largest / total));
    if (largest / total < 0.75) {
      issues.push({
        code: 'lawn-fragmented',
        principle: 'proportion',
        severity: 'major',
        message: `The lawn is ${lawns.length} separate pieces; the largest is only ${pct(largest / total)} of the grass.`,
        subjects: lawns.map((panel) => panel.id),
        repair: 'enlarge-lawn',
      });
    }
  }

  /* ---- leftover pockets ---- */
  const pockets = subject.regions.filter((region) => !region.isBase && region.area < POCKET_AREA);
  if (pockets.length > 2) {
    issues.push({
      code: 'leftover-pocket',
      principle: 'proportion',
      severity: 'minor',
      message: `${pockets.length} scraps of ground under ${POCKET_AREA} m² each.`,
      subjects: pockets.map((region) => region.id),
      repair: 'merge-beds',
    });
    parts.push(clamp01(1 - (pockets.length - 2) / 6));
  }

  return { score: meanOf(parts), issues };
}

/**
 * How far inside its band a share is, as a fraction.
 *
 * One inside, falling off over `BAND_RUNOUT` past either edge. The bands are wide by design — they
 * have to pass a naturalistic garden that is half lawn and a modern one that is two thirds paving —
 * so anything inside them scores the same, and this only separates the plans that miss.
 */
export /** The terrace: the largest paved thing anybody placed, which is what every hard-share fault is about. */
function largestPaved(subject: DesignSubject): DesignSubject['items'][number] | null {
  return (
    subject.items
      .filter((item) => item.category === 'paved-area')
      .sort((a, b) => b.area - a.area)[0] ?? null
  );
}

export function withinBand(value: number, band: Band): number {
  if (value >= band.min - 1e-9 && value <= band.max + 1e-9) return 1;
  const past = value < band.min ? band.min - value : value - band.max;
  return clamp01(1 - past / BAND_RUNOUT);
}

/**
 * The one share that is inside what any garden's should be and outside what this one's should be.
 *
 * At most one, and the furthest out. Four separate lines saying the same plan is not the plan it
 * claimed to be is a list nobody reads, and the repair stage takes the first fault it can act on —
 * so three extra copies would crowd out the faults that are about geometry rather than intention.
 */
function offBrief(
  subject: DesignSubject,
  shares: { hard: number; lawn: number; planting: number; undesigned: number },
  traced: Record<'hard' | 'lawn' | 'planting' | 'undesigned', Band>,
  brief: Record<'hard' | 'lawn' | 'planting' | 'undesigned', Band>,
): MeasuredIssue[] {
  const kinds = ['hard', 'lawn', 'planting', 'undesigned'] as const;

  const off = kinds
    .map((kind) => ({ kind, past: past(shares[kind], brief[kind]) }))
    .filter((entry) => entry.past > 0 && past(shares[entry.kind], traced[entry.kind]) === 0)
    .sort((a, b) => b.past - a.past)[0];

  if (!off) return [];

  const band = brief[off.kind];
  const under = shares[off.kind] < band.min;

  return [
    {
      code: 'composition-off-brief',
      principle: 'proportion',
      severity: 'minor',
      message: `${pct(shares[off.kind])} of the garden is ${words(off.kind)}, where a concept ${subject.brief.rationale ? 'of this kind' : 'like this'} wants ${under ? `at least ${pct(band.min)}` : `at most ${pct(band.max)}`}.`,
      subjects: subjectsFor(subject, off.kind),
      ...(repairFor(off.kind, under) ? { repair: repairFor(off.kind, under)! } : {}),
    },
  ];
}

/** How far outside a band a share is; nought when it is inside. */
function past(value: number, band: Band): number {
  if (value < band.min - 1e-9) return band.min - value;
  if (value > band.max + 1e-9) return value - band.max;
  return 0;
}

function words(kind: 'hard' | 'lawn' | 'planting' | 'undesigned'): string {
  switch (kind) {
    case 'hard':
      return 'hard landscaping';
    case 'lawn':
      return 'open grass';
    case 'planting':
      return 'planting';
    default:
      return 'ground with nothing designed onto it';
  }
}

function repairFor(
  kind: 'hard' | 'lawn' | 'planting' | 'undesigned',
  under: boolean,
): DesignIssue['repair'] {
  if (kind === 'hard' && !under) return 'shrink-terrace';
  if (kind === 'lawn' && under) return 'enlarge-lawn';
  if (kind === 'undesigned' && !under) return 'enlarge-lawn';
  /* Deeper planting is the composition's decision, not an adjustment to one element. */
  return undefined;
}

/** Something on the plan the share is about, so the issue points at a real element. */
function subjectsFor(
  subject: DesignSubject,
  kind: 'hard' | 'lawn' | 'planting' | 'undesigned',
): string[] {
  if (kind === 'planting') return subject.beds.slice(0, 8).map((bed) => bed.id);
  if (kind === 'lawn') {
    return subject.panels
      .filter((panel) => panel.category === 'lawn')
      .sort((a, b) => b.area - a.area)
      .slice(0, 4)
      .map((panel) => panel.id);
  }
  if (kind === 'hard') {
    const paved = subject.items
      .filter((item) => item.category === 'paved-area')
      .sort((a, b) => b.area - a.area);
    return paved.slice(0, 1).map((item) => item.id);
  }
  return [];
}

/**
 * Whether this plan is allowed a lawn at all.
 *
 * Read off the brief's own exclusions rather than the maintenance level, because the two can
 * genuinely disagree now: a minimalist brief that ticked a lawn by name gets one. A plan judged
 * against the garden bands when it is forbidden grass would be marked down for missing something
 * it was told not to draw.
 */
function lawnAllowed(subject: DesignSubject): boolean {
  return !subject.brief.excludedFeatures.some((entry) => entry.feature === 'lawn');
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** The extent of a ring across the terrace's own frame — exported for the style principle. */
export { minExtent };
