import type { DesignBrief, PlanDocument } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES as BUDGET_POSITIONS } from '../archetypes.js';
import { resolveConstraints } from '../constraints.js';
import { ARCHETYPES } from '../knowledge/archetypes/index.js';
import { rankArchetypes } from './archetype-selector.js';
import { buildBriefs } from './brief-builder.js';
import { reconcileBriefs } from './brief-reconcile.js';
import { interpretRequirements } from './requirements.js';
import { scenario, SCENARIOS } from './scenarios.js';
import { analyseSite } from './site-analysis.js';

/**
 * What a model is allowed to change about a design brief, tested with no model.
 *
 * This is the half of Phase 5 that matters, and the split that makes it testable is the same one
 * `planner.service.test.ts` gets from `DesignIntent`: the model produces a structured opinion, and
 * a pure function decides how much of it is true. Feed the function an opinion, assert what
 * survives.
 *
 * The property every test here is circling: **the deterministic brief is the floor.** A model can
 * improve a brief and it cannot break one, because every field falls back and the worst case is the
 * answer the generator would have produced anyway.
 */

function read(document: PlanDocument) {
  const analysis = analyseSite(document);
  const constraints = resolveConstraints(
    document.brief,
    BUDGET_POSITIONS[0]!,
    analysis.scale.designedArea,
  );
  const requirements = interpretRequirements(document.brief, analysis, constraints);
  return { analysis, fallback: buildBriefs(document.brief, requirements, analysis) };
}

/** The fallback with one field overridden, which is how a model's answer differs in practice. */
function proposeFrom(fallback: DesignBrief[], over: Partial<DesignBrief>): DesignBrief[] {
  return fallback.map((brief) => ({ ...brief, ...over }));
}

