import { describe, expect, it } from 'vitest';
import type { GardenBrief } from '@garden-studio/schema';
import { ARCHETYPES } from './archetypes.js';
import {
  featureAttempts,
  resolveConstraints,
  resolvePlotScale,
  SUBURBAN_REFERENCE,
} from './constraints.js';

/**
 * Pure policy, so no database. The point of pulling this out of `concepts.service` was that the
 * rules could be stated and checked on their own, and this file is the check.
 */

const [balanced, entertaining, retreat] = ARCHETYPES;

function brief(overrides: Partial<GardenBrief> = {}): GardenBrief {
  return {
    purpose: '',
    desiredFeatures: [],
    featuresOther: '',
    budget: 'medium',
    maintenance: 'medium',
    style: null,
    styleOther: '',
    ...overrides,
  };
}

describe('resolveConstraints', () => {
  /*
   * The defect this whole layer exists for: the card's badge and the ground cover were computed
   * from two different places, so a brief saying "medium" produced a concept badged "low" with a
   * lawn under it. There is now one call, and both read its answer.
   */
  it('takes maintenance from the archetype, which is what the card claims', () => {
    const answered = brief({ maintenance: 'medium' });

    expect(resolveConstraints(answered, balanced!, 150).maintenance).toBe('medium');
    // Archetype 2 is the low-maintenance retreat whatever the brief said.
    expect(resolveConstraints(answered, retreat!, 150).maintenance).toBe('low');
  });

  /*
   * A stated level is a ceiling. Archetype 1 declares itself `medium`, so without the cap a user
   * who asked for low maintenance is offered a medium-upkeep concept among the three — the brief
   * having no force, which is the same defect in a different place.
   */
  it('never offers more upkeep than the brief asked for', () => {
    const low = brief({ maintenance: 'low' });

    for (const archetype of ARCHETYPES) {
      expect(resolveConstraints(low, archetype, 150).maintenance).toBe('low');
    }
  });

  it('still lets an archetype come in under the ceiling', () => {
    // The retreat is calmer than a medium brief asked for, and that is never the complaint.
    expect(resolveConstraints(brief({ maintenance: 'medium' }), retreat!, 150).maintenance).toBe(
      'low',
    );
  });

  it('has no ceiling to apply when the question was left unanswered', () => {
    expect(resolveConstraints(brief({ maintenance: null }), entertaining!, 150).maintenance).toBe(
      'medium',
    );
  });

  it('forbids lawn exactly when the concept claims low maintenance', () => {
    expect(resolveConstraints(brief(), retreat!, 150).forbiddenFill).toEqual(['lawn']);
    expect(resolveConstraints(brief(), balanced!, 150).forbiddenFill).toEqual([]);
  });

  it('follows the style into low upkeep even when the level does not say so', () => {
    const constraints = resolveConstraints(
      brief({ maintenance: 'high', style: 'lowMaintenance' }),
      balanced!,
      150,
    );

    expect(constraints.forbiddenFill).toEqual(['lawn']);
  });

  /*
   * Only the flowering perennial mixes. Shrubs, ground cover, grasses and hedging all stay — they
   * are genuinely low-upkeep, and a low-maintenance concept still has to have something to plant.
   */
  it('rules out the perennial mixes and nothing else', () => {
    const forbidden = resolveConstraints(brief(), retreat!, 150).forbiddenMaterials;

    expect(forbidden).toEqual(['mixed-border', 'wildflower']);
    expect(forbidden).not.toContain('shrubs');
    expect(forbidden).not.toContain('ground-cover');
  });

  it('defaults an unanswered budget rather than carrying null into the design', () => {
    expect(resolveConstraints(brief({ budget: null }), balanced!, 150).budget).toBe('medium');
  });
});

describe('resolvePlotScale', () => {
  it('bands the plot by the area actually in scope', () => {
    expect(resolvePlotScale(40).band).toBe('courtyard');
    expect(resolvePlotScale(150).band).toBe('suburban');
    expect(resolvePlotScale(900).band).toBe('large');
    expect(resolvePlotScale(8400).band).toBe('estate');
  });

  it('leaves the reference plot at the size the manifest quotes', () => {
    expect(resolvePlotScale(SUBURBAN_REFERENCE).sizeFactor).toBeCloseTo(1);
  });

  /*
   * The heart of the plot-scale fix, and the reason for a fractional exponent: a plot ten times
   * larger wants *more* areas and a somewhat bigger one, not a dining table for forty.
   */
  it('grows footprints sub-linearly', () => {
    const ten = resolvePlotScale(SUBURBAN_REFERENCE * 10).sizeFactor;

    expect(ten).toBeGreaterThan(1);
    expect(ten).toBeLessThan(3);
  });

  it('clamps at both ends, so neither a window box nor a farm goes absurd', () => {
    expect(resolvePlotScale(1).sizeFactor).toBeCloseTo(0.6);
    expect(resolvePlotScale(500_000).sizeFactor).toBeCloseTo(2.5);
  });

  it('treats an empty scope as the reference rather than dividing by nothing', () => {
    expect(resolvePlotScale(0).sizeFactor).toBeCloseTo(1);
  });
});

describe('featureAttempts', () => {
  it('attempts the whole list on an ordinary plot', () => {
    const constraints = resolveConstraints(brief(), balanced!, 150);

    expect(featureAttempts(4, balanced!, constraints)).toBe(4);
  });

  it('asks less of a courtyard, and more of an estate', () => {
    const courtyard = resolveConstraints(brief(), balanced!, 40);
    const estate = resolveConstraints(brief(), balanced!, 8400);

    expect(featureAttempts(4, balanced!, courtyard)).toBeLessThan(4);
    expect(featureAttempts(4, balanced!, estate)).toBeGreaterThan(4);
  });

  it('lets the budget shave one off and add one on', () => {
    const low = resolveConstraints(brief({ budget: 'low' }), balanced!, 150);
    const premium = resolveConstraints(brief({ budget: 'premium' }), balanced!, 150);

    expect(featureAttempts(4, balanced!, low)).toBe(3);
    expect(featureAttempts(4, balanced!, premium)).toBe(5);
  });

  it('carries the archetype’s own appetite through', () => {
    const constraints = resolveConstraints(brief(), retreat!, 150);

    // The retreat is a calmer plan by design: fewer built things, more ground cover.
    expect(featureAttempts(4, retreat!, constraints)).toBeLessThan(
      featureAttempts(4, entertaining!, resolveConstraints(brief(), entertaining!, 150)),
    );
  });

  it('never goes below nothing', () => {
    const constraints = resolveConstraints(brief({ budget: 'low' }), balanced!, 40);

    expect(featureAttempts(0, balanced!, constraints)).toBe(0);
  });
});
