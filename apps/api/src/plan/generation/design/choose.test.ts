import {
  polygonArea,
  roundPolygon,
  type DesiredFeature,
  type PlanDocument,
} from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES as BUDGET_POSITIONS } from '../archetypes.js';
import { resolveConstraints } from '../constraints.js';
import { archetypeById } from '../knowledge/archetypes/index.js';
import { buildBriefs } from './brief-builder.js';
import { drawings, enumerateCandidates } from './candidates.js';
import { languageOf } from '../knowledge/archetypes/composed.js';
import { chooseLayouts } from './choose.js';
import { curvedRing, pickDistinct, signatureOf, similarity, type Scored } from './diversity.js';
import { previewLayout, type PreviewRequest } from './layout-generator.js';
import { interpretRequirements, withinCapacity } from './requirements.js';
import { scenario, SCENARIOS } from './scenarios.js';
import { analyseSite } from './site-analysis.js';
import { defaultParams } from '../knowledge/archetypes/types.js';

/**
 * The candidate loop, tested without a database.
 *
 * The loop only pays for itself because a preview issues no query, and these are the tests that
 * keep it that way: every one of them runs the full enumerate-preview-score-choose pipeline over
 * eleven scenarios in milliseconds. A suite that needed PostGIS to ask "did it consider more than
 * one arrangement" could not ask it.
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

/** The context a preview needs, built from the pure analysis alone. */
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

function chooseFor(document: PlanDocument) {
  const { analysis, briefs } = read(document);
  const context = contextOf(document);
  if (!context) return [];
  return chooseLayouts({ analysis, briefs, context });
}

/* ---------------------------------------------------------------- the preview */

describe('a layout preview', () => {
  const document = scenario('family-play').document;

  it('draws a terrace, seats features and routes paths, with no query', () => {
    const { analysis, briefs } = read(document);
    const context = contextOf(document)!;
    const preview = previewLayout({
      ...context,
      archetype: archetypeById('terrace_and_lawn'),
      params: defaultParams('terrace_and_lawn'),
      brief: briefs[0]!,
      analysis,
    });

    expect(preview.terraceRefused).toBe(false);
    expect(preview.placed.length).toBeGreaterThan(1);
    expect(preview.placed.some((item) => item.slotId === 'terrace')).toBe(true);
    expect(preview.lawn).not.toBeNull();
    expect(preview.beds.length).toBeGreaterThan(0);
  });

  it('never mutates the obstacles it was handed', () => {
    const { analysis, briefs } = read(document);
    const context = contextOf(document)!;
    const obstacles = context.obstacles;
    const before = obstacles.length;

    previewLayout({
      ...context,
      archetype: archetypeById('terrace_and_lawn'),
      params: defaultParams('terrace_and_lawn'),
      brief: briefs[0]!,
      analysis,
    });

    // A loop that shared one obstacle list would have each candidate avoiding the last one's work.
    expect(obstacles.length).toBe(before);
  });

  it('never offers the hand-drawn template for a composition that composed on this plot', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const { analysis, briefs } = read(entry.document);
      const field = enumerateCandidates({ analysis, brief: briefs[0]!, context });
      const byArchetype = new Map<string, boolean[]>();
      for (const candidate of field) {
        const id = candidate.fit.archetype.id;
        byArchetype.set(id, [...(byArchetype.get(id) ?? []), !!candidate.preview.sketch.composed]);
      }
      for (const [id, composed] of byArchetype) {
        /* All composed, or none did and the template is the only drawing there is. */
        expect(new Set(composed).size, `${entry.key}/${id}`).toBe(1);
      }
    }
  });

  it('keeps every placed feature inside the room and clear of its neighbours', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const { analysis, briefs } = read(entry.document);

      for (const candidate of enumerateCandidates({ analysis, brief: briefs[0]!, context })) {
        const { placed } = candidate.preview;
        for (const [i, item] of placed.entries()) {
          expect(polygonArea(item.ring), `${entry.key}/${candidate.id}`).toBeGreaterThan(0.5);
          for (const other of placed.slice(i + 1)) {
            const gap = Math.hypot(
              item.geometry.kind === 'rect' ? item.geometry.centre.x : 0,
              item.geometry.kind === 'rect' ? item.geometry.centre.y : 0,
            );
            expect(Number.isFinite(gap)).toBe(true);
            expect(other.id).not.toBe(item.id);
          }
        }
      }
    }
  });

  it('is deterministic', () => {
    const { analysis, briefs } = read(document);
    const context = contextOf(document)!;
    const once = previewLayout({
      ...context,
      archetype: archetypeById('sweeping_lawn'),
      params: defaultParams('sweeping_lawn'),
      brief: briefs[0]!,
      analysis,
    });
    const twice = previewLayout({
      ...context,
      archetype: archetypeById('sweeping_lawn'),
      params: defaultParams('sweeping_lawn'),
      brief: briefs[0]!,
      analysis,
    });
    expect(once.placed).toEqual(twice.placed);
    expect(once.routes).toEqual(twice.routes);
    expect(once.trees).toEqual(twice.trees);
  });
});

