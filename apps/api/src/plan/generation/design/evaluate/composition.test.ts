import type {
  DesignBrief,
  DesignElement,
  DesignIssueCode,
  GardenBrief,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from '../../archetypes.js';
import { resolveConstraints } from '../../constraints.js';
import { buildBriefs } from '../brief-builder.js';
import { interpretRequirements } from '../requirements.js';
import { analyseSite } from '../site-analysis.js';
import { GALLERY_SITE } from './gallery.js';
import { buildSubject } from './subject.js';
import { scoreComposition } from './composition.js';
import { evaluateDesign } from './index.js';
import { gardenBuilder, panel, rect } from './test-garden.js';

/**
 * The composition principle, a fault at a time.
 *
 * The gallery proves the other half — that none of these fires on a well-composed garden. Every
 * detector here gets the fault and a control that differs from it in as little as possible, which is
 * the only way to know a rule measures what its name says: a rule that fires on nothing passes the
 * gallery just as happily as a good one.
 *
 * On the gallery's plot: 14 m wide, the garden running from the house at y 13 to the back fence at
 * y 0, the doors facing down the page.
 */

const ANALYSIS = analyseSite(GALLERY_SITE);

function briefFor(style: GardenBrief['style'] = 'modern'): DesignBrief {
  const garden = { ...GALLERY_SITE.brief, style };
  const constraints = resolveConstraints(garden, ARCHETYPES[0]!, ANALYSIS.scale.designedArea);
  const requirements = interpretRequirements(garden, ANALYSIS, constraints);
  return buildBriefs(garden, requirements, ANALYSIS)[0]!;
}

function codes(
  elements: DesignElement[],
  features: [string, string][] = [],
  style?: GardenBrief['style'],
): DesignIssueCode[] {
  const subject = buildSubject(
    elements,
    ANALYSIS,
    briefFor(style),
    new Map(features) as Map<string, never>,
  );
  return scoreComposition(subject).issues.map((issue) => issue.code);
}

/** One lawn panel, x 2–12 and y 2.5–10.5, on a base. */
function garden(prefix: string) {
  const build = gardenBuilder(prefix);
  const base = build.fill('lawn', panel(7, 6.5, 14, 13), { fillKind: 'base' });
  const lawn = build.fill('lawn', panel(7, 6.5, 10, 8));
  return { ...build, base, lawn };
}

describe('a feature on the open ground', () => {
  it('is reported when a fire pit stands in the middle of the lawn', () => {
    const { feature, base, lawn } = garden('a');
    const pit = feature('Fire pit', { kind: 'point', at: { x: 7, y: 6.5 }, radius: 1.3 });
    expect(codes([base, lawn, pit], [[pit.id, 'firePit']])).toContain('feature-in-open-space');
  });

  it('is not reported when the fire pit is in the corner beyond the lawn', () => {
    const { feature, base, lawn } = garden('b');
    const pit = feature('Fire pit', { kind: 'point', at: { x: 12.8, y: 1.5 }, radius: 1 });
    expect(codes([base, lawn, pit], [[pit.id, 'firePit']])).not.toContain('feature-in-open-space');
  });

  it('lets a play area stand on the grass, because the relationship rules say it belongs there', () => {
    const { feature, base, lawn } = garden('c');
    const play = feature('Play area', rect(7, 6.5, 4, 3.4), { category: 'gravel-mulch' });
    expect(codes([base, lawn, play], [[play.id, 'play']])).not.toContain('feature-in-open-space');
  });
});

describe('a path across the lawn', () => {
  it('is reported when it cuts the lawn diagonally in two', () => {
    const { path, base, lawn } = garden('d');
    const route = path([
      { x: 3, y: 10 },
      { x: 11, y: 3 },
    ]);
    expect(codes([base, lawn, route])).toContain('route-crosses-panel');
  });

  it('is not reported when it runs down the edge of the lawn', () => {
    const { path, base, lawn } = garden('e');
    const route = path([
      { x: 2.8, y: 10.2 },
      { x: 2.8, y: 3 },
    ]);
    expect(codes([base, lawn, route])).not.toContain('route-crosses-panel');
  });

  it('is not reported when it is the axis from the doors to the far end', () => {
    const axis = ANALYSIS.primaryAxis!;
    const { path, base, lawn } = garden('f');
    const route = path([
      { x: axis.from.x, y: 10.2 },
      { x: axis.from.x, y: 3 },
    ]);
    expect(codes([base, lawn, route])).not.toContain('route-crosses-panel');
  });
});

describe('a built thing floating in the ground', () => {
  it('is reported when a shed stands metres from everything', () => {
    const { feature, fill } = gardenBuilder('g');
    const base = fill('lawn', panel(7, 6.5, 14, 13), { fillKind: 'base' });
    const shed = feature('Garden store', rect(7, 6, 2, 1.5), { category: 'structure' });
    expect(codes([base, shed], [[shed.id, 'storage']])).toContain('hard-island');
  });

  it('is not reported when the shed stands against the fence', () => {
    const { feature, fill } = gardenBuilder('h');
    const base = fill('lawn', panel(7, 6.5, 14, 13), { fillKind: 'base' });
    const shed = feature('Garden store', rect(1.5, 1.4, 2, 1.5), { category: 'structure' });
    expect(codes([base, shed], [[shed.id, 'storage']])).not.toContain('hard-island');
  });
});

describe('an element with no purpose', () => {
  it('is reported on a plan that gave everything else one', () => {
    const { feature, base, lawn } = garden('i');
    const terrace = feature('Seating patio', rect(7, 11.8, 8, 2.4), { purpose: 'terrace' });
    const stray = feature('Gravel circle', { kind: 'point', at: { x: 12.8, y: 1.5 }, radius: 1 });
    expect(codes([base, lawn, terrace, stray])).toContain('orphan-feature');
  });

  it('is not asked about on a plan that never carried purposes', () => {
    const { feature, base, lawn } = garden('j');
    const terrace = feature('Seating patio', rect(7, 11.8, 8, 2.4));
    const stray = feature('Gravel circle', { kind: 'point', at: { x: 12.8, y: 1.5 }, radius: 1 });
    expect(codes([base, lawn, terrace, stray])).not.toContain('orphan-feature');
  });
});

describe('the weight of the plan', () => {
  it('is reported when every built space is down one side', () => {
    const { feature, base } = garden('k');
    const a = feature('Seating patio', rect(2, 11, 3.5, 3));
    const b = feature('Dining terrace', rect(2, 6, 3.5, 3));
    const c = feature('Garden store', rect(1.5, 1.5, 2.5, 2), { category: 'structure' });
    expect(codes([base, a, b, c])).toContain('one-sided');
  });

  it('is not reported when the spaces are spread across the garden', () => {
    const { feature, base } = garden('l');
    const a = feature('Seating patio', rect(7, 11.5, 6, 3));
    const b = feature('Dining terrace', rect(2.5, 3, 3.5, 3));
    const c = feature('Garden store', rect(11.5, 2, 2.5, 2), { category: 'structure' });
    expect(codes([base, a, b, c])).not.toContain('one-sided');
  });
});

describe('the shape of the open ground', () => {
  it('is reported when the lawn is the leftover of everything round it', () => {
    const { fill, base } = garden('m');
    const leftover = fill('lawn', {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 2, y: 2 },
        { x: 5, y: 2 },
        { x: 5, y: 4 },
        { x: 7, y: 4 },
        { x: 7, y: 2 },
        { x: 12, y: 2 },
        { x: 12, y: 6 },
        { x: 10, y: 6 },
        { x: 10, y: 8 },
        { x: 12, y: 8 },
        { x: 12, y: 10 },
        { x: 6, y: 10 },
        { x: 6, y: 8 },
        { x: 2, y: 8 },
      ],
    });
    expect(codes([base, leftover])).toContain('panel-complexity');
  });

  it('is not reported for a panel notched once round a bay', () => {
    const { fill, base } = garden('n');
    const notched = fill('lawn', {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 2, y: 2.5 },
        { x: 9, y: 2.5 },
        { x: 9, y: 5 },
        { x: 12, y: 5 },
        { x: 12, y: 10.5 },
        { x: 2, y: 10.5 },
      ],
    });
    expect(codes([base, notched])).not.toContain('panel-complexity');
  });
});

