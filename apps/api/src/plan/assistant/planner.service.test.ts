import {
  PlanDocumentSchema,
  elementAnchor,
  type DesignElement,
  type DesignIntent,
  type PlanDocument,
} from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlannerService } from './planner.service.js';
import { PlacementService } from '../generation/placement.service.js';
import { connectTestDatabase, DB_UNAVAILABLE_MESSAGE, type TestDatabase } from '../../test/db.js';

const connection = await connectTestDatabase();

/**
 * This suite is the argument for the whole hybrid split.
 *
 * Because `DesignIntent` is plain data with no coordinates in it, the half of the assistant that
 * actually decides where things go can be tested exhaustively with **no model involved at all** —
 * feed it intents, assert the changes. The model's only job is to produce these objects, and that
 * is tested separately against a fake.
 */

function element(overrides: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    category: 'paved-area',
    role: 'feature',
    name: overrides.id,
    zone: 'front',
    shape: { kind: 'rect', centre: { x: 5, y: 12 }, width: 4, depth: 3, rotation: 0 },
    ...overrides,
  };
}

/** A 20 x 16 plot with an 8 x 6 house across the top, both gardens in scope. */
function plan(elements: DesignElement[]): PlanDocument {
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
    layout: { elements },
  });
}

const patio = element({
  id: 'e-1',
  name: 'Seating patio',
  category: 'paved-area',
  material: 'stone-pavers',
  shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 5, depth: 4, rotation: 0 },
});

/** The ground cover a whole zone sits on: selectable, recolourable, but not reshapable. */
const baseFill = element({
  id: 'e-base',
  name: undefined,
  category: 'lawn',
  role: 'fill',
  fillKind: 'base',
  material: 'standard-turf',
  shape: {
    kind: 'polygon',
    cornerRadius: 0,
    points: [
      { x: 0, y: 8 },
      { x: 20, y: 8 },
      { x: 20, y: 16 },
      { x: 0, y: 16 },
    ],
  },
});

