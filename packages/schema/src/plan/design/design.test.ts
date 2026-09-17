import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { GeneratedConceptSchema } from '../concepts.js';
import {
  DesignBriefEnvelopeSchema,
  DesignBriefSchema,
  featuresAtLeast,
  tierOf,
} from './design-brief.js';
import {
  DesignIssueSchema,
  DesignScoreSchema,
  hasCritical,
  IssueGuidanceSchema,
  issuesBySeverity,
} from './design-score.js';
import { ConceptExplanationSchema } from './concept-explanation.js';
import { isAtLeast, PRIORITY_ORDER, PriorityTierSchema } from './vocabulary.js';

function brief(over: Partial<z.input<typeof DesignBriefSchema>> = {}) {
  return DesignBriefSchema.parse({
    id: 'A',
    intent: 'entertaining',
    emphasis: 'social',
    primaryZone: 'dining',
    archetypeShortlist: ['terrace_and_lawn'],
    circulation: 'direct',
    focal: 'far-corner',
    privacy: 'screen-neighbours',
    ...over,
  });
}

/**
 * The property the whole architecture rests on, and the one a model could break silently.
 *
 * A `DesignBrief` may eventually be written by Claude. If any field could hold a number pair, the
 * model would be placing things, and the deterministic planner would no longer be authoritative
 * about geometry. Walking the schema's own property names is the check that survives somebody
 * adding a field in a hurry — the same test `anchors.test.ts` runs over `GardenAction`.
 */
describe('a design brief cannot express a position', () => {
  const FORBIDDEN = [
    'x',
    'y',
    'at',
    'centre',
    'center',
    'points',
    'polygon',
    'coordinates',
    'u',
    'v',
  ];

  function names(schema: z.ZodTypeAny, depth = 0): string[] {
    if (depth > 6) return [];
    const inner = schema as unknown as { _def: { typeName: string; [key: string]: unknown } };
    const def = inner._def;

    if (def.typeName === 'ZodObject') {
      const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
      return Object.entries(shape).flatMap(([key, value]) => [
        key,
        ...names(value as z.ZodTypeAny, depth + 1),
      ]);
    }
    if (def.typeName === 'ZodArray') return names((def as { type: z.ZodTypeAny }).type, depth + 1);
    if (
      def.typeName === 'ZodOptional' ||
      def.typeName === 'ZodNullable' ||
      def.typeName === 'ZodDefault'
    ) {
      return names((def as { innerType: z.ZodTypeAny }).innerType, depth + 1);
    }
    if (def.typeName === 'ZodUnion' || def.typeName === 'ZodDiscriminatedUnion') {
      const options = (def as { options: z.ZodTypeAny[] }).options ?? [];
      return options.flatMap((option) => names(option, depth + 1));
    }
    return [];
  }

  it('has no field whose name could hold a coordinate', () => {
    const found = names(DesignBriefSchema).filter((name) => FORBIDDEN.includes(name));
    expect(found).toEqual([]);
  });

  it('gives an issue nowhere to put a position either', () => {
    /*
     * The same property, on the other half of the contract. `IssueGuidance` exists so the reviewer
     * can say what a valid correction would achieve — near this, clear of that, out of the view —
     * and the moment it could carry a point the scorer would be placing things. Every field on it
     * is an id, an enum, a boolean or a distance, and a distance is a relation rather than a
     * position: "three metres from the table" is true wherever the table is.
     */
    const found = names(IssueGuidanceSchema).filter((name) => FORBIDDEN.includes(name));
    expect(found).toEqual([]);
  });

  it('accepts no numbers at all except through the enums it names', () => {
    // Every leaf is a string, an enum or an array of them: a brief is entirely categorical.
    const parsed = brief({
      featurePriorities: [{ feature: 'seating', tier: 'essential', reason: 'asked for' }],
    });
    const numeric = JSON.stringify(parsed).match(/:\s*-?\d/g) ?? [];
    expect(numeric).toEqual([]);
  });
});

describe('a design issue', () => {
  const issue = (over: Partial<z.input<typeof DesignIssueSchema>> = {}) =>
    DesignIssueSchema.parse({
      code: 'shed-in-view',
      principle: 'relationships',
      severity: 'major',
      message: 'The store sits in the view from the doors.',
      subjects: ['e1'],
      ...over,
    });

  it('is a geometry finding unless it says otherwise', () => {
    /*
     * Defaulted rather than required, so every emitter written before a second critic existed goes
     * on parsing — and so the field means "which critic found this" rather than "did somebody
     * remember to set it".
     */
    expect(issue().source).toBe('geometry');
    expect(issue({ source: 'visual' }).source).toBe('visual');
  });

  it('carries no guidance unless the detector had some', () => {
    expect(issue().guidance).toBeUndefined();
  });

  it('takes the relations a planner can act on', () => {
    const guided = issue({
      guidance: {
        near: ['e2'],
        nearM: 3,
        outOfView: true,
        preferZone: 'utility',
        nearAnchor: 'gate',
      },
    });

    expect(guided.guidance).toEqual({
      near: ['e2'],
      nearM: 3,
      outOfView: true,
      preferZone: 'utility',
      nearAnchor: 'gate',
    });
  });

  it('refuses a zone it has never heard of', () => {
    expect(() => issue({ guidance: { preferZone: 'orangery' } })).toThrow();
  });
});

