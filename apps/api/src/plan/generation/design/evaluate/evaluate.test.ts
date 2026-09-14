import {
  rectToPolygon,
  type DesignBrief,
  type DesignElement,
  type DesignIssueCode,
  type DesiredFeature,
  type PlanGeometry,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../archetypes.js';
import { resolveConstraints } from '../../constraints.js';
import { buildBriefs } from '../brief-builder.js';
import { interpretRequirements } from '../requirements.js';
import { scenario } from '../scenarios.js';
import { analyseSite } from '../site-analysis.js';
import { evaluateDesign } from './index.js';

/**
 * The scorer, tested by building the fault and checking it is reported.
 *
 * Every rule gets a pair: a plan that satisfies it and a plan that breaks it, differing in as
 * little as possible. That is the only way to be sure a principle is measuring what its name says —
 * a rule that fires on everything and a rule that fires on nothing both look like a passing test
 * when you only ever feed them one garden.
 *
 * The gardens here are built by hand rather than generated, deliberately. A test whose fixture came
 * out of the generator can only ever confirm what the generator already does, which is the same
 * argument `composition-rules.ts` makes about deriving its bands from a traced plan instead.
 */

/* The family-play scenario: a 14 × 20 m plot, house across the back, doors facing -y. */
const SITE = scenario('family-play').document;
const ANALYSIS = analyseSite(SITE);

function briefFor(over: Partial<DesignBrief> = {}): DesignBrief {
  const constraints = resolveConstraints(SITE.brief, ARCHETYPES[0]!, 150);
  const requirements = interpretRequirements(SITE.brief, ANALYSIS, constraints);
  return { ...buildBriefs(SITE.brief, requirements, ANALYSIS)[0]!, ...over };
}

let counter = 0;
function id(): string {
  counter += 1;
  return `e${counter}`;
}

/** A rectangle in world metres, axis-aligned unless told otherwise. */
function rect(
  x: number,
  y: number,
  width: number,
  depth: number,
  rotation = 0,
): Extract<PlanGeometry, { kind: 'rect' }> {
  return { kind: 'rect', centre: { x, y }, width, depth, rotation };
}

function feature(
  name: string,
  shape: PlanGeometry,
  over: Partial<DesignElement> = {},
): DesignElement {
  return {
    id: id(),
    category: 'paved-area',
    role: 'feature',
    name,
    shape,
    zone: 'back',
    material: 'stone-pavers',
    ...over,
  };
}

function fill(
  category: DesignElement['category'],
  shape: PlanGeometry,
  over: Partial<DesignElement> = {},
): DesignElement {
  return {
    id: id(),
    category,
    role: 'fill',
    fillKind: 'accent',
    shape,
    zone: 'back',
    material: category === 'lawn' ? 'standard-turf' : 'mixed-border',
    ...over,
  };
}

function path(points: { x: number; y: number }[], width = 1.2): DesignElement {
  return feature(
    'Service path',
    { kind: 'polyline', points, width },
    {
      category: 'paved-area',
      material: 'stone-setts',
    },
  );
}

function score(
  elements: DesignElement[],
  featureOf: [string, DesiredFeature][] = [],
  brief = briefFor(),
) {
  return evaluateDesign({
    elements,
    analysis: ANALYSIS,
    brief,
    featureOf: new Map(featureOf),
    tier: 'realised',
  });
}

function codes(result: ReturnType<typeof score>): DesignIssueCode[] {
  return result.issues.map((issue) => issue.code);
}

/* ---------------------------------------------------------------- shape of the answer */

describe('a score', () => {
  it('reports categories, issues and a total between nought and one', () => {
    const terrace = feature('Seating patio', rect(7, 13, 6, 3.5));
    const result = score([terrace], [[terrace.id, 'seating']]);

    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.total).toBeLessThanOrEqual(1);
    expect(Object.keys(result.categories).length).toBeGreaterThan(3);
    expect(result.tier).toBe('realised');
  });

  it('leaves out a principle that cannot be measured rather than scoring it zero', () => {
    const unlocated = analyseSite(scenario('unlocated').document);
    const terrace = feature('Seating patio', rect(6, 12, 6, 3.5));

    const result = evaluateDesign({
      elements: [terrace],
      analysis: unlocated,
      brief: briefFor(),
      featureOf: new Map([[terrace.id, 'seating' as DesiredFeature]]),
      tier: 'realised',
    });

    expect(result.categories.sun).toBeUndefined();
    // And the rest still scored: the plan is judged on eight things, not marked down for a ninth.
    expect(Object.keys(result.categories).length).toBeGreaterThan(3);
  });

  it('is deterministic', () => {
    const terrace = feature('Seating patio', rect(7, 13, 6, 3.5));
    const elements = [terrace];
    const featureOf: [string, DesiredFeature][] = [[terrace.id, 'seating']];
    expect(score(elements, featureOf)).toEqual(score(elements, featureOf));
  });
});

