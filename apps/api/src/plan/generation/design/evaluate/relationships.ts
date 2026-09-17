import {
  pointInPolygon,
  polygonsIntersect,
  type IssueGuidance,
  type Point,
} from '@garden-studio/schema';
import {
  ruleWeight,
  rulesFor,
  type RelationshipRule,
  type RelationSubject,
} from '../../knowledge/relationship-rules.js';
import { clamp01, NOT_APPLICABLE, type PrincipleResult, type MeasuredIssue } from './result.js';
import { nearestDistance, type DesignSubject } from './subject.js';

/**
 * Does each thing stand in the right relationship to the others?
 *
 * The knowledge in `relationship-rules.ts`, measured. Each rule that *applies* — both its subject
 * and its object are actually in this garden — contributes its weight, and the score is the
 * weighted fraction satisfied. Rules whose subject is absent are not failures; a garden with no
 * play area is not badly designed for having no play area near the lawn.
 *
 * A distance rule is scored as a gradient rather than a pass: a barbecue 3.4 m from the table when
 * the rule asks for 3 has very nearly done the right thing, and scoring it zero would make the
 * evaluator prefer a candidate that put the barbecue at 2.9 m in a worse place overall.
 *
 * Visibility is answered against the view cone the site analysis already computed, so "the shed
 * should not be in the view from the doors" and "the play area should be" are the same test read in
 * opposite directions — which is what stops the two drifting apart.
 */

/** How far past a `preferNear` distance a pair may be before the rule scores nothing. */
const NEAR_RUNOUT = 6;

/** How far short of an `avoidNear` distance a pair may be before the rule scores nothing. */
const AVOID_RUNOUT = 3;

/**
 * Slack on every distance comparison, in metres.
 *
 * A centroid is computed by shoelace and a threshold is a round number, so a pair placed at exactly
 * the distance a rule asks for lands a fraction of a nanometre the wrong side of it about half the
 * time. Reporting "the barbecue is 3.0 m from the table, past the 3 m it wants" is the kind of
 * fault nobody can act on and everybody stops trusting the tool over.
 */
const SLACK = 1e-6;

export function scoreRelationships(subject: DesignSubject): PrincipleResult {
  const present = new Set<RelationSubject>(subject.positions.keys());
  const rules = rulesFor(present);
  if (rules.length === 0) return NOT_APPLICABLE;

  const issues: MeasuredIssue[] = [];
  let earned = 0;
  let available = 0;

  for (const rule of rules) {
    const outcome = scoreRule(rule, subject);
    if (outcome === null) continue;

    /*
     * Weighed by what this concept is for. A social reading of a brief cares more that the barbecue
     * is by the table than a planted reading does, which is the difference between three cards
     * judged as three gardens and three cards judged as one. Note the *severity* below still reads
     * the rule's own weight, so a fault does not change how bad it is depending on which slot it
     * turned up in — only how much of the score it costs.
     */
    const weight = ruleWeight(rule, subject.brief.emphasis);
    available += weight;
    earned += weight * outcome.score;
    if (outcome.issue) issues.push(outcome.issue);
  }

  return { score: available > 0 ? clamp01(earned / available) : null, issues };
}

function scoreRule(
  rule: RelationshipRule,
  subject: DesignSubject,
): { score: number; issue?: MeasuredIssue } | null {
  if (rule.kind === 'requireVisibleFrom' || rule.kind === 'avoidVisibleFrom') {
    return scoreVisibility(rule, subject);
  }

  const distance = nearestDistance(subject, rule.subject, rule.object);
  if (distance === null || rule.distance === undefined) return null;

  const subjects = idsOf(subject, rule.subject);

  if (rule.kind === 'avoidNear') {
    if (distance >= rule.distance - SLACK) return { score: 1 };
    const score = clamp01((distance - (rule.distance - AVOID_RUNOUT)) / AVOID_RUNOUT);
    return {
      score,
      issue: {
        code: rule.code ?? 'relationship-unmet',
        principle: 'relationships',
        severity: rule.weight >= 3 ? 'major' : 'minor',
        message: `${name(rule.subject)} is ${distance.toFixed(1)} m from ${name(rule.object)}, inside the ${rule.distance} m it wants. ${rule.reason}`,
        subjects,
        repair: 'move-to-zone',
        guidance: keepApart(rule, subject),
      },
    };
  }

  if (distance <= rule.distance + SLACK) return { score: 1 };

  const score = clamp01(1 - (distance - rule.distance) / NEAR_RUNOUT);
  /*
   * A `requireNear` that is missed is a real fault; a `preferNear` that is missed by a long way is
   * a minor one. Neither is critical — a relationship the plot cannot satisfy is a compromise, not
   * an illegal garden, and refusing the candidate outright would leave small plots with nothing.
   */
  const severity = rule.kind === 'requireNear' ? 'major' : 'minor';
  if (rule.kind === 'preferNear' && score > 0.6) return { score };

  return {
    score,
    issue: {
      code: rule.code ?? 'relationship-unmet',
      principle: 'relationships',
      severity,
      message: `${name(rule.subject)} is ${distance.toFixed(1)} m from ${name(rule.object)}, past the ${rule.distance} m it wants. ${rule.reason}`,
      subjects,
      repair: 'move-to-zone',
      guidance: bringTogether(rule, subject),
    },
  };
}

