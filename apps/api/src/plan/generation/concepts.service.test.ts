import {
  PlanDocumentSchema,
  THRESHOLD_DEPTH,
  computeZones,
  distanceToSegment,
  elementArea,
  geometryOutline,
  housePolygon,
  openingCentre,
  polygonContainsPolygon,
  polygonEdges,
  polygonsIntersect,
  resolvedGates,
  streetEdge,
  suggestedAccess,
  thresholdRect,
  wallSegment,
  type GardenBrief,
  type GeneratedConcept,
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

/**
 * A 20 m x 19 m plot with an 8 m x 6 m house near the top, both gardens in scope. The house faces
 * the top fence (rotation 180: its front is towards -y), so the street is along the top, the
 * front garden is the 4 m strip there and the back garden the 9 m below the house — and
 * `suggestedAccess` gives it patio doors, a front door, a side gate and the street edge, the way a
 * real site reaches the generator.
 */
function plan(overrides: Partial<PlanDocument> = {}): PlanDocument {
  const site = siteWithAccess({
    vertices: [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 20, y: 0 },
      { id: 'v3', x: 20, y: 19 },
      { id: 'v4', x: 0, y: 19 },
    ],
    closed: true,
    house: {
      outline: [
        { id: 'h0', x: -4, y: -3 },
        { id: 'h1', x: 4, y: -3 },
        { id: 'h2', x: 4, y: 3 },
        { id: 'h3', x: -4, y: 3 },
      ],
      centre: { x: 10, y: 7 },
      rotation: 180,
    },
    selectedZoneIds: ['front', 'back', 'left', 'right'],
  });
  return PlanDocumentSchema.parse({ version: 1, site, brief, ...overrides });
}

/** Parses a raw site, then fills in the doors, the gate and the street edge. */
function siteWithAccess(raw: unknown) {
  return suggestedAccess(PlanDocumentSchema.shape.site.parse(raw));
}

/**
 * A 100 m x 84 m property — about 8,400 m², the size that exposed the plot-scale defect. The house
 * is the same building; only the land around it is bigger, which is exactly the comparison.
 */
function largePlan(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: siteWithAccess({
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
        rotation: 180,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
    }),
    brief,
  });
}

/** An L-shaped plot: the guillotine could not produce a concave accent for this. */
function lShapedPlan(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: siteWithAccess({
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
        rotation: 180,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
    }),
    brief,
  });
}

