import {
  featureIsLegal,
  featureOutline,
  geometryAnchor,
  geometryArea,
  polygonsIntersect,
  PlanDocumentSchema,
  suggestedAccess,
  type GardenAction,
  type PlacedFeature,
  type PlanDocument,
} from '@garden-studio/schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GardenPlannerService } from './garden-planner.service.js';
import { PlacementService } from '../../generation/placement.service.js';
import {
  connectTestDatabase,
  DB_UNAVAILABLE_MESSAGE,
  type TestDatabase,
} from '../../../test/db.js';

const connection = await connectTestDatabase();

/**
 * The same 20 × 19 m plot the concept suite and the anchor suite use: an 8 × 6 m house at (10, 7)
 * facing -y, so the street is the top fence and the back garden is the 9 m below the house.
 *
 * **No model appears anywhere in this file.** `GardenAction` objects go straight in, which is the
 * whole point of the hybrid split — the half that decides where things actually go is testable
 * against real PostGIS with nothing faked.
 */
function plan(features: PlacedFeature[] = []): PlanDocument {
  return PlanDocumentSchema.parse({
    version: 1,
    site: suggestedAccess(
      PlanDocumentSchema.shape.site.parse({
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
      }),
    ),
    features: { features, skipped: false },
  });
}

const boundary = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 19 },
  { x: 0, y: 19 },
];

function shed(at: { x: number; y: number }, id = 'f1'): PlacedFeature {
  return {
    id,
    kind: 'shed',
    name: 'Shed',
    geometry: { kind: 'rect', centre: at, width: 2.5, depth: 2, rotation: 0 },
    status: 'keep',
    replaceWith: null,
  };
}

