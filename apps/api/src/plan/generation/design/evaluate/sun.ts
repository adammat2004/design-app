import { pointInPolygon } from '@garden-studio/schema';
import { meanOf, NOT_APPLICABLE, type PrincipleResult, type MeasuredIssue } from './result.js';
import type { DesignSubject } from './subject.js';

/**
 * Will the seating get the afternoon sun, and is the kitchen garden in the light?
 *
 * **Scored only when `site.location` is set, and that is a refusal rather than a gap.** Solar
 * altitude is a function of latitude, so there is no shade that is true of anywhere; a plan with no
 * location returns `null` here, the weight is redistributed across the other principles, and the
 * concept is judged on everything else. The alternative — assuming a latitude — would have the
 * design built confidently around a fact the user never stated, which is the mistake
 * `suggestedDoorWall` and `site.location` both exist to avoid.
 *
 * TODOS calls sun-aware generation "the real research contribution". This is not that: it does not
 * *place* anything in the sun, it notices when something landed in the shade. That is the honest
 * first half, and it is what a placer would need as its objective anyway.
 */

/** The features that want the afternoon sun. */
const WANTS_SUN = ['seating', 'dining', 'vegPatch', 'hotTub'];

/** How much of a feature may sit in shade before it reads as a shaded spot. */
const SHADE_LIMIT = 0.5;

export function scoreSun(subject: DesignSubject): PrincipleResult {
  const sun = subject.analysis.sun;
  if (!sun || sun.shade.length === 0) return NOT_APPLICABLE;

  const wanting = subject.items.filter((item) => item.feature && WANTS_SUN.includes(item.feature));
  if (wanting.length === 0) return NOT_APPLICABLE;

  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  for (const item of wanting) {
    /*
     * Sampled on the outline's own vertices plus its centre, rather than on a grid. A terrace is a
     * rectangle: five points tell you whether it is in shade, and this runs on fifty candidates.
     */
    const probes = [...item.ring, item.centre];
    const shaded = probes.filter((point) =>
      sun.shade.some((ring) => ring.length >= 3 && pointInPolygon(point, ring)),
    ).length;
    const share = shaded / probes.length;

    parts.push(1 - share);

    if (share > SHADE_LIMIT) {
      issues.push({
        code: 'seating-in-shade',
        principle: 'sun',
        severity: 'minor',
        message: `${item.name || item.feature} is in shade for most of its area at three on a midsummer afternoon.`,
        subjects: [item.id],
        repair: 'move-to-zone',
        /* Only ever set on a located plan, which is the only plan this principle runs on at all. */
        guidance: { sunlit: true },
      });
    }
  }

  return { score: meanOf(parts), issues };
}
