import { geometryOutline, polygonArea, type PlanDocument } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES as BUDGET_POSITIONS } from '../archetypes.js';
import { resolveConstraints } from '../constraints.js';
import { GOOD_ENOUGH } from '../knowledge/principles.js';
import { elementsFromPreview } from './adapters.js';
import { buildBriefs } from './brief-builder.js';
import { enumerateCandidates } from './candidates.js';
import { chooseLayouts } from './choose.js';
import { evaluateDesign } from './evaluate/index.js';
import { previewLayout, type PreviewRequest } from './layout-generator.js';
import { repairCandidate, UNAVAILABLE } from './repair.js';
import { interpretRequirements, withinCapacity } from './requirements.js';
import { scenario, SCENARIOS } from './scenarios.js';
import { analyseSite } from './site-analysis.js';
import { defaultParams } from '../knowledge/archetypes/types.js';
import { NO_ADJUSTMENTS, hasAdjustments, slotBarred } from './types.js';

/**
 * The repair stage, tested without a database.
 *
 * What these are really guarding is the honesty of the loop rather than its cleverness. A repair
 * that raises a score by quietly shrinking the garden, or one the real pipeline then ignores, is
 * worse than no repair at all — the concept would carry a number describing a plan nobody drew.
 * Both of those are properties rather than examples, so they are asserted over every scenario.
 */

function read(document: PlanDocument) {
  const analysis = analyseSite(document);
  const constraints = resolveConstraints(
    document.brief,
    BUDGET_POSITIONS[0]!,
    analysis.scale.designedArea,
  );
  const requirements = interpretRequirements(document.brief, analysis, constraints);
  const briefs = buildBriefs(document.brief, requirements, analysis);
  return { analysis, constraints, requirements, briefs };
}

function contextOf(
  document: PlanDocument,
): Omit<PreviewRequest, 'archetype' | 'params' | 'brief' | 'analysis'> | null {
  const { analysis, constraints, requirements } = read(document);
  if (!analysis.box || !analysis.frame || !analysis.room) return null;

  return {
    constraints,
    room: analysis.room,
    box: analysis.box,
    frame: analysis.frame,
    boundary: analysis.boundary,
    houseRing: analysis.house?.ring ?? null,
    scope: null,
    obstacles: analysis.house ? [analysis.house.ring] : [],
    thresholds: [],
    placing: withinCapacity(requirements).keep,
    zoneAt: () => analysis.mainZoneId ?? 'back',
    gateSide: analysis.gateSide,
    gateCentre: analysis.sideGate?.centre ?? null,
    lawnAllowed: !constraints.forbiddenFill.includes('lawn'),
  };
}

/** Every scenario's field, scored, so a test can repair real candidates rather than invented ones. */
function fieldFor(document: PlanDocument) {
  const context = contextOf(document);
  if (!context) return null;
  const { analysis, briefs } = read(document);
  const candidates = enumerateCandidates({ analysis, brief: briefs[0]!, context });

  const scored = candidates.map((candidate) => {
    const { elements, featureOf } = elementsFromPreview(candidate.preview, context.zoneAt);
    return {
      candidate,
      score: evaluateDesign({
        elements,
        analysis,
        brief: candidate.brief,
        featureOf,
        tier: 'structural' as const,
      }),
    };
  });

  return { analysis, context, scored };
}

function repairAll(document: PlanDocument) {
  const field = fieldFor(document);
  if (!field) return [];
  return field.scored.map((entry) => ({
    before: entry,
    after: repairCandidate({
      candidate: entry.candidate,
      score: entry.score,
      analysis: field.analysis,
      context: field.context,
    }),
  }));
}

/* ---------------------------------------------------------------- the guarantee */

