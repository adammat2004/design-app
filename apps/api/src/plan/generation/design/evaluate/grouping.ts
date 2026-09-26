import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type PrincipleResult,
  type MeasuredIssue,
} from './result.js';
import type { DesignSubject, SubjectItem } from './subject.js';

/**
 * Do the things that belong together stand together?
 *
 * This is what "functional zoning" means once the geometry exists. The brief says the dining room
 * holds the terrace, the pergola and the barbecue; the plan is good on this principle when those
 * three are in one part of the garden and bad when the pergola ended up at the far fence because
 * that was where the first free slot happened to be.
 *
 * Measured without needing the zone rectangles to exist, deliberately — that keeps the same
 * evaluator usable on a finished concept from the old generator, which has no zone plan at all.
 * What is measured is the **spread of each zone's members**: a group whose pieces all sit within a
 * few metres of their own centre is a room, and one whose pieces are scattered across the plot is
 * not, whatever any plan claimed.
 */

/**
 * How far apart a zone's furthest two members may sit and still read as one room, in metres.
 *
 * The **diameter** of the group rather than its radius from the centroid, which is the measurement
 * that matters and the one the first version got wrong: two things at opposite ends of a garden are
 * each only half the distance from the point between them, so a dining terrace and its pergola
 * fifteen metres apart scored as a tidy seven-metre group.
 */
const ROOM_SPREAD = 7;

/** Beyond this a group is not loose, it is two places with one name. */
const SPLIT_SPREAD = 14;

export function scoreGrouping(subject: DesignSubject): PrincipleResult {
  const issues: MeasuredIssue[] = [];
  const identified = subject.items.filter((item) => item.zone !== null);
  if (identified.length === 0) return NOT_APPLICABLE;

  const byZone = new Map<string, SubjectItem[]>();
  for (const item of identified) {
    const key = item.zone!;
    byZone.set(key, [...(byZone.get(key) ?? []), item]);
  }

  const parts: number[] = [];

  for (const [zone, members] of byZone) {
    if (members.length < 2) {
      /*
       * A zone with one thing in it cannot be badly grouped. Scored as a pass rather than skipped,
       * so a plan that placed every feature in a zone of its own is not rewarded for having no
       * groups to get wrong — it loses instead on `zone-fragmented` below and on relationships.
       */
      parts.push(1);
      continue;
    }

    let spread = 0;
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i]!.centre;
        const b = members[j]!.centre;
        spread = Math.max(spread, Math.hypot(a.x - b.x, a.y - b.y));
      }
    }

    parts.push(clamp01(1 - Math.max(0, spread - ROOM_SPREAD) / (SPLIT_SPREAD - ROOM_SPREAD)));

    if (spread > SPLIT_SPREAD) {
      issues.push({
        code: 'zone-fragmented',
        principle: 'grouping',
        severity: 'major',
        message: `The ${zone} area is split across ${spread.toFixed(0)} m of garden: ${members
          .map((item) => item.name || item.feature)
          .join(', ')}.`,
        subjects: members.map((item) => item.id),
        repair: 'move-to-zone',
      });
    }
  }

  /*
   * There used to be a compactness half here — the convex hull of every feature against the room,
   * ideal about half. It was measuring where the built masses sit *in the room*, which is not a
   * grouping question at all, and it went with its weight to the composition principle, where
   * `one-sided` asks it as what it is: are the masses all on one side of the garden.
   */
  return { score: meanOf(parts), issues };
}
