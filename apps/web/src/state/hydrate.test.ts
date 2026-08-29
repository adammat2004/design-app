import { PlanDocumentSchema, type PlanProject } from '@garden-studio/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetBoundaryStoreForTests, useBoundaryStore } from './boundary-store';
import { resetBriefStoreForTests, useBriefStore } from './brief-store';
import { resetConceptsStoreForTests, useConceptsStore } from './concepts-store';
import { resetFeaturesStoreForTests, useFeaturesStore } from './features-store';
import { hydratePlanStores } from './hydrate';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from './plan-editor-store';

/**
 * A stored plan mid-way through the wizard, with ids deliberately well above 1 — that is what
 * makes the counter-reseeding assertions meaningful.
 */
function storedProject(overrides: Partial<PlanProject> = {}): PlanProject {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    name: 'Reloaded garden',
    revision: 4,
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-02T11:30:00.000Z',
    document: PlanDocumentSchema.parse({
      version: 1,
      unit: 'ft',
      site: {
        vertices: [
          { id: 'v5', x: 0, y: 0 },
          { id: 'v6', x: 20, y: 0 },
          { id: 'v7', x: 20, y: 16 },
          { id: 'v8', x: 0, y: 16 },
        ],
        closed: true,
        house: {
          outline: [
            { id: 'h0', x: -4, y: -3 },
            { id: 'h1', x: 4, y: -3 },
            { id: 'h2', x: 4, y: 3 },
            { id: 'h3', x: -4, y: 3 },
          ],
          centre: { x: 10, y: 8 },
          rotation: 0,
        },
        selectedZoneIds: ['back'],
      },
      features: {
        features: [
          {
            id: 'f7',
            kind: 'tree',
            name: 'Old apple',
            geometry: { kind: 'point', at: { x: 2, y: 2 }, radius: 1 },
            status: 'keep',
            replaceWith: null,
          },
        ],
        skipped: true,
      },
      brief: { budget: 'high', maintenance: 'low', style: 'modern' },
      concepts: {
        concepts: [],
        selectedId: 'c9-1',
        chosenConceptId: 'c9-1',
        seed: 9,
      },
      layout: {
        elements: [
          {
            id: 'e-12',
            category: 'paved-area',
            role: 'feature',
            name: 'Terrace',
            shape: { kind: 'rect', centre: { x: 10, y: 13 }, width: 4, depth: 3, rotation: 0 },
            zone: 'back',
          },
        ],
        seededFrom: 'c9-1',
        pristine: [],
      },
    }),
    ...overrides,
  };
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetFeaturesStoreForTests();
  resetBriefStoreForTests();
  resetConceptsStoreForTests();
  resetPlanEditorStoreForTests();
});

describe('hydratePlanStores', () => {
  it('puts every section into the store that owns it', () => {
    hydratePlanStores(storedProject());

    expect(useBoundaryStore.getState().present.vertices).toHaveLength(4);
    expect(useBoundaryStore.getState().present.closed).toBe(true);
    expect(useBoundaryStore.getState().unit).toBe('ft');
    expect(useBoundaryStore.getState().projectName).toBe('Reloaded garden');

    expect(useFeaturesStore.getState().present.features).toHaveLength(1);
    expect(useBriefStore.getState().present.budget).toBe('high');
    expect(useConceptsStore.getState().present.seed).toBe(9);
    expect(usePlanEditorStore.getState().present.elements).toHaveLength(1);
  });

  /*
   * These two live outside their store's history stack but are real user intent, so they have to
   * survive a reload. They are also the easiest thing in the sync layer to forget.
   */
  it('restores the intent that sits outside the history stacks', () => {
    hydratePlanStores(storedProject());

    expect(useFeaturesStore.getState().skipped).toBe(true);
    expect(useConceptsStore.getState().chosenConceptId).toBe('c9-1');
  });

  it('restores what "Reset to concept" needs', () => {
    hydratePlanStores(storedProject());

    expect(usePlanEditorStore.getState().seededFrom).toBe('c9-1');
    expect(usePlanEditorStore.getState().pristine).toEqual([]);
  });

  it('reports the server timestamp as the last save', () => {
    hydratePlanStores(storedProject());

    const savedAt = new Date('2026-08-02T11:30:00.000Z').getTime();
    expect(useBoundaryStore.getState().lastSavedAt).toBe(savedAt);
    expect(useBriefStore.getState().lastSavedAt).toBe(savedAt);
  });

  it('clears the undo stacks rather than restoring them', () => {
    hydratePlanStores(storedProject());

    expect(useBoundaryStore.getState().past).toEqual([]);
    expect(useBoundaryStore.getState().future).toEqual([]);
    expect(useFeaturesStore.getState().past).toEqual([]);
    expect(usePlanEditorStore.getState().past).toEqual([]);
  });

  it('clears ephemeral editor state', () => {
    useBoundaryStore.setState({ mode: 'measure', measurement: { from: { x: 0, y: 0 }, to: null } });

    hydratePlanStores(storedProject());

    expect(useBoundaryStore.getState().mode).toBe('boundary');
    expect(useBoundaryStore.getState().measurement).toBeNull();
    expect(useFeaturesStore.getState().selectedIds).toEqual([]);
  });
});

/*
 * The trap: every store mints ids from a module-level counter that starts at zero on a fresh
 * page. Without re-seeding, a plan loaded with `f7` in it would mint `f1` for the next feature
 * and collide with something already on the plan.
 */
describe('id counters after a load', () => {
  it('continues the boundary vertex ids', () => {
    hydratePlanStores(storedProject());

    useBoundaryStore.getState().insertVertexOnEdge(0, { x: 10, y: 0 });

    const ids = useBoundaryStore.getState().present.vertices.map((vertex) => vertex.id);
    expect(ids).toContain('v9');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('continues the feature ids', () => {
    hydratePlanStores(storedProject());

    useFeaturesStore.getState().startPlacing('shed');
    useFeaturesStore.getState().placeRectangle({ x: 3, y: 13 }, 2, 2);

    const ids = useFeaturesStore.getState().present.features.map((feature) => feature.id);
    expect(ids).toEqual(['f7', 'f8']);
  });

  it('continues the layout element ids', () => {
    hydratePlanStores(storedProject());

    usePlanEditorStore.getState().duplicateElement('e-12');

    const ids = usePlanEditorStore.getState().present.elements.map((element) => element.id);
    expect(ids).toEqual(['e-12', 'e-13']);
  });

  /*
   * Generated concept element ids look like `c9-0-e3`. An unanchored pattern would match the
   * digits in those and skew the counter; because concept ids are namespaced by seed they can
   * never collide with `e-N` anyway.
   */
  it('ignores generated concept ids when re-seeding', () => {
    const project = storedProject();
    project.document.layout.elements = [
      { ...project.document.layout.elements[0]!, id: 'c9-0-e30' },
      { ...project.document.layout.elements[0]!, id: 'e-2' },
    ];

    hydratePlanStores(project);
    usePlanEditorStore.getState().duplicateElement('e-2');

    expect(usePlanEditorStore.getState().present.elements.at(-1)!.id).toBe('e-3');
  });
});