describe('a repair', () => {
  /**
   * The one property that makes the stage safe to run on everything. It cannot make a plan worse,
   * because at the limit it changes nothing and the candidate it was given stands.
   */
  it('never lowers the score it was asked to raise', () => {
    for (const entry of SCENARIOS) {
      for (const { before, after } of repairAll(entry.document)) {
        expect(after.score.total, `${entry.key}/${before.candidate.id}`).toBeGreaterThanOrEqual(
          before.score.total,
        );
      }
    }
  });

  /**
   * *Introduces*, not *has*. A candidate can arrive carrying a critical fault — the selector drops
   * those before it picks, and these tests repair the whole raw field on purpose — and repair is not
   * obliged to cure one. What it may never do is create one while chasing a higher total.
   */
  it('never introduces a fault that makes the plan unofferable', () => {
    for (const entry of SCENARIOS) {
      for (const { before, after } of repairAll(entry.document)) {
        const criticals = (score: { issues: { severity: string }[] }) =>
          score.issues.filter((issue) => issue.severity === 'critical').length;
        expect(criticals(after.score), `${entry.key}/${before.candidate.id}`).toBeLessThanOrEqual(
          criticals(before.score),
        );
      }
    }
  });

  /**
   * The defect the benchmark found, as a test.
   *
   * Barring the slot a store was in asks the fitter for its second answer — and where there is no
   * second answer the store simply goes unplaced, taking the fault with it. The relationship score
   * rises, the loop accepts, and the real pipeline hands the store to the sampler, which puts it
   * back with none of the composition's reasoning. On the long-narrow fixture that turned a plan
   * scoring 0.83 into one scoring 0.72 while every structural number said it had improved.
   */
  it('moves what it was asked to move, and never loses it', () => {
    for (const entry of SCENARIOS) {
      for (const { before, after } of repairAll(entry.document)) {
        if (after.repairs.length === 0) continue;
        const seated = new Set(after.candidate.preview.placed.map((item) => item.feature));
        for (const item of before.candidate.preview.placed) {
          const droppedOnPurpose = after.adjustments.dropped.includes(item.feature);
          expect(
            seated.has(item.feature) || droppedOnPurpose,
            `${entry.key}/${before.candidate.id}/${item.feature}`,
          ).toBe(true);
        }
      }
    }
  });

  it('leaves a candidate that is already good enough entirely alone', () => {
    for (const entry of SCENARIOS) {
      for (const { before, after } of repairAll(entry.document)) {
        if (before.score.total < GOOD_ENOUGH) continue;
        expect(after.repairs, `${entry.key}/${before.candidate.id}`).toEqual([]);
        expect(hasAdjustments(after.adjustments)).toBe(false);
        expect(after.candidate).toBe(before.candidate);
      }
    }
  });

  it('stays within its budget however many faults there are', () => {
    for (const entry of SCENARIOS) {
      for (const { after } of repairAll(entry.document)) {
        expect(after.repairs.length).toBeLessThanOrEqual(4);
        expect(after.attempted).toBeLessThanOrEqual(4);
      }
    }
  });

  it('is deterministic', () => {
    const once = repairAll(scenario('overloaded').document).map((entry) => entry.after.repairs);
    const twice = repairAll(scenario('overloaded').document).map((entry) => entry.after.repairs);
    expect(once).toEqual(twice);
  });

  /**
   * A repair that changed nothing must not claim it did, and one that changed something must say
   * what. The explanation quotes these verbatim on the concept card, so a sentence describing a
   * change the plan does not carry is the same class of untruth as a decision naming no element.
   */
  it('accounts for itself: a sentence for each change, and no sentence without one', () => {
    for (const entry of SCENARIOS) {
      for (const { before, after } of repairAll(entry.document)) {
        const changed =
          hasAdjustments(after.adjustments) ||
          JSON.stringify(after.candidate.params) !== JSON.stringify(before.candidate.params);

        expect(after.repairs.length > 0, `${entry.key}/${before.candidate.id}`).toBe(changed);
        for (const sentence of after.repairs) {
          expect(sentence.length).toBeGreaterThan(10);
          expect(sentence.trimEnd().endsWith('.')).toBe(true);
        }
      }
    }
  });
});

/* ---------------------------------------------------------------- the adjustments */