describe('the geometry language', () => {
  /* A lawn drawn as a 24-point ellipse, the way the curved composition draws one. */
  const ellipse = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * Math.PI * 2;
    return { x: 7 + 4.5 * Math.cos(t), y: 6.5 + 3.5 * Math.sin(t) };
  });

  it('is reported when a curved lawn sits among straight beds and paving of the same weight', () => {
    const { fill, feature, base } = garden('o');
    const lawn = fill('lawn', { kind: 'polygon', cornerRadius: 0, points: ellipse });
    const rear = fill('planting-bed', panel(7, 1, 14, 2));
    const terrace = feature('Seating patio', rect(7, 11.5, 12, 3));
    expect(codes([base, lawn, rear, terrace])).toContain('geometry-mixed');
  });

  it('is not reported when everything is square to the house', () => {
    const { fill, feature, base, lawn } = garden('p');
    const rear = fill('planting-bed', panel(7, 1, 14, 2));
    const terrace = feature('Seating patio', rect(7, 11.5, 12, 3));
    expect(codes([base, lawn, rear, terrace])).not.toContain('geometry-mixed');
  });
});

describe('a path beside a bed', () => {
  function circulationCodes(elements: DesignElement[]): DesignIssueCode[] {
    return evaluateDesign({
      elements,
      analysis: ANALYSIS,
      brief: briefFor(),
      featureOf: new Map(),
      tier: 'realised',
    }).issues.map((issue) => issue.code);
  }

  it('cuts through the planting when its line runs inside the bed', () => {
    const { fill, path } = gardenBuilder('q');
    const bed = fill('planting-bed', panel(7, 6, 10, 2));
    const route = path([
      { x: 7, y: 10 },
      { x: 7, y: 2 },
    ]);
    expect(circulationCodes([bed, route])).toContain('route-through-planting');
  });

  it('needs no path to a feature a metre off the middle of the terrace', () => {
    const { feature } = gardenBuilder('u');
    const terrace = feature('Seating patio', rect(7, 11, 10, 3));
    /* Opposite the middle of the far edge, well over a stride from either corner. */
    const water = feature('Water feature', { kind: 'point', at: { x: 7, y: 8.4 }, radius: 0.6 });
    const featureOf = new Map([
      [terrace.id, 'seating'],
      [water.id, 'water'],
    ]);
    const codesOf = evaluateDesign({
      elements: [terrace, water],
      analysis: ANALYSIS,
      brief: briefFor(),
      featureOf: featureOf as never,
      tier: 'realised',
    }).issues.map((issue) => issue.code);
    expect(codesOf).not.toContain('route-missing');
  });

  it('still wants a path to a feature across the garden from it', () => {
    const { feature } = gardenBuilder('v');
    const terrace = feature('Seating patio', rect(7, 11, 10, 3));
    const water = feature('Water feature', { kind: 'point', at: { x: 7, y: 2 }, radius: 0.6 });
    const featureOf = new Map([
      [terrace.id, 'seating'],
      [water.id, 'water'],
    ]);
    const codesOf = evaluateDesign({
      elements: [terrace, water],
      analysis: ANALYSIS,
      brief: briefFor(),
      featureOf: featureOf as never,
      tier: 'realised',
    }).issues.map((issue) => issue.code);
    expect(codesOf).toContain('route-missing');
  });

  it('is not pinched by the store it arrives at', () => {
    const { fill, path, feature } = gardenBuilder('s');
    const shed = feature('Garden store', rect(7, 1.5, 2.2, 2), { category: 'structure' });
    /* Planting down one side of the path's last metre, the store straight ahead of it. */
    const bed = fill('planting-bed', panel(5.5, 3.5, 1.5, 3));
    const route = path(
      [
        { x: 7, y: 9 },
        { x: 7, y: 2.55 },
      ],
      1.05,
    );
    expect(circulationCodes([shed, bed, route])).not.toContain('route-pinch');
  });

  it('is pinched between a store and a bed it squeezes past on the way', () => {
    const { fill, path, feature } = gardenBuilder('t');
    /* 0.45 m clear to the store on one side, 0.4 m to the bed on the other: 0.85 m in all. */
    const shed = feature('Garden store', rect(8.45, 6, 2, 2), { category: 'structure' });
    const bed = fill('planting-bed', panel(5.9, 6, 1.4, 3));
    /* A corner level with them: the rule samples a route where it turns. */
    const route = path(
      [
        { x: 7, y: 10 },
        { x: 7, y: 6 },
        { x: 7, y: 1 },
      ],
      0.8,
    );
    expect(circulationCodes([shed, bed, route])).toContain('route-pinch');
  });

  it('does not when its edge meets the bed within the tolerance the beds are simplified to', () => {
    const { fill, path } = gardenBuilder('r');
    /* A bed whose edge overlaps the path's strip by 5 cm — what PostGIS's simplify leaves behind. */
    const bed = fill('planting-bed', panel(4.4, 6, 3, 8));
    const route = path([
      { x: 7, y: 10 },
      { x: 7, y: 2 },
    ]);
    expect(circulationCodes([bed, route])).not.toContain('route-through-planting');
  });
});

describe('an enclosed garden, read by what each bed is for', () => {
  function privacyScore(leftPurpose: string): number {
    const { fill, feature } = gardenBuilder(`en-${leftPurpose}`);
    const base = fill('lawn', panel(7, 6.5, 14, 13), { fillKind: 'base' });
    const seat = feature('Seating patio', rect(7, 11, 6, 3), { purpose: 'terrace' });
    /* One bed by the left fence and one by the right: only the purpose of the left one differs. */
    const left = fill('planting-bed', panel(1.5, 11, 3, 3), { purpose: leftPurpose });
    const right = fill('planting-bed', panel(13, 6, 2, 8), { purpose: 'framing-planting' });
    return evaluateDesign({
      elements: [base, seat, left, right],
      analysis: ANALYSIS,
      brief: { ...briefFor(), privacy: 'enclose' },
      featureOf: new Map([[seat.id, 'seating']]),
      tier: 'realised',
    }).categories.privacy!;
  }

  it('does not count the planting by the terrace as enclosing a side', () => {
    expect(privacyScore('threshold-planting')).toBeLessThan(privacyScore('screening-planting'));
  });
});
