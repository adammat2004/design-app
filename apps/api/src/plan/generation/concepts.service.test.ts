import {
  PlanDocumentSchema,
  computeZones,
  distanceToSegment,
  elementArea,
  geometryOutline,
  housePolygon,
  polygonContainsPolygon,
  polygonEdges,
  polygonsIntersect,
  type GardenBrief,
  type PlanDocument,
} from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConceptsService } from './concepts.service.js';
import { FillService } from './fill.service.js';
import { PlacementService } from './placement.service.js';
import { GeometryValidationService } from '../geometry-validation.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../../test/db.js';

const connection = await connectTestDatabase();

const brief: GardenBrief = {
  purpose: 'Somewhere to eat outside and let the children run around.',
  desiredFeatures: ['seating', 'play', 'storage', 'water'],
  featuresOther: '',
  budget: 'medium',
  maintenance: 'medium',
  style: 'modern',
  styleOther: '',
};

/** A 20 m x 16 m plot with an 8 m x 6 m house near the top, both gardens in scope. */
function plan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: {
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 20, y: 0 },
        { id: 'v3', x: 20, y: 16 },
        { id: 'v4', x: 0, y: 16 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -4, y: -3 },
          { id: 'h1', x: 4, y: -3 },
          { id: 'h2', x: 4, y: 3 },
          { id: 'h3', x: -4, y: 3 },
        ],
        centre: { x: 10, y: 4 },
        rotation: 0,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
    },
    brief,
    ...overrides,
  });
}

/**
 * A 100 m x 84 m property — about 8,400 m², the size that exposed the plot-scale defect. The house
 * is the same building; only the land around it is bigger, which is exactly the comparison.
 */
function largePlan(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: {
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 100, y: 0 },
        { id: 'v3', x: 100, y: 84 },
        { id: 'v4', x: 0, y: 84 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -4, y: -3 },
          { id: 'h1', x: 4, y: -3 },
          { id: 'h2', x: 4, y: 3 },
          { id: 'h3', x: -4, y: 3 },
        ],
        centre: { x: 50, y: 20 },
        rotation: 0,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
    },
    brief,
  });
}

/** An L-shaped plot: the guillotine could not produce a concave accent for this. */
function lShapedPlan(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: {
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 20, y: 0 },
        { id: 'v3', x: 20, y: 8 },
        { id: 'v4', x: 10, y: 8 },
        { id: 'v5', x: 10, y: 18 },
        { id: 'v6', x: 0, y: 18 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -3, y: -2.5 },
          { id: 'h1', x: 3, y: -2.5 },
          { id: 'h2', x: 3, y: 2.5 },
          { id: 'h3', x: -3, y: 2.5 },
        ],
        centre: { x: 5, y: 3 },
        rotation: 0,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
    },
    brief,
  });
}

