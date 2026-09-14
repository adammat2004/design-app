import type {
  DesignBrief,
  DesignElement,
  DesignIssue,
  DesignScore,
  DesiredFeature,
  PrincipleId,
  ScoreTier,
} from '@garden-studio/schema';
import { PRINCIPLE_WEIGHTS } from '../../knowledge/principles.js';
import type { SiteAnalysis } from '../types.js';
import { scoreBuildability } from './buildability.js';
import { scoreCirculation } from './circulation.js';
import { scoreFeatureFit } from './feature-fit.js';
import { scoreGrouping } from './grouping.js';
import { scoreHierarchy } from './hierarchy.js';
import { scorePrivacy } from './privacy.js';
import { scoreProportion } from './proportion.js';
import { scoreRelationships } from './relationships.js';
import { scoreStyle } from './style.js';
import { scoreSun } from './sun.js';
import { buildSubject, type DesignSubject } from './subject.js';

/**
 * How good is this garden?
 *
 * Nine principles, each a pure function of the resolved plan, combined by the weights in
 * `knowledge/principles.ts` and gated by whether the essentials landed. The answer is a breakdown
 * and a list of faults rather than a number, because a number can only rank: the breakdown is what
 * the repair stage acts on, what the explanation quotes and what makes "why is this one better"
 * a question with an answer.
 *
 * **One evaluator, two tiers.** The structural tier runs over a candidate's sketched rectangles,
 * on every one of the fifty-odd candidates, with a coarse composition sample. The realised tier
 * runs the identical code over the finished element list once PostGIS has cut the beds and clipped
 * the lawn, on the finalists only. They differ in when they run and what they can see, never in
 * what they measure — which is what stops a candidate winning on a reading its own realisation
 * contradicts.
 *
 * It has **no authority over geometry**. Every outline it reads came from `geometryOutline`, no
 * placement is moved by it, and deleting this directory leaves the generator producing the same
 * legal plans in an arbitrary order.
 */

export interface EvaluateRequest {
  elements: DesignElement[];
  analysis: SiteAnalysis;
  brief: DesignBrief;
  /** Which requested feature each element is, where it is known. See `adapters.ts`. */
  featureOf?: Map<string, DesiredFeature>;
  tier: ScoreTier;
}

/**
 * How coarsely the composition grid is sampled per tier.
 *
 * A quarter metre is what `measureComposition` defaults to and what the fixture bands were derived
 * against, so the realised tier uses it. Half a metre is four times cheaper and moves a share by
 * about a point, which is well inside bands that span thirty — worth it when it runs fifty times.
 */
const STRUCTURAL_STEP = 0.5;

export function evaluateDesign(request: EvaluateRequest): DesignScore {
  const subject = buildSubject(
    request.elements,
    request.analysis,
    request.brief,
    request.featureOf,
  );
  return scoreSubject(subject, request.tier);
}

export function scoreSubject(subject: DesignSubject, tier: ScoreTier): DesignScore {
  const step = tier === 'structural' ? STRUCTURAL_STEP : undefined;

  const measured: Partial<Record<PrincipleId, number>> = {};
  const issues: DesignIssue[] = [];

  const run = (id: PrincipleId, result: { score: number | null; issues: DesignIssue[] }) => {
    if (result.score !== null) measured[id] = result.score;
    issues.push(...result.issues);
  };

  run('circulation', scoreCirculation(subject));
  run('grouping', scoreGrouping(subject));
  run('proportion', scoreProportion(subject, step));
  run('relationships', scoreRelationships(subject));
  run('privacy', scorePrivacy(subject));
  run('hierarchy', scoreHierarchy(subject));
  run('style', scoreStyle(subject));
  run('buildability', scoreBuildability(subject));
  run('sun', scoreSun(subject));

  const fit = scoreFeatureFit(subject);
  run('featureFit', fit.result);

  /*
   * Renormalised over what actually applied. A principle that could not be measured is absent from
   * `categories` rather than zero, and its weight is shared out — so an unlocated garden is judged
   * on the eight things it can be judged on rather than marked down for a ninth nobody stated.
   */
  let weighted = 0;
  let available = 0;
  for (const [id, score] of Object.entries(measured) as [PrincipleId, number][]) {
    const weight = PRINCIPLE_WEIGHTS[id];
    // `featureFit` is the gate below, not a weighted category.
    if (weight === undefined) continue;
    weighted += weight * score;
    available += weight;
  }

  const base = available > 0 ? weighted / available : 0;

  return {
    /* The gate: a missing essential caps the total rather than reducing it. */
    total: Math.min(1, Math.max(0, Math.min(base, fit.cap))),
    categories: measured,
    issues,
    tier,
  };
}

export { buildSubject };
export type { DesignSubject };