/* ---------------------------------------------------------------- the gate */

describe('the essential-feature gate', () => {
  it('caps a concept that could not place something the brief calls essential', () => {
    const brief = briefFor({
      featurePriorities: [{ feature: 'play', tier: 'essential', reason: 'children' }],
      excludedFeatures: [],
    });

    const without = score([feature('Seating patio', rect(7, 13, 6, 3.5))], [], brief);
    expect(without.total).toBeLessThanOrEqual(0.5);
    expect(codes(without)).toContain('missing-essential');
  });

  it('does not penalise a concept for honouring its own exclusion', () => {
    const brief = briefFor({
      featurePriorities: [{ feature: 'water', tier: 'preferred', reason: 'nice to have' }],
      excludedFeatures: [{ feature: 'water', reason: 'no room without losing the lawn' }],
    });

    const result = score([feature('Seating patio', rect(7, 13, 6, 3.5))], [], brief);
    expect(codes(result)).not.toContain('missing-essential');
  });

  it('reports a garden whose features cover nearly all of it', () => {
    const crammed = [
      feature('Seating patio', rect(7, 12.8, 13, 4.4)),
      feature('Dining terrace', rect(7, 7.8, 13, 5.4)),
      feature('Garden room', rect(7, 2.6, 13, 5), { category: 'structure' }),
    ];
    const result = score(
      crammed,
      crammed.map((element, index) => [
        element.id,
        (['seating', 'dining', 'gardenRoom'] as DesiredFeature[])[index]!,
      ]),
    );

    expect(codes(result)).toContain('feature-density');
  });
});

/* ---------------------------------------------------------------- circulation */

describe('circulation', () => {
  const terrace = () => feature('Seating patio', rect(7, 13, 6, 3.5));

  it('marks a feature nothing connects to', () => {
    const patio = terrace();
    const shed = feature('Garden store', rect(12, 2, 2.5, 2), { category: 'structure' });
    const result = score(
      [patio, shed],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).toContain('route-missing');
  });

  it('accepts the same plan once a path reaches it', () => {
    const patio = terrace();
    const shed = feature('Garden store', rect(12, 2, 2.5, 2), { category: 'structure' });
    const route = path([
      { x: 9, y: 11.5 },
      { x: 12, y: 3.2 },
    ]);
    const result = score(
      [patio, shed, route],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).not.toContain('route-missing');
  });

  it('reports a path that wanders instead of arriving', () => {
    const patio = terrace();
    const shed = feature('Garden store', rect(12, 2, 2.5, 2), { category: 'structure' });
    const detour = path([
      { x: 9, y: 11.5 },
      { x: 1, y: 11 },
      { x: 1, y: 2 },
      { x: 12, y: 3.2 },
    ]);
    const result = score(
      [patio, shed, detour],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).toContain('route-detour');
  });

  it('reports a path driven through a building', () => {
    const patio = terrace();
    const shed = feature('Garden store', rect(7, 6, 3, 3), { category: 'structure' });
    const through = path([
      { x: 7, y: 11.5 },
      { x: 7, y: 2 },
    ]);
    const result = score(
      [patio, shed, through],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).toContain('route-through-feature');
  });

  it('reports a route too narrow to wheel anything down', () => {
    const patio = terrace();
    const shed = feature('Garden store', rect(12, 2, 2.5, 2), { category: 'structure' });
    const thin = path(
      [
        { x: 9, y: 11.5 },
        { x: 12, y: 3.2 },
      ],
      0.5,
    );
    const result = score(
      [patio, shed, thin],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).toContain('route-too-narrow');
  });
});

