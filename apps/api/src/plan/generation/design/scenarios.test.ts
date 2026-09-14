import { polygonArea, type DesiredFeature, type PlanDocument } from '@garden-studio/schema';
import { describe, expect, it } from 'vitest';
import { ARCHETYPES as BUDGET_POSITIONS } from '../archetypes.js';
import { resolveConstraints } from '../constraints.js';
import { ARCHETYPES } from '../knowledge/archetypes/index.js';
import { FEATURE_LIBRARY } from '../knowledge/feature-library.js';
import { archetypesForSlots, rankArchetypes, refusals } from './archetype-selector.js';
import { buildBriefs } from './brief-builder.js';
import { interpretRequirements, withinCapacity } from './requirements.js';
import { scenario, SCENARIOS } from './scenarios.js';
import { analyseSite } from './site-analysis.js';
import { planZones } from './zone-planner.js';
import type { ZonePlan } from './types.js';

/**
 * The scenarios, answered on the **zone plan alone** — no database, no geometry engine.
 *
 * This is what the pure layer buys. Every question here is one a person would ask of a drawing —
 * is the shed where the bins can reach it, does a long garden get broken into rooms, is the play
 * area in view — and answering them takes milliseconds because nothing below this point has run.
 * A suite that had to generate three whole concepts against PostGIS to ask "which composition did
 * it pick" could not afford to ask it eleven times.
 *
 * Each scenario carries its own expectation as a sentence (`scenarios.ts`); these are those
 * sentences, made checkable.
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
  const slots = archetypesForSlots(analysis, briefs);

  return { analysis, constraints, requirements, briefs, slots };
}

/** The zone plan slot A would compose, at the composition's own first choice of parameters. */
function zonePlanOf(document: PlanDocument): ZonePlan {
  const { analysis, constraints, requirements, briefs, slots } = read(document);
  const archetype = slots[0]!.fit.archetype;
  const params = archetype.params(analysis, briefs[0]!)[0]!;
  const box = analysis.box!;

  return planZones({
    brief: briefs[0]!,
    site: analysis,
    archetype,
    params,
    room: {
      uMin: Math.max(0, box.uMin),
      uMax: box.uMax,
      vMin: box.vMin,
      vMax: box.vMax,
      polygon: box.polygon,
    },
    request: {
      features: document.brief.desiredFeatures,
      scale: constraints.scale.sizeFactor,
      style: constraints.style,
      lawnAllowed: !constraints.forbiddenFill.includes('lawn'),
      gateSide: analysis.gateSide,
      houseWallLength: analysis.frame!.wallLength,
      doorWidth: analysis.frame!.doorWidth,
    },
    placing: withinCapacity(requirements).keep,
  });
}

/* ---------------------------------------------------------------- the archetype library */

describe('the archetype library', () => {
  it('names every composition the vocabulary has', () => {
    expect(ARCHETYPES.map((archetype) => archetype.id).sort()).toEqual(
      [
        'courtyard',
        'destination_garden',
        'formal_axis',
        'linear_sequence',
        'side_by_side',
        'sweeping_lawn',
        'terrace_and_lawn',
      ].sort(),
    );
  });

  it('offers its own default first, so one parameter set is the plan as designed', () => {
    const { analysis, briefs } = read(scenario('family-play').document);
    for (const archetype of ARCHETYPES) {
      const params = archetype.params(analysis, briefs[0]!);
      expect(params.length, archetype.id).toBeGreaterThan(0);
      expect(params[0]!.archetype, archetype.id).toBe(archetype.id);
    }
  });

  it('pins the two axes that would stop a formal garden being one', () => {
    const { analysis, briefs } = read(scenario('modern-vs-natural').document);
    const formal = ARCHETYPES.find((archetype) => archetype.id === 'formal_axis')!;
    for (const params of formal.params(analysis, briefs[0]!)) {
      expect(params.lawnBias).toBe('centre');
      expect(params.destination).toBe('axis-end');
    }
  });

  it('gives a reason whenever it refuses', () => {
    for (const entry of SCENARIOS) {
      const { analysis, briefs } = read(entry.document);
      for (const refusal of refusals(analysis, briefs[0]!)) {
        expect(refusal.reasons.length, `${entry.key}/${refusal.id}`).toBeGreaterThan(0);
        expect(refusal.reasons[0]!.length).toBeGreaterThan(20);
      }
    }
  });

  it('always leaves at least one composition standing', () => {
    for (const entry of SCENARIOS) {
      const { analysis, briefs } = read(entry.document);
      expect(rankArchetypes(analysis, briefs[0]!).length, entry.key).toBeGreaterThan(0);
    }
  });

  it('fills all three slots even where only one composition fits', () => {
    for (const entry of SCENARIOS) {
      const { slots } = read(entry.document);
      expect(slots.length, entry.key).toBe(3);
    }
  });
});

