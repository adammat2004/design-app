import type {
  DesignBrief,
  DesignElement,
  DesignIssue,
  DesignScore,
  DesiredFeature,
  PrincipleId,
  ScoreTier,
} from '@garden-studio/schema';
import { BASE_PROFILE, weightProfile } from '../../knowledge/weight-profiles.js';
import type { SiteAnalysis } from '../types.js';
import { scoreBuildability } from './buildability.js';
import { scoreCanopy } from './canopy.js';
import { scoreCirculation } from './circulation.js';
import { scoreFeatureFit } from './feature-fit.js';
import { scoreGrouping } from './grouping.js';
import { scoreHierarchy } from './hierarchy.js';
import { scoreMaintenance } from './maintenance.js';
import { measure } from './measure.js';
import { scorePrivacy } from './privacy.js';
import { scoreProportion } from './proportion.js';
import { scoreRelationships } from './relationships.js';
import { scoreStyle } from './style.js';
import { scoreSun } from './sun.js';
import type { PrincipleResult } from './result.js';
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
 * **There is no universal definition of the perfect garden**, so the weights follow the brief.
 * `weightProfile` shifts the base table by what the concept is for — an entertaining plan weighs how
 * its spaces relate, a planted one weighs enclosure and massing, a low-upkeep one weighs what it
 * will cost to look after — and the weights actually applied are attached to the score, because a
 * weighted mean whose weights are invisible cannot be explained.
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

/**
 * Off with `BRIEF_WEIGHTS=0`, which exists for measurement rather than for production.
 *
 * The same lever `DESIGN_REPAIR=0` is, for the same reason: brief-driven weights change which
 * candidate the loop picks, so a benchmark taken after they landed cannot say which of the two
 * things moved a number. Being able to run the harness with the old fixed table is what makes the
 * comparison attributable — and it is how the one repeated composition in the fixture set was
 * traced to the social profile rather than to the new principle.
 */
const BRIEF_WEIGHTS = process.env.BRIEF_WEIGHTS !== '0';

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
  /* Sampled once: `proportion` and `maintenanceFit` read the same grid. See `measure.ts`. */
  const composition = measure(subject, step);

  const scored: Partial<Record<PrincipleId, number>> = {};
  const issues: DesignIssue[] = [];

  /*
   * Stamped with the critic that found it, once, on the way out. Everything in this directory
   * measures geometry; a vision critic reading the rendered picture stamps its own, and nothing
   * downstream has to know which it was reading.
   */
  const run = (id: PrincipleId, result: PrincipleResult) => {
    if (result.score !== null) scored[id] = result.score;
    for (const issue of result.issues) issues.push({ ...issue, source: 'geometry' });
  };

  run('circulation', scoreCirculation(subject));
  run('grouping', scoreGrouping(subject));
  run('proportion', scoreProportion(subject, composition));
  run('relationships', scoreRelationships(subject));
  run('privacy', scorePrivacy(subject));
  run('hierarchy', scoreHierarchy(subject));
  run('style', scoreStyle(subject));
  run('buildability', scoreBuildability(subject));
  run('sun', scoreSun(subject));
  run('maintenanceFit', scoreMaintenance(subject, composition));
  run('canopy', scoreCanopy(subject));

  const fit = scoreFeatureFit(subject);
  run('featureFit', fit.result);

  /*
   * Weighted by what this concept is *for*, then renormalised over what actually applied.
   *
   * The profile is a deterministic reading of the brief's own intent and emphasis — see
   * `weight-profiles.ts` — so the three concept slots are judged as the three different gardens they
   * claim to be rather than against one universal standard. A principle that could not be measured
   * is absent from `categories` rather than zero, and its weight is shared out, so an unlocated
   * garden is judged on what it can be judged on rather than marked down for a fact nobody stated.
   */
  const profile = BRIEF_WEIGHTS ? weightProfile(subject.brief) : BASE_PROFILE;

  let weighted = 0;
  let available = 0;
  const applied: Partial<Record<PrincipleId, number>> = {};
  for (const [id, score] of Object.entries(scored) as [PrincipleId, number][]) {
    const weight = profile.weights[id];
    // `featureFit` is the gate below, not a weighted category.
    if (weight === undefined) continue;
    weighted += weight * score;
    available += weight;
    applied[id] = weight;
  }

  const base = available > 0 ? weighted / available : 0;

  /* Renormalised for the record too, so the weights shown are the ones the total was made of. */
  for (const id of Object.keys(applied) as PrincipleId[]) {
    applied[id] = applied[id]! / available;
  }

  return {
    /* The gate: a missing essential caps the total rather than reducing it. */
    total: Math.min(1, Math.max(0, Math.min(base, fit.cap))),
    categories: scored,
    issues,
    tier,
    weights: applied,
  };
}

export { buildSubject };
export type { DesignSubject };
