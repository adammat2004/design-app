import {
  PlanDocumentSchema,
  THRESHOLD_DEPTH,
  computeZones,
  canTake,
  distanceToSegment,
  elementArea,
  edgingRuns,
  geometryOutline,
  isCounted,
  housePolygon,
  openingCentre,
  planSchedule,
  pointInPolygon,
  polygonContainsPolygon,
  polygonEdges,
  polygonToWkt,
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
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ConceptsService, SCOPE_INSET } from './concepts.service.js';
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
  let fill: FillService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    fill = new FillService(db.db);
    service = new ConceptsService(new PlacementService(db.db), fill);
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
          !isCounted(element.category) &&
          element.shape.kind !== 'polyline',
      );

      for (const path of paths) {
        // Primary access is continuous paving; secondary routes follow their destination/upkeep.
        if (path.name === 'Front path' || path.name === 'Axis path' || path.name === 'Side path') {
          expect(path.material).not.toBe('stepping-stones');
        } else {
          expect(canTake(path.category, path.material!)).toBe(true);
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

  /*
   * Which opening the side path starts at. The generator used to take whichever gate was stored
   * first, which was harmless while every gate was a 900 mm pedestrian one and wrong the moment a
   * gap in the boundary could be a driveway or a street frontage.
   */
  describe('openings in the boundary', () => {
    /** The stored site with its gates replaced wholesale. */
    function withGates(gates: Record<string, unknown>[]): PlanDocument {
      const base = plan();
      return PlanDocumentSchema.parse({
        version: 1,
        site: { ...base.site, gates },
        brief,
      });
    }

    const sideGate = {
      id: 'g1',
      edgeVertexId: 'v2',
      offsetAlongEdge: 12,
      width: 0.9,
      kind: 'pedestrian',
    };

    /** The street runs along the top of this plot, v1 → v2. */
    const drive = {
      id: 'g2',
      edgeVertexId: 'v1',
      offsetAlongEdge: 4,
      width: 3,
      kind: 'vehicle',
    };

    it('starts the side path at a pedestrian gate rather than at a driveway', async () => {
      const [concept] = await service.generate(withGates([drive, sideGate]), 11);
      const path = concept!.elements.find((element) => element.name === 'Side path');
      expect(path).toBeDefined();

      // The side path begins near the gate in the side fence, not out on the street frontage.
      const start = (path!.shape as { points: { x: number; y: number }[] }).points[0]!;
      expect(Math.hypot(start.x - 20, start.y - 12)).toBeLessThan(3);
    });

    /*
     * The front path already runs to the kerb. A side path starting at the street frontage would
     * be dragged through the front garden and past the house.
     */
    it('runs no side path when the only opening is on the street', async () => {
      const concepts = await service.generate(withGates([drive]), 11);

      for (const concept of concepts) {
        expect(concept.elements.some((element) => element.name === 'Side path')).toBe(false);
        // The front path is unaffected: it is the street's own business.
        expect(concept.elements.some((element) => element.name === 'Front path')).toBe(true);
      }
    });

    /*
     * A car stands inside a driveway, so its keep-clear is five metres rather than one. Nothing
     * the generator places may sit in it.
     */
    it('keeps a driveway clear to a car’s depth', async () => {
      const document = withGates([drive]);
      const concepts = await service.generate(document, 11);

      // The drive is 3 m wide centred 4 m along the top fence, opening downwards into the plot.
      const inside = { x: 4, y: 2.5 };

      for (const concept of concepts) {
        for (const element of concept.elements) {
          if (element.role !== 'feature' || isCounted(element.category)) continue;
          expect(pointInPolygon(inside, geometryOutline(element.shape))).toBe(false);
        }
      }
    });

    it('still designs a legal garden with a driveway and a gate on it', async () => {
      const document = withGates([drive, sideGate]);
      const concepts = await service.generate(document, 11);

      expect(concepts).toHaveLength(3);
      for (const concept of concepts) {
        const layout = { elements: concept.elements, seededFrom: concept.id, pristine: null };
        expect((await validation.validate({ ...document, layout })).violations).toEqual([]);
      }
    });
  });

  it('stands the structural shrubs inside the beds', async () => {
    /*
     * These used to be two to four "specimen shrubs" sampled by PostGIS — a random point in a
     * random bed. They are now the scheme's own `backdrop` and `specimen` layers, placed by
     * `samplePlanting` from the same seed and with the same drift and edge-grading the painter uses
     * for the infill, so a shrub stands where the texture would have drawn one.
     *
     * What must stay true either way is what this test has always checked: a shrub is inside a bed,
     * and drawn after it.
     */
    const [concept] = await service.generate(plan(), 11);
    const specimens = concept!.elements.filter((element) => element.symbol?.startsWith('shrub-'));
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

    /*
     * Capped, because the sampler returns a *drawn density* — the right answer for a texture and
     * the wrong one for a list of objects the user has to scroll through.
     */
    expect(specimens.length).toBeLessThanOrEqual(30);
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
          !isCounted(element.category) &&
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

  it('never raises a terrace without a way down off it', async () => {
    /*
     * The invariant that matters about level changes, and the only one the generator can get wrong
     * in a way nothing else would catch: a raised terrace with no flight is a room you step out of
     * the house into and cannot leave. `stepsFromTerrace` returning null has to leave the terrace on
     * grade rather than raised and stranded.
     */
    const concepts = await service.generate(
      plan({ brief: { ...brief, style: 'formal', budget: 'premium' } }),
      11,
    );

    let raised = 0;
    for (const concept of concepts) {
      const lifted = concept.elements.filter(
        (element) => element.role === 'feature' && (element.elevation ?? 0) > 0,
      );
      if (lifted.length === 0) continue;
      raised += 1;

      const flights = concept.elements.filter((element) => element.symbol === 'steps');
      expect(flights.length, 'a raised terrace has a flight').toBeGreaterThan(0);

      // The flight climbs exactly what the terrace is lifted by — one fact, read twice.
      for (const flight of flights) {
        expect(flight.elevation).toBeCloseTo(lifted[0]!.elevation!, 9);
      }
    }

    // A formal brief on a premium budget is the case that takes the level change.
    expect(raised).toBeGreaterThan(0);
  });

  it('keeps every garden on one level unless the style and the budget both ask', async () => {
    // Retaining is the dearest thing per square metre in a garden. A concept that quietly raised
    // its terrace on a medium budget would be misreporting what it costs to build.
    for (const budget of ['low', 'medium'] as const) {
      const concepts = await service.generate(
        plan({ brief: { ...brief, style: 'formal', budget } }),
        11,
      );

      for (const concept of concepts) {
        for (const element of concept.elements) {
          expect(element.elevation ?? 0, `${budget} ${element.id}`).toBe(0);
        }
      }
    }
  });

  it('cuts the flight flush against the terrace rather than into it', async () => {
    /*
     * Flush is load-bearing: two rectangles sharing an edge do not intersect by
     * `polygonsIntersect`, which tests a strict crossing, so the flight satisfies the pairwise
     * disjointness rule without a fudge gap. If it ever overlaps, the concept suite's own
     * disjointness test fails — this asserts the near miss the other way, that it actually touches.
     */
    const concepts = await service.generate(
      plan({ brief: { ...brief, style: 'formal', budget: 'premium' } }),
      11,
    );

    for (const concept of concepts) {
      const flight = concept.elements.find((element) => element.symbol === 'steps');
      if (!flight) continue;

      const terrace = concept.elements.find(
        (element) => element.role === 'feature' && (element.elevation ?? 0) > 0,
      )!;

      const stepRing = geometryOutline(flight.shape);
      const terraceRing = geometryOutline(terrace.shape);

      expect(polygonsIntersect(stepRing, terraceRing)).toBe(false);

      /*
       * Touching: a corner of the flight sits on the terrace's *edge*, which is not the same as
       * sitting on one of its corners — the flight is capped at 2.4 m and a terrace is often much
       * wider, so it lands in the middle of a side. Measured to the segment, not to the vertex.
       */
      const toSegment = (
        p: { x: number; y: number },
        a: { x: number; y: number },
        b: { x: number; y: number },
      ) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      };

      const gap = Math.min(
        ...stepRing.map((point) =>
          Math.min(
            ...terraceRing.map((a, i) =>
              toSegment(point, a, terraceRing[(i + 1) % terraceRing.length]!),
            ),
          ),
        ),
      );
      expect(gap).toBeLessThan(0.05);
    }
  });

  it('edges the beds but never a base fill', async () => {
    /*
     * The one rule that matters here, and it fails silently if broken. A base fill is the *whole
     * zone polygon*, so its outline carries the zone's internal cross-fences as well as its
     * perimeter — and `edgingRuns` only drops the sides against the boundary and the house. Edging
     * one would therefore draw a brick course straight across the middle of the garden, where the
     * side return meets the back, and nothing downstream would object.
     */
    const concepts = await service.generate(
      plan({ brief: { ...brief, style: 'formal', budget: 'high' } }),
      11,
    );

    let edged = 0;
    for (const concept of concepts) {
      for (const element of concept.elements) {
        if (!element.edging) continue;
        edged += 1;

        expect(element.fillKind, `${element.id} is a base fill`).not.toBe('base');
        expect(['planting-bed', 'gravel-mulch']).toContain(element.category);
        expect(element.shape.kind).not.toBe('point');
      }
    }

    // A formal brief on a high budget is exactly the case that asks for edging.
    expect(edged).toBeGreaterThan(0);
  });

  it('leaves the fence side of a border out of the schedule', async () => {
    /*
     * The derivation earning its place. A border runs to the boundary, so a third of its perimeter
     * is against the fence — and a course buried in the fence line is one nobody lays and nobody
     * can see, but which would be ordered and paid for.
     */
    const document = plan({ brief: { ...brief, style: 'formal', budget: 'high' } });
    const [concept] = await service.generate(document, 11);

    const withFence = edgingRuns(concept!.elements, { boundary: document.site.vertices });
    const withoutFence = edgingRuns(concept!.elements);

    const total = (runs: { length: number }[]) => runs.reduce((sum, run) => sum + run.length, 0);

    expect(withFence.length).toBeGreaterThan(0);
    expect(total(withFence)).toBeLessThan(total(withoutFence));
  });

  it('specifies a lighting scheme, on the plot and clear of the house', async () => {
    /*
     * The scheme is placed last and against things already there — beside a tree, along a path —
     * so it is the one pass that could silently walk a fitting off the plot or into the building.
     * Neither is allowed, even though lighting is exempt from the disjointness rule above.
     */
    const document = plan();
    const house = housePolygon(document.site.house!);
    const concepts = await service.generate(document, 11);

    let seen = 0;
    for (const concept of concepts) {
      const lights = concept.elements.filter((element) => element.category === 'lighting');

      for (const light of lights) {
        seen += 1;
        expect(light.symbol).toBeDefined();
        expect(light.material).toBeDefined();
        expect(canTake('lighting', light.material!)).toBe(true);

        const outline = geometryOutline(light.shape);
        expect(polygonContainsPolygon(document.site.vertices, outline)).toBe(true);
        expect(polygonsIntersect(outline, house)).toBe(false);
      }
    }

    // The fixture has trees and a front path, so every concept has something worth lighting.
    expect(seen).toBeGreaterThan(0);
  });

  it('specifies no lighting at all on a low budget', async () => {
    // Lighting is a real cost with a real trench in it. A low-budget concept that quietly listed
    // a dozen fittings would be misreporting what it costs to build.
    const concepts = await service.generate(plan({ brief: { ...brief, budget: 'low' } }), 11);

    for (const concept of concepts) {
      expect(concept.elements.filter((element) => element.category === 'lighting')).toEqual([]);
    }
  });

  it('counts lighting in items rather than in square metres', async () => {
    // The reason lighting is a `COUNTED_CATEGORY`: "0.02 m² of powder-coated black" is not a line
    // anyone can order against, and the area would be noise in the ground totals besides.
    const [concept] = await service.generate(plan(), 11);
    const line = planSchedule(concept!.elements).find((entry) => entry.category === 'lighting');

    if (line) {
      expect(line.areaSqm).toBe(0);
      expect(line.units).toBe(line.elementCount);
      expect(line.unitLabel).toMatch(/item/);
    }
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

    /*
     * The counted categories are excluded because they stand *on* other things by design, which is
     * what `COUNTED_CATEGORIES` means: furniture sits on its host (see the test above), and a
     * lighting scheme is fittings standing among the planting and beside the paths they light.
     * Everything measured in square metres is still held to being disjoint and clear of the house.
     */
    const placed = concept!.elements.filter(
      (element) =>
        element.role === 'feature' &&
        element.category !== 'existing-feature' &&
        !isCounted(element.category),
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

  describe('the redesign area', () => {
    /**
     * Inside the back garden, reaching the garden door at (10, 10) so the layout grammar still
     * runs, and clear of all four fences so `borderRegions` is genuinely exercised and genuinely
     * clipped. The front zone falls outside it entirely, so a whole zone drops out of the design.
     */
    const area = [
      { x: 3, y: 8 },
      { x: 17, y: 8 },
      { x: 17, y: 17 },
      { x: 3, y: 17 },
    ];

    function scoped(polygon = area): PlanDocument {
      const base = plan();
      return { ...base, site: { ...base.site, scopePolygon: polygon } };
    }

    /*
     * The claim the redesign area makes, checked the only way that cannot be fooled by a
     * tessellated circle or a hairline bulge: union everything generated, subtract the area the
     * user drew, and demand nothing is left. One query, every element kind at once, so it fails
     * loudly for a single stray light fitting rather than silently for a bed the eye would miss.
     */
    it('never designs outside the area the user drew', async () => {
      const document = scoped();

      for (const seed of [1, 2, 3]) {
        for (const concept of await service.generate(document, seed)) {
          const rings = concept.elements.map((element) => geometryOutline(element.shape));
          expect(rings.length).toBeGreaterThan(0);

          const [row] = await connection!.db.execute<{ outside: number }>(sql`
            SELECT ST_Area(ST_Difference(
              ST_UnaryUnion(ST_Collect(ARRAY[${sql.join(
                rings.map(
                  (ring) => sql`ST_MakeValid(ST_GeomFromText(${polygonToWkt(ring)}::text))`,
                ),
                sql`, `,
              )}])),
              ST_GeomFromText(${polygonToWkt(area)}::text)
            ))::float8 AS outside
          `);

          // A hundredth of a square metre — a 120th of MIN_FILL_AREA, so nothing visible passes.
          expect(row!.outside).toBeLessThan(0.01);
        }
      }
    });

    it('still draws a garden rather than emptying the plan', async () => {
      const [concept] = await service.generate(scoped(), 5);

      expect(concept!.elements.length).toBeGreaterThan(3);
      expect(concept!.elements.some((element) => element.role === 'feature')).toBe(true);
    });

    it('generates a plan the validator that guards its own save accepts', async () => {
      const document = scoped();

      for (const concept of await service.generate(document, 4)) {
        const result = await validation.validate({
          ...document,
          layout: { elements: concept.elements, seededFrom: concept.id, pristine: null },
        });

        expect(result.violations).toEqual([]);
      }
    });

    /*
     * The structural half of the backward-compatibility guarantee. A plan with no drawn area must
     * not merely produce the same picture — it must run the same code, which means the clip query
     * is never issued. This is the test that fails the day somebody "simplifies" the null branch
     * into `scopePolygon ?? boundary`, which would re-simplify every zone and move coordinates on
     * every stored plan.
     */
    it('issues no clip at all when no area was drawn', async () => {
      const clip = vi.spyOn(fill, 'clipRingsTo');
      const room = vi.spyOn(fill, 'clipTo');

      await service.generate(plan(), 9);
      expect(clip).not.toHaveBeenCalled();

      // `clipTo` still has its original caller — the curved template's lawn — so it is the
      // scope-inset call specifically that must be absent.
      for (const call of room.mock.calls) expect(call[2]).not.toBe(SCOPE_INSET);

      clip.mockRestore();
      room.mockRestore();
    });

    /*
     * An area that does not reach the garden door cannot have a terrace at the doors, and the
     * concept says so rather than drawing a garden with no way out of the house. This pins the
     * MIN_ROOM_AREA fallback the whole design leans on.
     */
    it('says so when the drawn area leaves no room at the doors', async () => {
      const far = [
        { x: 4, y: 15 },
        { x: 16, y: 15 },
        { x: 16, y: 18 },
        { x: 4, y: 18 },
      ];

      const [concept] = await service.generate(scoped(far), 6);

      expect(concept!.summary).toContain('no clear room for a terrace');
    });
  });
});

if (connection === null) {
  describe('ConceptsService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