/* ---------------------------------------------------------------- relationships */

describe('feature relationships', () => {
  it('reports a store standing in the view from the doors', () => {
    const patio = feature('Seating patio', rect(7, 13, 6, 3.5));
    const shed = feature('Garden store', rect(7, 6, 2.5, 2), { category: 'structure' });
    const result = score(
      [patio, shed],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).toContain('shed-in-view');
  });

  it('accepts the same store once it is off in a corner', () => {
    const patio = feature('Seating patio', rect(7, 13, 6, 3.5));
    const shed = feature('Garden store', rect(12.5, 2, 2.5, 2), { category: 'structure' });
    const result = score(
      [patio, shed],
      [
        [patio.id, 'seating'],
        [shed.id, 'storage'],
      ],
    );

    expect(codes(result)).not.toContain('shed-in-view');
  });

  it('reports a play area nobody can see from the house', () => {
    const patio = feature('Seating patio', rect(7, 13, 6, 3.5));
    const play = feature('Play area', rect(13, 2, 3, 3), {
      category: 'gravel-mulch',
      material: 'play-bark',
    });
    const result = score(
      [patio, play],
      [
        [patio.id, 'seating'],
        [play.id, 'play'],
      ],
    );

    expect(codes(result)).toContain('play-not-visible');
  });

  it('reports a play area beside the fire pit', () => {
    const play = feature('Play area', rect(7, 6, 3, 3), {
      category: 'gravel-mulch',
      material: 'play-bark',
    });
    const fire = feature(
      'Fire pit',
      { kind: 'point', at: { x: 8.5, y: 6 }, radius: 1.5 },
      {
        category: 'gravel-mulch',
        material: 'decorative-gravel',
      },
    );
    const result = score(
      [play, fire],
      [
        [play.id, 'play'],
        [fire.id, 'firePit'],
      ],
    );

    expect(codes(result)).toContain('play-near-hazard');
  });

  it('reports a barbecue marooned away from the table', () => {
    const dining = feature('Dining terrace', rect(4, 13, 4, 3));
    const bbq = feature('Outdoor kitchen', rect(12, 3, 3, 1.4), { category: 'structure' });
    const result = score(
      [dining, bbq],
      [
        [dining.id, 'dining'],
        [bbq.id, 'outdoorKitchen'],
      ],
    );

    expect(codes(result)).toContain('bbq-far-from-dining');
  });

  it('accepts a barbecue at the end of the dining terrace', () => {
    const dining = feature('Dining terrace', rect(6, 13, 4, 3));
    const bbq = feature('Outdoor kitchen', rect(9, 13, 3, 1.4), { category: 'structure' });
    const result = score(
      [dining, bbq],
      [
        [dining.id, 'dining'],
        [bbq.id, 'outdoorKitchen'],
      ],
    );

    expect(codes(result)).not.toContain('bbq-far-from-dining');
  });
});

/* ---------------------------------------------------------------- grouping */

