import { polygonArea, type DesignIssue } from '@garden-studio/schema';
import { clamp01, meanOf, NOT_APPLICABLE, type PrincipleResult } from './result.js';
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
  const issues: DesignIssue[] = [];
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
   * Compactness: how much of the garden the built features are spread over. A plan whose features
   * occupy a quarter of the room in one or two clusters reads as composed; one whose convex hull is
   * the whole plot reads as scattered, which is exactly the complaint the old sampler earned.
   */
  const room = subject.analysis.room;
  if (room && identified.length >= 3) {
    const hull = convexHull(identified.map((item) => item.centre));
    const share = hull.length >= 3 ? polygonArea(hull) / Math.max(1, polygonArea(room)) : 0;
    // Some spread is right — a garden is not one clump — so the ideal is around half the room.
    parts.push(clamp01(1 - Math.abs(share - 0.45) / 0.55));
  }

  return { score: meanOf(parts), issues };
}

/**
 * Andrew's monotone chain. Small, deterministic, and the only hull this codebase needs.
 *
 * Written here rather than in `packages/schema/geometry` on purpose: a hull is a *measurement* the
 * scorer takes, not a tessellation anything draws, and the rule that the canvas and the validator
 * must consume the same ring does not apply to something no renderer ever sees.
 */
export function convexHull(
  points: readonly { x: number; y: number }[],
): { x: number; y: number }[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);

  const half = (input: typeof sorted) => {
    const out: typeof sorted = [];
    for (const point of input) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, point) <= 0) {
        out.pop();
      }
      out.push(point);
    }
    out.pop();
    return out;
  };

  return [...half(sorted), ...half([...sorted].reverse())];
}

function cross(
  o: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
