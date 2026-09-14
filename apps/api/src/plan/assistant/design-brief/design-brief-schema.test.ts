import {
  BriefEmphasisSchema,
  BriefSlotSchema,
  CirculationStyleSchema,
  DesignBriefEnvelopeSchema,
  DesignBriefSchema,
  DesiredFeatureSchema,
  FocalStrategySchema,
  FunctionalZoneTypeSchema,
  GardenIntentSchema,
  LayoutArchetypeIdSchema,
  PriorityTierSchema,
  PrivacyStrategySchema,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { DESIGN_BRIEF_JSON_SCHEMA } from './design-brief-schema.js';

/**
 * The JSON Schema is hand-written, so this is what keeps it honest.
 *
 * The failure it exists to catch is silent and, here, silent twice over: a field that drifts means
 * the model returns something the Zod parse rejects, the service falls back to the deterministic
 * brief by design, and the generation succeeds — so nobody sees an error and the feature simply
 * stops doing anything. That is worse than a crash, and only a test finds it.
 *
 * The same shape of test as `garden-action-schema.test.ts`'s, deliberately. If one of them grows a
 * better check, the other two should get it too.
 */
describe('the hand-written JSON Schema agrees with the Zod schema', () => {
  const brief = DESIGN_BRIEF_JSON_SCHEMA.properties.briefs.items;

  it('asks for every field the Zod brief requires', () => {
    /* `style` is deliberately absent: it is the user's own answer and the model may not set it. */
    const zodFields = Object.keys(DesignBriefSchema.shape).filter((key) => key !== 'style');

    expect([...brief.required].sort()).toEqual([...zodFields].sort());
  });

  it('offers the model only vocabulary that exists', () => {
    const pairs: [readonly string[], readonly string[], string][] = [
      [brief.properties.id.enum, BriefSlotSchema.options, 'id'],
      [brief.properties.intent.enum, GardenIntentSchema.options, 'intent'],
      [brief.properties.emphasis.enum, BriefEmphasisSchema.options, 'emphasis'],
      [brief.properties.primaryZone.enum, FunctionalZoneTypeSchema.options, 'primaryZone'],
      [
        brief.properties.secondaryZones.items.enum,
        FunctionalZoneTypeSchema.options,
        'secondaryZones',
      ],
      [
        brief.properties.supportingZones.items.enum,
        FunctionalZoneTypeSchema.options,
        'supportingZones',
      ],
      [
        brief.properties.archetypeShortlist.items.enum,
        LayoutArchetypeIdSchema.options,
        'archetypeShortlist',
      ],
      [brief.properties.circulation.enum, CirculationStyleSchema.options, 'circulation'],
      [brief.properties.focal.enum, FocalStrategySchema.options, 'focal'],
      [brief.properties.privacy.enum, PrivacyStrategySchema.options, 'privacy'],
      [
        brief.properties.featurePriorities.items.properties.feature.enum,
        DesiredFeatureSchema.options,
        'featurePriorities.feature',
      ],
      [
        brief.properties.featurePriorities.items.properties.tier.enum,
        PriorityTierSchema.options,
        'featurePriorities.tier',
      ],
      [
        brief.properties.excludedFeatures.items.properties.feature.enum,
        DesiredFeatureSchema.options,
        'excludedFeatures.feature',
      ],
    ];

    for (const [offered, real, name] of pairs) {
      expect([...offered], name).toEqual([...real]);
    }
  });

  it('accepts an envelope shaped the way the schema describes', () => {
    const one = (id: 'A' | 'B' | 'C') => ({
      id,
      intent: 'entertaining',
      emphasis: 'social',
      primaryZone: 'terrace',
      secondaryZones: ['dining'],
      supportingZones: ['planting'],
      archetypeShortlist: ['terrace_and_lawn'],
      circulation: 'direct',
      focal: 'far-corner',
      privacy: 'screen-neighbours',
      featurePriorities: [{ feature: 'seating', tier: 'essential', reason: 'the point of it' }],
      excludedFeatures: [{ feature: 'water', reason: 'no room beside the dining area' }],
      rationale: 'A garden built round eating outside.',
    });

    const parsed = DesignBriefEnvelopeSchema.safeParse({
      briefs: [one('A'), one('B'), one('C')],
      notes: 'Three readings of the same brief.',
    });

    expect(parsed.success).toBe(true);
  });

  /*
   * Structured outputs refuses a schema with a missing `additionalProperties` or `required`, and the
   * error names the whole schema rather than the field — so this is far cheaper to find here.
   */
  it('closes every object and states what each one requires', () => {
    const objects: { node: Record<string, unknown>; name: string }[] = [];
    const walk = (node: unknown, name: string): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.type === 'object') objects.push({ node: record, name });
      for (const [key, value] of Object.entries(record)) walk(value, `${name}.${key}`);
    };
    walk(DESIGN_BRIEF_JSON_SCHEMA, 'root');

    expect(objects.length).toBeGreaterThan(3);
    for (const { node, name } of objects) {
      expect(node.additionalProperties, name).toBe(false);
      expect(Array.isArray(node.required) && node.required.length > 0, name).toBe(true);
    }
  });

  /* Exactly three: the screen has three cards, and two or four is a set nothing can render. */
  it('will not accept a set that is not three concepts', () => {
    const brief = {
      id: 'A',
      intent: 'mixed',
      emphasis: 'open',
      primaryZone: 'lawn',
      secondaryZones: [],
      supportingZones: [],
      archetypeShortlist: ['terrace_and_lawn'],
      circulation: 'direct',
      focal: 'none',
      privacy: 'none',
      featurePriorities: [],
      excludedFeatures: [],
      rationale: '',
    };

    const envelopeOf = (count: number) =>
      DesignBriefEnvelopeSchema.safeParse({
        briefs: Array.from({ length: count }, () => brief),
        notes: '',
      }).success;

    expect(envelopeOf(3)).toBe(true);
    expect(envelopeOf(2)).toBe(false);
    expect(envelopeOf(4)).toBe(false);
  });

  /**
   * The property the whole architecture rests on, asserted rather than trusted.
   *
   * There is nowhere in a strategic brief to put a coordinate, a dimension or a distance — so "the
   * model never decides where anything goes" is a fact about the type rather than a line in a
   * prompt. The same test `garden-action-schema.test.ts` and `anchors.test.ts` carry, and the reason
   * an LLM can be on the generation path at all.
   */
  it('has nowhere to put a coordinate or a dimension', () => {
    const names = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const record = node as Record<string, unknown>;
      if (record.properties && typeof record.properties === 'object') {
        for (const key of Object.keys(record.properties)) names.add(key);
      }
      for (const value of Object.values(record)) walk(value);
    };
    walk(DESIGN_BRIEF_JSON_SCHEMA);

    expect(names.size).toBeGreaterThan(0);
    const forbidden = [
      'x',
      'y',
      'centre',
      'center',
      'coordinates',
      'points',
      'width',
      'depth',
      'radius',
      'area',
      'distance',
      'size',
      'metres',
    ];
    for (const field of forbidden) {
      expect(names, field).not.toContain(field);
    }
  });

  /* And the type refuses one even if a model tried to smuggle it in. */
  it('refuses a brief carrying a position', () => {
    const parsed = DesignBriefSchema.safeParse({
      id: 'A',
      intent: 'mixed',
      emphasis: 'open',
      primaryZone: 'lawn',
      archetypeShortlist: ['terrace_and_lawn'],
      circulation: 'direct',
      focal: 'none',
      privacy: 'none',
      terraceAt: { x: 4, y: 2 },
    });

    /* Zod strips unknown keys rather than failing, so the assertion is that it does not survive. */
    expect(parsed.success && 'terraceAt' in parsed.data).toBe(false);
  });
});