/* ---------------------------------------------------------------- the scenarios */

describe('scenario 2: a long narrow garden', () => {
  const document = scenario('long-narrow').document;

  it('is laid out as a sequence of rooms rather than one strip', () => {
    expect(read(document).slots[0]!.id).toBe('linear_sequence');
  });

  it('puts the rooms in order down the length, not beside each other', () => {
    const plan = zonePlanOf(document);
    const placed = plan.zones.filter((zone) => zone.rect !== null);
    expect(placed.length).toBeGreaterThan(1);

    const terrace = placed.find((zone) => zone.type === 'terrace')!;
    for (const zone of placed) {
      if (zone.id === terrace.id) continue;
      // Further down the garden than the terrace, rather than alongside it.
      expect(zone.rect!.u0, zone.type).toBeGreaterThanOrEqual(terrace.rect!.u0);
    }
  });

  it('refuses the compositions that need width', () => {
    const { analysis, briefs } = read(document);
    const refused = refusals(analysis, briefs[0]!).map((entry) => entry.id);
    expect(refused).toContain('side_by_side');
  });
});

describe('scenario 3: a wide shallow garden', () => {
  const document = scenario('wide-shallow').document;

  it('lays the rooms beside each other rather than front to back', () => {
    expect(read(document).slots[0]!.id).toBe('side_by_side');
  });

  it('refuses a formal axis outright: there is no view to have', () => {
    const { analysis, briefs } = read(document);
    expect(refusals(analysis, briefs[0]!).map((entry) => entry.id)).toContain('formal_axis');
  });

  it('gives the terrace and the open ground their own places along the wall', () => {
    const plan = zonePlanOf(document);
    const terrace = plan.zones.find((zone) => zone.type === 'terrace')!;
    const lawn = plan.zones.find((zone) => zone.type === 'lawn')!;

    expect(terrace.rect).not.toBeNull();
    expect(lawn.rect).not.toBeNull();
    // Side by side: they overlap in depth and not in width.
    const overlapDepth =
      Math.min(terrace.rect!.u1, lawn.rect!.u1) - Math.max(terrace.rect!.u0, lawn.rect!.u0);
    const overlapWidth =
      Math.min(terrace.rect!.v1, lawn.rect!.v1) - Math.max(terrace.rect!.v0, lawn.rect!.v0);
    expect(overlapDepth).toBeGreaterThan(0);
    expect(overlapWidth).toBeLessThanOrEqual(0);
  });
});

describe('scenario 4: a side gate and a shed', () => {
  const document = scenario('side-gate-shed').document;

  it('claims the store for the utility room', () => {
    const plan = zonePlanOf(document);
    const utility = plan.zones.find((zone) => zone.type === 'utility');
    expect(utility).toBeDefined();
    expect(utility!.features).toContain('storage');
  });

  it('puts the utility room on the gate side of the garden', () => {
    const { analysis } = read(document);
    const plan = zonePlanOf(document);
    const utility = plan.zones.find((zone) => zone.type === 'utility')!;
    if (!utility.rect || !analysis.gateSide) return;

    const centre = (utility.rect.v0 + utility.rect.v1) / 2;
    // `v` runs right when looking out of the doors, so a gate on the right is positive.
    expect(Math.sign(centre)).toBe(analysis.gateSide === 'right' ? 1 : -1);
  });

  it('knows the store should be out of the view and near the gate', () => {
    expect(FEATURE_LIBRARY.storage.visibility).toBe('avoids');
    expect(FEATURE_LIBRARY.storage.access).toBe('gate');
  });
});

