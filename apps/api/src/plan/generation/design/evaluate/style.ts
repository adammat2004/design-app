import { normaliseDegrees } from '@garden-studio/schema';
import { styleRules } from '../../knowledge/style-rules.js';
import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type PrincipleResult,
  type MeasuredIssue,
} from './result.js';
import type { DesignSubject } from './subject.js';

/**
 * Does the plan look like the style it claims?
 *
 * Style has been a material decision for this project's whole life — what the paving is, what the
 * planting is, how round the corners are — and the geometry underneath has been the same whichever
 * card the user pressed. This is the measurement that makes the difference structural: a modern
 * plan is aligned and uses few materials; a naturalistic one curves and masses its planting; a
 * traditional one is symmetric about the doors where the plot allows it.
 *
 * Three measurements, all reading `style-rules.ts` rather than branching on the style here:
 *
 * - **alignment** — how far the built things sit from the frame's own bearing.
 * - **material count** — against the style's cap, which is the single most reliable tell.
 * - **symmetry** — only where the style requires it, measured about the door axis.
 */

/** Degrees from the wall bearing that still reads as aligned on a strict style. */
const STRICT_TOLERANCE = 2;

/** Degrees at which even a loose style reads as accidental rather than deliberate. */
const LOOSE_TOLERANCE = 12;

/** How far a mirrored pair may differ, in metres, before the symmetry claim fails. */
const SYMMETRY_TOLERANCE = 0.6;

export function scoreStyle(subject: DesignSubject): PrincipleResult {
  const rules = styleRules(subject.brief.style);
  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  /* ---- alignment ---- */
  const frame = subject.analysis.frame;
  const rotated = subject.items.filter((item) => item.rotation !== null);
  if (frame && rotated.length > 0) {
    const tolerance = rules.alignment === 'strict' ? STRICT_TOLERANCE : LOOSE_TOLERANCE;
    const off = rotated.filter((item) => offAxis(item.rotation!, frame.wallBearing) > tolerance);
    parts.push(1 - off.length / rotated.length);

    if (rules.alignment === 'strict' && off.length > 0) {
      issues.push({
        code: 'misaligned',
        principle: 'style',
        severity: 'minor',
        message: `${off.length} of ${rotated.length} features sit off the line of the house, which a ${label(subject)} plan should not.`,
        subjects: off.map((item) => item.id),
        repair: 'align',
        guidance: { alignTo: 'house' },
      });
    }
  }

  /* ---- material count ---- */
  const used = subject.materials.size;
  if (used > 0) {
    parts.push(clamp01(1 - Math.max(0, used - rules.maxMaterials) / rules.maxMaterials));
    if (used > rules.maxMaterials) {
      issues.push({
        code: 'too-many-materials',
        principle: 'style',
        severity: 'minor',
        message: `${used} different materials, where a ${label(subject)} plan wants at most ${rules.maxMaterials}.`,
        /*
         * The surfaces the count is of, so the fault points at something even though no repair can
         * act on it — choosing fewer materials is `materialFor`'s decision, not a layout change.
         */
        subjects: subject.items
          .filter((item) => item.material !== null)
          .slice(0, 8)
          .map((item) => item.id),
      });
    }
  }

  /* ---- planting massing ---- */
  if (subject.beds.length > 0 && rules.bedMassing !== 'islands-ok') {
    /*
     * An island bed is one that touches no boundary and no other bed: a lozenge of planting adrift
     * in the middle of a lawn. One is a specimen bed and can be deliberate; three or more is the
     * "many isolated random islands" failure, and only a style that permits them escapes it.
     */
    const islands = subject.beds.filter((bed) => isIsland(bed, subject));
    parts.push(clamp01(1 - Math.max(0, islands.length - 1) / 3));
    if (islands.length > 2) {
      issues.push({
        code: 'bed-islands',
        principle: 'style',
        severity: 'minor',
        message: `${islands.length} planting beds float free of the boundary and of each other.`,
        subjects: islands.map((bed) => bed.id),
        repair: 'merge-beds',
      });
    }
  }

  /* ---- symmetry, where the style asks for it ---- */
  if (rules.symmetry === 'required' && frame) {
    const across = subject.items
      .filter((item) => item.feature !== 'storage')
      .map((item) => frame.toLocal(item.centre).v);
    if (across.length >= 2) {
      const paired = across.filter((v) =>
        across.some((other) => Math.abs(other + v) < SYMMETRY_TOLERANCE),
      );
      parts.push(paired.length / across.length);
    }
  }

  return parts.length > 0 ? { score: meanOf(parts), issues } : NOT_APPLICABLE;
}

/** How far a rectangle's rotation is from the wall's, allowing for a quarter turn. */
export function offAxis(rotation: number, bearing: number): number {
  const delta = Math.abs(normaliseDegrees(rotation - bearing));
  const folded = delta % 90;
  return Math.min(folded, 90 - folded);
}

function isIsland(bed: DesignSubject['beds'][number], subject: DesignSubject): boolean {
  const edges = subject.analysis.edges;
  const touchesFence = bed.ring.some((point) =>
    edges.some(
      (edge) =>
        Math.abs(
          (point.x - edge.start.x) * edge.inward.x + (point.y - edge.start.y) * edge.inward.y,
        ) < 0.4,
    ),
  );
  if (touchesFence) return false;

  const house = subject.analysis.house;
  if (house) {
    const near = bed.ring.some((point) =>
      house.ring.some((corner) => Math.hypot(corner.x - point.x, corner.y - point.y) < 1),
    );
    if (near) return false;
  }

  return !subject.beds.some(
    (other) =>
      other.id !== bed.id &&
      Math.hypot(other.centre.x - bed.centre.x, other.centre.y - bed.centre.y) <
        Math.sqrt(other.area) + Math.sqrt(bed.area),
  );
}

function label(subject: DesignSubject): string {
  switch (subject.brief.style) {
    case 'modern':
      return 'modern';
    case 'cottage':
      return 'naturalistic';
    case 'formal':
      return 'traditional';
    case 'lowMaintenance':
      return 'minimalist';
    default:
      return 'considered';
  }
}
