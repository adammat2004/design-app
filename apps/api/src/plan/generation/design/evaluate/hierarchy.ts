import { distanceToSegment, type DesignIssue } from '@garden-studio/schema';
import { clamp01, meanOf, NOT_APPLICABLE, type PrincipleResult } from './result.js';
import { isInView } from './relationships.js';
import type { DesignSubject } from './subject.js';

/**
 * Does the garden have a main event, and does the eye have somewhere to land?
 *
 * Visual hierarchy is the difference between a garden and a collection of equally-sized rectangles.
 * Three measurements:
 *
 * - **dominance** — one space is clearly the main one. A plan whose terrace, lawn feature and far
 *   room are all within a few square metres of each other reads as indecisive.
 * - **focal** — when the brief asked for something to terminate the view, something actually does.
 * - **outlook** — the view out of the doors is not blocked by a building a few metres away.
 *
 * The last is the one worth having even when nothing else applies. A shed four metres from the
 * patio doors is legal, passes every containment check, and ruins the garden.
 */

/** The main space should be at least this much larger than the next. */
const DOMINANCE = 1.5;

/** How near the axis's far end something has to be to count as terminating it. */
const FOCAL_REACH = 6;

/** A structure nearer than this to the doors, in the view, is blocking the outlook. */
const OUTLOOK_CLEAR = 4;

export function scoreHierarchy(subject: DesignSubject): PrincipleResult {
  const issues: DesignIssue[] = [];
  const parts: number[] = [];

  /* ---- dominance ---- */
  const spaces = [...subject.items, ...subject.panels]
    .map((thing) => thing.area)
    .sort((a, b) => b - a);
  if (spaces.length >= 2) {
    const ratio = spaces[1]! > 0 ? spaces[0]! / spaces[1]! : DOMINANCE;
    parts.push(clamp01(ratio / DOMINANCE));
    if (ratio < 1.15) {
      issues.push({
        code: 'no-primary-space',
        principle: 'hierarchy',
        severity: 'minor',
        message:
          'No one space is clearly the main one: the two largest are near enough the same size.',
        subjects: [],
      });
    }
  }

  /* ---- focal ---- */
  const axis = subject.analysis.primaryAxis;
  if (axis && subject.brief.focal !== 'none') {
    const end = axis.to;
    const terminators = [...subject.items, ...subject.trees].filter(
      (thing) => Math.hypot(thing.centre.x - end.x, thing.centre.y - end.y) <= FOCAL_REACH,
    );
    parts.push(terminators.length > 0 ? 1 : 0);
    if (terminators.length === 0) {
      issues.push({
        code: 'no-focal',
        principle: 'hierarchy',
        severity: 'minor',
        message: 'Nothing terminates the view down the garden from the doors.',
        subjects: [],
        repair: 'move-destination',
      });
    }
  }

  /* ---- outlook ---- */
  const cone = subject.analysis.viewCone;
  const door = subject.analysis.exits.primary?.centre ?? null;
  if (cone && door) {
    const blockers = subject.items.filter(
      (item) =>
        item.category === 'structure' &&
        isInView(cone, item.ring, item.centre) &&
        Math.min(...item.ring.map((point) => Math.hypot(point.x - door.x, point.y - door.y))) <
          OUTLOOK_CLEAR,
    );
    parts.push(blockers.length === 0 ? 1 : 0);
    for (const blocker of blockers) {
      issues.push({
        code: 'view-blocked',
        principle: 'hierarchy',
        severity: 'major',
        message: `${blocker.name || 'A structure'} stands in the view from the doors, within ${OUTLOOK_CLEAR} m of them.`,
        subjects: [blocker.id],
        repair: 'move-to-zone',
      });
    }

    /*
     * And the axis itself is not run straight into a fence at close range. A short axis is a fact
     * about a small garden rather than a fault, so this only scores where the room is deep enough
     * for the view to have been worth something.
     */
    if (axis && (subject.analysis.roomDepth ?? 0) >= 8) {
      const toFence = Math.min(
        ...subject.analysis.edges.map((edge) => distanceToSegment(axis.to, edge.start, edge.end)),
      );
      parts.push(clamp01(toFence / 2));
    }
  }

  return parts.length > 0 ? { score: meanOf(parts), issues } : NOT_APPLICABLE;
}
