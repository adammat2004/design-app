import {
  PlanDocumentSchema,
  geometryFitsInside,
  type DesignElement,
  type PlacedFeature,
  type PlanDocument,
  type PlanGeometry,
  type Point,
} from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GeometryValidationService } from './geometry-validation.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../test/db.js';

const connection = await connectTestDatabase();

/** A 10m x 8m rectangular property. */
const vertices = [
  { id: 'v1', x: 0, y: 0 },
  { id: 'v2', x: 10, y: 0 },
  { id: 'v3', x: 10, y: 8 },
  { id: 'v4', x: 0, y: 8 },
];

const boundary: Point[] = vertices.map(({ x, y }) => ({ x, y }));

function plan(overrides: {
  site?: Partial<PlanDocument['site']>;
  features?: PlacedFeature[];
  elements?: DesignElement[];
}): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: { vertices, closed: true, house: null, selectedZoneIds: [], ...overrides.site },
    features: { features: overrides.features ?? [], skipped: false },
    layout: { elements: overrides.elements ?? [] },
  });
}

/** Centre-anchored, so `shed('a', 2, 2)` spans x 1..3 and y 1..3. */
function shed(id: string, x: number, y: number, width = 2, depth = 2): PlacedFeature {
  return {
    id,
    kind: 'shed',
    name: id,
    geometry: { kind: 'rect', centre: { x, y }, width, depth, rotation: 0 },
    status: 'keep',
    replaceWith: null,
  };
}

function tree(id: string, x: number, y: number, radius = 1): PlacedFeature {
  return {
    id,
    kind: 'tree',
    name: id,
    geometry: { kind: 'point', at: { x, y }, radius },
    status: 'keep',
    replaceWith: null,
  };
}

function path(id: string, points: Point[], width: number): PlacedFeature {
  return {
    id,
    kind: 'path',
    name: id,
    geometry: { kind: 'polyline', points, width },
    status: 'keep',
    replaceWith: null,
  };
}

function patio(id: string, points: Point[], cornerRadius: number): PlacedFeature {
  return {
    id,
    kind: 'patio',
    name: id,
    geometry: { kind: 'polygon', points, cornerRadius },
    status: 'keep',
    replaceWith: null,
  };
}

function element(id: string, shape: PlanGeometry): DesignElement {
  return { id, category: 'paved-area', role: 'feature', name: id, shape, zone: 'back' };
}

/** A 4m x 3m house centred wherever it is put, unrotated unless asked. */
function house(x: number, y: number, rotation = 0) {
  return {
    outline: [
      { id: 'h0', x: -2, y: -1.5 },
      { id: 'h1', x: 2, y: -1.5 },
      { id: 'h2', x: 2, y: 1.5 },
      { id: 'h3', x: -2, y: 1.5 },
    ],
    centre: { x, y },
    rotation,
  };
}