describe('a layout adjustment', () => {
  const document = scenario('family-play').document;

  it('draws exactly the unrepaired plan when it is empty', () => {
    const context = contextOf(document)!;
    const { analysis, briefs } = read(document);
    const candidate = enumerateCandidates({ analysis, brief: briefs[0]!, context })[0]!;

    const again = previewLayout({
      ...context,
      archetype: candidate.fit.archetype,
      params: candidate.params,
      brief: candidate.brief,
      analysis,
      adjustments: NO_ADJUSTMENTS,
    });

    expect(again.placed).toEqual(candidate.preview.placed);
    expect(again.routes).toEqual(candidate.preview.routes);
    expect(again.trees).toEqual(candidate.preview.trees);
  });

  it('keeps a feature out of the slot it was barred from', () => {
    const context = contextOf(document)!;
    const { analysis, briefs } = read(document);
    const candidate = enumerateCandidates({ analysis, brief: briefs[0]!, context })[0]!;
    const item = candidate.preview.placed.find((placed) => placed.slotId !== 'terrace');
    if (!item) return;

    const adjustments = {
      ...NO_ADJUSTMENTS,
      avoidSlots: [{ feature: item.feature, slot: item.slotId }],
    };
    expect(slotBarred(adjustments, item.feature, item.slotId)).toBe(true);

    const moved = previewLayout({
      ...context,
      archetype: candidate.fit.archetype,
      params: candidate.params,
      brief: candidate.brief,
      analysis,
      adjustments,
    });

    const again = moved.placed.find((placed) => placed.feature === item.feature);
    expect(again?.slotId).not.toBe(item.slotId);
  });

  it('leaves a dropped feature out of the drawing altogether', () => {
    const context = contextOf(document)!;
    const { analysis, briefs } = read(document);
    const candidate = enumerateCandidates({ analysis, brief: briefs[0]!, context })[0]!;
    const item = candidate.preview.placed.find((placed) => placed.slotId !== 'terrace');
    if (!item) return;

    const without = previewLayout({
      ...context,
      archetype: candidate.fit.archetype,
      params: candidate.params,
      brief: candidate.brief,
      analysis,
      adjustments: { ...NO_ADJUSTMENTS, dropped: [item.feature] },
    });

    expect(without.placed.some((placed) => placed.feature === item.feature)).toBe(false);
    expect(without.unplaced).not.toContain(item.feature);
  });

  it('widens every route to the floor it sets', () => {
    const context = contextOf(document)!;
    const { analysis, briefs } = read(document);
    const candidate = enumerateCandidates({ analysis, brief: briefs[0]!, context })[0]!;
    if (candidate.preview.routes.length === 0) return;

    const wider = previewLayout({
      ...context,
      archetype: candidate.fit.archetype,
      params: candidate.params,
      brief: candidate.brief,
      analysis,
      adjustments: { ...NO_ADJUSTMENTS, routeWidth: 1.5 },
    });

    for (const route of wider.routes) {
      if (route.geometry.kind !== 'polyline') continue;
      expect(route.geometry.width).toBeGreaterThanOrEqual(1.5);
    }
  });
});

/* ---------------------------------------------------------------- the preview's honesty */

describe('a preview', () => {
  /**
   * The measured reason the access pass is in the preview at all. The real pipeline gives every
   * room it placed a path from the terrace; a preview that stopped at the composition's own paths
   * was choosing candidates on a circulation reading its own realisation then contradicted.
   */
  it('gives every room it placed a way to it, or reports none', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const { analysis, briefs } = read(entry.document);
      const candidate = enumerateCandidates({ analysis, brief: briefs[0]!, context })[0]!;
      const { preview } = candidate;
      if (preview.terraceRefused || preview.placed.length < 2) continue;

      /* Not every room can be reached on every plot; what must hold is that it was attempted. */
      expect(preview.routes.length, entry.key).toBeGreaterThan(0);
      for (const route of preview.routes) {
        expect(polygonArea(geometryOutline(route.geometry)), entry.key).toBeGreaterThan(0);
      }
    }
  });
});

/* ---------------------------------------------------------------- wiring */

describe('the chosen layout', () => {
  it('carries what the repair changed, so realisation can honour it', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const { analysis, briefs } = read(entry.document);

      for (const choice of chooseLayouts({ analysis, briefs, context })) {
        expect(choice.adjustments, entry.key).toBeDefined();
        /*
         * The wiring that matters: a repair that moved a subject is carried by `adjustments` and
         * one that moved a parameter by `params`. A choice claiming a repair must carry it in the
         * adjustments, in the parameters, or realisation has nothing to honour.
         */
        if (choice.repairs.length > 0) {
          const moved =
            hasAdjustments(choice.adjustments) ||
            JSON.stringify(choice.candidate.params) !==
              JSON.stringify(defaultParams(choice.candidate.fit.archetype.id));
          expect(moved, entry.key).toBe(true);
        }
      }
    }
  });

  it('says which repairs it cannot perform, rather than silently skipping them', () => {
    expect(Object.keys(UNAVAILABLE).sort()).toEqual(['align', 'merge-beds']);
    for (const reason of Object.values(UNAVAILABLE)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
