import {
  measureComposition,
  minExtent,
  type DesignIssue,
  type GardenZone,
} from '@garden-studio/schema';
import { COMPOSITION_BANDS, type Band } from '../../composition-rules.js';
import { LAWN_FLOOR, TERRACE_FLOOR } from '../../layout/sketch.js';
import { clamp01, meanOf, NOT_APPLICABLE, type PrincipleResult } from './result.js';
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

export function scoreProportion(subject: DesignSubject, step?: number): PrincipleResult {
  const zones = inScopeZones(subject);
  if (zones.length === 0) return NOT_APPLICABLE;

  const report = measureComposition(subject.elements, zones, step);
  if (report.sampledArea <= 0) return NOT_APPLICABLE;

  const issues: DesignIssue[] = [];
  const parts: number[] = [];

  const courtyard = report.courtyard || !lawnAllowed(subject);
  const bands = courtyard ? COMPOSITION_BANDS.courtyard : COMPOSITION_BANDS.garden;

  parts.push(withinBand(report.shares.hard, bands.hard));
  parts.push(withinBand(report.shares.lawn, bands.lawn));
  parts.push(withinBand(report.shares.planting, bands.planting));
  parts.push(withinBand(report.shares.undesigned, bands.undesigned));

  if (report.shares.hard > bands.hard.max) {
    issues.push({
      code: 'hard-excessive',
      principle: 'proportion',
      severity: 'major',
      message: `${pct(report.shares.hard)} of the garden is hard landscaping, over the ${pct(bands.hard.max)} a plan this size should need.`,
      subjects: [],
      repair: 'shrink-terrace',
    });
  }
  if (report.shares.undesigned > bands.undesigned.max) {
    issues.push({
      code: 'leftover-pocket',
      principle: 'proportion',
      severity: 'major',
      message: `${pct(report.shares.undesigned)} of the ground has nothing designed onto it.`,
      subjects: [],
      repair: 'enlarge-lawn',
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
        subjects: [],
        repair: 'enlarge-lawn',
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
        subjects: [],
        repair: 'shrink-terrace',
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
        subjects: [],
        repair: 'enlarge-lawn',
      });
    }
    if (report.lawn.area < LAWN_FLOOR.area - 0.05) {
      issues.push({
        code: 'lawn-sliver',
        principle: 'proportion',
        severity: 'minor',
        message: `The lawn is ${report.lawn.area.toFixed(0)} m², under the ${LAWN_FLOOR.area} m² worth mowing.`,
        subjects: [],
        repair: 'enlarge-lawn',
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
export function withinBand(value: number, band: Band): number {
  if (value >= band.min - 1e-9 && value <= band.max + 1e-9) return 1;
  const past = value < band.min ? band.min - value : value - band.max;
  return clamp01(1 - past / BAND_RUNOUT);
}

function inScopeZones(subject: DesignSubject): GardenZone[] {
  const ids = subject.analysis.scope.zones;
  const zones = subject.analysis.zones;
  return ids.length > 0 ? zones.filter((zone) => ids.includes(zone.id)) : zones;
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