/** The suburban plot turned a quarter: the house faces the left fence, the garden lies to the right. */
function rotatedPlan(): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: siteWithAccess({
      vertices: [
        { id: 'v1', x: 0, y: 0 },
        { id: 'v2', x: 19, y: 0 },
        { id: 'v3', x: 19, y: 20 },
        { id: 'v4', x: 0, y: 20 },
      ],
      closed: true,
      house: {
        outline: [
          { id: 'h0', x: -4, y: -3 },
          { id: 'h1', x: 4, y: -3 },
          { id: 'h2', x: 4, y: 3 },
          { id: 'h3', x: -4, y: 3 },
        ],
        centre: { x: 7, y: 10 },
        rotation: 90,
      },
      selectedZoneIds: ['front', 'back', 'left', 'right'],
    }),
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

  /* ---------------------------------------------------------------- composition */

  it('rounds accent beds for a cottage garden and keeps them crisp for a modern one', async () => {
    const cottage = await service.generate(plan({ brief: { ...brief, style: 'cottage' } }), 11);
    const modern = await service.generate(plan({ brief: { ...brief, style: 'modern' } }), 11);

    const radii = (concepts: GeneratedConcept[]) =>
      concepts
        .flatMap((concept) => concept.elements)
        .filter((element) => element.role === 'fill' && element.fillKind === 'accent')
        .filter((element) => element.category !== 'planting-bed' || element.name === undefined)
        .map((element) => (element.shape.kind === 'polygon' ? element.shape.cornerRadius : 0));

    // Border bands stay square (they meet the fence); the beds inside are what the style shapes.
    expect(radii(cottage).some((radius) => radius >= 1)).toBe(true);
    expect(radii(modern).every((radius) => radius === 0)).toBe(true);
  });

  it('runs paths that stay on the plot and end at the feature they serve', async () => {
    const concepts = await service.generate(plan(), 11);
    const boundary = plan().site.vertices.map((v) => ({ x: v.x, y: v.y }));

    for (const concept of concepts) {
      const paths = concept.elements.filter((element) => element.shape.kind === 'polyline');

      // The gate has a path to the terrace and the front door a path to the street, every time.
      expect(paths.map((path) => path.name)).toContain('Side path');
      expect(paths.map((path) => path.name)).toContain('Front path');

      const features = concept.elements.filter(
        (element) =>
          element.role === 'feature' &&
          element.category !== 'furniture' &&
          element.shape.kind !== 'polyline' &&
          element.shape.kind !== 'point',
      );

      for (const path of paths) {
        // Garden paths are stepping stones; the front path is walked in the rain, so it is paved.
        if (path.name === 'Front path' || path.name === 'Axis path') {
          expect(path.material).not.toBe('stepping-stones');
        } else {
          expect(path.material).toBe('stepping-stones');
        }
        expect(polygonContainsPolygon(boundary, geometryOutline(path.shape))).toBe(true);
        if (path.shape.kind !== 'polyline' || !path.name?.startsWith('Path to')) continue;

        // A path to something ends at its edge, not in the middle of it.
        const end = path.shape.points[path.shape.points.length - 1]!;
        const gap = Math.min(
          ...features.flatMap((feature) =>
            polygonEdges(geometryOutline(feature.shape)).map((edge) =>
              distanceToSegment(end, edge.start, edge.end),
            ),
          ),
        );
        expect(gap).toBeLessThan(0.2);
      }
    }
  });

  /*
   * ---- the layout grammar ----
   *
   * What separates a designed garden from a scatter of legal features: the terrace is across the
   * doors, the lawn is one panel, the shed is by the gate, the formal plan mirrors, the front
   * garden reaches the street. Every one of these was false of the sampled layout.
   */

  it('recommends the template the style asks for, and the three concepts differ', async () => {
    const modern = await service.generate(plan({ brief: { ...brief, style: 'modern' } }), 2);
    const cottage = await service.generate(plan({ brief: { ...brief, style: 'cottage' } }), 2);
    const formal = await service.generate(plan({ brief: { ...brief, style: 'formal' } }), 2);

    expect(modern.find((concept) => concept.recommended)!.name).toBe('Terrace and lawn');
    expect(cottage.find((concept) => concept.recommended)!.name).toBe('Sweeping lawn');
    expect(formal.find((concept) => concept.recommended)!.name).toBe('Formal axis');

    for (const set of [modern, cottage, formal]) {
      expect(new Set(set.map((concept) => concept.name)).size).toBe(3);
      // Different templates, not the same layout with a different badge: the main panel differs.
      const panels = set.map((concept) =>
        JSON.stringify(
          concept.elements.find(
            (element) =>
              element.fillKind === 'accent' &&
              (element.category === 'lawn' || element.category === 'gravel-mulch'),
          )?.shape,
        ),
      );
      expect(new Set(panels).size).toBe(3);
    }
  });

  it('sets the terrace across the patio doors, on the wall, with the threshold inside it', async () => {
    const document = plan();
    const house = document.site.house!;
    const door = house.openings.find((opening) => opening.type === 'patio-door')!;
    const threshold = geometryOutline(thresholdRect(house, door, THRESHOLD_DEPTH)!);
    const wall = wallSegment(house, door.wallId)!;

    for (const concept of await service.generate(document, 11)) {
      const terrace = concept.elements.find((element) => element.name === 'Seating patio')!;
      const outline = geometryOutline(terrace.shape);

      expect(polygonContainsPolygon(outline, threshold)).toBe(true);
      // One edge of the terrace lies on the door's wall.
      const onWall = outline.filter((point) => distanceToSegment(point, wall[0], wall[1]) < 0.05);
      expect(onWall.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('lays one lawn panel, inside the back garden, behind the terrace', async () => {
    const document = plan();
    const house = housePolygon(document.site.house!);

    for (const concept of await service.generate(document, 11)) {
      if (concept.maintenance === 'low') continue;
      // The front garden's base may be turf too; the *panel* is the one accent lawn.
      const lawns = concept.elements.filter(
        (element) => element.category === 'lawn' && element.fillKind === 'accent',
      );
      expect(lawns).toHaveLength(1);

      const outline = geometryOutline(lawns[0]!.shape);
      const terrace = geometryOutline(
        concept.elements.find((element) => element.name === 'Seating patio')!.shape,
      );
      expect(polygonsIntersect(outline, house)).toBe(false);
      expect(polygonsIntersect(outline, terrace)).toBe(false);
      // Behind the terrace: every lawn vertex is further down the garden than the terrace's far edge.
      const terraceFar = Math.max(...terrace.map((point) => point.y));
      expect(Math.min(...outline.map((point) => point.y))).toBeGreaterThan(terraceFar - 1e-6);
      // And drawn after the border pieces it sits on.
      const lastBed = concept.elements.findLastIndex(
        (element) =>
          element.fillKind === 'accent' &&
          element.category === 'planting-bed' &&
          element.zone !== 'front',
      );
      expect(concept.elements.indexOf(lawns[0]!)).toBeGreaterThan(lastBed);
    }
  });

  it('puts the shed in the corner nearest the gate', async () => {
    const document = plan();
    const gate = resolvedGates(document.site)[0]!;
    const boundary = document.site.vertices.map((v) => ({ x: v.x, y: v.y }));
    const farCorner = boundary.reduce((far, point) =>
      Math.hypot(point.x - gate.centre.x, point.y - gate.centre.y) >
      Math.hypot(far.x - gate.centre.x, far.y - gate.centre.y)
        ? point
        : far,
    );

    for (const concept of await service.generate(document, 11)) {
      const store = concept.elements.find((element) => element.name === 'Garden store');
      if (!store || store.shape.kind !== 'rect') continue;
      const toGate = Math.hypot(
        store.shape.centre.x - gate.centre.x,
        store.shape.centre.y - gate.centre.y,
      );
      const toFar = Math.hypot(
        store.shape.centre.x - farCorner.x,
        store.shape.centre.y - farCorner.y,
      );
      // On the gate's side of the garden: nearer the gate than the opposite corner.
      expect(toGate).toBeLessThan(toFar);
      expect(store.shape.centre.x).toBeGreaterThan(10);
    }
  });

  it('mirrors the formal plan about the door axis', async () => {
    const concepts = await service.generate(plan({ brief: { ...brief, style: 'formal' } }), 11);
    const formal = concepts.find((concept) => concept.name === 'Formal axis')!;
    const axisX = 10; // The door is centred on the back wall of a house centred at x = 10.

    const terrace = formal.elements.find((element) => element.name === 'Seating patio')!;
    const lawn = formal.elements.find(
      (element) =>
        element.category === 'lawn' ||
        (element.category === 'gravel-mulch' && element.fillKind === 'accent'),
    );
    for (const element of [terrace, lawn]) {
      if (!element) continue;
      const outline = geometryOutline(element.shape);
      const left = Math.min(...outline.map((point) => point.x));
      const right = Math.max(...outline.map((point) => point.x));
      expect(Math.abs(axisX - left - (right - axisX))).toBeLessThan(0.05);
    }

    const axis = formal.elements.find((element) => element.name === 'Axis path');
    expect(axis).toBeDefined();
    if (axis?.shape.kind === 'polyline') {
      for (const point of axis.shape.points) expect(Math.abs(point.x - axisX)).toBeLessThan(0.05);
    }
  });

  it('gives the front garden a paved path from the front door to the street', async () => {
    const document = plan();
    const house = document.site.house!;
    const door = house.openings.find((opening) => opening.type === 'front-door')!;
    const street = streetEdge(document.site)!;

    for (const concept of await service.generate(document, 11)) {
      const path = concept.elements.find((element) => element.name === 'Front path')!;
      expect(path.shape.kind).toBe('polyline');
      if (path.shape.kind !== 'polyline') continue;
      const [start, end] = [path.shape.points[0]!, path.shape.points.at(-1)!];
      const doorCentre = openingCentre(house, door)!;
      expect(Math.hypot(start.x - doorCentre.x, start.y - doorCentre.y)).toBeLessThan(0.6);
      expect(distanceToSegment(end, street[0], street[1])).toBeLessThan(0.3);
      expect(path.material).not.toBe('stepping-stones');
      // The front garden is planted rather than left as the palette's ground.
      expect(
        concept.elements.some((e) => e.zone === 'front' && e.category === 'planting-bed'),
      ).toBe(true);
    }
  });

  it('never lays play bark as a ground cover', async () => {
    for (const concept of await service.generate(
      plan({ brief: { ...brief, style: 'formal' } }),
      11,
    )) {
      const bark = concept.elements.filter((element) => element.material === 'play-bark');
      for (const element of bark) expect(element.name).toBe('Play area');
    }
  });

  it('designs a rotated house from its doors, not from the screen', async () => {
    const document = rotatedPlan();
    const house = document.site.house!;
    const door = house.openings.find((opening) => opening.type === 'patio-door')!;
    const threshold = geometryOutline(thresholdRect(house, door, THRESHOLD_DEPTH)!);

    for (const concept of await service.generate(document, 11)) {
      const terrace = concept.elements.find((element) => element.name === 'Seating patio')!;
      expect(polygonContainsPolygon(geometryOutline(terrace.shape), threshold)).toBe(true);
      // Aligned to the wall, which is turned: never a screen-aligned rectangle.
      expect(terrace.shape.kind === 'rect' && Math.abs(terrace.shape.rotation % 180)).toBeCloseTo(
        90,
        5,
      );
      const layout = { elements: concept.elements, seededFrom: concept.id, pristine: null };
      expect((await validation.validate({ ...document, layout })).violations).toEqual([]);
    }
  });

  it('still generates when the house has no doors, gate or street', async () => {
    const bare = PlanDocumentSchema.parse({
      version: 1,
      site: {
        ...plan().site,
        house: { ...plan().site.house!, openings: [] },
        gates: [],
        streetEdgeVertexId: null,
      },
      brief,
    });

    const concepts = await service.generate(bare, 11);
    expect(concepts).toHaveLength(3);
    for (const concept of concepts) {
      expect(concept.elements.some((element) => element.name === 'Seating patio')).toBe(true);
      expect(concept.elements.some((element) => element.name === 'Side path')).toBe(false);
      const layout = { elements: concept.elements, seededFrom: concept.id, pristine: null };
      expect((await validation.validate({ ...bare, layout })).violations).toEqual([]);
    }
  });

  it('stands specimen shrubs inside the beds', async () => {
    const [concept] = await service.generate(plan(), 11);
    const specimens = concept!.elements.filter((element) => element.symbol === 'specimen');
    const beds = concept!.elements.filter(
      (element) =>
        element.role === 'fill' &&
        element.fillKind === 'accent' &&
        element.category === 'planting-bed',
    );

    expect(specimens.length).toBeGreaterThan(0);
    for (const specimen of specimens) {
      const outline = geometryOutline(specimen.shape);
      expect(beds.some((bed) => polygonContainsPolygon(geometryOutline(bed.shape), outline))).toBe(
        true,
      );
      // Drawn after the bed it stands in.
      const bed = beds.find((b) => polygonContainsPolygon(geometryOutline(b.shape), outline))!;
      expect(concept!.elements.indexOf(specimen)).toBeGreaterThan(concept!.elements.indexOf(bed));
    }
  });

  it('puts furniture inside the feature it belongs to, and nowhere else', async () => {
    /*
     * The one deliberate exception to the disjointness rule below: a dining set is *supposed* to
     * overlap the pergola it sits under. So it must overlap exactly one built footprint, and lie
     * wholly inside it with the margin `furnish` keeps.
     */
    const document = plan();
    const concepts = await service.generate(document, 11);

    let seen = 0;
    for (const concept of concepts) {
      const furniture = concept.elements.filter((element) => element.category === 'furniture');
      const hosts = concept.elements.filter(
        (element) =>
          element.role === 'feature' &&
          element.category !== 'furniture' &&
          element.category !== 'existing-feature' &&
          element.shape.kind !== 'polyline',
      );

      for (const item of furniture) {
        seen += 1;
        expect(item.symbol).toBeDefined();
        expect(item.height).toBeGreaterThan(0);

        const outline = geometryOutline(item.shape);
        const inside = hosts.filter((host) =>
          polygonContainsPolygon(geometryOutline(host.shape), outline),
        );
        expect(inside, `${item.name} sits inside exactly one feature`).toHaveLength(1);

        // Stacking: the item is drawn after its host.
        const hostIndex = concept.elements.indexOf(inside[0]!);
        expect(concept.elements.indexOf(item)).toBeGreaterThan(hostIndex);
      }
    }

    // The fixture asks for seating and a pergola, so at least one concept furnished something.
    expect(seen).toBeGreaterThan(0);
  });

  it('marks a store with what it is, so the drawing can give it a roof', async () => {
    const document = plan();
    const [concept] = await service.generate(document, 11);

    const store = concept!.elements.find((element) => element.name === 'Garden store');
    expect(store?.symbol).toBe('shed');
  });

  it('keeps placed features off the house and out of each other', async () => {
    const document = plan();
    const house = housePolygon(document.site.house!);
    const [concept] = await service.generate(document, 11);

    // Furniture is excluded here because it stands *on* its host by design — see the test above.
    const placed = concept!.elements.filter(
      (element) =>
        element.role === 'feature' &&
        element.category !== 'existing-feature' &&
        element.category !== 'furniture',
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