describe('grouping', () => {
  it('reports a dining zone split across the garden', () => {
    const dining = feature('Dining terrace', rect(3, 13, 4, 3));
    const pergola = feature('Dining pergola', rect(13, 2, 3.6, 3.6), { category: 'structure' });
    const result = score(
      [dining, pergola],
      [
        [dining.id, 'dining'],
        [pergola.id, 'pergola'],
      ],
    );

    expect(codes(result)).toContain('zone-fragmented');
  });

  it('accepts the pergola at the end of the terrace it belongs to', () => {
    const dining = feature('Dining terrace', rect(6, 13, 4, 3));
    const pergola = feature('Dining pergola', rect(10, 12.5, 3.6, 3.6), { category: 'structure' });
    const result = score(
      [dining, pergola],
      [
        [dining.id, 'dining'],
        [pergola.id, 'pergola'],
      ],
    );

    expect(codes(result)).not.toContain('zone-fragmented');
    expect(result.categories.grouping).toBeGreaterThan(0.8);
  });
});

/* ---------------------------------------------------------------- proportion */

describe('proportion', () => {
  it('reports a lawn cut into pieces', () => {
    const base = fill(
      'lawn',
      { kind: 'polygon', points: rectToPolygon(rect(7, 7, 13, 13)), cornerRadius: 0 },
      {
        fillKind: 'base',
      },
    );
    const pieces = [
      fill('lawn', { kind: 'polygon', points: rectToPolygon(rect(4, 7, 4, 8)), cornerRadius: 0 }),
      fill('lawn', { kind: 'polygon', points: rectToPolygon(rect(10, 7, 4, 8)), cornerRadius: 0 }),
    ];
    const terrace = feature('Seating patio', rect(7, 13, 6, 3.5));
    const result = score([base, ...pieces, terrace], [[terrace.id, 'seating']]);

    expect(codes(result)).toContain('lawn-fragmented');
  });

  it('accepts one continuous lawn panel', () => {
    const base = fill(
      'lawn',
      { kind: 'polygon', points: rectToPolygon(rect(7, 7, 13, 13)), cornerRadius: 0 },
      {
        fillKind: 'base',
      },
    );
    const lawn = fill('lawn', {
      kind: 'polygon',
      points: rectToPolygon(rect(7, 7, 10, 8)),
      cornerRadius: 0,
    });
    const terrace = feature('Seating patio', rect(7, 13, 6, 3.5));
    const result = score([base, lawn, terrace], [[terrace.id, 'seating']]);

    expect(codes(result)).not.toContain('lawn-fragmented');
  });

  it('reports a lawn that is a strip rather than a panel', () => {
    const base = fill(
      'lawn',
      { kind: 'polygon', points: rectToPolygon(rect(7, 7, 13, 13)), cornerRadius: 0 },
      {
        fillKind: 'base',
      },
    );
    const sliver = fill('lawn', {
      kind: 'polygon',
      points: rectToPolygon(rect(7, 7, 9, 1.6)),
      cornerRadius: 0,
    });
    const terrace = feature('Seating patio', rect(7, 13, 6, 3.5));
    const result = score([base, sliver, terrace], [[terrace.id, 'seating']]);

    expect(codes(result)).toContain('lawn-sliver');
  });

  it('reports a plan with no terrace at the doors at all', () => {
    const lawn = fill('lawn', {
      kind: 'polygon',
      points: rectToPolygon(rect(7, 7, 10, 8)),
      cornerRadius: 0,
    });
    const result = score([lawn]);

    expect(codes(result)).toContain('terrace-too-shallow');
    expect(result.issues.find((issue) => issue.code === 'terrace-too-shallow')!.severity).toBe(
      'critical',
    );
  });
});

/* ---------------------------------------------------------------- hierarchy */

