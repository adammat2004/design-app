import {
  PlanDocumentSchema,
  distanceToSegment,
  elementAnchor,
  geometryIsLegal,
  geometryOutline,
  pointInPolygon,
  polygonsIntersect,
  polylineLength,
  type DesignElement,
  type DesignIntent,
  type PlanDocument,
  type PlanGeometry,
} from '@garden-studio/schema';
import { offBearing } from '../generation/design/bearing.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PlannerService } from './planner.service.js';
import { FillService } from '../generation/fill.service.js';
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
    planner = new PlannerService(new PlacementService(db.db), new FillService(db.db));
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
    const { geometryIsLegal } = await import('@garden-studio/schema');

    for (const entry of changes) {
      if (entry.kind === 'remove' || entry.kind === 'material') continue;
      expect(geometryIsLegal(entry.next.shape, boundary)).toBe(true);
    }
  });
  /* ---------------------------------------------------------------- the vocabulary added later */

  /*
   * Three things a user asks for constantly that the first seven intents could not say. Each is one
   * intent, one planner branch and one line of the diff — and none of them can hold a coordinate,
   * which is the property the whole split rests on.
   */
  describe('reshape', () => {
    /** A border along the back fence: wide, shallow, and the thing people ask to deepen. */
    const border = element({
      id: 'e-bed',
      name: 'Rear border',
      category: 'planting-bed',
      role: 'fill',
      fillKind: 'accent',
      material: 'mixed-border',
      shape: {
        kind: 'polygon',
        cornerRadius: 0,
        points: [
          { x: 2, y: 14 },
          { x: 18, y: 14 },
          { x: 18, y: 15.5 },
          { x: 2, y: 15.5 },
        ],
      },
    });

    /** The lawn in front of it, which is where a deeper border has to take its ground from. */
    const lawn = element({
      id: 'e-lawn',
      name: 'Lawn',
      category: 'lawn',
      role: 'fill',
      fillKind: 'accent',
      material: 'standard-turf',
      shape: {
        kind: 'polygon',
        cornerRadius: 0,
        points: [
          { x: 2, y: 9 },
          { x: 18, y: 9 },
          { x: 18, y: 14 },
          { x: 2, y: 14 },
        ],
      },
    });

    /**
     * The whole reason `reshape` exists: a resize would make it longer as well.
     *
     * The ends stay exactly where they are, which on a real plan is where the paths meet it.
     */
    it('moves one side and leaves the others where they were', async () => {
      const intent: DesignIntent = {
        kind: 'reshape',
        target: { elementIds: ['e-bed'] },
        edge: 'towards-house',
        metres: 1.5,
      };

      const { changes } = await planner.plan(plan([border]), [intent]);

      const reshaped = changes.find((entry) => entry.elementId === 'e-bed')!;
      expect(reshaped.kind).toBe('reshape');

      const shape = reshaped.next.shape;
      if (shape.kind !== 'polygon') throw new Error('expected a polygon');

      /* The fence side has not moved; the house side has come forward by the metre and a half. */
      const ys = shape.points.map((point) => point.y).sort((a, b) => a - b);
      expect(ys[2]).toBeCloseTo(15.5, 6);
      expect(ys[3]).toBeCloseTo(15.5, 6);
      expect(ys[0]).toBeCloseTo(12.5, 6);

      /* And it is still 16 m across: no corner moved sideways. */
      const xs = shape.points.map((point) => point.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(16, 6);
    });

    /**
     * Both halves or neither.
     *
     * A border deepened into the lawn with the lawn left alone is two elements claiming one piece of
     * ground — and because the bed draws over the lawn it looks right, so nothing on screen would
     * say the plan had stopped being true.
     */
    it('takes the ground it gains off the thing beside it', async () => {
      const intent: DesignIntent = {
        kind: 'reshape',
        target: { elementIds: ['e-bed'] },
        edge: 'towards-house',
        metres: 1.5,
      };

      const { changes } = await planner.plan(plan([border, lawn]), [intent]);

      expect(changes.map((entry) => entry.elementId).sort()).toEqual(['e-bed', 'e-lawn']);

      const trimmed = changes.find((entry) => entry.elementId === 'e-lawn')!.next.shape;
      if (trimmed.kind !== 'polygon') throw new Error('expected a polygon');

      /* The lawn now stops where the deeper border starts. */
      expect(Math.max(...trimmed.points.map((point) => point.y))).toBeCloseTo(12.5, 1);
    });

    it('refuses to reshape the ground cover a whole area sits on', async () => {
      const intent: DesignIntent = {
        kind: 'reshape',
        target: { elementIds: ['e-base'] },
        edge: 'towards-house',
        metres: 1,
      };

      const { changes, unplaceable } = await planner.plan(plan([baseFill]), [intent]);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('ground cover');
    });

    it('refuses a shape with no drawn outline', async () => {
      const intent: DesignIntent = {
        kind: 'reshape',
        target: { elementIds: ['e-1'] },
        edge: 'towards-house',
        metres: 1,
      };

      const { changes, unplaceable } = await planner.plan(plan([patio]), [intent]);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('drawn outline');
    });

    it('refuses to push a side out through the fence', async () => {
      const intent: DesignIntent = {
        kind: 'reshape',
        target: { elementIds: ['e-bed'] },
        edge: 'away-from-house',
        metres: 4,
      };

      const { changes, unplaceable } = await planner.plan(plan([border]), [intent]);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('outside the boundary');
    });

    /*
     * Pulling a side back past the one opposite folds the outline through itself.
     *
     * A folded outline has a perfectly ordinary vertex list and a quietly wrong area, so nothing
     * downstream would report it — the same class of fault `setEdgeLength`'s bow-tie guard exists
     * for. Comparing the overall spread does not catch it: a 1.5 m border pulled back 3 m has a
     * spread of 1.5 again, with its two sides swapped.
     */
    it('refuses a pull-back that would fold it through itself', async () => {
      const intent: DesignIntent = {
        kind: 'reshape',
        target: { elementIds: ['e-bed'] },
        edge: 'away-from-house',
        metres: -3,
      };

      const { changes, unplaceable } = await planner.plan(plan([border]), [intent]);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('nothing of it');
    });
  });

  describe('attach', () => {
    /** A dining set standing on the patio, as the generator's `furnish` pass leaves one. */
    const diningSet = element({
      id: 'e-set',
      name: 'Dining set',
      category: 'furniture',
      symbol: 'dining-set',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 2.4, depth: 2.4, rotation: 0 },
    });

    /**
     * The single most useful thing the old vocabulary could not say.
     *
     * `attach` reads the host as the *request* will leave it, so it has to come after the move it
     * belongs to — which is why the two are asserted together rather than separately.
     */
    it('brings the furniture with the surface it stands on', async () => {
      const intents: DesignIntent[] = [
        { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: false },
        { kind: 'attach', target: { elementIds: ['e-1'] } },
      ];

      const { changes } = await planner.plan(plan([patio, diningSet]), intents);

      const moved = changes.find((entry) => entry.elementId === 'e-1')!;
      const set = changes.find((entry) => entry.elementId === 'e-set')!;
      expect(set).toBeDefined();

      /* It travelled exactly as far as the patio did, in the same direction. */
      const patioShift = elementAnchor(moved.next).y - elementAnchor(patio).y;
      const setShift = elementAnchor(set.next).y - elementAnchor(diningSet).y;
      expect(setShift).toBeCloseTo(patioShift, 6);
      expect(Math.abs(patioShift)).toBeGreaterThan(0);
    });

    it('says so when nothing is standing on it', async () => {
      const intents: DesignIntent[] = [
        { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: false },
        { kind: 'attach', target: { elementIds: ['e-1'] } },
      ];

      const { changes, unplaceable } = await planner.plan(plan([patio]), intents);

      expect(changes.some((entry) => entry.elementId === 'e-set')).toBe(false);
      expect(unplaceable[0]!.reason).toContain('nothing standing on it');
    });

    /**
     * Alone, or after a move the planner refused, it produces nothing and says why.
     *
     * A no-op line would be worse than silence: a change on the diff, an operation on the canvas
     * and a count in the outcome, all for nothing having happened.
     */
    it('emits nothing at all when the host did not move', async () => {
      const intents: DesignIntent[] = [{ kind: 'attach', target: { elementIds: ['e-1'] } }];

      const { changes, unplaceable } = await planner.plan(plan([patio, diningSet]), intents);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('has not moved');
    });

    /**
     * A host that shrank can leave a dining set half off the paving even after the shift.
     *
     * A set on the grass is worse than one that did not move: the user can see the second and would
     * not notice the first.
     */
    it('refuses to leave the furniture half off a host that shrank', async () => {
      /* Shrunk on its own, so the resize is not refused for clashing with the set standing on it. */
      const roomy = element({
        id: 'e-1',
        name: 'Seating patio',
        material: 'stone-pavers',
        shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 6, depth: 5, rotation: 0 },
      });
      const small = element({
        id: 'e-set',
        name: 'Bench',
        category: 'furniture',
        symbol: 'bench',
        shape: { kind: 'rect', centre: { x: 12.4, y: 12 }, width: 1, depth: 0.5, rotation: 0 },
      });

      const intents: DesignIntent[] = [
        { kind: 'resize', target: { elementIds: ['e-1'] }, factor: 0.5 },
        { kind: 'attach', target: { elementIds: ['e-1'] } },
      ];

      const { changes, unplaceable } = await planner.plan(plan([roomy, small]), intents);

      expect(changes.some((entry) => entry.elementId === 'e-1')).toBe(true);
      expect(changes.some((entry) => entry.elementId === 'e-set')).toBe(false);
      expect(unplaceable.some((entry) => entry.reason.includes('no longer room'))).toBe(true);
    });
  });

  describe('move towards another element', () => {
    const firePit = element({
      id: 'e-fire',
      name: 'Fire pit',
      category: 'water-feature',
      shape: { kind: 'point', at: { x: 3, y: 14 }, radius: 0.6 },
    });

    /* "Nearer the seating" is the commonest placement request there is, and had no expression. */
    it('moves it nearer the thing it was told to', async () => {
      const intent: DesignIntent = {
        kind: 'move',
        target: { elementIds: ['e-fire'] },
        towards: 'element',
        elementId: 'e-1',
        away: false,
      };

      const { changes } = await planner.plan(plan([patio, firePit]), [intent]);

      expect(changes).toHaveLength(1);
      const before = Math.hypot(3 - 10, 14 - 12);
      const after = Math.hypot(
        elementAnchor(changes[0]!.next).x - 10,
        elementAnchor(changes[0]!.next).y - 12,
      );
      expect(after).toBeLessThan(before);
    });

    it('moves it away when asked to', async () => {
      const intent: DesignIntent = {
        kind: 'move',
        target: { elementIds: ['e-fire'] },
        towards: 'element',
        elementId: 'e-1',
        away: true,
      };

      const { changes } = await planner.plan(plan([patio, firePit]), [intent]);

      const before = Math.hypot(3 - 10, 14 - 12);
      const after = Math.hypot(
        elementAnchor(changes[0]!.next).x - 10,
        elementAnchor(changes[0]!.next).y - 12,
      );
      expect(after).toBeGreaterThan(before);
    });

    /* A move towards itself has no direction, and the ladder would report a useless refusal. */
    it('refuses to move a thing towards itself', async () => {
      const intent: DesignIntent = {
        kind: 'move',
        target: { elementIds: ['e-fire'] },
        towards: 'element',
        elementId: 'e-fire',
        away: false,
      };

      const { changes, unplaceable } = await planner.plan(plan([patio, firePit]), [intent]);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('nothing to move it towards');
    });

    it('refuses an id that names nothing', async () => {
      const intent: DesignIntent = {
        kind: 'move',
        target: { elementIds: ['e-fire'] },
        towards: 'element',
        elementId: 'e-nowhere',
        away: false,
      };

      const { changes, unplaceable } = await planner.plan(plan([patio, firePit]), [intent]);

      expect(changes).toEqual([]);
      expect(unplaceable[0]!.reason).toContain('nothing to move it towards');
    });
  });

  /* ---------------------------------------------------------------- reroute */

  /*
   * The store at the far end with a path that wanders out to it round the left, which is the shape
   * the circulation principle reports as a detour.
   */
  const store = element({
    id: 'e-shed',
    name: 'Garden store',
    category: 'structure',
    material: 'softwood',
    shape: { kind: 'rect', centre: { x: 16, y: 14 }, width: 2.4, depth: 2, rotation: 0 },
  });

  const wandering = element({
    id: 'e-path',
    name: 'Path to the store',
    category: 'paved-area',
    material: 'stone-setts',
    shape: {
      kind: 'polyline',
      width: 1.2,
      points: [
        { x: 10, y: 10 },
        { x: 2, y: 10 },
        { x: 2, y: 14.5 },
        { x: 14.6, y: 14.5 },
      ],
    },
  });

  const rerouteDirect: DesignIntent = {
    kind: 'reroute',
    target: { elementIds: ['e-path'] },
    objective: 'direct',
  };

  it('redraws a wandering path as a more direct one', async () => {
    const { changes } = await planner.plan(plan([patio, store, wandering]), [rerouteDirect]);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('reroute');

    const before = wandering.shape as Extract<PlanGeometry, { kind: 'polyline' }>;
    const after = changes[0]!.next.shape as Extract<PlanGeometry, { kind: 'polyline' }>;

    /* The measurement the circulation principle makes: shorter against the straight line. */
    expect(polylineLength(after.points)).toBeLessThan(polylineLength(before.points));
    expect(after.width).toBe(before.width);
  });

  it('leaves the route ends on the things they were on', async () => {
    const { changes } = await planner.plan(plan([patio, store, wandering]), [rerouteDirect]);
    const after = changes[0]!.next.shape as Extract<PlanGeometry, { kind: 'polyline' }>;

    const ends = [after.points[0]!, after.points[after.points.length - 1]!];

    /*
     * Still a path from the terrace to the store. A reroute that quietly moved an end somewhere
     * else would be answering "make it more direct" by making it a different path.
     */
    expect(nearestOn(geometryOutline(patio.shape), ends[0]!)).toBeLessThan(0.6);
    expect(nearestOn(geometryOutline(store.shape), ends[1]!)).toBeLessThan(0.7);
  });

  it('never proposes a route that leaves the plot', async () => {
    const document = plan([patio, store, wandering]);
    const { changes } = await planner.plan(document, [rerouteDirect]);
    const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));

    expect(geometryIsLegal(changes[0]!.next.shape, boundary)).toBe(true);
  });

  it('keeps clear of what it was told to avoid', async () => {
    /* A bed across the direct line, so the straight answer is the one that has to be given up. */
    const bed = element({
      id: 'e-bed',
      name: 'Border',
      category: 'planting-bed',
      material: 'mixed-border',
      shape: { kind: 'rect', centre: { x: 13, y: 12.4 }, width: 6, depth: 1.6, rotation: 0 },
    });

    const intent: DesignIntent = {
      kind: 'reroute',
      target: { elementIds: ['e-path'] },
      objective: 'avoid',
      avoidElementIds: ['e-bed'],
    };

    const { changes, unplaceable } = await planner.plan(plan([patio, store, bed, wandering]), [
      intent,
    ]);

    if (changes.length === 0) {
      // A refusal is the honest answer where no legal line clears it; it still has to say so.
      expect(unplaceable).toHaveLength(1);
      return;
    }

    expect(
      polygonsIntersect(geometryOutline(changes[0]!.next.shape), geometryOutline(bed.shape)),
    ).toBe(false);
  });

  it('never makes a path longer than the one it replaced', async () => {
    /*
     * The guarantee, rather than "it refuses when the path is already straight" — which is not one
     * the router can make. A reroute searches from thirteen points along whatever the path leaves,
     * so a line that is straight from where it happens to start is very often *not* the shortest
     * line between the two things it joins, and finding the shorter one is the router doing its
     * job rather than a fault.
     */
    const straight = element({
      id: 'e-path',
      name: 'Path to the store',
      category: 'paved-area',
      material: 'stone-setts',
      shape: {
        kind: 'polyline',
        width: 1.2,
        points: [
          { x: 12.5, y: 12 },
          { x: 14.75, y: 14 },
        ],
      },
    });

    const before = straight.shape as Extract<PlanGeometry, { kind: 'polyline' }>;
    const { changes } = await planner.plan(plan([patio, store, straight]), [rerouteDirect]);

    for (const proposed of changes) {
      const after = proposed.next.shape as Extract<PlanGeometry, { kind: 'polyline' }>;
      expect(polylineLength(after.points)).toBeLessThanOrEqual(
        polylineLength(before.points) + 1e-9,
      );
    }
  });

  it('says so when a path reaches nothing', async () => {
    /*
     * Stepping stones across a lawn end where they end. There is nothing to route *to*, so a
     * reroute has no question to answer and says so rather than nudging the line by a hair.
     */
    const alone = element({
      id: 'e-path',
      name: 'Stepping stones',
      category: 'paved-area',
      material: 'stone-setts',
      shape: {
        kind: 'polyline',
        width: 1.2,
        points: [
          { x: 4, y: 10.5 },
          { x: 4, y: 14 },
        ],
      },
    });

    const { changes, unplaceable } = await planner.plan(plan([alone]), [rerouteDirect]);

    expect(changes).toHaveLength(0);
    expect(unplaceable[0]!.reason).toContain('nothing at the far end');
  });

  it('refuses to reroute something that is not a path', async () => {
    const intent: DesignIntent = {
      kind: 'reroute',
      target: { elementIds: ['e-1'] },
      objective: 'direct',
    };

    const { changes, unplaceable } = await planner.plan(plan([patio]), [intent]);

    expect(changes).toHaveLength(0);
    expect(unplaceable[0]!.reason).toContain('not a path');
  });

  it('gives the same route twice', async () => {
    const once = await planner.plan(plan([patio, store, wandering]), [rerouteDirect]);
    const twice = await planner.plan(plan([patio, store, wandering]), [rerouteDirect]);

    expect(twice.changes).toEqual(once.changes);
  });

  /* ---------------------------------------------------------------- rotate */

  it('squares a skewed terrace to the house', async () => {
    const skewed = element({
      id: 'e-1',
      name: 'Dining terrace',
      category: 'paved-area',
      material: 'stone-pavers',
      shape: { kind: 'rect', centre: { x: 10, y: 11 }, width: 4, depth: 3, rotation: 23 },
    });

    const intent: DesignIntent = { kind: 'rotate', target: { elementIds: ['e-1'] }, to: 'house' };

    const { changes } = await planner.plan(plan([skewed]), [intent]);

    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('rotate');

    const after = changes[0]!.next.shape as Extract<PlanGeometry, { kind: 'rect' }>;
    // The house walls run along the axes, so square to it is a quarter turn from zero.
    expect(after.rotation % 90).toBeCloseTo(0, 6);
    // And nothing but the angle moved.
    expect(after.centre).toEqual({ x: 10, y: 11 });
    expect(after.width).toBe(4);
  });

  it('takes the shortest way round', async () => {
    const skewed = element({
      id: 'e-1',
      shape: { kind: 'rect', centre: { x: 10, y: 11 }, width: 4, depth: 3, rotation: 80 },
    });

    const intent: DesignIntent = { kind: 'rotate', target: { elementIds: ['e-1'] }, to: 'house' };

    const { changes } = await planner.plan(plan([skewed]), [intent]);
    const after = changes[0]!.next.shape as Extract<PlanGeometry, { kind: 'rect' }>;

    /* 90 is ten degrees away; 0 is eighty. A turn that reads as an adjustment takes the near one. */
    expect(after.rotation).toBe(90);
  });

  it('lines one thing up with another', async () => {
    const pergola = element({
      id: 'e-2',
      name: 'Pergola',
      category: 'structure',
      material: 'softwood',
      shape: { kind: 'rect', centre: { x: 5, y: 12 }, width: 3, depth: 3, rotation: 30 },
    });
    const skewed = element({
      id: 'e-1',
      shape: { kind: 'rect', centre: { x: 12, y: 12 }, width: 3, depth: 2, rotation: 0 },
    });

    const intent: DesignIntent = {
      kind: 'rotate',
      target: { elementIds: ['e-1'] },
      to: 'element',
      elementId: 'e-2',
    };

    const { changes } = await planner.plan(plan([skewed, pergola]), [intent]);
    const after = changes[0]!.next.shape as Extract<PlanGeometry, { kind: 'rect' }>;

    expect(offBearing(after.rotation, 30)).toBeLessThan(0.001);
  });

  it('says so when a thing is already square to what it was asked to match', async () => {
    const intent: DesignIntent = { kind: 'rotate', target: { elementIds: ['e-1'] }, to: 'house' };

    const { changes, unplaceable } = await planner.plan(plan([patio]), [intent]);

    expect(changes).toHaveLength(0);
    expect(unplaceable[0]!.reason).toContain('already square');
  });

  it('refuses to turn an outline', async () => {
    const intent: DesignIntent = {
      kind: 'rotate',
      target: { elementIds: ['e-base'] },
      to: 'house',
    };

    const { changes, unplaceable } = await planner.plan(plan([baseFill]), [intent]);

    expect(changes).toHaveLength(0);
    expect(unplaceable).toHaveLength(1);
  });

  it('never proposes a turn the editor would refuse', async () => {
    /* A terrace filling most of the plot width: turning it would put a corner through the fence. */
    const wide = element({
      id: 'e-1',
      shape: { kind: 'rect', centre: { x: 10, y: 12 }, width: 19, depth: 3, rotation: 12 },
    });

    const intent: DesignIntent = { kind: 'rotate', target: { elementIds: ['e-1'] }, to: 'house' };

    const document = plan([wide]);
    const boundary = document.site.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
    const { changes } = await planner.plan(document, [intent]);

    for (const proposed of changes) {
      expect(geometryIsLegal(proposed.next.shape, boundary)).toBe(true);
    }
  });

  /**
   * The wire schema forces the model to send a value for every field, including the ones that do
   * not apply to the verb it chose — an empty string for an id, an empty list, `false`, `0`. That
   * was the price of getting the grammar small enough for Anthropic to compile it at all.
   *
   * Every read of those fields in `planner.service.ts` is a truthiness or length check rather than
   * an existence check, so the placeholders already behave exactly as an absent key does. These
   * tests state that rather than leaving it to be rediscovered: a future `!== undefined` written in
   * good faith would turn "move it nearer the house" into "there is nothing to move it towards",
   * and nothing else in the suite would notice.
   */
  describe('the placeholders the wire schema forces', () => {
    it('treats an empty elementId on a move as no element at all', async () => {
      const withPlaceholder = await planner.plan(plan([patio]), [
        {
          kind: 'move',
          target: { elementIds: ['e-1'] },
          towards: 'house',
          elementId: '',
          away: false,
        },
      ]);
      const without = await planner.plan(plan([patio]), [
        { kind: 'move', target: { elementIds: ['e-1'] }, towards: 'house', away: false },
      ]);

      expect(withPlaceholder.changes).toHaveLength(without.changes.length);
      expect(withPlaceholder.changes[0]?.next.shape).toEqual(without.changes[0]?.next.shape);
      expect(withPlaceholder.unplaceable).toEqual(without.unplaceable);
    });

    it('treats an empty elementId on a rotate as no element at all', async () => {
      const withPlaceholder = await planner.plan(plan([patio]), [
        { kind: 'rotate', target: { elementIds: ['e-1'] }, to: 'house', elementId: '' },
      ]);
      const without = await planner.plan(plan([patio]), [
        { kind: 'rotate', target: { elementIds: ['e-1'] }, to: 'house' },
      ]);

      expect(withPlaceholder.changes).toHaveLength(without.changes.length);
      expect(withPlaceholder.changes[0]?.next.shape).toEqual(without.changes[0]?.next.shape);
    });

    it('treats an empty avoid list and an empty connect id as no preference', async () => {
      const path = element({
        id: 'e-9',
        category: 'paved-area',
        shape: {
          kind: 'polyline',
          points: [
            { x: 4, y: 12 },
            { x: 14, y: 12 },
          ],
          width: 1.2,
        },
      });

      const withPlaceholders = await planner.plan(plan([path]), [
        {
          kind: 'reroute',
          target: { elementIds: ['e-9'] },
          objective: 'direct',
          avoidElementIds: [],
          connectElementId: '',
        },
      ]);
      const without = await planner.plan(plan([path]), [
        { kind: 'reroute', target: { elementIds: ['e-9'] }, objective: 'direct' },
      ]);

      expect(withPlaceholders.changes).toHaveLength(without.changes.length);
      expect(withPlaceholders.unplaceable).toEqual(without.unplaceable);
    });

    it('treats a stated maxChanges of 5 as the default it replaced', async () => {
      const stated = await planner.plan(plan([patio]), [{ kind: 'reduce-cost', maxChanges: 5 }]);
      const omitted = await planner.plan(plan([patio]), [
        { kind: 'reduce-cost' } as unknown as DesignIntent,
      ]);

      expect(stated.changes).toHaveLength(omitted.changes.length);
    });
  });
});

if (connection === null) {
  describe('PlannerService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}

/** The distance from a point to a ring outline; nought when it is inside. */
function nearestOn(ring: { x: number; y: number }[], point: { x: number; y: number }): number {
  if (pointInPolygon(point, ring)) return 0;
  return Math.min(
    ...ring.map((corner, i) => distanceToSegment(point, corner, ring[(i + 1) % ring.length]!)),
  );
}
