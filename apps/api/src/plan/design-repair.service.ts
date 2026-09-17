import { Injectable } from '@nestjs/common';
import {
  editorCannot,
  elementAnchor,
  geometryOutline,
  isLocked,
  performableInEditor,
  pointInPolygon,
  polygonCentroid,
  type DesignElement,
  type DesignIntent,
  type DesignIssue,
  type DesignScore,
  type IssueGuidance,
  type PlanDocument,
  type Point,
  type ProposedChange,
  type RepairDesignResult,
} from '@garden-studio/schema';
import { PlannerService } from './assistant/planner.service.js';
import { DesignReviewService } from './design-review.service.js';

/**
 * The best legal answer to one fault, chosen by measuring several rather than by taking the first.
 *
 * Every correction this system has ever made was first-fit. The editor's review loop mapped a fault
 * to one intent, the planner returned the first legal step in that direction, the change was
 * *animated*, and only then was it scored and — about half the time — wound back. So the user
 * watched the designer try something that a measurement taken two seconds earlier would have said
 * was not worth doing.
 *
 * ```
 *   issue + guidance ─► candidates ─► legal? ─► score each ─► best that improves ─► changes
 *                            │                                        │
 *                            └─ bounded, deterministic                └─ or nothing, with a reason
 * ```
 *
 * Four properties hold it together.
 *
 * **The search is where the scorer is.** Scoring a candidate is pure and costs a few milliseconds;
 * doing it on the client would be a round trip each, against a plan that is being animated.
 *
 * **Nothing here writes geometry.** Every candidate is built by the same `PlannerService` the chat
 * uses, from the same `DesignIntent` vocabulary, and is checked by the same `geometryIsLegal` the
 * editor refuses on. This service chooses; it does not place.
 *
 * **The answer is a prediction, and the editor remains the authority.** The client plays the change
 * and re-scores; what this buys is that a change nothing could improve is never played at all.
 *
 * **Bounded and deterministic.** A fixed candidate ceiling, a fixed seed, ties broken by the order
 * the candidates were generated in. Asked twice about the same plan it answers the same thing.
 */

/**
 * How many candidates to build and score.
 *
 * Each is a pure realised-tier score over the whole element list, which is a few milliseconds on a
 * fifty-element garden. Twelve is enough to cover eight directions at a couple of distances and
 * still answer inside the time a user spends reading the fault.
 */
const CEILING = 12;

/** How much better the plan has to get. The same threshold the generator's repair stage uses. */
const WORTHWHILE = 0.002;

@Injectable()
export class DesignRepairService {
  constructor(
    private readonly planner: PlannerService,
    private readonly reviewer: DesignReviewService,
  ) {}

  async repair(
    document: PlanDocument,
    issue: DesignIssue,
    elements: DesignElement[],
  ): Promise<RepairDesignResult> {
    const refusal = this.cannot(issue);
    if (refusal) return { changes: [], predicted: null, considered: 0, reason: refusal };

    const target = subjectOf(issue, elements);
    if (!target) {
      return {
        changes: [],
        predicted: null,
        considered: 0,
        reason: 'It is not about anything on the plan that can be changed.',
      };
    }

    const before = this.reviewer.review(document, elements);
    const intents = this.candidates(issue, target, elements, document);

    let best: { changes: ProposedChange[]; after: DesignScore; resolved: boolean } | null = null;
    let considered = 0;

    for (const intent of intents) {
      const { changes } = await this.planner.plan(
        { ...document, layout: { ...document.layout, elements } },
        [intent],
      );
      if (changes.length === 0) continue;

      considered += 1;
      const after = this.reviewer.review(document, applyChanges(elements, changes));
      const resolved = !after.issues.some((found) => sameIssue(found, issue));

      if (!improves(before, after, issue, resolved)) continue;
      if (best && !betterThan(after, resolved, best)) continue;

      best = { changes, after, resolved };
    }

    if (!best) {
      return {
        changes: [],
        predicted: null,
        considered,
        reason: considered === 0 ? nothingToTry(issue, target) : NOTHING_HELPED,
      };
    }

    return {
      changes: best.changes,
      predicted: { before: before.total, after: best.after.total, resolved: best.resolved },
      considered,
      reason: null,
    };
  }

