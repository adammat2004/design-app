import { distanceToSegment, resolveSymbol } from '@garden-studio/schema';
import { MIN_FILL_SIDE } from '../../fill-limits.js';
import { minExtent } from './proportion.js';
import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type PrincipleResult,
  type MeasuredIssue,
} from './result.js';
import { FEATURE_LIBRARY } from '../../knowledge/feature-library.js';
import type { DesignSubject } from './subject.js';

/**
 * Could this actually be built, and maintained afterwards?
 *
 * The cheapest principle to satisfy and the easiest to forget. A plan can be geometrically perfect
 * and still describe something nobody can construct: a bed too narrow to plant, a shed pushed so
 * tight against the fence that its far side cannot be reached to creosote, a terrace raised 400 mm
 * with no way to step off it.
 *
 * Deliberately small. It checks the things that are *facts about building* rather than matters of
 * taste, and it carries little weight, because a design that scores badly here is usually fixed by
 * a centimetre rather than by a rethink.
 */

/** How much space a person needs behind a structure to build it and to maintain it. */
const MAINTENANCE_GAP = 0.3;

/** A rise this far above grade needs a way down off it. */
const NEEDS_STEPS = 0.15;

/*
 * There is deliberately no deeper floor for a concept built round its planting.
 *
 * Asking a planted reading for 1.5 m borders rather than `MIN_FILL_SIDE`'s 1.2 was tried, and the
 * harness answered within one run: the generator draws borders at `BORDER_WIDTH` routinely, so a
 * legal and deliberate 1.4 m bed became a fault, and a plan whose beds were all of that width scored
 * **zero** for buildability. It was also the third instance of one mistake in this pass — the same
 * one that discounted circulation under `planted` and proportion under `social`. What a planted
 * concept wants more of is planting, and `emphasis-bands.ts` asks for it by area, which is the
 * measure that does not turn a width the generator is entitled to into a defect.
 */

export function scoreBuildability(subject: DesignSubject): PrincipleResult {
  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  /* ---- beds you can actually plant ---- */
  if (subject.beds.length > 0) {
    const rotation = subject.analysis.frame?.wallBearing ?? 0;
    const thin = subject.beds.filter((bed) => minExtent(bed.ring, rotation) < MIN_FILL_SIDE - 0.05);
    parts.push(1 - thin.length / subject.beds.length);
    for (const bed of thin) {
      issues.push({
        code: 'bed-too-narrow',
        principle: 'buildability',
        severity: 'minor',
        message: `A planting bed is ${minExtent(bed.ring, rotation).toFixed(2)} m across, under the ${MIN_FILL_SIDE} m a border needs to be planted in layers.`,
        subjects: [bed.id],
        repair: 'merge-beds',
      });
    }
  }

  /* ---- structures you can get round ---- */
  const structures = subject.items.filter((item) => item.category === 'structure');
  if (structures.length > 0) {
    const cramped = structures.filter((item) => {
      /*
       * A shed against the fence is right — `boundaryAffinity: 'prefers'` says so, and pushing it
       * off would waste the corner. A *pergola* against the fence is a pergola you cannot paint.
       * So the rule is only applied to the features that do not want the boundary.
       */
      const wantsFence = item.feature
        ? FEATURE_LIBRARY[item.feature].boundaryAffinity === 'prefers'
        : false;
      if (wantsFence) return false;

      const gap = Math.min(
        ...subject.analysis.edges.flatMap((edge) =>
          item.ring.map((point) => distanceToSegment(point, edge.start, edge.end)),
        ),
      );
      return gap > 1e-6 && gap < MAINTENANCE_GAP;
    });

    parts.push(1 - cramped.length / structures.length);
    for (const item of cramped) {
      issues.push({
        code: 'feature-against-fence',
        principle: 'buildability',
        severity: 'minor',
        message: `${item.name || 'A structure'} sits under ${MAINTENANCE_GAP} m from the boundary, too tight to build against or maintain.`,
        subjects: [item.id],
        repair: 'move-to-zone',
        guidance: { clearOfBoundaryM: MAINTENANCE_GAP },
      });
    }
  }

  /* ---- a raised surface has a way off it ---- */
  const raised = subject.elements.filter(
    (element) => (element.elevation ?? 0) >= NEEDS_STEPS && resolveSymbol(element) !== 'steps',
  );
  if (raised.length > 0) {
    const flights = subject.elements.filter((element) => resolveSymbol(element) === 'steps');
    parts.push(flights.length > 0 ? 1 : 0);
    if (flights.length === 0) {
      issues.push({
        code: 'steps-missing',
        principle: 'buildability',
        severity: 'major',
        message: `A surface is raised ${(raised[0]!.elevation ?? 0).toFixed(2)} m above the garden with no steps down off it.`,
        subjects: raised.map((element) => element.id),
      });
    }
  }

  return parts.length > 0 ? { score: meanOf(parts.map(clamp01)), issues } : NOT_APPLICABLE;
}