describe('design brief helpers', () => {
  it('reads a feature back at the tier it was given', () => {
    const subject = brief({
      featurePriorities: [
        { feature: 'seating', tier: 'essential', reason: 'the garden is for entertaining' },
        { feature: 'water', tier: 'optional', reason: 'if it fits' },
      ],
    });

    expect(tierOf(subject, 'seating')).toBe('essential');
    expect(tierOf(subject, 'water')).toBe('optional');
    expect(tierOf(subject, 'play')).toBeNull();
  });

  it('filters by tier floor in the order the brief ranked them', () => {
    const subject = brief({
      featurePriorities: [
        { feature: 'seating', tier: 'essential', reason: '' },
        { feature: 'water', tier: 'optional', reason: '' },
        { feature: 'pergola', tier: 'preferred', reason: '' },
      ],
    });

    expect(featuresAtLeast(subject, 'preferred')).toEqual(['seating', 'pergola']);
    expect(featuresAtLeast(subject, 'optional')).toEqual(['seating', 'water', 'pergola']);
  });

  it('orders tiers ascending, so "at least preferred" is a comparison', () => {
    expect(PRIORITY_ORDER).toEqual([...PriorityTierSchema.options].reverse());
    expect(isAtLeast('essential', 'preferred')).toBe(true);
    expect(isAtLeast('optional', 'preferred')).toBe(false);
    expect(isAtLeast('preferred', 'preferred')).toBe(true);
  });

  it('requires exactly three briefs in an envelope', () => {
    expect(DesignBriefEnvelopeSchema.safeParse({ briefs: [brief(), brief()] }).success).toBe(false);
    expect(
      DesignBriefEnvelopeSchema.safeParse({
        briefs: [brief(), brief({ id: 'B' }), brief({ id: 'C' })],
      }).success,
    ).toBe(true);
  });
});

describe('a design score', () => {
  const score = DesignScoreSchema.parse({
    total: 0.62,
    categories: { circulation: 0.4, grouping: 0.8 },
    issues: [
      {
        code: 'route-detour',
        principle: 'circulation',
        severity: 'minor',
        message: 'long',
        subjects: ['e1'],
      },
      {
        code: 'missing-essential',
        principle: 'featureFit',
        severity: 'critical',
        message: 'no terrace',
      },
      { code: 'lawn-sliver', principle: 'proportion', severity: 'major', message: 'thin' },
    ],
    tier: 'structural',
  });

  it('reports a critical issue', () => {
    expect(hasCritical(score)).toBe(true);
    expect(
      hasCritical({ ...score, issues: score.issues.filter((i) => i.severity !== 'critical') }),
    ).toBe(false);
  });

  it('sorts issues worst first, which is the order repair works in', () => {
    expect(issuesBySeverity(score).map((issue) => issue.severity)).toEqual([
      'critical',
      'major',
      'minor',
    ]);
  });

  it('keeps categories partial, so a principle that does not apply is absent rather than zero', () => {
    expect(score.categories.sun).toBeUndefined();
    expect(Object.keys(score.categories)).toEqual(['circulation', 'grouping']);
  });
});

describe('the concept wire format grows without breaking', () => {
  const legacy = {
    id: 'c1-0',
    name: 'Terrace and lawn',
    recommended: true,
    summary: 'A terrace across the doors.',
    style: 'Modern / Structured',
    budget: 'medium',
    maintenance: 'medium',
    requestedFeaturesIncluded: [{ feature: 'seating', label: 'Seating', included: true }],
    elements: [],
  };

  it('parses a concept stored before the design agent existed', () => {
    const parsed = GeneratedConceptSchema.parse(legacy);
    expect(parsed.strategy).toBeUndefined();
    expect(parsed.score).toBeUndefined();
    expect(parsed.explanation).toBeUndefined();
    expect(parsed.requestedFeaturesIncluded[0]!.reason).toBeUndefined();
  });

  it('carries a strategy, a score and an explanation when the agent produced them', () => {
    const parsed = GeneratedConceptSchema.parse({
      ...legacy,
      strategy: { briefId: 'A', archetype: 'terrace_and_lawn', candidateId: 'A-0' },
      score: { total: 0.8, categories: { circulation: 0.9 }, issues: [], tier: 'realised' },
      explanation: ConceptExplanationSchema.parse({
        strategy: 'terrace_and_lawn',
        briefId: 'A',
        intent: 'entertaining',
        emphasis: 'social',
        decisions: [
          { kind: 'terrace-at-doors', text: 'Put the terrace across the doors.', subjects: ['e1'] },
        ],
      }),
      requestedFeaturesIncluded: [
        { feature: 'water', label: 'Water', included: false, reason: 'no room beside the lawn' },
      ],
    });

    expect(parsed.strategy?.archetype).toBe('terrace_and_lawn');
    expect(parsed.score?.tier).toBe('realised');
    expect(parsed.explanation?.decisions[0]!.kind).toBe('terrace-at-doors');
    expect(parsed.requestedFeaturesIncluded[0]!.reason).toBe('no room beside the lawn');
  });
});