  /** Why nothing was even worth trying, in words that say which limitation was met. */
  private noop = undefined;

  /** Why this fault cannot be acted on at all, or `null` when it can. */
  private cannot(issue: DesignIssue): string | null {
    if (!issue.repair) return 'There is no correction for this kind of fault.';
    if (!performableInEditor(issue.repair)) return capitalise(editorCannot(issue.repair)!);
    return null;
  }

  /**
   * The changes worth trying, as intents.
   *
   * Intents rather than geometry, so every candidate goes through the planner that the chat's own
   * requests go through and is refused by the same rules. A candidate this builds that the planner
   * declines simply never becomes a candidate — which is why `considered` counts what came back
   * rather than what was tried.
   */
  private candidates(
    issue: DesignIssue,
    target: DesignElement,
    elements: DesignElement[],
    document: PlanDocument,
  ): DesignIntent[] {
    const guidance = issue.guidance ?? {};
    const to = { elementIds: [target.id] };

    switch (issue.repair) {
      case 'shrink-terrace':
      case 'widen-path':
        return sizes(guidance, target).map((factor) => ({ kind: 'resize', target: to, factor }));

      case 'drop-optional':
        return issue.subjects
          .slice(0, CEILING)
          .map((id) => ({ kind: 'remove', target: { elementIds: [id] } }));

      case 'reroute':
        return target.shape.kind === 'polyline' ? this.routes(guidance, to) : [];

      case 'align':
        return [{ kind: 'rotate', target: to, to: guidance.alignTo ?? 'house' }];

      case 'move-to-zone':
      case 'move-destination':
      case 'move-tree':
        return this.moves(guidance, target, elements, document);

      default:
        return [];
    }
  }

  /** A reroute is one intent per objective the guidance supports; the router does the searching. */
  private routes(guidance: IssueGuidance, to: { elementIds: string[] }): DesignIntent[] {
    const intents: DesignIntent[] = [];

    if (guidance.avoid?.length) {
      intents.push({
        kind: 'reroute',
        target: to,
        objective: 'avoid',
        avoidElementIds: guidance.avoid.slice(0, 8),
      });
    }
    if (guidance.connect) {
      intents.push({
        kind: 'reroute',
        target: to,
        objective: 'connect',
        connectElementId: guidance.connect,
      });
    }
    intents.push({ kind: 'reroute', target: to, objective: 'direct' });

    return intents;
  }

