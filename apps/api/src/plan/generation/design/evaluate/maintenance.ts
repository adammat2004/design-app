import type { MaintenanceLevel } from '@garden-studio/schema';
import { clamp01, NOT_APPLICABLE, type PrincipleResult, type MeasuredIssue } from './result.js';
import { mownShare, type Measured } from './measure.js';
import type { DesignSubject } from './subject.js';

/**
 * How much work does this garden ask for, against how much was offered?
 *
 * The question nothing in the scorer could ask. A plan can be beautifully composed and completely
 * wrong for its owner: a mown panel with fifty metres of edge, three mixed borders and four
 * materials to keep apart is an excellent garden for somebody who enjoys gardening and a burden for
 * somebody who said they have no time. Measured before this existed, the hand-built pair that
 * differs in exactly that way scored 0.972 against 0.960 — a twelve-point gap where the three pairs
 * whose faults are compositional separate by thirty or more.
 *
 * **A ceiling, not a target.** `cappedMaintenance` already decides that a stated upkeep level is the
 * most a concept may ask rather than an amount it should hit, and this is the same rule measured:
 * a garden that asks less than was offered is not a fault. Somebody who ticked "high effort" is
 * saying they are willing, not that they demand weeding.
 *
 * **Absent rather than zero when nobody said.** `brief.upkeep` is null until the user answers, and a
 * plan drawn against no answer is judged on the other principles — the refusal `site.location` makes
 * about shade, for the same reason.
 */

/** How much of a garden being lawn reads as a full mowing job. */
const FULL_MOWING = 0.4;

/** How much of it being planted reads as a full weeding job. */
const FULL_WEEDING = 0.4;

/** Separate beds per 100 m² at which the edges alone are a weekend. */
const FIDDLY_BEDS = 6;

/**
 * The most upkeep each stated level will carry, as a fraction of everything a garden can ask.
 *
 * **Calibrated against an ordinary garden rather than chosen.** A perfectly normal suburban plan —
 * a third planting, a third lawn, four borders — measures about 0.65 on the scale below, so a
 * medium ceiling of 0.6 would have reported nearly every good garden as too much work, which is a
 * rule that fires on everything and therefore says nothing. `high` sits at one on purpose: somebody
 * who ticked "high effort" is saying they are willing, and there is no garden that is too much for
 * them.
 */
const CEILING: Record<MaintenanceLevel, number> = {
  low: 0.35,
  medium: 0.75,
  high: 1,
};

/** How far past the ceiling the demand may drift before the principle scores nothing. */
const RUNOUT = 0.35;

/** Over the ceiling by more than this and it is a fault worth reporting rather than a lost fraction. */
const REPORT_AT = 0.05;

export function scoreMaintenance(
  subject: DesignSubject,
  measured: Measured | null,
): PrincipleResult {
  const level = subject.brief.upkeep;
  if (level === null || measured === null) return NOT_APPLICABLE;

  const asked = demand(subject, measured);
  const ceiling = CEILING[level];
  const over = asked - ceiling;

  const issues: MeasuredIssue[] = [];
  if (over > REPORT_AT) {
    issues.push({
      code: 'upkeep-heavy',
      principle: 'maintenanceFit',
      severity: over > RUNOUT / 2 ? 'major' : 'minor',
      message: `This garden asks for more looking after than a ${label(level)} brief allows: ${pct(asked)} of what a garden can demand, against ${pct(ceiling)}.`,
      /*
       * The grass and the beds, which are what the demand is made of and the only things a repair
       * could act on. An empty subject list is a fault nothing can be pointed at.
       */
      subjects: heaviest(subject),
      repair: 'merge-beds',
    });
  }

  return { score: clamp01(1 - Math.max(0, over) / RUNOUT), issues };
}

/**
 * How much work this garden asks for, nought to one.
 *
 * The mean of three things a person would actually count: how much of it has to be mown, how much
 * has to be weeded, and how many separate pieces those are in. Beds are counted rather than
 * measured because the cost of a border is mostly its edge and its variety — six small ones are
 * more work than one of the same total area, which is also why `merge-beds` is the repair.
 */
function demand(subject: DesignSubject, measured: Measured): number {
  const mown = clamp01(mownShare(measured) / FULL_MOWING);
  const planted = clamp01(measured.report.shares.planting / FULL_WEEDING);

  const hundreds = Math.max(0.5, measured.area / 100);
  const fiddly = clamp01(subject.beds.length / (FIDDLY_BEDS * hundreds));

  return (mown + planted + fiddly) / 3;
}

/** The grass and the beds: what the demand is made of, so the issue points at something. */
function heaviest(subject: DesignSubject): string[] {
  const lawns = subject.panels.filter((panel) => panel.category === 'lawn');
  return [...lawns, ...subject.beds]
    .sort((a, b) => b.area - a.area)
    .slice(0, 8)
    .map((region) => region.id);
}

function label(level: MaintenanceLevel): string {
  return level === 'low' ? 'low-upkeep' : `${level}-upkeep`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}
