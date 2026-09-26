import { distanceToSegment, type DesignIssue } from '@garden-studio/schema';
import {
  clamp01,
  meanOf,
  NOT_APPLICABLE,
  type PrincipleResult,
  type MeasuredIssue,
} from './result.js';
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
  const issues: MeasuredIssue[] = [];
  const parts: number[] = [];

  /* ---- dominance ---- */
  parts.push(...dominance(subject, issues));

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
        guidance: { outOfView: true, awayFromAnchor: 'house', awayM: OUTLOOK_CLEAR },
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

/**
 * Is one space clearly the main one — and is it the one the concept said it was?
 *
 * `brief.primaryZone` is the room the whole plan claims to be organised around. It is set per
 * concept slot, so the social reading of a brief centres on the dining area and the open reading on
 * the lawn, and until now no principle read it: whichever space happened to be biggest counted as
 * the main one, and a plan that said it was built round a lawn and then paved most of the garden
 * scored exactly as well as one that meant it.
 *
 * Where the primary zone can be resolved to something on the plan, dominance is measured on *that*
 * against its largest rival. Where it cannot — the zone holds nothing that was drawn — the old
 * biggest-against-second-biggest reading stands, because a plan cannot be marked down for failing to
 * emphasise a room it was never able to build.
 */
function dominance(subject: DesignSubject, issues: MeasuredIssue[]): number[] {
  const spaces = [...subject.items, ...subject.panels];
  if (spaces.length < 2) return [];

  const resolved = primarySpace(subject);
  const primary = resolved?.space ?? null;

  /*
   * An open panel is not a rival to a room, and this is the whole of why the rule is safe.
   *
   * A lawn is the largest single thing in very nearly every garden ever drawn. Counting it as a
   * rival would report every concept built round dining, play or a hot tub as failing to be about
   * that thing — which is a rule that fires on almost everything and therefore says nothing. The
   * panel is the ground the rooms stand in; what "organised around the dining area" claims is that
   * it is the most generous *room*. When the primary zone is itself the open ground, everything
   * competes, because then the claim really is about which space is biggest.
   */
  const field = resolved === null || resolved.fromPanel ? spaces : subject.items;
  const rivals = field.filter((space) => space.id !== primary?.id).sort((a, b) => b.area - a.area);

  const main = primary ?? rivals[0]!;
  const next = primary ? rivals[0] : rivals[1];
  if (!next) return [];

  const ratio = next.area > 0 ? main.area / next.area : DOMINANCE;
  if (ratio >= 1.15) return [clamp01(ratio / DOMINANCE)];

  const repair = primary && primary.area < next.area ? repairFor(primary, next) : undefined;

  issues.push({
    code: 'no-primary-space',
    principle: 'hierarchy',
    severity: 'minor',
    message: primary
      ? `The ${subject.brief.primaryZone} area is what this concept is organised around, and ${describe(next)} is ${ratio < 1 ? 'larger' : 'the same size'}.`
      : 'No one space is clearly the main one: the two largest are near enough the same size.',
    subjects: primary ? [primary.id, next.id] : [],
    ...(repair ? { repair } : {}),
    /* How much bigger the main space has to be, as a factor on area rather than a size. */
    ...(primary ? { guidance: { targetAreaFactor: (next.area * DOMINANCE) / primary.area } } : {}),
  });

  return [clamp01(ratio / DOMINANCE)];
}

/**
 * The thing on the plan the concept's primary zone is about.
 *
 * Resolved through the same `FEATURE_LIBRARY` zone every feature is filed under, so "the dining
 * zone" means the elements the library says belong to it rather than anything this file decides.
 * `lawn` and `planting` are the two zones nothing is *placed* in — they are composed — so they
 * resolve to the open panel and to the beds instead.
 */
function primarySpace(
  subject: DesignSubject,
): { space: DesignSubject['items'][number]; fromPanel: boolean } | null {
  const zone = subject.brief.primaryZone;

  if (zone === 'lawn') {
    const panels = subject.panels
      .filter((panel) => panel.category === 'lawn' || panel.category === 'gravel-mulch')
      .sort((a, b) => b.area - a.area);
    return panels[0] ? { space: asSpace(panels[0]), fromPanel: true } : null;
  }

  const inZone = subject.items.filter((item) => item.zone === zone).sort((a, b) => b.area - a.area);
  return inZone[0] ? { space: inZone[0], fromPanel: false } : null;
}

/** A region read as a space, so the two can be compared without widening `SubjectItem`. */
function asSpace(region: DesignSubject['panels'][number]): DesignSubject['items'][number] {
  return {
    id: region.id,
    feature: null,
    zone: null,
    category: region.category,
    name: 'the lawn',
    ring: region.ring,
    centre: region.centre,
    area: region.area,
    rotation: null,
    material: null,
    purpose: null,
    symbol: null,
  };
}

function describe(space: { name?: string; category: string }): string {
  return space.name || `the ${space.category.replace('-', ' ')}`;
}

/**
 * What to do about a main space that is not the main space.
 *
 * Only ever "make the intended one bigger" or "make the rival smaller", and only where the rival is
 * the terrace — which is the one thing a repair can shrink. Anything else is the composition's
 * decision rather than an adjustment to an element.
 */
function repairFor(
  primary: { category: string },
  rival: { category: string },
): DesignIssue['repair'] {
  if (rival.category === 'paved-area') return 'shrink-terrace';
  return primary.category === 'lawn' ? 'enlarge-lawn' : undefined;
}