describe('hierarchy', () => {
  it('reports a building planted right outside the doors', () => {
    const patio = feature('Seating patio', rect(7, 13, 6, 3.5));
    const room = feature('Garden room', rect(7, 11, 4, 3), { category: 'structure' });
    const result = score(
      [patio, room],
      [
        [patio.id, 'seating'],
        [room.id, 'gardenRoom'],
      ],
    );

    expect(codes(result)).toContain('view-blocked');
  });

  it('accepts the same building at the far end', () => {
    const patio = feature('Seating patio', rect(7, 13, 6, 3.5));
    const room = feature('Garden room', rect(4, 2.5, 4, 3), { category: 'structure' });
    const result = score(
      [patio, room],
      [
        [patio.id, 'seating'],
        [room.id, 'gardenRoom'],
      ],
    );

    expect(codes(result)).not.toContain('view-blocked');
  });
});

/* ---------------------------------------------------------------- style */

describe('style', () => {
  it('reports features off the line of the house on a modern plan', () => {
    const straight = feature('Seating patio', rect(7, 13, 6, 3.5));
    const skew = feature('Dining terrace', rect(5, 7, 4, 3, 23));
    const result = score(
      [straight, skew],
      [
        [straight.id, 'seating'],
        [skew.id, 'dining'],
      ],
    );

    expect(codes(result)).toContain('misaligned');
  });

  it('does not mind the same angle on a naturalistic plan', () => {
    const natural = analyseSite(scenario('natural-twin').document);
    const skew = feature('Dining terrace', rect(5, 7, 4, 3, 23));

    const result = evaluateDesign({
      elements: [feature('Seating patio', rect(7, 13, 6, 3.5)), skew],
      analysis: natural,
      brief: { ...briefFor(), style: 'cottage' },
      featureOf: new Map([[skew.id, 'dining' as DesiredFeature]]),
      tier: 'realised',
    });

    expect(codes(result)).not.toContain('misaligned');
  });

  it('reports a plan made of too many different materials for its style', () => {
    const many = [
      feature('Seating patio', rect(7, 13, 6, 3.5), { material: 'porcelain' }),
      feature('Dining terrace', rect(3, 10, 3, 3), { material: 'stone-pavers' }),
      feature('Garden store', rect(12, 3, 2.5, 2), { category: 'structure', material: 'softwood' }),
      fill(
        'gravel-mulch',
        { kind: 'polygon', points: rectToPolygon(rect(5, 5, 3, 3)), cornerRadius: 0 },
        {
          material: 'slate-chippings',
        },
      ),
      fill('lawn', { kind: 'polygon', points: rectToPolygon(rect(9, 7, 4, 4)), cornerRadius: 0 }),
    ];
    const result = score(many);

    expect(codes(result)).toContain('too-many-materials');
  });
});

/* ---------------------------------------------------------------- buildability */

describe('buildability', () => {
  it('reports a bed too narrow to plant', () => {
    const thin = fill('planting-bed', {
      kind: 'polygon',
      points: rectToPolygon(rect(7, 5, 8, 0.5)),
      cornerRadius: 0,
    });
    expect(codes(score([thin]))).toContain('bed-too-narrow');
  });

  it('reports a raised terrace with no way down off it', () => {
    const raised = feature('Seating patio', rect(7, 13, 6, 3.5), { elevation: 0.34 });
    expect(codes(score([raised], [[raised.id, 'seating']]))).toContain('steps-missing');
  });

  it('accepts the same terrace once it has a flight', () => {
    const raised = feature('Seating patio', rect(7, 13, 6, 3.5), { elevation: 0.34 });
    const steps = feature('Steps', rect(7, 11, 1.6, 0.7), { symbol: 'steps', elevation: 0.34 });
    expect(codes(score([raised, steps], [[raised.id, 'seating']]))).not.toContain('steps-missing');
  });
});

/* ---------------------------------------------------------------- sun */