describe.skipIf(connection === null)('GardenPlannerService', () => {
  let planner: GardenPlannerService;
  let db: TestDatabase;

  beforeAll(() => {
    db = connection!;
    planner = new GardenPlannerService(new PlacementService(db.db));
  });

  afterAll(async () => {
    await db?.close();
  });

  const add = (overrides: Partial<Extract<GardenAction, { kind: 'add' }>> = {}): GardenAction => ({
    kind: 'add',
    feature: 'shed',
    at: 'back-left',
    count: 1,
    ...overrides,
  });

  /*
   * The strongest claim in the file, and the direct analogue of step 5's "never proposes anything
   * the editor would refuse". If this can be broken, the assistant can put a shed over the fence.
   */
  it('never proposes a feature the editor would refuse', async () => {
    const { changes } = await planner.plan(plan(), [
      add({ feature: 'tree', at: 'along-right-fence', count: 2 }),
      add({ feature: 'shed', at: 'back-left' }),
      add({ feature: 'patio', at: 'outside-back-door' }),
    ]);

    expect(changes.length).toBeGreaterThan(0);
    for (const change of changes) {
      expect(featureIsLegal(change.next, boundary), change.label).toBe(true);
    }
  });

  it('places what the anchor asked for near where it asked', async () => {
    const { changes } = await planner.plan(plan(), [add({ at: 'back-left' })]);

    const at = geometryAnchor(changes[0]!.next.geometry);
    // Back garden is below the house (+y), and "left" looking out of a -y-facing house is +x.
    expect(at.y).toBeGreaterThan(10);
    expect(at.x).toBeGreaterThan(10);
  });

  /*
   * "Two mature trees along the right fence" is one action with a count, and it must not propose
   * both in the same spot — the working copy is advanced as each lands, which is what prevents it.
   */
  it('keeps repeats of one action off each other', async () => {
    const { changes } = await planner.plan(plan(), [
      add({ feature: 'tree', at: 'along-right-fence', count: 2 }),
    ]);

    expect(changes).toHaveLength(2);
    expect(
      polygonsIntersect(featureOutline(changes[0]!.next), featureOutline(changes[1]!.next)),
    ).toBe(false);
  });

  it('keeps a new feature off the ones already on the plan', async () => {
    const existing = shed({ x: 16, y: 16 });
    const { changes } = await planner.plan(plan([existing]), [add({ at: 'back-left' })]);

    expect(changes).toHaveLength(1);
    expect(polygonsIntersect(featureOutline(changes[0]!.next), featureOutline(existing))).toBe(
      false,
    );
  });

  it('gives each added feature a distinct name', async () => {
    const { changes } = await planner.plan(plan(), [add({ feature: 'tree', count: 3 })]);

    const names = changes.map((change) => change.next.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('takes a stated name and a stated size over its own defaults', async () => {
    const { changes } = await planner.plan(plan(), [
      add({ name: 'Old workshop', size: { kind: 'rect', width: 4, depth: 3 } }),
    ]);

    expect(changes[0]!.next.name).toBe('Old workshop');
    expect(geometryArea(changes[0]!.next.geometry)).toBeCloseTo(12, 1);
  });

  it('moves a feature towards a named place', async () => {
    const existing = shed({ x: 10, y: 12 });
    const { changes } = await planner.plan(plan([existing]), [
      { kind: 'move', featureId: 'f1', to: 'along-back-fence' },
    ]);

    expect(changes).toHaveLength(1);
    const at = geometryAnchor(changes[0]!.next.geometry);
    expect(at.y).toBeGreaterThan(12);
    expect(featureIsLegal(changes[0]!.next, boundary)).toBe(true);
  });

  it('resizes, clamped to what still fits on the plot', async () => {
    const existing = shed({ x: 10, y: 14 });
    const { changes } = await planner.plan(plan([existing]), [
      { kind: 'resize', featureId: 'f1', factor: 1.5 },
    ]);

    expect(geometryArea(changes[0]!.next.geometry)).toBeGreaterThan(
      geometryArea(existing.geometry),
    );
    expect(featureIsLegal(changes[0]!.next, boundary)).toBe(true);
  });

  it('deletes and re-statuses without touching geometry', async () => {
    const existing = shed({ x: 10, y: 14 });

    const removed = await planner.plan(plan([existing]), [
      { kind: 'status', featureId: 'f1', status: 'remove', replaceWith: null },
    ]);
    expect(removed.changes[0]!.next.status).toBe('remove');
    expect(removed.changes[0]!.next.geometry).toEqual(existing.geometry);

    const deleted = await planner.plan(plan([existing]), [{ kind: 'delete', featureId: 'f1' }]);
    expect(deleted.changes[0]!.kind).toBe('delete');
    expect(deleted.changes[0]!.featureId).toBe('f1');
  });

  // A replacement note only means anything while the answer is "replace".
  it('drops a replacement note when the status is not replace', async () => {
    const { changes } = await planner.plan(plan([shed({ x: 10, y: 14 })]), [
      { kind: 'status', featureId: 'f1', status: 'keep', replaceWith: 'A bigger one' },
    ]);

    expect(changes[0]!.next.replaceWith).toBeNull();
  });

  it('reports the scope separately from the features', async () => {
    const { scope, changes } = await planner.plan(plan(), [
      { kind: 'scope', zones: ['back', 'left'] },
    ]);

    expect(scope).toEqual({ zones: ['back', 'left'] });
    expect(changes).toEqual([]);
  });

  /*
   * The model writes the prose, the planner writes the facts. An action it cannot carry out is
   * omitted from `changes` and reported with a measured reason — never silently dropped, and never
   * fudged into somewhere illegal.
   */
  it('omits and explains what it cannot place', async () => {
    const { changes, unplaceable } = await planner.plan(plan(), [
      add({ size: { kind: 'rect', width: 28, depth: 28 } }),
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable).toHaveLength(1);
    expect(unplaceable[0]!.reason).toMatch(/no clear space/i);
  });

  it('says so when an action names a feature that is not there', async () => {
    const { changes, unplaceable } = await planner.plan(plan(), [
      { kind: 'delete', featureId: 'nope' },
    ]);

    expect(changes).toEqual([]);
    expect(unplaceable[0]!.reason).toMatch(/no longer on the plan/i);
  });

  // Same sentence twice, same garden — "regenerate" must not mean "roll again" here.
  it('is deterministic for the same document and actions', async () => {
    const actions: GardenAction[] = [add({ feature: 'tree', at: 'back-right', count: 2 })];

    const first = await planner.plan(plan(), actions);
    const second = await planner.plan(plan(), actions);

    expect(first.changes).toEqual(second.changes);
  });

  it('still answers on a plan with no house', async () => {
    const bare = plan();
    const document: PlanDocument = {
      ...bare,
      site: { ...bare.site, house: null, selectedZoneIds: [] },
    };

    const { changes } = await planner.plan(document, [add({ at: 'centre' })]);

    expect(changes).toHaveLength(1);
    expect(featureIsLegal(changes[0]!.next, boundary)).toBe(true);
  });
});

if (connection === null) {
  describe('GardenPlannerService', () => {
    it.skip(DB_UNAVAILABLE_MESSAGE, () => {});
  });
}