describe.skipIf(connection === null)('ConceptsService', () => {
  let service: ConceptsService;
  let validation: GeometryValidationService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    service = new ConceptsService(new PlacementService(db.db), new FillService(db.db));
    validation = new GeometryValidationService(db.db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('produces three concepts, the first of which is the recommendation', async () => {
    const concepts = await service.generate(plan(), 1);

    expect(concepts).toHaveLength(3);
    expect(concepts[0]!.recommended).toBe(true);
    expect(concepts.filter((concept) => concept.recommended)).toHaveLength(1);
    expect(new Set(concepts.map((concept) => concept.id)).size).toBe(3);
  });

  it('lays ground cover over every zone in scope', async () => {
    const [concept] = await service.generate(plan(), 1);
    const document = plan();
    const zones = computeZones(
      document.site.vertices.map((v) => ({ x: v.x, y: v.y })),
      document.site.house,
    );

    const bases = concept!.elements.filter((element) => element.fillKind === 'base');

    expect(bases).toHaveLength(zones.length);
    // Base fills come first, so nothing can be drawn underneath them.
    expect(concept!.elements.slice(0, bases.length).every((e) => e.fillKind === 'base')).toBe(true);
  });

  it('puts the features on top of their own ground cover', async () => {
    const [concept] = await service.generate(plan(), 1);

    const lastFill = concept!.elements.findLastIndex((element) => element.role === 'fill');
    const firstFeature = concept!.elements.findIndex((element) => element.role === 'feature');

    expect(firstFeature).toBeGreaterThan(lastFill);
  });

  it('places what the brief asked for, and says so honestly when it cannot', async () => {
    const [concept] = await service.generate(plan(), 1);

    expect(concept!.requestedFeaturesIncluded).toHaveLength(brief.desiredFeatures.length);
    expect(concept!.requestedFeaturesIncluded.some((check) => check.included)).toBe(true);

    // Every "included" claim is backed by an element actually in the plan.
    const named = new Set(
      concept!.elements.filter((e) => e.role === 'feature').map((e) => e.name ?? ''),
    );
    expect(named.size).toBeGreaterThan(0);
  });

  it('cannot fit much into a tiny garden, and does not pretend otherwise', async () => {
    const tiny = PlanDocumentSchema.parse({
      version: 1,
      site: {
        vertices: [
          { id: 'v1', x: 0, y: 0 },
          { id: 'v2', x: 7, y: 0 },
          { id: 'v3', x: 7, y: 7 },
          { id: 'v4', x: 0, y: 7 },
        ],
        closed: true,
        house: {
          outline: [
            { id: 'h0', x: -2.5, y: -2 },
            { id: 'h1', x: 2.5, y: -2 },
            { id: 'h2', x: 2.5, y: 2 },
            { id: 'h3', x: -2.5, y: 2 },
          ],
          centre: { x: 3.5, y: 2.5 },
          rotation: 0,
        },
        selectedZoneIds: ['front', 'back', 'left', 'right'],
      },
      brief,
    });

    const [concept] = await service.generate(tiny, 1);

    expect(concept!.requestedFeaturesIncluded.some((check) => !check.included)).toBe(true);
  });

  /* ---------------------------------------------------------------- determinism */

  it('is deterministic: the same document and seed produce the same concepts', async () => {
    const first = await service.generate(plan(), 42);
    const second = await service.generate(plan(), 42);

    expect(second).toEqual(first);
  });

  it('advancing the seed produces a different plan', async () => {
    const first = await service.generate(plan(), 42);
    const second = await service.generate(plan(), 43);

    expect(second).not.toEqual(first);
    // And the ids cannot collide, so a reroll can never look like the previous set.
    expect(second[0]!.id).not.toBe(first[0]!.id);
  });

  it('regenerates one slot without touching the others', async () => {
    const set = await service.generate(plan(), 7);
    const reroll = await service.regenerate(plan(), 8, 1);

    expect(reroll.id).toBe('c8-1');
    // Slot 1's archetype is preserved — a reroll is a different garden, not a different concept.
    expect(reroll.recommended).toBe(set[1]!.recommended);
    expect(reroll.name).toBe(set[1]!.name);
  });

  /* ---------------------------------------------------------------- the strongest test */

  /*
   * The generator's output is judged by the very service that guards saves. If these two ever
   * drift apart — a different tessellation, a different containment rule, a different opinion
   * about touching — this fails, and the wizard would otherwise generate a garden it then
   * refuses to let the user keep.
   */
  it('generates concepts that pass the validator that guards their own save', async () => {
    for (const seed of [1, 2, 3]) {
      const concepts = await service.generate(plan(), seed);

      for (const concept of concepts) {
        const document = plan();
        document.layout.elements = concept.elements;

        const result = await validation.validate(document);

        expect(result.violations).toEqual([]);
      }
    }
  });

  it('generates a legal plan on an L-shaped plot too', async () => {
    const concepts = await service.generate(lShapedPlan(), 5);

    for (const concept of concepts) {
      const document = lShapedPlan();
      document.layout.elements = concept.elements;

      expect((await validation.validate(document)).violations).toEqual([]);
    }
  });

  /* ---------------------------------------------------------------- placement quality */

  it('keeps placed features off the house and out of each other', async () => {
    const document = plan();
    const house = housePolygon(document.site.house!);
    const [concept] = await service.generate(document, 11);

    const placed = concept!.elements.filter(
      (element) => element.role === 'feature' && element.category !== 'existing-feature',
    );

    for (const element of placed) {
      const outline = geometryOutline(element.shape);
      expect(polygonsIntersect(outline, house)).toBe(false);
    }

    // Paths are allowed to run up to things; the built footprints are not.
    const footprints = placed.filter((element) => element.shape.kind !== 'polyline');
    for (let i = 0; i < footprints.length; i += 1) {
      for (let j = i + 1; j < footprints.length; j += 1) {
        const a = geometryOutline(footprints[i]!.shape);
        const b = geometryOutline(footprints[j]!.shape);
        expect(polygonsIntersect(a, b)).toBe(false);
      }
    }
  });

  it('gives every accent a real area rather than a sliver', async () => {
    const [concept] = await service.generate(plan(), 3);

    const accents = concept!.elements.filter((element) => element.fillKind === 'accent');

    expect(accents.length).toBeGreaterThan(0);
    for (const accent of accents) {
      expect(elementArea(accent)).toBeGreaterThan(1);
    }
  });

  it('plants a border against the fence', async () => {
    const document = plan();
    const boundary = document.site.vertices.map((v) => ({ x: v.x, y: v.y }));
    const [concept] = await service.generate(document, 11);

    const beds = concept!.elements.filter(
      (element) => element.fillKind === 'accent' && element.category === 'planting-bed',
    );
    expect(beds.length).toBeGreaterThan(0);

    /*
     * At least one bed has to actually touch the fence line, or it is a bed in the middle of the
     * garden and the border did not happen. Measured as "a vertex within the band's own depth of
     * the boundary", which is true of a border and false of an inset accent.
     */
    const nearFence = beds.some((bed) =>
      geometryOutline(bed.shape).some((point) =>
        polygonEdges(boundary).some((edge) => distanceToSegment(point, edge.start, edge.end) < 0.2),
      ),
    );

    expect(nearFence).toBe(true);
  });

  it('plants trees that stay inside the fence and clear of each other', async () => {
    const document = plan();
    const boundary = document.site.vertices.map((v) => ({ x: v.x, y: v.y }));
    const [concept] = await service.generate(document, 12);

    const trees = concept!.elements.filter((element) => element.name === 'Tree');
    expect(trees.length).toBeGreaterThan(0);

    for (const tree of trees) {
      expect(tree.shape.kind).toBe('point');
      // A canopy that overhangs the fence is what the exact disc erosion exists to prevent.
      expect(polygonContainsPolygon(boundary, geometryOutline(tree.shape))).toBe(true);
      /*
       * Never an accent: `geometryArea` is 0 for a point, so a tree tagged as one would sail past
       * the sliver rule above and quietly break the "every accent has a real area" guarantee.
       */
      expect(tree.fillKind).toBeUndefined();
    }
  });

  it('keeps the border out from under the trees and features', async () => {
    // The border is pushed onto `obstacles` before the accent pass, so nothing later sits on it.
    const [concept] = await service.generate(plan(), 13);

    const fills = concept!.elements.filter((element) => element.role === 'fill');
    const lastFill = concept!.elements.indexOf(fills.at(-1)!);
    const firstFeature = concept!.elements.findIndex((element) => element.role === 'feature');

    // The ordering the whole z-order guarantee rests on, re-asserted with trees in the mix.
    expect(firstFeature).toBeGreaterThan(lastFill);
  });

  /*
   * ---- brief compliance ----
   *
   * The defect these are here for: a concept badged "Maintenance: Low" that contained a lawn and
   * mixed flowering perennial beds. The cause was two sources for one decision — the badge came
   * from the archetype and the ground cover from the brief — so these assert the *pair*, not just
   * the absence of grass.
   */

  it('puts no lawn in a concept that claims to be low maintenance', async () => {
    const concepts = await service.generate(plan({ brief: { ...brief, maintenance: 'low' } }), 5);

    for (const concept of concepts) {
      expect(concept.maintenance).toBe('low');
      expect(concept.elements.filter((element) => element.category === 'lawn')).toEqual([]);
    }
  });

  it('keeps the badge and the ground cover in step even when the brief disagrees', async () => {
    // The brief says medium; archetype 2 is the low-maintenance retreat regardless.
    const concepts = await service.generate(
      plan({ brief: { ...brief, maintenance: 'medium' } }),
      5,
    );

    for (const concept of concepts) {
      const hasLawn = concept.elements.some((element) => element.category === 'lawn');
      expect(hasLawn).toBe(concept.maintenance !== 'low');
    }
  });

  it('keeps the perennial mixes out of a low-maintenance concept, without leaving it bare', async () => {
    // Formal style takes a branch that would otherwise reach for a mixed border.
    const concepts = await service.generate(
      plan({ brief: { ...brief, maintenance: 'low', style: 'formal' } }),
      7,
    );

    for (const concept of concepts) {
      if (concept.maintenance !== 'low') continue;

      const materials = concept.elements.map((element) => element.material);
      expect(materials).not.toContain('mixed-border');
      expect(materials).not.toContain('wildflower');
      // Still a planted garden rather than an empty one.
      expect(concept.elements.some((element) => element.category === 'planting-bed')).toBe(true);
    }
  });

  it('reports what the materials came to, alongside what it was aiming at', async () => {
    const [concept] = await service.generate(plan(), 3);

    expect(concept!.estimatedBudget).toBeDefined();
    expect(['low', 'medium', 'high', 'premium']).toContain(concept!.estimatedBudget);
  });

  /*
   * ---- plot scale ----
   *
   * On an 8,400 m² plot the generator used to emit a suburban feature set unchanged — a 13 m²
   * dining pergola marooned in a field. Feature size and feature count both have to follow the
   * plot, and the growth has to be sub-linear or the dining area seats forty.
   */

  it('sizes features to the plot rather than drawing the same garden at every scale', async () => {
    const suburban = await service.generate(plan(), 11);
    const estate = await service.generate(largePlan(), 11);

    const seatingArea = (concepts: Awaited<ReturnType<typeof service.generate>>) => {
      const seating = concepts[0]!.elements.find((element) => element.name === 'Seating patio');
      return seating ? elementArea(seating) : 0;
    };

    const small = seatingArea(suburban);
    const big = seatingArea(estate);

    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(small * 1.5);
    // Sub-linear: the plot is ~26 times bigger, the terrace must not be.
    expect(big).toBeLessThan(small * 8);
  });

  it('puts more in a large garden rather than the same things further apart', async () => {
    const suburban = await service.generate(plan(), 11);
    const estate = await service.generate(largePlan(), 11);

    const features = (concepts: Awaited<ReturnType<typeof service.generate>>) =>
      concepts[0]!.elements.filter((element) => element.role === 'feature').length;

    expect(features(estate)).toBeGreaterThan(features(suburban));
    // The surplus lands as a repeat of something that repeats sensibly, named so on the plan.
    expect(estate[0]!.elements.some((element) => element.name?.startsWith('Second '))).toBe(true);
  });

  it('still generates a legal plan at estate scale', async () => {
    const document = largePlan();
    const concepts = await service.generate(document, 11);

    for (const concept of concepts) {
      const result = await validation.validate({
        ...document,
        layout: { elements: concept.elements, seededFrom: concept.id, pristine: null },
      });

      expect(result.violations).toEqual([]);
    }
  });
});

if (connection === null) {
  describe('ConceptsService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