describe.skipIf(connection === null)('GeometryValidationService', () => {
  let service: GeometryValidationService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    service = new GeometryValidationService(db.db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('accepts a plan where every feature sits inside the boundary and nothing overlaps', async () => {
    const result = await service.validate(
      plan({ features: [shed('shed-1', 2, 2), tree('tree-1', 8, 6)] }),
    );

    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a plan with nothing placed at all', async () => {
    expect((await service.validate(plan({}))).valid).toBe(true);
  });

  it('refuses to look at a boundary that was never closed', async () => {
    const result = await service.validate(plan({ site: { closed: false } }));

    expect(result.valid).toBe(false);
    expect(result.violations[0]!.code).toBe('boundary_not_closed');
    expect(result.violations[0]!.section).toBe('site');
  });

  it('flags a self-intersecting boundary', async () => {
    const bowtie = [
      { id: 'v1', x: 0, y: 0 },
      { id: 'v2', x: 10, y: 10 },
      { id: 'v3', x: 10, y: 0 },
      { id: 'v4', x: 0, y: 10 },
    ];

    const result = await service.validate(plan({ site: { vertices: bowtie } }));

    expect(result.violations.map((v) => v.code)).toContain('invalid_boundary');
  });

  it('flags a feature that pokes out over the boundary', async () => {
    // The property is 10m wide, so a 2m shed centred at x=10 hangs 1m over the fence.
    const result = await service.validate(plan({ features: [shed('shed-1', 10, 2)] }));

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.code).toBe('feature_outside_boundary');
    expect(result.violations[0]!.targetIds).toEqual(['shed-1']);
    expect(result.violations[0]!.section).toBe('features');
  });

  it('flags a feature entirely outside the boundary', async () => {
    const result = await service.validate(plan({ features: [tree('tree-1', 50, 50)] }));

    expect(result.violations.map((v) => v.code)).toContain('feature_outside_boundary');
  });

  it('flags two partially overlapping features', async () => {
    const result = await service.validate(
      plan({ features: [shed('shed-1', 2, 2), shed('shed-2', 3, 3)] }),
    );

    const overlap = result.violations.find((v) => v.code === 'features_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.targetIds.sort()).toEqual(['shed-1', 'shed-2']);
  });

  it('flags a feature that sits entirely inside another', async () => {
    // This is the case ST_Overlaps would silently pass: containment is not "overlap" to
    // PostGIS, so a small shed dropped fully inside a large patio would have validated
    // clean. ST_Intersects minus ST_Touches catches it.
    const outer = shed('patio-1', 4, 4, 6, 6);
    const inner = shed('shed-1', 2.5, 2.5, 1, 1);

    const result = await service.validate(plan({ features: [outer, inner] }));

    const overlap = result.violations.find((v) => v.code === 'features_overlap');
    expect(overlap).toBeDefined();
    expect(overlap!.targetIds.sort()).toEqual(['patio-1', 'shed-1']);
  });

  it('allows two features that touch edge to edge without sharing interior space', async () => {
    // shed-1 spans x 1..3, shed-2 spans x 3..5. Touching is not overlapping.
    const result = await service.validate(
      plan({ features: [shed('shed-1', 2, 2), shed('shed-2', 4, 2)] }),
    );

    expect(result.violations).toEqual([]);
  });

  it('reports each overlapping pair once, not twice', async () => {
    const result = await service.validate(
      plan({ features: [shed('shed-1', 2, 2), shed('shed-2', 3, 3)] }),
    );

    expect(result.violations.filter((v) => v.code === 'features_overlap')).toHaveLength(1);
  });

  it('reports an out-of-bounds feature and an overlap together', async () => {
    const result = await service.validate(
      plan({ features: [shed('shed-1', 2, 2), shed('shed-2', 3, 3), tree('tree-1', 50, 50)] }),
    );

    expect(result.violations.map((v) => v.code).sort()).toEqual([
      'feature_outside_boundary',
      'features_overlap',
    ]);
  });

  /* ---------------------------------------------------------------- the house as a shape */

  it('accepts a house sitting inside the property', async () => {
    expect((await service.validate(plan({ site: { house: house(5, 2) } }))).valid).toBe(true);
  });

  it('flags a house hanging over the boundary', async () => {
    const result = await service.validate(plan({ site: { house: house(9.5, 2) } }));

    expect(result.violations.map((v) => v.code)).toContain('house_outside_boundary');
    expect(result.violations[0]!.section).toBe('site');
  });

  it('flags a rotated house whose corner swings out over the boundary', async () => {
    // Square on, the 4x3 house spans x 0..4 — flush against the fence and legal. Turned 45
    // degrees about the same centre its corners reach 2.475m out, so it no longer fits.
    const squareOn = await service.validate(plan({ site: { house: house(2, 4) } }));
    const turned = await service.validate(plan({ site: { house: house(2, 4, 45) } }));

    expect(squareOn.violations).toEqual([]);
    expect(turned.violations.map((v) => v.code)).toContain('house_outside_boundary');
  });

  it('allows a feature butting flush against the house wall', async () => {
    // The house spans y 0.5..3.5; the patio starts exactly at y=3.5.
    const result = await service.validate(
      plan({ site: { house: house(5, 2) }, features: [shed('patio-1', 5, 4.5, 4, 2)] }),
    );

    expect(result.violations).toEqual([]);
  });

  it('flags a feature sharing interior space with the house', async () => {
    const result = await service.validate(
      plan({ site: { house: house(5, 2) }, features: [shed('shed-1', 5, 3, 2, 2)] }),
    );

    const onHouse = result.violations.find((v) => v.code === 'feature_on_house');
    expect(onHouse).toBeDefined();
    expect(onHouse!.targetIds).toEqual(['shed-1']);
  });

  /* ---------------------------------------------------------------- the new geometry kinds */

  it('flags a path whose strip crosses the fence even though every point is inside', async () => {
    /*
     * A point-only test would miss this entirely: both vertices sit at y = 0.4, inside the
     * property, but the 1m-wide ribbon they describe reaches y = -0.1. This is the case the
     * shared `polylineStrip` tessellation exists for.
     */
    const result = await service.validate(
      plan({
        features: [
          path(
            'path-1',
            [
              { x: 2, y: 0.4 },
              { x: 8, y: 0.4 },
            ],
            1,
          ),
        ],
      }),
    );

    expect(result.violations.map((v) => v.code)).toContain('feature_outside_boundary');
  });

  it('accepts a path whose strip clears the fence', async () => {
    const result = await service.validate(
      plan({
        features: [
          path(
            'path-1',
            [
              { x: 2, y: 1 },
              { x: 8, y: 1 },
            ],
            1,
          ),
        ],
      }),
    );

    expect(result.violations).toEqual([]);
  });

  it('accepts a rounded patio flush against the fence, because rounding only ever cuts inwards', async () => {
    const corners = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 4 },
      { x: 0, y: 4 },
    ];

    const square = await service.validate(plan({ features: [patio('patio-1', corners, 0)] }));
    const rounded = await service.validate(plan({ features: [patio('patio-1', corners, 1)] }));

    expect(square.violations).toEqual([]);
    expect(rounded.violations).toEqual([]);
  });

  /*
   * The regression the shared `circleRing` was introduced to prevent. The canvas used to draw a
   * point feature as an octagon while the validator buffered a 64-gon, so the server's circle
   * was up to 7.6% of the radius larger and could reject a tree the user could see was inside
   * the fence. Both sides now tessellate identically, so the two predicates must agree —
   * whatever the answer is.
   */
  it('agrees with the client predicate about a tree near the fence', async () => {
    for (const x of [0.9, 0.95, 1, 1.05]) {
      const feature = tree('tree-1', x, 4);
      const server = await service.validate(plan({ features: [feature] }));
      const client = geometryFitsInside(feature.geometry, boundary);

      expect(server.violations.some((v) => v.code === 'feature_outside_boundary')).toBe(!client);
    }
  });

  /* ---------------------------------------------------------------- layout elements */

  it('flags a layout element hanging over the boundary', async () => {
    const result = await service.validate(
      plan({
        elements: [
          element('e-1', {
            kind: 'rect',
            centre: { x: 10, y: 4 },
            width: 4,
            depth: 2,
            rotation: 0,
          }),
        ],
      }),
    );

    const violation = result.violations.find((v) => v.code === 'element_outside_boundary');
    expect(violation).toBeDefined();
    expect(violation!.section).toBe('layout');
  });

  /*
   * Deliberately NOT a violation. A concept stacks a pergola on a patio on a base fill by
   * design, so flagging overlapping elements would flag every correct concept.
   */
  it('allows layout elements to overlap each other', async () => {
    const result = await service.validate(
      plan({
        elements: [
          element('e-1', { kind: 'rect', centre: { x: 5, y: 4 }, width: 6, depth: 4, rotation: 0 }),
          element('e-2', { kind: 'rect', centre: { x: 5, y: 4 }, width: 2, depth: 2, rotation: 0 }),
        ],
      }),
    );

    expect(result.violations).toEqual([]);
  });

  it('flags a layout element sitting on the house', async () => {
    const result = await service.validate(
      plan({
        site: { house: house(5, 2) },
        elements: [
          element('e-1', { kind: 'rect', centre: { x: 5, y: 2 }, width: 2, depth: 2, rotation: 0 }),
        ],
      }),
    );

    expect(result.violations.map((v) => v.code)).toContain('element_on_house');
  });

  it('names the shapes it is complaining about', async () => {
    const result = await service.validate(
      plan({ site: { house: house(5, 2) }, features: [shed('shed-1', 5, 3, 2, 2)] }),
    );

    expect(result.violations[0]!.message).toContain('shed-1');
  });
});

if (connection === null) {
  describe('GeometryValidationService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