describe('scenario 5: a family garden with a play area', () => {
  const document = scenario('family-play').document;

  it('reads the garden as a family one and makes the play area essential', () => {
    const { requirements } = read(document);
    expect(requirements.intent).toBe('family');
    expect(requirements.priorities.find((entry) => entry.feature === 'play')!.tier).toBe(
      'essential',
    );
  });

  it('gives the play area a room of its own', () => {
    const plan = zonePlanOf(document);
    const play = plan.zones.find((zone) => zone.type === 'play');
    expect(play).toBeDefined();
    expect(play!.features).toContain('play');
  });

  it('never cuts the play area for capacity, whatever else is asked for', () => {
    const { requirements } = read(document);
    expect(withinCapacity(requirements).keep).toContain('play');
  });
});

describe('scenario 6: the same plot, modern and naturalistic', () => {
  it('chooses a different composition for each', () => {
    const modern = read(scenario('modern-vs-natural').document).slots[0]!.id;
    const natural = read(scenario('natural-twin').document).slots[0]!.id;
    expect(modern).not.toBe(natural);
    expect(modern).toBe('terrace_and_lawn');
    expect(natural).toBe('sweeping_lawn');
  });

  it('holds the plot constant, so only the style differs', () => {
    const modern = analyseSite(scenario('modern-vs-natural').document);
    const natural = analyseSite(scenario('natural-twin').document);
    expect(modern.shape).toBe(natural.shape);
    expect(modern.roomDepth).toBeCloseTo(natural.roomDepth!, 9);
    expect(modern.roomWidth).toBeCloseTo(natural.roomWidth!, 9);
  });
});

describe('scenario 7: everything, on a plot that cannot hold it', () => {
  const document = scenario('overloaded').document;

  it('leaves the lower-priority features out, with a reason each', () => {
    const { briefs } = read(document);
    for (const brief of briefs) {
      expect(brief.excludedFeatures.length).toBeGreaterThan(0);
      for (const excluded of brief.excludedFeatures) {
        expect(excluded.reason.length).toBeGreaterThan(20);
      }
    }
  });

  it('keeps every essential and cuts from the bottom', () => {
    const { requirements } = read(document);
    const { keep, cut } = withinCapacity(requirements);
    const tierOf = (feature: DesiredFeature) =>
      requirements.priorities.find((entry) => entry.feature === feature)!.tier;

    for (const feature of keep) {
      if (tierOf(feature) === 'essential') continue;
      // Nothing kept is wanted less than anything cut.
      const rank = { essential: 2, preferred: 1, optional: 0 } as const;
      for (const dropped of cut) {
        expect(rank[tierOf(feature)]).toBeGreaterThanOrEqual(rank[tierOf(dropped.feature)]);
      }
    }
    expect(cut.every((entry) => tierOf(entry.feature) !== 'essential')).toBe(true);
  });

  it('makes no room it has nothing to put in', () => {
    const plan = zonePlanOf(document);
    const composed = new Set(['lawn', 'planting', 'transition']);
    for (const zone of plan.zones) {
      if (composed.has(zone.type) || zone.type === 'terrace') continue;
      expect(zone.features.length, zone.type).toBeGreaterThan(0);
    }
  });
});

describe('scenario: an L-shaped plot', () => {
  const document = scenario('l-shaped').document;

  it('refuses the compositions that assume a rectangle', () => {
    const { analysis, briefs } = read(document);
    expect(analysis.shape).toBe('irregular');
    expect(refusals(analysis, briefs[0]!).map((entry) => entry.id)).toContain('side_by_side');
  });
});

/* ---------------------------------------------------------------- the zone plan itself */