describe('sun', () => {
  it('says nothing about shade on a plan with no location', () => {
    const unlocated = analyseSite(scenario('unlocated').document);
    const terrace = feature('Seating patio', rect(6, 12, 6, 3.5));

    const result = evaluateDesign({
      elements: [terrace],
      analysis: unlocated,
      brief: briefFor(),
      featureOf: new Map([[terrace.id, 'seating' as DesiredFeature]]),
      tier: 'realised',
    });

    expect(codes(result)).not.toContain('seating-in-shade');
    expect(result.categories.sun).toBeUndefined();
  });

  it('scores the sun on a located plan', () => {
    const terrace = feature('Seating patio', rect(7, 13, 6, 3.5));
    const result = score([terrace], [[terrace.id, 'seating']]);
    expect(result.categories.sun).toBeDefined();
  });
});

/* ---------------------------------------------------------------- the whole thing */

describe('a well-composed garden outscores a badly composed one', () => {
  /*
   * The test the rest of them exist to make trustworthy. Both plans contain the identical five
   * things on the identical plot; only where they stand differs. If the scorer cannot tell these
   * apart, nothing else it says is worth reading.
   */
  function garden(good: boolean): {
    elements: DesignElement[];
    featureOf: [string, DesiredFeature][];
  } {
    const base = fill(
      'lawn',
      { kind: 'polygon', points: rectToPolygon(rect(7, 7.5, 13, 14)), cornerRadius: 0 },
      {
        fillKind: 'base',
      },
    );

    const terrace = feature('Seating patio', rect(7, 13, 7, 3.6));
    const play = good
      ? feature('Play area', rect(6, 5, 3.6, 3.4), {
          category: 'gravel-mulch',
          material: 'play-bark',
        })
      : feature('Play area', rect(13, 1.5, 3.6, 3.4), {
          category: 'gravel-mulch',
          material: 'play-bark',
        });
    const shed = good
      ? feature('Garden store', rect(12.4, 2, 2.4, 2), {
          category: 'structure',
          material: 'softwood',
        })
      : feature('Garden store', rect(7, 8.5, 2.4, 2), {
          category: 'structure',
          material: 'softwood',
        });
    const lawn = good
      ? fill('lawn', {
          kind: 'polygon',
          points: rectToPolygon(rect(6, 9, 9, 4.4)),
          cornerRadius: 0,
        })
      : fill('lawn', {
          kind: 'polygon',
          points: rectToPolygon(rect(3, 9, 3.2, 4.4)),
          cornerRadius: 0,
        });
    const bed = fill('planting-bed', {
      kind: 'polygon',
      points: rectToPolygon(rect(7, 0.9, 12, 1.6)),
      cornerRadius: 0,
    });
    const route = good
      ? path([
          { x: 9.5, y: 11.2 },
          { x: 12.4, y: 3.2 },
        ])
      : path([
          { x: 9.5, y: 11.2 },
          { x: 1, y: 10 },
          { x: 1, y: 1 },
          { x: 13, y: 1.5 },
        ]);

    return {
      elements: [base, lawn, bed, terrace, play, shed, route],
      featureOf: [
        [terrace.id, 'seating'],
        [play.id, 'play'],
        [shed.id, 'storage'],
      ],
    };
  }

  it('prefers the plan a designer would draw', () => {
    const well = garden(true);
    const badly = garden(false);

    const better = score(well.elements, well.featureOf);
    const worse = score(badly.elements, badly.featureOf);

    expect(better.total).toBeGreaterThan(worse.total);
    expect(better.issues.length).toBeLessThan(worse.issues.length);
  });

  it('and says why, in sentences with measurements in them', () => {
    const badly = garden(false);
    const worse = score(badly.elements, badly.featureOf);

    expect(worse.issues.length).toBeGreaterThan(0);
    for (const issue of worse.issues) {
      expect(issue.message.length).toBeGreaterThan(15);
      expect(issue.message.endsWith('.')).toBe(true);
    }
    // The two faults that were built in on purpose.
    expect(codes(worse)).toContain('shed-in-view');
    expect(codes(worse)).toContain('play-not-visible');
  });
});
