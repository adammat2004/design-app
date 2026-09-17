import { distanceToSegment } from '@garden-studio/schema';
import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type PrincipleResult,
  type MeasuredIssue,
} from './result.js';
import type { DesignSubject, SubjectItem } from './subject.js';

/**
 * Can you sit in this garden without being overlooked?
 *
 * The principle a plan drawn from above forgets, and the first thing a client raises. It is scored
 * against the sides of the property the document actually describes: an edge the user gave a fence,
 * wall, hedge or railing has somebody on the other side of it, and the edge they named as the
 * street has the pavement. **An undescribed side scores nothing at all** — the same refusal the sun
 * principle makes without a location. Assuming an overlooking neighbour behind every unstated
 * boundary would mark down every plan drawn before step 1 grew boundary treatments.
 *
 * What counts as screened is deliberately generous: planting at least `SCREEN_DEPTH` deep between
 * the seat and the fence, a structure in the way, or a boundary tall enough to do the job on its
 * own. A 1.8 m fence two metres from a sofa really is privacy; a 0.9 m railing is not.
 */

/** How close a seat has to be to an exposed edge for the exposure to matter. */
const EXPOSURE_REACH = 6;

/** A boundary this tall screens a seated person by itself. */
const SCREENING_HEIGHT = 1.7;

/** How deep a bed has to be between a seat and a fence to read as a screen. */
const SCREEN_DEPTH = 1.2;

/** The features whose privacy anybody cares about. */
const PRIVATE: (string | null)[] = ['seating', 'dining', 'hotTub'];

export function scorePrivacy(subject: DesignSubject): PrincipleResult {
  const exposedEdges = subject.analysis.edges.filter((edge) => edge.exposure !== 'unknown');
  const seats = subject.items.filter((item) => PRIVATE.includes(item.feature));
  if (exposedEdges.length === 0 || seats.length === 0) return NOT_APPLICABLE;

  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  for (const seat of seats) {
    /* Every exposed edge within reach of this seat, nearest first. */
    const near = exposedEdges
      .map((edge) => ({
        edge,
        distance: Math.min(
          ...seat.ring.map((point) => distanceToSegment(point, edge.start, edge.end)),
        ),
      }))
      .filter((entry) => entry.distance <= EXPOSURE_REACH)
      .sort((a, b) => a.distance - b.distance);

    if (near.length === 0) {
      parts.push(1);
      continue;
    }

    let screened = 0;
    for (const { edge, distance } of near) {
      if (edge.height >= SCREENING_HEIGHT) {
        screened += 1;
        continue;
      }
      if (screenBetween(seat, edge, subject)) {
        screened += 1;
        continue;
      }
      /*
       * The street is worse than a neighbour: a fence between two gardens is a shared expectation,
       * a pavement is strangers. Weighted by being reported as an issue rather than only scored.
       */
      if (edge.exposure === 'street' || distance < EXPOSURE_REACH / 2) {
        issues.push({
          code: 'seating-exposed',
          principle: 'privacy',
          severity: edge.exposure === 'street' ? 'major' : 'minor',
          message: `${seat.name || seat.feature} sits ${distance.toFixed(1)} m from ${
            edge.exposure === 'street' ? 'the street' : 'the neighbouring boundary'
          } with nothing screening it.`,
          subjects: [seat.id],
          repair: 'move-to-zone',
          /*
           * Screened from *this* edge, named by the vertex every other module names it by. Not
           * "move it away from the boundary": a seat can be right against a 1.8 m fence quite
           * happily, and what is wrong here is that nothing stands between it and a low one.
           */
          guidance: { screenFrom: [edge.vertexId] },
        });
      }
    }

    parts.push(clamp01(screened / near.length));
  }

  /*
   * The brief's own ask, on top of the per-seat measure. `enclose` is a stated wish for a garden
   * that feels held in, and it is met by planting along the sides rather than by any one seat being
   * screened — so it is scored separately and only when it was asked for.
   */
  if (subject.brief.privacy === 'enclose') {
    const plantedSides = new Set(
      subject.beds
        .map((bed) => nearestEdgeSide(bed.centre, subject))
        .filter((side): side is string => side !== null),
    );
    parts.push(clamp01(plantedSides.size / 2));
  }

  return { score: meanOf(parts), issues };
}

/** Whether planting or a structure stands between this seat and this edge. */
function screenBetween(
  seat: SubjectItem,
  edge: DesignSubject['analysis']['edges'][number],
  subject: DesignSubject,
): boolean {
  const seatDistance = Math.min(
    ...seat.ring.map((point) => distanceToSegment(point, edge.start, edge.end)),
  );

  const blockers = [
    ...subject.beds.filter((bed) => bed.area >= SCREEN_DEPTH * SCREEN_DEPTH * 2),
    ...subject.items.filter((item) => item.category === 'structure' && item.id !== seat.id),
  ];

  return blockers.some((blocker) => {
    const ring = 'ring' in blocker ? blocker.ring : [];
    const distance = Math.min(
      ...ring.map((point) => distanceToSegment(point, edge.start, edge.end)),
    );
    // Between the seat and the fence, rather than behind the seat or beyond the fence.
    if (distance > seatDistance) return false;
    const toSeat = Math.hypot(blocker.centre.x - seat.centre.x, blocker.centre.y - seat.centre.y);
    return toSeat <= EXPOSURE_REACH + SCREEN_DEPTH;
  });
}

/** Which side of the property a point is nearest, for the enclosure measure. */
function nearestEdgeSide(point: { x: number; y: number }, subject: DesignSubject): string | null {
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const edge of subject.analysis.edges) {
    const distance = distanceToSegment(point, edge.start, edge.end);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = edge.vertexId;
    }
  }
  return bestDistance <= 3 ? best : null;
}