describe('a zone plan', () => {
  it('puts every room it places inside the room behind the doors', () => {
    for (const entry of SCENARIOS) {
      const { analysis } = read(entry.document);
      if (!analysis.box) continue;
      const plan = zonePlanOf(entry.document);

      for (const zone of plan.zones) {
        if (!zone.rect) continue;
        expect(zone.rect.u0, `${entry.key}/${zone.type}`).toBeGreaterThanOrEqual(-1e-6);
        expect(zone.rect.u1).toBeLessThanOrEqual(analysis.box.uMax + 1e-6);
        expect(zone.rect.v0).toBeGreaterThanOrEqual(analysis.box.vMin - 1e-6);
        expect(zone.rect.v1).toBeLessThanOrEqual(analysis.box.vMax + 1e-6);
      }
    }
  });

  it('always has a terrace at the doors and a primary room that exists', () => {
    for (const entry of SCENARIOS) {
      const plan = zonePlanOf(entry.document);
      expect(
        plan.zones.some((zone) => zone.type === 'terrace'),
        entry.key,
      ).toBe(true);
      expect(
        plan.zones.some((zone) => zone.id === plan.primaryId),
        entry.key,
      ).toBe(true);
    }
  });

  it('hangs every room off the terrace, so nothing is stranded', () => {
    for (const entry of SCENARIOS) {
      const plan = zonePlanOf(entry.document);
      const terrace = plan.zones.find((zone) => zone.type === 'terrace')!;
      const reachable = new Set([terrace.id]);
      for (const [from, to] of plan.adjacency) {
        if (reachable.has(from)) reachable.add(to);
        if (reachable.has(to)) reachable.add(from);
      }
      for (const zone of plan.zones) {
        if (zone.type === 'planting' || zone.type === 'transition') continue;
        expect(reachable.has(zone.id), `${entry.key}/${zone.type}`).toBe(true);
      }
    }
  });

  it('gives a room it places a real area rather than a sliver', () => {
    for (const entry of SCENARIOS) {
      const plan = zonePlanOf(entry.document);
      for (const zone of plan.zones) {
        if (!zone.rect) continue;
        const area = (zone.rect.u1 - zone.rect.u0) * (zone.rect.v1 - zone.rect.v0);
        expect(area, `${entry.key}/${zone.type}`).toBeGreaterThan(1);
      }
    }
  });

  it('is deterministic', () => {
    const once = zonePlanOf(scenario('family-play').document);
    const twice = zonePlanOf(scenario('family-play').document);
    expect(once).toEqual(twice);
  });
});

/* ---------------------------------------------------------------- the sketches */

describe('every composition draws a usable sketch on every scenario', () => {
  it('gives a terrace, slots with zones, and nothing inverted', () => {
    for (const entry of SCENARIOS) {
      const { analysis, constraints, briefs } = read(entry.document);
      if (!analysis.box || !analysis.frame) continue;

      const room = {
        uMin: Math.max(0, analysis.box.uMin),
        uMax: analysis.box.uMax,
        vMin: analysis.box.vMin,
        vMax: analysis.box.vMax,
        polygon: analysis.box.polygon,
      };
      const request = {
        features: entry.document.brief.desiredFeatures,
        scale: constraints.scale.sizeFactor,
        style: constraints.style,
        lawnAllowed: !constraints.forbiddenFill.includes('lawn'),
        gateSide: analysis.gateSide,
        houseWallLength: analysis.frame.wallLength,
        doorWidth: analysis.frame.doorWidth,
      };

      for (const archetype of ARCHETYPES) {
        const params = archetype.params(analysis, briefs[0]!)[0]!;
        const plan = planZones({
          brief: briefs[0]!,
          site: analysis,
          archetype,
          params,
          room,
          request,
          placing: withinCapacity(read(entry.document).requirements).keep,
        });
        const sketch = archetype.sketch(request, room, plan, params);
        const where = `${entry.key}/${archetype.id}`;

        expect(sketch.terrace, where).not.toBeNull();
        expect(sketch.terrace!.u1, where).toBeGreaterThan(sketch.terrace!.u0);
        expect(sketch.terrace!.v1, where).toBeGreaterThan(sketch.terrace!.v0);

        /* Every slot knows which room it belongs to: the whole point of the zone layer. */
        for (const slot of sketch.slots) {
          expect(slot.zoneId, `${where}/${slot.id}`).toBeDefined();
          expect(slot.maxSize.width, `${where}/${slot.id}`).toBeGreaterThan(0);
          expect(slot.maxSize.depth, `${where}/${slot.id}`).toBeGreaterThan(0);
        }

        /* No bed is drawn inside out, and none is a sliver the fill pass would throw away. */
        for (const bed of sketch.beds) {
          if (bed.shape.kind !== 'rect') continue;
          const area = polygonArea([
            { x: bed.shape.rect.u0, y: bed.shape.rect.v0 },
            { x: bed.shape.rect.u1, y: bed.shape.rect.v0 },
            { x: bed.shape.rect.u1, y: bed.shape.rect.v1 },
            { x: bed.shape.rect.u0, y: bed.shape.rect.v1 },
          ]);
          expect(bed.shape.rect.u1, `${where}/${bed.name}`).toBeGreaterThan(bed.shape.rect.u0);
          expect(bed.shape.rect.v1, `${where}/${bed.name}`).toBeGreaterThan(bed.shape.rect.v0);
          expect(area, `${where}/${bed.name}`).toBeGreaterThan(0.5);
        }
      }
    }
  });
});