  /**
   * Where a moved thing might go, as relations rather than positions.
   *
   * The guidance says what a good answer satisfies — near these, clear of those, out of the view —
   * and each of those resolves to an *element or an anchor* the `move` intent can name. What is
   * left over is the eight directions at three distances, which is how "somewhere else, and
   * measurably better" is searched without anybody stating a coordinate.
   *
   * The nudges are expressed as a move towards a nearby element where one is in that direction and
   * as a move away from the target's own surroundings otherwise — because `DesignIntent` has no
   * field for a displacement, and that is the property being preserved rather than worked around.
   */
  private moves(
    guidance: IssueGuidance,
    target: DesignElement,
    elements: DesignElement[],
    document: PlanDocument,
  ): DesignIntent[] {
    const to = { elementIds: [target.id] };
    const intents: DesignIntent[] = [];

    for (const id of (guidance.near ?? []).slice(0, 4)) {
      if (id !== target.id) {
        intents.push({ kind: 'move', target: to, towards: 'element', elementId: id, away: false });
      }
    }
    for (const id of (guidance.awayFrom ?? []).slice(0, 4)) {
      if (id !== target.id) {
        intents.push({ kind: 'move', target: to, towards: 'element', elementId: id, away: true });
      }
    }

    if (guidance.nearAnchor === 'house') {
      intents.push({ kind: 'move', target: to, towards: 'house', away: false });
    }
    if (guidance.awayFromAnchor === 'house' || guidance.outOfView) {
      intents.push({ kind: 'move', target: to, towards: 'house', away: true });
    }
    if (guidance.clearOfBoundaryM !== undefined) {
      intents.push({ kind: 'move', target: to, towards: 'boundary', away: true });
    }
    if (guidance.inView) {
      intents.push({ kind: 'move', target: to, towards: 'house', away: false });
    }

    /*
     * Every zone in scope, which is the one destination the vocabulary always had and the one the
     * old loop could not use — the scorer never named a zone, so mapping a move to one would have
     * been inventing the correction rather than performing it. It names one now, and where it does
     * not, the zones are still a small, bounded set of real rooms rather than a guess.
     */
    const zones = zonesOf(document, target);
    for (const zone of zones.slice(0, 4)) {
      intents.push({ kind: 'move', target: to, towards: 'zone', zone, away: false });
    }

    /* And the neighbours: somewhere else, measured, without a displacement anywhere in the union. */
    for (const other of nearest(target, elements).slice(0, 3)) {
      intents.push({
        kind: 'move',
        target: to,
        towards: 'element',
        elementId: other.id,
        away: true,
      });
    }

    return intents.slice(0, CEILING);
  }
}

/* ---------------------------------------------------------------- choosing */

/**
 * Whether a candidate is worth keeping.
 *
 * Three conditions, and dropping any of them has a name. **The fault has to get better**, or the
 * loop is free to "fix" a pinched path by enlarging a terrace at the other end of the garden —
 * which is a higher total and not an answer. **The total has to rise**, by the same 0.002 the
 * generator's repair stage uses, or a change that traded one fault for another of equal weight
 * would count as progress. **Nothing severe may appear**: a repair that swaps a minor fault for a
 * critical one is not a repair, and this is the one condition measured on the *kinds* of what
 * appeared rather than on the number.
 */
function improves(
  before: DesignScore,
  after: DesignScore,
  issue: DesignIssue,
  resolved: boolean,
): boolean {
  const principle = issue.principle;
  const rose = (after.categories[principle] ?? 0) > (before.categories[principle] ?? 0);
  if (!resolved && !rose) return false;

  if (after.total <= before.total + WORTHWHILE) return false;
  if (criticals(after) > criticals(before)) return false;
  return majorsElsewhere(after, principle) <= majorsElsewhere(before, principle);
}

/** Resolved first, then the higher total. Ties keep the candidate that was generated first. */
function betterThan(
  after: DesignScore,
  resolved: boolean,
  best: { after: DesignScore; resolved: boolean },
): boolean {
  if (resolved !== best.resolved) return resolved;
  return after.total > best.after.total;
}

function criticals(score: DesignScore): number {
  return score.issues.filter((issue) => issue.severity === 'critical').length;
}

/** Major faults about anything but the principle being repaired. */
function majorsElsewhere(score: DesignScore, principle: DesignIssue['principle']): number {
  return score.issues.filter((issue) => issue.severity === 'major' && issue.principle !== principle)
    .length;
}

/** Whether a fault found now is the one that was being repaired. */
function sameIssue(found: DesignIssue, issue: DesignIssue): boolean {
  return (
    found.code === issue.code &&
    found.subjects.length === issue.subjects.length &&
    found.subjects.every((subject, index) => subject === issue.subjects[index])
  );
}

/* ---------------------------------------------------------------- reading the plan */

/** The element a fault is about, where one of its subjects names something changeable. */
function subjectOf(issue: DesignIssue, elements: DesignElement[]): DesignElement | null {
  for (const subject of issue.subjects) {
    const found = elements.find((element) => element.id === subject);
    if (found && !found.hidden && !isLocked(found)) return found;
  }
  return null;
}

