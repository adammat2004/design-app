import { describe, expect, it } from 'vitest';
import {
  BUDGET_BANDS,
  DESIRED_FEATURES,
  MAINTENANCE_LEVELS,
  PURPOSE_LIMIT,
  PURPOSE_WARN,
  STYLE_DIRECTIONS,
  briefBlockedReason,
  briefCompletion,
  clampPurpose,
  emptyBrief,
  toggleDesiredFeature,
  zoneScopeLabel,
  type GardenBrief,
} from './brief';
import type { GardenZone, ZoneId } from './zones';

/** The three answers that gate Continue, and nothing else. */
function answeredBrief(): GardenBrief {
  return { ...emptyBrief(), budget: 'medium', maintenance: 'low', style: 'modern' };
}

/** Only the fields `zoneScopeLabel` reads; the polygons are irrelevant to it. */
function zone(id: ZoneId, label: string): GardenZone {
  return { id, label, polygon: [], area: 1, centroid: { x: 0, y: 0 } };
}

const FOUR_ZONES = [
  zone('front', 'Front garden'),
  zone('back', 'Back garden'),
  zone('left', 'Left side'),
  zone('right', 'Right side'),
];

describe('the catalogues', () => {
  it('offers the eight named features, plus Other separately', () => {
    expect(DESIRED_FEATURES).toHaveLength(8);
    expect(DESIRED_FEATURES.map((option) => option.id)).not.toContain('other');
  });

  it('gives every budget band its own tint, so the four are told apart at a glance', () => {
    expect(BUDGET_BANDS).toHaveLength(4);
    expect(new Set(BUDGET_BANDS.map((band) => band.tint)).size).toBe(4);
    expect(new Set(BUDGET_BANDS.map((band) => band.accent)).size).toBe(4);
  });

  it('offers three maintenance levels and four style directions', () => {
    expect(MAINTENANCE_LEVELS).toHaveLength(3);
    expect(STYLE_DIRECTIONS).toHaveLength(4);
    expect(STYLE_DIRECTIONS.map((option) => option.id)).not.toContain('other');
  });

  it('warns before it caps', () => {
    expect(PURPOSE_WARN).toBeLessThan(PURPOSE_LIMIT);
  });
});

describe('emptyBrief', () => {
  it('leaves the three gating answers unanswered rather than defaulted', () => {
    const brief = emptyBrief();

    expect(brief.budget).toBeNull();
    expect(brief.maintenance).toBeNull();
    expect(brief.style).toBeNull();
    expect(brief.desiredFeatures).toEqual([]);
    expect(brief.purpose).toBe('');
  });
});

describe('toggleDesiredFeature', () => {
  it('adds a feature that is not chosen', () => {
    expect(toggleDesiredFeature([], 'seating')).toEqual(['seating']);
  });

  it('removes one that is, leaving the rest in order', () => {
    expect(toggleDesiredFeature(['seating', 'play', 'firePit'], 'play')).toEqual([
      'seating',
      'firePit',
    ]);
  });

  it('does not mutate the list it was given', () => {
    const chosen = ['seating' as const];
    toggleDesiredFeature(chosen, 'play');

    expect(chosen).toEqual(['seating']);
  });
});

describe('clampPurpose', () => {
  it('leaves anything within the cap alone', () => {
    expect(clampPurpose('somewhere for the kids to play')).toBe('somewhere for the kids to play');
  });

  it('truncates a paste at exactly the cap', () => {
    expect(clampPurpose('x'.repeat(PURPOSE_LIMIT + 40))).toHaveLength(PURPOSE_LIMIT);
  });
});

describe('briefCompletion', () => {
  it('counts nothing on a fresh brief', () => {
    const completion = briefCompletion(emptyBrief());

    expect(completion.answered).toBe(0);
    expect(completion.requiredAnswered).toBe(0);
    expect(completion.requiredTotal).toBe(3);
    expect(completion.complete).toBe(false);
  });

  it('does not count whitespace as a purpose', () => {
    const sections = briefCompletion({ ...emptyBrief(), purpose: '   \n ' }).sections;

    expect(sections.find((section) => section.id === 'purpose')?.done).toBe(false);
  });

  it('treats purpose and desired features as optional', () => {
    const optional = briefCompletion(emptyBrief()).sections.filter((section) => !section.required);

    expect(optional.map((section) => section.id)).toEqual(['purpose', 'features']);
  });

  it('is complete on the three gating answers alone', () => {
    const completion = briefCompletion(answeredBrief());

    expect(completion.complete).toBe(true);
    expect(completion.requiredAnswered).toBe(3);
    // Purpose empty and nothing selected in the feature grid — still complete.
    expect(completion.answered).toBe(3);
  });

  it('climbs one required answer at a time', () => {
    const brief = emptyBrief();

    expect(briefCompletion({ ...brief, budget: 'low' }).requiredAnswered).toBe(1);
    expect(briefCompletion({ ...brief, budget: 'low', maintenance: 'high' }).requiredAnswered).toBe(
      2,
    );
  });
});

describe('briefBlockedReason', () => {
  it('names all three on a fresh brief', () => {
    expect(briefBlockedReason(emptyBrief())).toBe(
      'Choose a budget band, a maintenance preference and a style direction to continue.',
    );
  });

  it('narrows to what is still outstanding', () => {
    expect(briefBlockedReason({ ...emptyBrief(), budget: 'medium' })).toBe(
      'Choose a maintenance preference and a style direction to continue.',
    );
    expect(briefBlockedReason({ ...emptyBrief(), budget: 'medium', maintenance: 'low' })).toBe(
      'Choose a style direction to continue.',
    );
  });

  it('clears once budget, maintenance and style are chosen, with everything else empty', () => {
    expect(briefBlockedReason(answeredBrief())).toBeNull();
  });

  it('does not block on an empty Other box', () => {
    const brief: GardenBrief = {
      ...answeredBrief(),
      desiredFeatures: ['other'],
      style: 'other',
    };

    expect(briefBlockedReason(brief)).toBeNull();
  });
});

describe('zoneScopeLabel', () => {
  it('says so when nothing is chosen', () => {
    expect(zoneScopeLabel(FOUR_ZONES, [])).toBe('No areas chosen yet');
  });

  it('names a single zone', () => {
    expect(zoneScopeLabel(FOUR_ZONES, ['back'])).toBe('Back garden');
  });

  it('joins two in plan order, not selection order', () => {
    expect(zoneScopeLabel(FOUR_ZONES, ['back', 'front'])).toBe('Front garden and back garden');
  });

  it('collapses to one phrase when every zone is chosen', () => {
    expect(zoneScopeLabel(FOUR_ZONES, ['front', 'back', 'left', 'right'])).toBe(
      'Entire outdoor space',
    );
  });

  it('ignores a tick for a zone the house has dissolved', () => {
    const twoZones = [zone('front', 'Front garden'), zone('back', 'Back garden')];

    expect(zoneScopeLabel(twoZones, ['front', 'left'])).toBe('Front garden');
  });

  it('does not call a lone zone the entire outdoor space', () => {
    expect(zoneScopeLabel([zone('back', 'Back garden')], ['back'])).toBe('Back garden');
  });
});
