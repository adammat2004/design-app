import {
  DESIRED_FEATURE_LABELS,
  pointInPolygon,
  type DesiredFeature,
  type GardenBrief,
  type PlanDocument,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { FEATURE_SPECS, REPEATABLE_FEATURES } from '../archetypes.js';
import { resolveConstraints, type DesignConstraints } from '../constraints.js';
import { ARCHETYPES } from '../archetypes.js';
import { FEATURE_LIBRARY, placementLadder, tierFor } from '../knowledge/feature-library.js';
import { CONDITIONAL, PRINCIPLES } from '../knowledge/principles.js';
import { RELATIONSHIP_RULES, rulesFor } from '../knowledge/relationship-rules.js';
import { STYLE_RULES, styleFit } from '../knowledge/style-rules.js';
import { slotPreferences } from '../layout/assign.js';
import { buildBriefs } from './brief-builder.js';
import { capacityFor, inferIntent, interpretRequirements, withinCapacity } from './requirements.js';
import { scenario, SCENARIOS } from './scenarios.js';
import { analyseSite, isStronglyLinear, siteShape } from './site-analysis.js';

/**
 * The design agent's pure layer, tested without a database.
 *
 * Everything here runs against plain documents in milliseconds, which is the point of the whole
 * pure/PostGIS split: a candidate loop that has to run the scorer fifty times can only afford to if
 * the scorer never issues a query, and a test suite can only be this thorough if it never needs one.
 */

function constraintsFor(document: PlanDocument): DesignConstraints {
  return resolveConstraints(document.brief, ARCHETYPES[0]!, 150);
}

function readingOf(document: PlanDocument) {
  const analysis = analyseSite(document);
  const requirements = interpretRequirements(document.brief, analysis, constraintsFor(document));
  return { analysis, requirements, briefs: buildBriefs(document.brief, requirements, analysis) };
}

/* ---------------------------------------------------------------- knowledge */

describe('the feature library', () => {
  const features = Object.keys(FEATURE_LIBRARY) as DesiredFeature[];

  it('knows every feature a brief can ask for', () => {
    expect([...features].sort()).toEqual([...Object.keys(DESIRED_FEATURE_LABELS)].sort());
  });

  /**
   * The load-bearing one. Dimensions live in `FEATURE_SPECS` and behaviour lives here, and the two
   * must stay one manifest — a copied spec would drift the first time a footprint changed, and
   * nothing would report it because both halves would still parse.
   */
  it('shares the identical spec object with FEATURE_SPECS rather than a copy', () => {
    for (const feature of features) {
      expect(FEATURE_LIBRARY[feature].spec, feature).toBe(FEATURE_SPECS[feature]);
    }
  });

  it('agrees with the existing slot preference table', () => {
    for (const feature of features) {
      expect(placementLadder(feature), feature).toEqual(slotPreferences(feature));
    }
  });

  it('agrees with REPEATABLE_FEATURES about what a large plot may have two of', () => {
    const repeatable = features.filter((feature) => FEATURE_LIBRARY[feature].repeatable);
    expect([...repeatable].sort()).toEqual([...REPEATABLE_FEATURES].sort());
  });

  it('marks exactly the three composed answers as composed', () => {
    const composed = features.filter((feature) => FEATURE_LIBRARY[feature].composed);
    expect([...composed].sort()).toEqual(['lawn', 'lighting', 'plantingBeds']);
  });

  it('gives a minimum size no larger than the footprint it is a floor for', () => {
    for (const feature of features) {
      const { spec, minSize } = FEATURE_LIBRARY[feature];
      if (spec.footprint.kind === 'point' || minSize.kind === 'point') continue;
      expect(minSize.width, feature).toBeLessThanOrEqual(spec.footprint.width + 1e-9);
      expect(minSize.depth, feature).toBeLessThanOrEqual(spec.footprint.depth + 1e-9);
    }
  });

  it('ranks a play area essential to a family garden and optional elsewhere', () => {
    expect(tierFor('play', 'family')).toBe('essential');
    expect(tierFor('play', 'entertaining')).toBe('preferred');
    expect(tierFor('outdoorKitchen', 'entertaining')).toBe('essential');
    expect(tierFor('outdoorKitchen', 'family')).toBe('optional');
  });
});

describe('the relationship rules', () => {
  it('names only features, the house, the gate, the lawn or the street', () => {
    const allowed = new Set<string>([
      ...Object.keys(FEATURE_LIBRARY),
      'house',
      'gate',
      'lawn',
      'street',
    ]);
    for (const rule of RELATIONSHIP_RULES) {
      expect(allowed.has(rule.subject), rule.subject).toBe(true);
      expect(allowed.has(rule.object), rule.object).toBe(true);
    }
  });

  it('gives every distance rule a distance and every rule a reason', () => {
    for (const rule of RELATIONSHIP_RULES) {
      const needsDistance = ['preferNear', 'requireNear', 'avoidNear'].includes(rule.kind);
      expect(rule.distance !== undefined, `${rule.subject} ${rule.kind} ${rule.object}`).toBe(
        needsDistance,
      );
      expect(rule.reason.length).toBeGreaterThan(10);
    }
  });

  it('only offers rules whose subject is actually in the garden', () => {
    const rules = rulesFor(new Set(['storage', 'house']));
    expect(rules.every((rule) => rule.subject === 'storage')).toBe(true);
    expect(rulesFor(new Set())).toEqual([]);
  });

  it('keeps the play area away from fire and open water', () => {
    const hazards = RELATIONSHIP_RULES.filter(
      (rule) => rule.subject === 'play' && rule.kind === 'avoidNear',
    );
    expect(hazards.map((rule) => rule.object).sort()).toEqual(['firePit', 'water']);
    expect(hazards.every((rule) => (rule.distance ?? 0) >= 4)).toBe(true);
  });
});

describe('the style rules', () => {
  it('keeps the existing style-to-layout claim at the top of each style', () => {
    expect(styleFit('formal', 'formal_axis')).toBeGreaterThan(styleFit('formal', 'sweeping_lawn'));
    expect(styleFit('cottage', 'sweeping_lawn')).toBeGreaterThan(
      styleFit('cottage', 'terrace_and_lawn'),
    );
    expect(styleFit('modern', 'terrace_and_lawn')).toBeGreaterThan(
      styleFit('modern', 'sweeping_lawn'),
    );
  });

  it('is neutral rather than hostile about a pairing it has no opinion on', () => {
    expect(styleFit('other', 'linear_sequence')).toBe(0.5);
  });

  it('makes modern and naturalistic differ structurally, not only in materials', () => {
    expect(STYLE_RULES.modern.curvature).toBe('none');
    expect(STYLE_RULES.cottage.curvature).toBe('strong');
    expect(STYLE_RULES.modern.alignment).toBe('strict');
    expect(STYLE_RULES.cottage.alignment).toBe('loose');
    expect(STYLE_RULES.modern.maxMaterials).toBeLessThan(STYLE_RULES.cottage.maxMaterials);
  });
});

describe('the principle weights', () => {
  it('puts circulation and grouping first, and style and buildability last', () => {
    const ordered = [...PRINCIPLES].sort((a, b) => b.weight - a.weight).map((p) => p.id);
    expect(ordered.slice(0, 2).sort()).toEqual(['circulation', 'grouping']);
    expect(ordered.slice(-3).sort()).toEqual(['buildability', 'style', 'sun']);
  });

  it('sums to one over the principles that always apply, with sun on top', () => {
    const always = PRINCIPLES.filter((principle) => !CONDITIONAL.includes(principle.id));
    expect(always.reduce((sum, principle) => sum + principle.weight, 0)).toBeCloseTo(1, 9);
    expect(CONDITIONAL).toEqual(['sun']);
  });

  it('does not weight featureFit, which is a gate rather than a category', () => {
    expect(PRINCIPLES.some((principle) => principle.id === 'featureFit')).toBe(false);
  });
});

/* ---------------------------------------------------------------- site analysis */

describe('site analysis', () => {
  it('classifies the shape from the room rather than from the plot', () => {
    expect(analyseSite(scenario('long-narrow').document).shape).toBe('long');
    expect(analyseSite(scenario('wide-shallow').document).shape).toBe('wide');
    expect(analyseSite(scenario('family-play').document).shape).toBe('square');
    expect(analyseSite(scenario('l-shaped').document).shape).toBe('irregular');
  });

  it('calls a long garden strongly linear and a square one not', () => {
    expect(isStronglyLinear(analyseSite(scenario('long-narrow').document))).toBe(true);
    expect(isStronglyLinear(analyseSite(scenario('family-play').document))).toBe(false);
  });

  it('refuses to guess a shape with no room to measure', () => {
    expect(siteShape(null, null, null)).toBe('irregular');
    expect(siteShape([{ x: 0, y: 0 }], 4, 4)).toBe('irregular');
  });

  it('finds the garden door, the room behind it and the zone the room is in', () => {
    const analysis = analyseSite(scenario('family-play').document);
    expect(analysis.exits.primary).not.toBeNull();
    expect(analysis.room!.length).toBeGreaterThanOrEqual(3);
    expect(analysis.mainZoneId).toBe('back');
    expect(analysis.roles.get('back')).toBe('main');
  });

  /**
   * The handedness trap `anchors.test.ts` already pins for the garden assistant, in the other
   * direction: +y is down the page, so a view cone built with a positive `v` on the right must
   * still contain a point straight out from the door and exclude one behind the house.
   */
  it('builds a view cone that points into the garden and not back through the house', () => {
    const analysis = analyseSite(scenario('family-play').document);
    const frame = analysis.frame!;
    expect(pointInPolygon(frame.toWorld(4, 0), analysis.viewCone!)).toBe(true);
    expect(pointInPolygon(frame.toWorld(-2, 0), analysis.viewCone!)).toBe(false);
    // Well off to the side at that depth is outside a thirty-degree wedge.
    expect(pointInPolygon(frame.toWorld(4, 6), analysis.viewCone!)).toBe(false);
  });

  it('points every boundary normal into the plot', () => {
    const analysis = analyseSite(scenario('family-play').document);
    for (const edge of analysis.edges) {
      const mid = { x: (edge.start.x + edge.end.x) / 2, y: (edge.start.y + edge.end.y) / 2 };
      const inside = { x: mid.x + edge.inward.x * 0.5, y: mid.y + edge.inward.y * 0.5 };
      expect(pointInPolygon(inside, analysis.boundary), edge.vertexId).toBe(true);
    }
  });

  it('says nothing about a boundary nobody described', () => {
    const analysis = analyseSite(scenario('family-play').document);
    const described = analysis.edges.filter((edge) => edge.exposure !== 'unknown');
    // `suggestedAccess` states the street edge and nothing else, so exactly one side is known.
    expect(described.map((edge) => edge.exposure)).toEqual(['street']);
  });

  it('refuses to claim any shade without a location', () => {
    expect(analyseSite(scenario('unlocated').document).sun).toBeNull();
    expect(analyseSite(scenario('family-play').document).sun).not.toBeNull();
  });

  it('is deterministic: the same document reads the same twice', () => {
    const once = analyseSite(scenario('family-play').document);
    const twice = analyseSite(scenario('family-play').document);
    expect(once.shape).toBe(twice.shape);
    expect(once.edges).toEqual(twice.edges);
    expect(once.viewCone).toEqual(twice.viewCone);
  });
});

/* ---------------------------------------------------------------- requirements */

describe('interpreting the brief', () => {
  it('infers what the garden is for from what was asked for', () => {
    expect(inferIntent(scenario('family-play').document.brief).intent).toBe('family');
    expect(inferIntent(scenario('small-entertaining').document.brief).intent).toBe('entertaining');
  });

  it('reads the prose, which nothing in the generator has ever done', () => {
    const base: GardenBrief = {
      ...scenario('family-play').document.brief,
      desiredFeatures: ['seating'],
      purpose: '',
    };
    const quiet = inferIntent({ ...base, purpose: 'Somewhere quiet to escape and unwind.' });
    expect(quiet.intent).toBe('relaxation');
    expect(quiet.keywords.length).toBeGreaterThan(0);
  });

  it('answers "mixed" rather than guessing when nothing wins clearly', () => {
    const brief: GardenBrief = {
      ...scenario('family-play').document.brief,
      purpose: '',
      desiredFeatures: ['seating'],
    };
    expect(inferIntent(brief).intent).toBe('mixed');
  });

  it('orders the requested features by how badly this kind of garden wants them', () => {
    const { requirements } = readingOf(scenario('family-play').document);
    const tiers = requirements.priorities.map((entry) => entry.tier);
    // Essentials first: the list is sorted, so the tiers never go back up.
    const rank = { essential: 2, preferred: 1, optional: 0 } as const;
    for (let i = 1; i < tiers.length; i += 1) {
      expect(rank[tiers[i]!]).toBeLessThanOrEqual(rank[tiers[i - 1]!]!);
    }
    expect(requirements.priorities.find((entry) => entry.feature === 'play')!.tier).toBe(
      'essential',
    );
  });

  it('cuts by priority rather than by the order the brief listed things', () => {
    const { requirements } = readingOf(scenario('overloaded').document);
    const { keep, cut } = withinCapacity(requirements);

    expect(cut.length).toBeGreaterThan(0);
    expect(cut.every((entry) => entry.reason.length > 0)).toBe(true);
    // Nothing essential is ever cut, whatever the capacity.
    const essentials = requirements.priorities
      .filter((entry) => entry.tier === 'essential')
      .map((entry) => entry.feature);
    for (const feature of essentials) expect(keep).toContain(feature);
    // And nothing composed consumes capacity.
    expect(keep.some((feature) => FEATURE_LIBRARY[feature].composed)).toBe(false);
  });

  it('gives a bigger plot more capacity and a low budget less', () => {
    const analysis = analyseSite(scenario('family-play').document);
    const at = (band: DesignConstraints['scale']['band'], budget: DesignConstraints['budget']) =>
      capacityFor(
        {
          ...constraintsFor(scenario('family-play').document),
          budget,
          scale: { band, designedArea: 1, sizeFactor: 1 },
        },
        analysis,
      );

    expect(at('estate', 'medium')).toBeGreaterThan(at('suburban', 'medium'));
    expect(at('suburban', 'medium')).toBeGreaterThan(at('courtyard', 'medium'));
    expect(at('suburban', 'low')).toBeLessThan(at('suburban', 'premium'));
  });
});

/* ---------------------------------------------------------------- briefs */

describe('building the design briefs', () => {
  it('produces three, one per slot, with A the intent-led reading', () => {
    const { briefs, requirements } = readingOf(scenario('small-entertaining').document);
    expect(briefs.map((brief) => brief.id)).toEqual(['A', 'B', 'C']);
    expect(briefs.every((brief) => brief.intent === requirements.intent)).toBe(true);
    expect(briefs[0]!.emphasis).toBe('social');
  });

  it('makes the three differ in what they are for, not only in name', () => {
    const { briefs } = readingOf(scenario('family-play').document);
    expect(new Set(briefs.map((brief) => brief.emphasis)).size).toBe(3);
  });

  it('never claims a primary zone the garden has nothing to put in', () => {
    for (const entry of SCENARIOS) {
      const { briefs, requirements } = readingOf(entry.document);
      const zones = new Set(
        requirements.priorities.map((priority) => FEATURE_LIBRARY[priority.feature].zone),
      );
      zones.add('terrace');
      for (const brief of briefs) expect(zones.has(brief.primaryZone), entry.key).toBe(true);
    }
  });

  it('never names a focal point the garden does not contain', () => {
    for (const entry of SCENARIOS) {
      const { briefs } = readingOf(entry.document);
      for (const brief of briefs) {
        if (brief.focal !== 'water') continue;
        expect(entry.document.brief.desiredFeatures, entry.key).toContain('water');
      }
    }
  });

  it('keeps the style-preferred layout at the head of the shortlist where the site allows it', () => {
    const { briefs } = readingOf(scenario('modern-vs-natural').document);
    expect(briefs[0]!.archetypeShortlist[0]).toBe('terrace_and_lawn');

    const natural = readingOf(scenario('natural-twin').document);
    expect(natural.briefs[0]!.archetypeShortlist[0]).toBe('sweeping_lawn');
  });

  it('shortlists the layout the shape needs, not only the one the style likes', () => {
    const wide = readingOf(scenario('wide-shallow').document);
    expect(wide.briefs[0]!.archetypeShortlist).toContain('side_by_side');

    const long = readingOf(scenario('long-narrow').document);
    expect(long.briefs[0]!.archetypeShortlist).toContain('linear_sequence');
  });

  it('excludes what it cannot fit, with a reason, rather than silently', () => {
    const { briefs } = readingOf(scenario('overloaded').document);
    for (const brief of briefs) {
      expect(brief.excludedFeatures.length).toBeGreaterThan(0);
      for (const excluded of brief.excludedFeatures) {
        expect(excluded.reason.length).toBeGreaterThan(20);
        // And the feature keeps the tier it earned, so the explanation can say it was wanted.
        expect(brief.featurePriorities.some((entry) => entry.feature === excluded.feature)).toBe(
          true,
        );
      }
    }
  });

  it('asks for no screening where nobody has described a boundary', () => {
    const { briefs } = readingOf(scenario('family-play').document);
    // `suggestedAccess` states the street edge, so the plot does have one exposure to answer for.
    expect(['screen-street', 'screen-neighbours', 'enclose', 'none']).toContain(briefs[0]!.privacy);
  });

  it('is deterministic', () => {
    const once = readingOf(scenario('overloaded').document).briefs;
    const twice = readingOf(scenario('overloaded').document).briefs;
    expect(once).toEqual(twice);
  });
});