/** The plan as it would be with these changes applied, in the order they were proposed. */
function applyChanges(elements: DesignElement[], changes: ProposedChange[]): DesignElement[] {
  let next = elements;

  for (const change of changes) {
    if (change.kind === 'remove') {
      next = next.filter((element) => element.id !== change.elementId);
      continue;
    }
    if (change.kind === 'add') {
      next = [...next, change.next];
      continue;
    }
    next = next.map((element) => (element.id === change.elementId ? change.next : element));
  }

  return next;
}

/** How big the guidance asks for it to be, as factors on a side rather than on area. */
function sizes(guidance: IssueGuidance, target: DesignElement): number[] {
  if (guidance.minWidthM !== undefined && target.shape.kind === 'polyline') {
    /* A width the fault named: aim at it, and a little over, because landing on it leaves the fault. */
    const factor = guidance.minWidthM / Math.max(0.1, target.shape.width);
    return unique([clampFactor(factor), clampFactor(factor * 1.1)]);
  }

  const area = guidance.targetAreaFactor ?? 0.85;
  /* On a side, because a resize scales both: the square root is what makes the *area* the factor. */
  const side = Math.sqrt(area);
  return unique([clampFactor(side), clampFactor(side * 0.95), clampFactor(side * 1.05)]);
}

function clampFactor(factor: number): number {
  return Math.min(4, Math.max(0.25, factor));
}

function unique(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value.toFixed(4))))].filter(
    (value) => Math.abs(value - 1) > 0.01,
  );
}

/**
 * The rooms the target is not already in.
 *
 * The zones the *user* put in scope, which is the only list of rooms this plan has, minus the one
 * the thing is in — moving something to where it already is has no direction and the move ladder
 * reports it as "already as far that way as it will go", which is true and useless.
 */
function zonesOf(document: PlanDocument, target: DesignElement): DesignElement['zone'][] {
  return document.site.selectedZoneIds
    .filter((zone) => zone !== target.zone)
    .sort((a, b) => a.localeCompare(b));
}

/** The things nearest the target, which are what "somewhere else" is measured away from. */
function nearest(target: DesignElement, elements: DesignElement[]): DesignElement[] {
  const anchor = elementAnchor(target);

  return elements
    .filter(
      (element) =>
        element.id !== target.id &&
        !element.hidden &&
        element.role === 'feature' &&
        element.shape.kind !== 'polyline',
    )
    .map((element) => ({
      element,
      distance: distanceBetween(anchor, element),
    }))
    .sort((a, b) => a.distance - b.distance)
    .map((entry) => entry.element);
}

function distanceBetween(anchor: Point, element: DesignElement): number {
  const ring = geometryOutline(element.shape);
  if (ring.length < 3) return Infinity;
  if (pointInPolygon(anchor, ring)) return 0;
  const centre = polygonCentroid(ring);
  return Math.hypot(centre.x - anchor.x, centre.y - anchor.y);
}

/** What the reviewer says when every candidate improved nothing. */
const NOTHING_HELPED = 'Nothing that could be done about it makes the design better.';

/**
 * Why there was nothing to try, in words that name the limitation actually met.
 *
 * The one worth naming is `route-missing`: its subject is the thing nobody can reach rather than a
 * path, so the correction is to *lay* a route and not to redraw one. Laying a route is the one
 * `RepairVerb` with no planner behind it — `DesignIntent.add` builds a footprint at a sampled point
 * and a route is a line between two things, which is a different question. Saying so is the point:
 * "there is no legal change" would be a sentence that sounds like the plot's fault.
 */
function nothingToTry(issue: DesignIssue, target: DesignElement): string {
  if (issue.repair === 'reroute' && target.shape.kind !== 'polyline') {
    return 'Nothing reaches it, and laying a new path is not something the designer can do yet.';
  }
  return 'There is no legal change to it that this plan allows.';
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