describe.skipIf(connection === null)('PlannerService', () => {
  let planner: PlannerService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    planner = new PlannerService(new PlacementService(db.db));
  });

  afterAll(async () => {
    await db?.close();
  });

  /* ---------------------------------------------------------------- resize */

  it('resizes by the requested factor when there is room', async () => {
    const intent: DesignIntent = { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 1.2 };

    const { changes } = await planner.plan(plan([patio]), [intent]);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('resize');
    expect(changes[0]!.before).toContain('5.0');
    expect(changes[0]!.after).toContain('6.0');
    // The element it would replace comes along, so the store can spot a stale proposal.
    expect(changes[0]!.previous?.id).toBe('e-1');
  });

  /*
   * "As big as it will go" is what the user meant. Refusing outright because their number was
   * ambitious would be technically correct and useless.
   */
  it('searches the factor down when the full one will not fit', async () => {
    const wide = element({
      id: 'e-1',
      name: 'Wide terrace',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 18, depth: 4, rotation: 0 },
    });

    const { changes, unplaceable } = await planner.plan(plan([wide]), [
      { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 4 },
    ]);

    expect(unplaceable).toEqual([]);
    expect(changes).toHaveLength(1);

    const next = changes[0]!.next.shape;
    expect(next.kind).toBe('rect');
    if (next.kind === 'rect') {
      expect(next.width).toBeGreaterThan(18);
      // Nowhere near four times, because the plot is only 20 m across.
      expect(next.width).toBeLessThan(20);
    }
  });

  it('refuses a resize that cannot happen at all', async () => {
    // Already flush with the boundary on both sides.
    const full = element({
      id: 'e-1',
      name: 'Full-width terrace',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 20, depth: 4, rotation: 0 },
    });

    const { changes, unplaceable } = await planner.plan(plan([full]), [
      { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 2 },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toContain('no room');
  });

  it('will not reshape the ground cover', async () => {
    const { changes, unplaceable } = await planner.plan(plan([baseFill]), [
      { kind: 'resize', target: { elementIds: ['e-base'] }, factor: 1.5 },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toContain('ground cover');
  });

  /* ---------------------------------------------------------------- move */

  it('moves towards the house and stops before touching it', async () => {
    const { changes } = await planner.plan(plan([patio]), [
      { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: false },
    ]);

    expect(changes).toHaveLength(1);

    const before = elementAnchor(patio);
    const after = elementAnchor(changes[0]!.next);
    // The house centre is at y = 4, so moving towards it means moving up the plan.
    expect(after.y).toBeLessThan(before.y);
  });

  it('moves away from the house in the other direction', async () => {
    const { changes } = await planner.plan(plan([patio]), [
      { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: true },
    ]);

    expect(elementAnchor(changes[0]!.next).y).toBeGreaterThan(elementAnchor(patio).y);
  });

  it('says so when a shape is already as far as it goes', async () => {
    // Hard against the bottom fence, asked to go further from the house.
    const cornered = element({
      id: 'e-1',
      name: 'Corner patio',
      shape: { kind: 'rect', centre: { x: 10, y: 14 }, width: 4, depth: 4, rotation: 0 },
    });

    const { changes, unplaceable } = await planner.plan(plan([cornered]), [
      { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: true },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toContain('as far');
  });

  it('will not move the ground cover', async () => {
    const { unplaceable } = await planner.plan(plan([baseFill]), [
      { kind: 'move', target: { elementIds: ['e-base'] }, towards: 'house', away: false },
    ]);

    expect(unplaceable[0]!.reason).toContain('ground cover');
  });

  /* ---------------------------------------------------------------- material */

  it('changes a material within the category', async () => {
    const { changes } = await planner.plan(plan([patio]), [
      { kind: 'material', target: { elementIds: ['e-1'] }, materialId: 'gravel-paving' },
    ]);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.before).toBe('Natural stone pavers');
    expect(changes[0]!.after).toBe('Gravel');
    expect(changes[0]!.next.material).toBe('gravel-paving');
  });

  /* There is no such thing as a gravel lawn. */
  it('refuses a material that does not belong to the category', async () => {
    const { changes, unplaceable } = await planner.plan(plan([patio]), [
      { kind: 'material', target: { elementIds: ['e-1'] }, materialId: 'standard-turf' },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toContain('paved area material');
  });

  /* The one thing that may be done to locked ground: turn the lawn into gravel. */
  it('allows the ground cover to change material', async () => {
    const { changes, unplaceable } = await planner.plan(plan([baseFill]), [
      { kind: 'material', target: { elementIds: ['e-base'] }, materialId: 'wildflower' },
    ]);

    expect(unplaceable).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.next.material).toBe('wildflower');
  });

  it('proposes nothing when the material is already what was asked for', async () => {
    const { changes } = await planner.plan(plan([patio]), [
      { kind: 'material', target: { elementIds: ['e-1'] }, materialId: 'stone-pavers' },
    ]);

    expect(changes).toEqual([]);
  });

  /* ---------------------------------------------------------------- remove */

  it('proposes a removal', async () => {
    const { changes } = await planner.plan(plan([patio]), [
      { kind: 'remove', target: { elementIds: ['e-1'] } },
    ]);

    expect(changes[0]!.kind).toBe('remove');
    expect(changes[0]!.after).toBe('Removed');
    // The element travels with it, so an undo has something to put back.
    expect(changes[0]!.next.id).toBe('e-1');
  });

  it('refuses to remove the ground cover, and suggests the thing that is allowed', async () => {
    const { changes, unplaceable } = await planner.plan(plan([baseFill]), [
      { kind: 'remove', target: { elementIds: ['e-base'] } },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toContain('Change what it is made of');
  });

  /* ---------------------------------------------------------------- add */

  it('finds a spot for something new', async () => {
    const { changes, unplaceable } = await planner.plan(plan([patio]), [
      {
        kind: 'add',
        category: 'structure',
        name: 'Garden store',
        footprint: { kind: 'rect', width: 2.5, depth: 2 },
        affinity: 'far-from-house',
      },
    ]);

    expect(unplaceable).toEqual([]);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('add');
    expect(changes[0]!.elementId).toBeNull();
    expect(changes[0]!.previous).toBeNull();
    expect(changes[0]!.next.name).toBe('Garden store');
    // Given a default material rather than left blank, as the editor's own add does.
    expect(changes[0]!.next.material).toBe('softwood');
  });

  /*
   * The honest refusal. A garden with no room left has to produce a reason the user can read, not a
   * silently missing change — and certainly not an invented position.
   */
  it('declines to add something that will not fit, and says why', async () => {
    const { changes, unplaceable } = await planner.plan(plan([patio]), [
      {
        kind: 'add',
        category: 'structure',
        name: 'Enormous shed',
        footprint: { kind: 'rect', width: 19, depth: 19 },
        affinity: 'any',
      },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.description).toContain('Enormous shed');
    expect(unplaceable[0]!.reason).toContain('no clear');
  });

  it('refuses a zone that is not being designed', async () => {
    const document = plan([patio]);
    document.site.selectedZoneIds = ['back'];

    const { unplaceable } = await planner.plan(document, [
      {
        kind: 'add',
        category: 'structure',
        name: 'Front bench',
        footprint: { kind: 'rect', width: 1.5, depth: 0.5 },
        zone: 'front',
        affinity: 'any',
      },
    ]);

    expect(unplaceable[0]!.reason).toContain('not one of the areas');
  });

  /* ---------------------------------------------------------------- reduce cost */

  it('swaps the dearest big surfaces for cheaper ones, biggest saving first', async () => {
    const small = element({
      id: 'e-2',
      name: 'Stepping stones',
      material: 'porcelain',
      shape: { kind: 'rect', centre: { x: 3, y: 14 }, width: 1, depth: 1, rotation: 0 },
    });

    const { changes } = await planner.plan(plan([patio, small]), [
      { kind: 'reduce-cost', maxChanges: 5 },
    ]);

    expect(changes.length).toBeGreaterThan(0);
    // The 5 x 4 terrace is worth more than the 1 x 1 stones, so it leads.
    expect(changes[0]!.elementId).toBe('e-1');
    expect(changes.every((entry) => entry.kind === 'material')).toBe(true);
  });

  it('respects the change limit', async () => {
    const many = [
      patio,
      element({ id: 'e-2', material: 'porcelain' }),
      element({ id: 'e-3', material: 'timber-decking' }),
    ];

    const { changes } = await planner.plan(plan(many), [{ kind: 'reduce-cost', maxChanges: 1 }]);

    expect(changes).toHaveLength(1);
  });

  it('says so when nothing can be made cheaper', async () => {
    const cheapest = element({ id: 'e-1', name: 'Gravel yard', material: 'gravel-paving' });

    const { changes, unplaceable } = await planner.plan(plan([cheapest]), [
      { kind: 'reduce-cost', maxChanges: 5 },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toContain('already the cheapest');
  });

  /* ---------------------------------------------------------------- resolution */

  /*
   * A model that names an element which is not there gets nothing, not a guess. Silently acting on
   * the nearest match would be worse than doing nothing.
   */
  it('drops an id that names nothing', async () => {
    const { changes, unplaceable } = await planner.plan(plan([patio]), [
      { kind: 'resize', target: { elementIds: ['e-nope'] }, factor: 1.2 },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable).toEqual([]);
  });

  it('acts on each element a single intent names', async () => {
    const second = element({
      id: 'e-2',
      name: 'Side path',
      material: 'porcelain',
      shape: { kind: 'rect', centre: { x: 3, y: 14 }, width: 1, depth: 1, rotation: 0 },
    });

    const { changes } = await planner.plan(plan([patio, second]), [
      { kind: 'material', target: { elementIds: ['e-1', 'e-2'] }, materialId: 'concrete' },
    ]);

    expect(changes.map((entry) => entry.elementId)).toEqual(['e-1', 'e-2']);
  });

  it('gives every change a distinct id, across intents', async () => {
    const { changes } = await planner.plan(plan([patio]), [
      { kind: 'material', target: { elementIds: ['e-1'] }, materialId: 'concrete' },
      { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 1.1 },
    ]);

    expect(new Set(changes.map((entry) => entry.id)).size).toBe(changes.length);
  });

  /*
   * Everything proposed is legal by the same predicate the canvas and the PostGIS validator use, so
   * the store's re-check on apply should never have anything to reject. It re-checks anyway — the
   * filter is a courtesy, the store is the guarantee — but a proposal that failed it would mean the
   * user watched a line vanish for no stated reason.
   */
  it('never proposes anything the editor would refuse', async () => {
    const intents: DesignIntent[] = [
      { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 3 },
      { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'boundary', away: false },
      {
        kind: 'add',
        category: 'water-feature',
        name: 'Pond',
        footprint: { kind: 'point', radius: 1 },
        affinity: 'any',
      },
    ];

    const document = plan([patio, baseFill]);
    const { changes } = await planner.plan(document, intents);

    const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    const { geometryIsLegal, housePolygon } = await import('@garden-studio/schema');
    const house = housePolygon(document.site.house!);

    for (const entry of changes) {
      if (entry.kind === 'remove' || entry.kind === 'material') continue;
      expect(geometryIsLegal(entry.next.shape, house, boundary)).toBe(true);
    }
  });
});

if (connection === null) {
  describe('PlannerService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