describe('reconciling a strategic brief', () => {
  const document = scenario('small-entertaining').document;

  it('keeps the deterministic brief when the model returned nothing usable', () => {
    const { analysis, fallback } = read(document);
    const result = reconcileBriefs([], fallback, document.brief, analysis);

    expect(result.briefs).toEqual(fallback);
    expect(result.refused.length).toBe(3);
  });

  it('takes the model’s reading of what the garden is for', () => {
    const { analysis, fallback } = read(document);
    const proposed = proposeFrom(fallback, { intent: 'gardening', emphasis: 'productive' });
    const result = reconcileBriefs(proposed, fallback, document.brief, analysis);

    for (const brief of result.briefs) {
      expect(brief.intent).toBe('gardening');
      expect(brief.emphasis).toBe('productive');
    }
    expect(result.accepted.A).toContain('intent');
  });

  /**
   * The one hallucination that would reach the drawing. The zone planner builds rooms from the
   * priority list, so an invented hot tub becomes a real rectangle in a real garden — and the owner
   * never asked for it.
   */
  it('drops a feature the user never asked for, and keeps the ones they did', () => {
    const { analysis, fallback } = read(document);
    const invented = {
      feature: 'greenhouse' as const,
      tier: 'essential' as const,
      reason: 'invented',
    };
    const real = { feature: 'seating' as const, tier: 'essential' as const, reason: 'real' };

    const result = reconcileBriefs(
      proposeFrom(fallback, { featurePriorities: [real, invented] }),
      fallback,
      { ...document.brief, desiredFeatures: ['seating', 'dining'] },
      analysis,
    );

    const features = result.briefs[0]!.featurePriorities.map((entry) => entry.feature);
    expect(features).toContain('seating');
    expect(features).not.toContain('greenhouse');
    expect(result.refused.some((note) => note.includes('greenhouse'))).toBe(true);
  });

  /**
   * Demoted rather than dropped: they asked for it, so it stays in the ranking. A brief where
   * everything is essential has ranked nothing, and the capacity cut then has no information to
   * cut on — which is the state the whole priority layer exists to replace.
   */
  it('caps how many things one concept may call essential', () => {
    const { analysis, fallback } = read(document);
    const everything = document.brief.desiredFeatures.map((feature) => ({
      feature,
      tier: 'essential' as const,
      reason: 'all of it',
    }));

    const result = reconcileBriefs(
      proposeFrom(fallback, { featurePriorities: everything }),
      fallback,
      document.brief,
      analysis,
    );

    for (const brief of result.briefs) {
      const essentials = brief.featurePriorities.filter((entry) => entry.tier === 'essential');
      expect(essentials.length).toBeLessThanOrEqual(4);
      /* Nothing was lost, only demoted. */
      expect(brief.featurePriorities.length).toBe(everything.length);
    }
  });

  /**
   * A composition scoring zero is a *refusal* rather than a low mark — a formal axis on a plot with
   * no axis is the wrong plan, not a worse one — so the site selector's answer outranks the model's
   * preference. Asserted against whichever compositions this particular plot actually refuses,
   * rather than against a hard-coded pair that might become viable when an archetype is retuned.
   */
  it('refuses a composition this plot has already ruled out', () => {
    const { analysis, fallback } = read(document);
    const refusedHere = ARCHETYPES.map((archetype) => archetype.id).filter(
      (id) =>
        !rankArchetypes(analysis, fallback[0]!).some(
          (fit) => fit.archetype.id === id && fit.score > 0,
        ),
    );

    expect(
      refusedHere.length,
      'this plot must refuse something for the test to mean anything',
    ).toBeGreaterThan(0);

    const result = reconcileBriefs(
      proposeFrom(fallback, { archetypeShortlist: refusedHere.slice(0, 3) }),
      fallback,
      document.brief,
      analysis,
    );

    /* Every one was refused, so the shortlist emptied and the default stands. */
    for (const [index, brief] of result.briefs.entries()) {
      expect(brief.archetypeShortlist).toEqual(fallback[index]!.archetypeShortlist);
    }
    expect(result.refused.some((note) => note.includes('cannot hold'))).toBe(true);
  });

  it('keeps the compositions the plot does allow, and drops only the rest', () => {
    const { analysis, fallback } = read(document);
    const viable = rankArchetypes(analysis, fallback[0]!)
      .filter((fit) => fit.score > 0)
      .map((fit) => fit.archetype.id);
    const refusedHere = ARCHETYPES.map((archetype) => archetype.id).filter(
      (id) => !viable.includes(id),
    );
    if (viable.length === 0 || refusedHere.length === 0) return;

    const result = reconcileBriefs(
      proposeFrom(fallback, { archetypeShortlist: [refusedHere[0]!, viable[0]!] }),
      fallback,
      document.brief,
      analysis,
    );

    expect(result.briefs[0]!.archetypeShortlist).toEqual([viable[0]!]);
  });

  it('will not let a concept exclude something nobody asked for', () => {
    const { analysis, fallback } = read(document);
    const result = reconcileBriefs(
      proposeFrom(fallback, {
        excludedFeatures: [{ feature: 'greenhouse', reason: 'no room' }],
      }),
      fallback,
      { ...document.brief, desiredFeatures: ['seating'] },
      analysis,
    );

    for (const brief of result.briefs) {
      expect(brief.excludedFeatures.some((entry) => entry.feature === 'greenhouse')).toBe(false);
    }
  });

  /**
   * The style is the user's own answer on a picture card. A model overriding it would turn a stated
   * preference into an inferred one, which is the thing the offered-not-applied convention exists
   * to prevent everywhere else in this app.
   */
  it('never lets the model change the style the user chose', () => {
    const { analysis, fallback } = read(document);
    const result = reconcileBriefs(
      proposeFrom(fallback, { style: 'formal' }),
      fallback,
      document.brief,
      analysis,
    );

    for (const [index, brief] of result.briefs.entries()) {
      expect(brief.style).toBe(fallback[index]!.style);
    }
  });

  it('will not organise a concept around a room nothing goes in', () => {
    const { analysis, fallback } = read(document);
    const result = reconcileBriefs(
      proposeFrom(fallback, { primaryZone: 'water' }),
      fallback,
      { ...document.brief, desiredFeatures: ['seating', 'dining'] },
      analysis,
    );

    for (const [index, brief] of result.briefs.entries()) {
      expect(brief.primaryZone).toBe(fallback[index]!.primaryZone);
    }
  });

  /**
   * The floor, asserted over every scenario rather than argued. Whatever a model says — including
   * nothing at all, and including three copies of one brief — what comes out still parses, still
   * names three slots, and still has a composition to try.
   */
  it('always returns three usable briefs, whatever it was handed', () => {
    for (const entry of SCENARIOS) {
      const { analysis, fallback } = read(entry.document);

      const nonsense: DesignBrief[][] = [
        [],
        fallback.map((brief) => ({ ...brief, archetypeShortlist: [] as never })),
        proposeFrom(fallback, { featurePriorities: [], excludedFeatures: [] }),
      ];

      for (const proposed of nonsense) {
        const result = reconcileBriefs(proposed, fallback, entry.document.brief, analysis);

        expect(result.briefs.length, entry.key).toBe(3);
        expect(
          result.briefs.map((brief) => brief.id),
          entry.key,
        ).toEqual(['A', 'B', 'C']);
        for (const brief of result.briefs) {
          expect(brief.archetypeShortlist.length, entry.key).toBeGreaterThan(0);
        }
      }
    }
  });

  /**
   * The end of the chain, and the reason the shortlist is a field at all.
   *
   * A preference the ranking ignored would be the "tick the design ignores" failure this codebase
   * records twice already. What it may *not* do is move a score: the first attempt gave a
   * shortlisted composition a tenth of a point and the benchmark said no — mean 0.872 → 0.868 and
   * the worst plan 0.739 → 0.680, because the site-and-style ranking is the better judge. So the
   * shortlist decides only between compositions the plot scores level, which is asserted here
   * directly rather than through a number that must not change.
   */
  it('marks what the brief shortlisted, without moving its score', () => {
    const { analysis, fallback } = read(document);
    const viable = rankArchetypes(analysis, fallback[0]!).filter((fit) => fit.score > 0);
    if (viable.length < 2) return;

    const runnerUp = viable[1]!.archetype.id;
    const result = reconcileBriefs(
      proposeFrom(fallback, { archetypeShortlist: [runnerUp] }),
      fallback,
      document.brief,
      analysis,
    );

    const ranked = rankArchetypes(analysis, result.briefs[0]!);
    const after = ranked.find((fit) => fit.archetype.id === runnerUp)!;

    expect(after.shortlisted).toBe(true);
    expect(after.score).toBe(viable[1]!.score);
    expect(ranked.filter((fit) => fit.shortlisted).length).toBe(1);
  });

  /**
   * And it does decide, where the plot has no opinion. Two compositions inside the near-tie band are
   * separated by whichever the brief named, rather than by the alphabetical order that decided it
   * before — which is the whole of what a strategic shortlist is allowed to be worth.
   */
  it('puts a shortlisted composition ahead of one the plot scores level with it', () => {
    const { analysis, fallback } = read(document);
    const ranked = rankArchetypes(analysis, { ...fallback[0]!, archetypeShortlist: [] as never });

    const pair = ranked.find(
      (fit, index) => index > 0 && Math.abs(fit.score - ranked[index - 1]!.score) < 0.03,
    );
    if (!pair) return;

    const promoted = rankArchetypes(analysis, {
      ...fallback[0]!,
      archetypeShortlist: [pair.archetype.id],
    });

    expect(promoted.findIndex((fit) => fit.archetype.id === pair.archetype.id)).toBeLessThan(
      ranked.findIndex((fit) => fit.archetype.id === pair.archetype.id),
    );
  });

  it('is deterministic', () => {
    const { analysis, fallback } = read(document);
    const proposed = proposeFrom(fallback, { intent: 'relaxation' });

    const once = reconcileBriefs(proposed, fallback, document.brief, analysis);
    const twice = reconcileBriefs(proposed, fallback, document.brief, analysis);
    expect(once).toEqual(twice);
  });
});
