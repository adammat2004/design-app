import type {
  DesignBrief,
  DesignElement,
  DesignScore,
  GardenBrief,
  PlanDocument,
  ScoreTier,
} from '@garden-studio/schema';
import type { DesignConstraints } from '../constraints.js';
import { buildBriefs } from './brief-builder.js';
import { identifyFeatures } from './adapters.js';
import { evaluateDesign } from './evaluate/index.js';
import { interpretRequirements } from './requirements.js';
import { analyseSite } from './site-analysis.js';
import type { Requirements, SiteAnalysis } from './types.js';

/**
 * The design agent, as far as it goes today.
 *
 * The pipeline in one place, so the order of the stages is visible rather than implied:
 *
 * ```
 *   PlanDocument
 *     ├─ analyseSite            what the plot is: frame, room, shape, exits, edges, roles, shade
 *     ├─ interpretRequirements  what the user wants: one intent, every feature at a tier, a capacity
 *     ├─ buildBriefs            three strategies: emphasis, zones, archetype shortlist, exclusions
 *     └─ evaluateDesign         nine principles over the elements, with the faults it found
 * ```
 *
 * Two stages of the full architecture are not here yet and their absence is deliberate rather than
 * pending: nothing generates candidate layouts and nothing selects between them. What exists is the
 * half that can be built without touching the generator at all — a reading of the site, a reading
 * of the brief, and a way to measure how good a finished plan is. That ordering is the point. The
 * scorer is calibrated against the generator as it stands before the generator changes, which is
 * the only way to know afterwards whether the change helped.
 *
 * **Pure and query-free.** Everything in this directory runs in TypeScript against plain data, so
 * the whole of it is testable in Node with no database — and so a candidate loop can afford to run
 * it fifty times.
 */

export interface DesignReading {
  analysis: SiteAnalysis;
  requirements: Requirements;
  /** Three strategies, one per concept slot. Slot A is the intent-led recommendation. */
  briefs: DesignBrief[];
}

/**
 * Everything the agent can say about a plan before any geometry is generated.
 *
 * `constraints` is passed in rather than resolved here because it is the generator's own
 * per-concept reading of the brief — budget position, upkeep ceiling, forbidden fills — and there
 * must go on being exactly one of those. See `resolveConstraints`.
 */
export function readDesign(document: PlanDocument, constraints: DesignConstraints): DesignReading {
  const analysis = analyseSite(document);
  const requirements = interpretRequirements(document.brief, analysis, constraints);
  return { analysis, requirements, briefs: buildBriefs(document.brief, requirements, analysis) };
}

/**
 * How good a finished plan is, against the strategy it should have been following.
 *
 * The `brief` is the concept's own where one exists. For a concept generated before the agent did,
 * the caller passes the slot's brief from `readDesign` — which is the honest comparison: it asks
 * what the old generator's output scores against the strategy the new one would have set itself.
 */
export function scoreConcept(
  elements: DesignElement[],
  analysis: SiteAnalysis,
  brief: DesignBrief,
  tier: ScoreTier = 'realised',
): DesignScore {
  return evaluateDesign({
    elements,
    analysis,
    brief,
    featureOf: identifyFeatures(elements),
    tier,
  });
}

/**
 * A one-shot reading for a document with no per-concept constraints to hand.
 *
 * Used by the eval harness and by tests that want a strategy for a plan without standing up the
 * generator. It resolves nothing the generator resolves; it only assembles what the agent needs.
 */
export function readDesignFor(
  document: PlanDocument,
  constraints: DesignConstraints,
  slot: 0 | 1 | 2,
): { analysis: SiteAnalysis; requirements: Requirements; brief: DesignBrief } {
  const analysis = analyseSite(document);
  const requirements = interpretRequirements(document.brief, analysis, constraints);
  const briefs = buildBriefs(document.brief, requirements, analysis);
  return { analysis, requirements, brief: briefs[slot]! };
}

export { analyseSite } from './site-analysis.js';
export { interpretRequirements, capacityFor, inferIntent, withinCapacity } from './requirements.js';
export { buildBrief, buildBriefs } from './brief-builder.js';
export { evaluateDesign, buildSubject, scoreSubject } from './evaluate/index.js';
export { identifyFeatures, featuresPresent, inclusionRate, composedPresent } from './adapters.js';
export { decide, buildExplanation, notableIssues } from './decisions.js';
export { siteShape, isStronglyLinear } from './site-analysis.js';
export type { SiteAnalysis, Requirements, Decision, SiteEdge, AwkwardArea } from './types.js';
export type { DesignSubject } from './evaluate/index.js';
export type { GardenBrief, DesignBrief };