/* ---------------------------------------------------------------- enumeration */

describe('enumerating candidates', () => {
  it('produces a field rather than a single answer', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const { analysis, briefs } = read(entry.document);
      const field = enumerateCandidates({ analysis, brief: briefs[0]!, context });

      expect(field.length, entry.key).toBeGreaterThan(1);
    }
  });

  it('stays bounded, so the loop cannot run away', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const { analysis, briefs } = read(entry.document);
      expect(
        enumerateCandidates({ analysis, brief: briefs[0]!, context }).length,
      ).toBeLessThanOrEqual(24);
    }
  });

  it('offers more than one composition wherever the plot allows one', () => {
    const context = contextOf(scenario('family-play').document)!;
    const { analysis, briefs } = read(scenario('family-play').document);
    const field = enumerateCandidates({ analysis, brief: briefs[0]!, context });
    expect(new Set(field.map((candidate) => candidate.fit.archetype.id)).size).toBeGreaterThan(1);
  });

  it('carries the brief it was enumerated for, rather than inferring it back', () => {
    const context = contextOf(scenario('family-play').document)!;
    const { analysis, briefs } = read(scenario('family-play').document);
    const field = enumerateCandidates({ analysis, brief: briefs[1]!, context });
    expect(field.every((candidate) => candidate.brief.id === 'B')).toBe(true);
  });
});

/* ---------------------------------------------------------------- diversity */

describe('the diversity signature', () => {
  it("reads a lawn's curve off its outline, not off its vertex count", () => {
    const ellipse = Array.from({ length: 28 }, (_, i) => {
      const t = (i / 28) * Math.PI * 2;
      return { x: 7 + 4.5 * Math.cos(t), y: 6 + 3.5 * Math.sin(t) };
    });
    /* A rectangle notched round two rooms: ten vertices, which the vertex count called curved. */
    const notched = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 8, y: 6 },
      { x: 8, y: 8 },
      { x: 2, y: 8 },
      { x: 2, y: 6 },
      { x: 0.5, y: 6 },
      { x: 0.5, y: 4 },
      { x: 0, y: 4 },
    ];
    const rounded = roundPolygon(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 8 },
        { x: 0, y: 8 },
      ],
      1.2,
    );
    expect(curvedRing(ellipse)).toBe(true);
    expect(curvedRing(notched)).toBe(false);
    expect(curvedRing(rounded)).toBe(false);
  });

  const context = contextOf(scenario('family-play').document)!;
  const { analysis, briefs } = read(scenario('family-play').document);
  const field = enumerateCandidates({ analysis, brief: briefs[0]!, context });

  it('calls a plan identical to itself', () => {
    const signature = signatureOf(field[0]!.preview);
    expect(similarity(signature, signature)).toBe(1);
  });

  /**
   * The property the whole filter rests on. Two parameter sets that make no difference on a
   * particular plot draw the same garden, and a signature over the *inputs* would call them
   * different — which is how a comparison screen comes to show one plan three times.
   */
  it('is taken from the drawn result, not from the parameters', () => {
    const same = field.filter(
      (candidate) => candidate.fit.archetype.id === field[0]!.fit.archetype.id,
    );
    for (const candidate of same) {
      const identical =
        JSON.stringify(candidate.preview.placed) === JSON.stringify(field[0]!.preview.placed) &&
        JSON.stringify(candidate.preview.lawn) === JSON.stringify(field[0]!.preview.lawn);
      if (!identical) continue;
      // Same drawing, different parameters: the signature must not pretend they differ.
      expect(similarity(signatureOf(candidate.preview), signatureOf(field[0]!.preview))).toBe(1);
    }
  });

  it('tells two compositions apart', () => {
    const byArchetype = new Map(field.map((c) => [c.fit.archetype.id, c] as const));
    const [first, second] = [...byArchetype.values()];
    if (!first || !second) return;
    expect(similarity(signatureOf(first.preview), signatureOf(second.preview))).toBeLessThan(1);
  });

  it('prefers a worse plan that is different over a better one that is not', () => {
    const scored = (total: number, candidate: (typeof field)[number]): Scored => ({
      candidate,
      score: { total, categories: {}, issues: [], tier: 'structural' },
    });

    const best = field[0]!;
    const other = field.find((candidate) => candidate.fit.archetype.id !== best.fit.archetype.id);
    if (!other) return;

    const taken = [signatureOf(best.preview)];
    const picked = pickDistinct([scored(0.9, best), scored(0.8, other)], taken);
    expect(picked?.candidate.fit.archetype.id).toBe(other.fit.archetype.id);
  });
});