/**
 * Whether the subject is in the view from the garden doors.
 *
 * `null` — not scored at all — when there is no view cone, which is every plan with no house or no
 * resolvable door. Guessing at a sightline without a doorway to stand in would be inventing the one
 * fact the whole rule rests on.
 */
function scoreVisibility(
  rule: RelationshipRule,
  subject: DesignSubject,
): { score: number; issue?: MeasuredIssue } | null {
  const cone = subject.analysis.viewCone;
  if (!cone) return null;

  const items = subject.items.filter((item) => item.feature === rule.subject);
  if (items.length === 0) return null;

  const wantsVisible = rule.kind === 'requireVisibleFrom';
  // In view if any part of it is: a shed half in the sightline is a shed in the sightline.
  const seen = items.map((item) => ({
    item,
    visible: pointInPolygon(item.centre, cone) || polygonsIntersect(item.ring, cone),
  }));

  const satisfied = seen.filter((entry) => entry.visible === wantsVisible);
  const score = satisfied.length / seen.length;
  if (score === 1) return { score };

  const offenders = seen.filter((entry) => entry.visible !== wantsVisible);
  return {
    score,
    issue: {
      code: rule.code ?? 'relationship-unmet',
      principle: 'relationships',
      severity: rule.weight >= 3 ? 'major' : 'minor',
      message: wantsVisible
        ? `${name(rule.subject)} cannot be seen from the garden doors. ${rule.reason}`
        : `${name(rule.subject)} sits in the view from the garden doors. ${rule.reason}`,
      subjects: offenders.map((entry) => entry.item.id),
      repair: 'move-to-zone',
      /*
       * A store out of the view wants somewhere to go, not just somewhere to leave: the utility
       * room by the gate is where a designer puts it, and saying so is the difference between a
       * fault the planner can act on and one it can only refuse.
       */
      guidance: wantsVisible
        ? { inView: true }
        : {
            outOfView: true,
            ...(rule.subject === 'storage'
              ? { preferZone: 'utility' as const, nearAnchor: 'gate' as const }
              : {}),
          },
    },
  };
}

/**
 * What a correction has to get this near to, as a relation.
 *
 * An element id where the object is something on the plan, and an anchor where it is the house or
 * the gate — which is why `IssueGuidance` carries both. Never a point: the planner resolves where
 * "near the dining area" actually is, against geometry the scorer only read.
 */
function bringTogether(rule: RelationshipRule, subject: DesignSubject): IssueGuidance {
  const ids = idsOf(subject, rule.object);
  if (ids.length > 0) return { near: ids.slice(0, 8), nearM: rule.distance };
  if (rule.object === 'house') return { nearAnchor: 'house', nearM: rule.distance };
  if (rule.object === 'gate') return { nearAnchor: 'gate', nearM: rule.distance };
  return {};
}

/** The same, read the other way: what it has to get clear of, and by how much. */
function keepApart(rule: RelationshipRule, subject: DesignSubject): IssueGuidance {
  const ids = idsOf(subject, rule.object);
  if (ids.length > 0) return { awayFrom: ids.slice(0, 8), awayM: rule.distance };
  if (rule.object === 'house') return { awayFromAnchor: 'house', awayM: rule.distance };
  if (rule.object === 'street') return { awayFromAnchor: 'street', awayM: rule.distance };
  return {};
}

function idsOf(subject: DesignSubject, key: RelationSubject): string[] {
  return subject.items.filter((item) => item.feature === key).map((item) => item.id);
}

/** What a rule's subject is called in a sentence. */
function name(key: RelationSubject): string {
  switch (key) {
    case 'house':
      return 'the house';
    case 'gate':
      return 'the side gate';
    case 'street':
      return 'the street';
    case 'lawn':
      return 'the lawn';
    case 'outdoorKitchen':
      return 'the outdoor kitchen';
    case 'firePit':
      return 'the fire pit';
    case 'hotTub':
      return 'the hot tub';
    case 'gardenRoom':
      return 'the garden room';
    case 'vegPatch':
      return 'the kitchen garden';
    case 'plantingBeds':
      return 'the planting';
    case 'play':
      return 'the play area';
    case 'storage':
      return 'the garden store';
    default:
      return `the ${key}`;
  }
}

/** Exported for the hierarchy principle, which asks the same question of a different subject. */
export function isInView(cone: Point[] | null, ring: Point[], centre: Point): boolean {
  if (!cone) return false;
  return pointInPolygon(centre, cone) || polygonsIntersect(ring, cone);
}