/* ---------------------------------------------------------------- choosing */

describe('choosing three layouts', () => {
  it('answers for every slot on every scenario', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      expect(chooseFor(entry.document).length, entry.key).toBe(3);
    }
  });

  it('considers a field rather than taking the first answer', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      for (const choice of chooseFor(entry.document)) {
        expect(choice.considered, entry.key).toBeGreaterThan(1);
      }
    }
  });

  it('gives slot A the outright best, unpenalised by anything already taken', () => {
    const { analysis, briefs } = read(scenario('family-play').document);
    const context = contextOf(scenario('family-play').document)!;
    const chosen = chooseLayouts({ analysis, briefs, context });
    const field = enumerateCandidates({ analysis, brief: briefs[0]!, context });

    // Slot A's composition is one the plot actually ranked, rather than a diversity compromise.
    expect(field.some((candidate) => candidate.id === chosen[0]!.candidate.id)).toBe(true);
  });

  it('offers three different compositions wherever the plot supports three', () => {
    for (const key of ['family-play', 'modern-vs-natural', 'overloaded']) {
      const chosen = chooseFor(scenario(key).document);
      const compositions = new Set(chosen.map((choice) => choice.candidate.fit.archetype.id));
      expect(compositions.size, key).toBe(3);
    }
  });

  it('never offers the same drawing twice', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      const chosen = chooseFor(entry.document);
      const drawings = chosen.map((choice) =>
        JSON.stringify({
          placed: choice.candidate.preview.placed.map((item) => item.geometry),
          lawn: choice.candidate.preview.lawn,
        }),
      );
      expect(new Set(drawings).size, entry.key).toBe(drawings.length);
    }
  });

  it('is deterministic', () => {
    const once = chooseFor(scenario('overloaded').document).map((choice) => choice.candidate.id);
    const twice = chooseFor(scenario('overloaded').document).map((choice) => choice.candidate.id);
    expect(once).toEqual(twice);
  });

  it('keeps every essential feature the brief named', () => {
    for (const entry of SCENARIOS) {
      const context = contextOf(entry.document);
      if (!context) continue;
      for (const choice of chooseFor(entry.document)) {
        const essentials = choice.brief.featurePriorities
          .filter((priority) => priority.tier === 'essential')
          .map((priority) => priority.feature)
          .filter((feature) => !choice.brief.excludedFeatures.some((e) => e.feature === feature));

        const seated = new Set<DesiredFeature>(
          choice.candidate.preview.placed.map((item) => item.feature),
        );
        /* A composed feature is drawn by a pass rather than seated, so it is not expected here. */
        const placedEssentials = essentials.filter(
          (feature) => !['lawn', 'plantingBeds', 'lighting'].includes(feature),
        );
        for (const feature of placedEssentials) {
          expect(
            seated.has(feature) || choice.candidate.preview.unplaced.includes(feature),
            `${entry.key}/${feature}`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('drawing one composition several ways', () => {
  const first = defaultParams('terrace_and_lawn');
  const deeper = { ...first, terraceDepth: 1.15 as const };

  it('tries the composition as designed first, then its other language and an unframed lawn', () => {
    const out = drawings([first, deeper], ['asymmetric_geometric', 'rectilinear'], null);
    expect(out[0]).toEqual({ ...first, language: 'asymmetric_geometric' });
    expect(out[1]).toEqual({ ...first, language: 'rectilinear' });
    expect(out[2]).toEqual({ ...first, language: 'asymmetric_geometric', framed: false });
    expect(out[3]).toEqual({ ...deeper, language: 'asymmetric_geometric' });
    expect(out.at(-1)).toEqual({ ...deeper, language: 'rectilinear' });
  });

  it("puts the brief's language first, where the composition can be drawn in it", () => {
    expect(
      drawings([first], ['rectilinear', 'asymmetric_geometric'], 'asymmetric_geometric')[0]!
        .language,
    ).toBe('asymmetric_geometric');
    expect(drawings([first], ['soft_organic'], 'rectilinear')[0]!.language).toBe('soft_organic');
  });

  it('offers no unframed lawn where the language does not frame one', () => {
    const out = drawings([first], ['soft_organic', 'rectilinear'], null);
    expect(out.some((params) => params.framed === false)).toBe(false);
  });

  it('draws a candidate in the language it names, and only in one the composition speaks', () => {
    expect(languageOf(['rectilinear', 'soft_organic'], { language: 'soft_organic' })).toBe(
      'soft_organic',
    );
    expect(languageOf(['rectilinear'], { language: 'soft_organic' })).toBe('rectilinear');
    expect(languageOf(['soft_organic', 'rectilinear'], {})).toBe('soft_organic');
  });
});
