import { beforeEach, describe, expect, it } from 'vitest';
import type { ProposedChange } from '@garden-studio/schema';
import type { DesignElement, GeneratedConcept } from '@/lib/concepts';
import { resetBoundaryStoreForTests, useBoundaryStore } from './boundary-store';
import {
  hydratePlanEditorStore,
  resetPlanEditorStoreForTests,
  selectedElement,
  usePlanEditorStore,
  visibleElements,
} from './plan-editor-store';

const store = () => usePlanEditorStore.getState();

/** A 20 x 16 plot with an 8 x 6 house in the middle — step 1, done. */
function mapProperty(): void {
  const boundary = useBoundaryStore.getState();
  boundary.addVertexAt({ x: 0, y: 0 });
  boundary.addVertexAt({ x: 20, y: 0 });
  boundary.addVertexAt({ x: 20, y: 16 });
  boundary.addVertexAt({ x: 0, y: 16 });
  boundary.closeShape();
  useBoundaryStore.getState().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
}

function element(over: Partial<DesignElement> & { id: string }): DesignElement {
  return {
    category: 'paved-area',
    role: 'feature',
    name: 'Seating patio',
    shape: { kind: 'rect', centre: { x: 3, y: 3 }, width: 3, depth: 2, rotation: 0 },
    zone: 'left',
    ...over,
  };
}

function concept(elements: DesignElement[]): GeneratedConcept {
  return {
    id: 'c1-0',
    name: 'Balanced Family Garden',
    recommended: true,
    summary: 'A test concept.',
    style: 'Modern / Natural',
    budget: 'medium',
    maintenance: 'medium',
    requestedFeaturesIncluded: [],
    elements,
  };
}

const BASE_FILL = element({
  id: 'g1',
  category: 'lawn',
  role: 'fill',
  fillKind: 'base',
  name: undefined,
  shape: {
    kind: 'polygon',
    points: [
      { x: 0, y: 12 },
      { x: 6, y: 12 },
      { x: 6, y: 16 },
      { x: 0, y: 16 },
    ],
    cornerRadius: 0,
  },
  zone: 'left',
});

function seed(elements: DesignElement[] = [element({ id: 'p1' }), BASE_FILL]): void {
  store().seedFrom(concept(elements));
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  changeCounter = 0;
  mapProperty();
});

describe('seeding', () => {
  it('starts empty', () => {
    expect(store().present.elements).toEqual([]);
    expect(store().seededFrom).toBeNull();
  });

  it('loads a concept and records where it came from', () => {
    seed();

    expect(store().present.elements).toHaveLength(2);
    expect(store().seededFrom).toBe('c1-0');
    expect(store().past).toEqual([]);
  });

  it('stamps a default material on anything the generator left bare', () => {
    seed([element({ id: 'p1', material: undefined })]);

    expect(store().present.elements[0].material).toBe('stone-pavers');
    expect(store().present.elements[0].elevation).toBe(0);
  });

  it('keeps a material the concept already carried', () => {
    seed([element({ id: 'p1', material: 'timber-decking' })]);

    expect(store().present.elements[0].material).toBe('timber-decking');
  });

  it('resets to the concept as generated, discarding edits', () => {
    seed();
    store().beginGesture();
    store().moveElementLive('p1', { x: 4, y: 4 });
    store().endGesture();
    expect(store().past.length).toBeGreaterThan(0);

    store().resetToConcept();
    expect(store().present.elements[0].shape).toEqual({
      kind: 'rect',
      centre: { x: 3, y: 3 },
      width: 3,
      depth: 2,
      rotation: 0,
    });
  });

  it('leaves Reset undoable — it is an edit like any other', () => {
    seed();
    store().beginGesture();
    // Clear of the house, which spans x 6–14, y 5–11.
    store().moveElementLive('p1', { x: 5, y: 3 });
    store().endGesture();

    store().resetToConcept();
    store().undo();

    const moved = store().present.elements[0].shape;
    expect(moved.kind === 'rect' && moved.centre.x).toBeCloseTo(5, 1);
  });
});

describe('direct manipulation', () => {
  /**
   * The reason `beginGesture` exists. A drag fires `moveElementLive` on every mousemove and each
   * of those commits, so without the bracket one drag would leave forty entries on the stack.
   */
  it('collapses a whole drag into one undo entry', () => {
    seed();
    const before = store().past.length;

    store().beginGesture();
    for (let x = 3; x <= 6; x += 0.5) store().moveElementLive('p1', { x, y: 3 });
    store().endGesture();

    expect(store().past.length).toBe(before + 1);

    store().undo();
    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBe(3);
  });

  it('earns no history entry for a drag that changed nothing', () => {
    seed();
    const before = store().past.length;

    store().beginGesture();
    store().endGesture();

    expect(store().past.length).toBe(before);
  });

  it('resizes, and refuses to go below the minimum side', () => {
    seed();
    store().resizeElementLive('p1', { width: 0.01 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.width).toBe(0.3);
  });

  it('rotates, normalising the angle', () => {
    seed();
    store().rotateElementLive('p1', 450);

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.rotation).toBe(90);
  });

  it('nudges by the arrow-key step', () => {
    seed();
    store().select('p1');
    store().nudgeSelection(0.1, 0);

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBeCloseTo(3.1, 5);
  });

  /**
   * The house is not a no-go area. A patio, a path or a pergola attached to the building is the
   * ordinary case, and the house is drawn over whatever runs under it — so a move onto it goes
   * through like any other, and nothing is said about it.
   */
  it('allows a move onto the house', () => {
    seed();
    store().moveElementLive('p1', { x: 10, y: 8 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre).toEqual({ x: 10, y: 8 });
    expect(store().clash).toBeNull();
  });

  it('refuses a move over the boundary', () => {
    seed();
    store().moveElementLive('p1', { x: 30, y: 3 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre).toEqual({ x: 3, y: 3 });
    expect(store().clash).toContain('boundary');
  });

  it('adds an element where the click landed', () => {
    seed([]);
    store().addElement('planting-bed', { x: 3, y: 14 });

    expect(store().present.elements).toHaveLength(1);
    expect(store().present.elements[0].category).toBe('planting-bed');
    expect(store().selectedId).toBe(store().present.elements[0].id);
  });

  it('adds an element on top of the house', () => {
    seed([]);
    store().addElement('paved-area', { x: 10, y: 8 });

    expect(store().present.elements).toHaveLength(1);
    expect(store().clash).toBeNull();
  });

  it('duplicates an element, offset and renamed', () => {
    seed();
    store().duplicateElement('p1');

    expect(store().present.elements).toHaveLength(3);
    const copy = store().present.elements.at(-1)!;
    expect(copy.id).not.toBe('p1');
    expect(copy.name).not.toBe('Seating patio');
  });

  it('deletes, and clears the selection when it was the selected one', () => {
    seed();
    store().select('p1');
    store().deleteElement('p1');

    expect(store().present.elements.map((entry) => entry.id)).toEqual(['g1']);
    expect(store().selectedId).toBeNull();
  });

  it('hides without deleting', () => {
    seed();
    store().toggleHidden('p1');

    expect(store().present.elements).toHaveLength(2);
    expect(visibleElements(store()).map((entry) => entry.id)).toEqual(['g1']);
  });
});

/**
 * Base fills are what keeps step 4's promise that no chosen zone shows bare grid. If the editor
 * could shrink or delete one, that promise would last exactly as long as the user's restraint.
 */
describe('the locked ground layer', () => {
  it('refuses to be moved', () => {
    seed();
    store().moveElementLive('g1', { x: 4, y: 14 });

    expect(store().present.elements[1].shape).toEqual(BASE_FILL.shape);
  });

  it('refuses to be resized', () => {
    seed();
    const before = store().present.elements[1].shape;
    store().resizeElementLive('g1', { width: 10 });

    expect(store().present.elements[1].shape).toEqual(before);
  });

  it('refuses to be deleted, and says why', () => {
    seed();
    store().deleteElement('g1');

    expect(store().present.elements).toHaveLength(2);
    expect(store().clash).toContain('ground layer');
  });

  it('refuses to be duplicated', () => {
    seed();
    store().duplicateElement('g1');

    expect(store().present.elements).toHaveLength(2);
  });

  /** The one edit it does accept — turning the lawn to gravel cannot open a gap. */
  it('accepts a material change', () => {
    seed();
    store().setMaterial('g1', 'artificial-turf');

    expect(store().present.elements[1].material).toBe('artificial-turf');
    expect(store().clash).toBeNull();
  });

  it('accepts being hidden', () => {
    seed();
    store().toggleHidden('g1');

    expect(store().present.elements[1].hidden).toBe(true);
  });
});

describe('properties', () => {
  it('renames, ignoring an empty name', () => {
    seed();
    store().renameElement('p1', 'Terrace');
    expect(store().present.elements[0].name).toBe('Terrace');

    store().renameElement('p1', '   ');
    expect(store().present.elements[0].name).toBe('Terrace');
  });

  it('sets zone and elevation', () => {
    seed();
    store().setZone('p1', 'back');
    store().setElevation('p1', 0.45);

    expect(store().present.elements[0].zone).toBe('back');
    expect(store().present.elements[0].elevation).toBe(0.45);
  });

  it('exposes the selected element', () => {
    seed();
    store().select('p1');

    expect(selectedElement(store())?.id).toBe('p1');
  });

  describe('boundary treatments', () => {
    /*
     * p1 is a 3 x 2 patio standing clear of the fence and the house with nothing round it, so every
     * one of its four sides meets open ground — and a steel preference edges all four in Auto.
     */
    const patio = () => store().present.elements.find((element) => element.id === 'p1')!;

    function customPatio() {
      seed();
      store().setEdging('p1', 'steel-edging');
      store().select('p1');
      store().openEdgeEdit('p1');
      store().setEdgeMode('p1', 'custom');
    }

    it('starts Custom from what Auto was drawing, so the picture does not change', () => {
      customPatio();
      const { mode, runs } = patio().edges!;
      expect(mode).toBe('custom');
      expect(runs.map((run) => run.side)).toEqual([0, 1, 2, 3]);
      expect(runs.every((run) => run.treatment === 'steel' && run.source === 'auto')).toBe(true);
    });

    it('adds a run over the free stretch at a click, and selects it', () => {
      customPatio();
      const top = patio().edges!.runs.find((run) => run.side === 0)!;
      store().removeEdgeRun('p1', top.id);

      const runId = store().addEdgeRunAt('p1', 0, 1.5);
      const added = patio().edges!.runs.find((run) => run.id === runId)!;
      expect(added).toMatchObject({ side: 0, source: 'user', treatment: 'steel' });
      expect(added.to - added.from).toBeCloseTo(3, 6);
      expect(store().edgeEdit?.selectedRunId).toBe(runId);
      // A click on a stretch already edged adds nothing: it is a run to select, not a gap to fill.
      expect(store().addEdgeRunAt('p1', 1, 1)).toBeNull();
    });

    it('drags an end along its side as one undo entry, and refuses a run too short to lay', () => {
      customPatio();
      const top = patio().edges!.runs.find((run) => run.side === 0)!;

      store().beginGesture();
      store().setEdgeRunEndLive('p1', top.id, 'to', 1.2);
      store().setEdgeRunEndLive('p1', top.id, 'to', 1.0);
      store().endGesture();

      const dragged = patio().edges!.runs.find((run) => run.id === top.id)!;
      expect(dragged.to - dragged.from).toBeCloseTo(1, 6);
      expect(dragged.source).toBe('user');

      // Under the 150 mm floor the frame is refused and the last legal one stays.
      store().beginGesture();
      store().setEdgeRunEndLive('p1', top.id, 'to', 0.05);
      store().endGesture();
      expect(patio().edges!.runs.find((run) => run.id === top.id)!.to).toBeCloseTo(dragged.to, 6);

      store().undo();
      const restored = patio().edges!.runs.find((run) => run.id === top.id)!;
      expect(restored.to - restored.from).toBeCloseTo(3, 6);
    });

    it('changes a treatment and a dimension, and drops dimensions the new treatment lacks', () => {
      customPatio();
      const top = patio().edges!.runs[0]!;

      store().setEdgeRunTreatment('p1', top.id, 'kerb');
      store().setEdgeRunDimension('p1', top.id, 'height', 150);
      expect(patio().edges!.runs[0]).toMatchObject({ treatment: 'kerb', heightMm: 150, source: 'user' });

      store().setEdgeRunTreatment('p1', top.id, 'flush');
      expect(patio().edges!.runs[0]).not.toHaveProperty('heightMm');
      // A flush join has no height to set.
      store().setEdgeRunDimension('p1', top.id, 'height', 90);
      expect(patio().edges!.runs[0]).not.toHaveProperty('heightMm');
    });

    it('keeps the runs through None so Custom gets them back, and Auto forgets them', () => {
      customPatio();
      store().setEdgeRunTreatment('p1', patio().edges!.runs[0]!.id, 'brick');

      store().setEdgeMode('p1', 'none');
      expect(patio().edges!.mode).toBe('none');
      store().setEdgeMode('p1', 'custom');
      expect(patio().edges!.runs[0]!.treatment).toBe('brick');

      store().setEdgeMode('p1', 'auto');
      expect(patio().edges).toEqual({ mode: 'auto', runs: [] });
    });

    it('closes edge editing when another element is selected', () => {
      customPatio();
      expect(store().edgeEdit?.hostId).toBe('p1');
      store().select('g1');
      expect(store().edgeEdit).toBeNull();
    });

    it('accepts a treatment on a locked ground layer, which cannot move', () => {
      seed();
      store().setEdgeMode('g1', 'none');
      expect(store().present.elements.find((element) => element.id === 'g1')!.edges?.mode).toBe('none');
    });
  });
});

/*
 * Proposals are written out by hand here rather than produced by anything.
 *
 * The server builds them now, and that is the point: this store's contract is "given a list of
 * lines and the ids that were ticked, apply what is still legal" — nothing about how the list was
 * arrived at. Hand-written lines let a case say exactly what it is testing, including the ones no
 * planner would ever emit (the illegal move, the reshaped ground layer).
 */
let changeCounter = 0;

function change(
  kind: ProposedChange['kind'],
  previous: DesignElement,
  next: DesignElement,
): ProposedChange {
  changeCounter += 1;

  return {
    id: `c${changeCounter}`,
    kind,
    elementId: previous.id,
    label: previous.name ?? previous.category,
    before: 'before',
    after: 'after',
    previous,
    next,
  };
}

/** A material swap per element — the shape a "make it cheaper" reply arrives in. */
function materialSwaps(materials: Record<string, DesignElement['material']>): ProposedChange[] {
  return store()
    .present.elements.filter((element) => element.id in materials)
    .map((element) => change('material', element, { ...element, material: materials[element.id] }));
}

/** One resize line, scaled about the element's centre the way the planner would. */
function resizeBy(elementId: string, factor: number): ProposedChange[] {
  const element = store().present.elements.find((entry) => entry.id === elementId)!;
  if (element.shape.kind !== 'rect') throw new Error('resizeBy expects a rect.');

  return [
    change('resize', element, {
      ...element,
      shape: {
        ...element.shape,
        width: element.shape.width * factor,
        depth: element.shape.depth * factor,
      },
    }),
  ];
}

describe('applying an assistant proposal', () => {
  /**
   * An applied diff is one thing the user did, so it is one thing they can undo — however many
   * lines it carried.
   */
  it('costs exactly one undo, whatever the line count', () => {
    seed([
      element({ id: 'p1', material: 'stone-pavers' }),
      element({
        id: 's1',
        category: 'structure',
        name: 'Dining pergola',
        material: 'hardwood',
        shape: { kind: 'rect', centre: { x: 3, y: 13 }, width: 2, depth: 2, rotation: 0 },
      }),
      BASE_FILL,
    ]);

    const changes = materialSwaps({ p1: 'concrete', s1: 'softwood' });
    expect(changes.length).toBeGreaterThan(1);

    const before = store().past.length;
    store().applyProposal(
      changes,
      changes.map((change) => change.id),
    );

    expect(store().past.length).toBe(before + 1);
  });

  it('undoes back to exactly what was there before', () => {
    seed();
    const snapshot = store().present.elements;
    const changes = resizeBy('p1', 1.25);

    store().applyProposal(
      changes,
      changes.map((change) => change.id),
    );
    expect(store().present.elements).not.toEqual(snapshot);

    store().undo();
    expect(store().present.elements).toEqual(snapshot);
  });

  it('applies only the lines that were accepted', () => {
    seed([
      element({ id: 'p1', material: 'stone-pavers' }),
      element({
        id: 's1',
        category: 'structure',
        name: 'Dining pergola',
        material: 'hardwood',
        shape: { kind: 'rect', centre: { x: 3, y: 13 }, width: 2, depth: 2, rotation: 0 },
      }),
    ]);
    const changes = materialSwaps({ p1: 'concrete', s1: 'softwood' });
    expect(changes.length).toBeGreaterThan(1);

    const outcome = store().applyProposal(changes, [changes[0].id]);

    expect(outcome.applied).toEqual([changes[0].id]);
    expect(outcome.refused).toEqual([]);
  });

  it('does nothing at all when every line was rejected', () => {
    seed();
    const before = store().present.elements;
    const changes = resizeBy('p1', 1.25);

    const outcome = store().applyProposal(changes, []);

    expect(outcome.applied).toEqual([]);
    expect(store().present.elements).toBe(before);
  });

  it('adds a new element for an add change, giving it a fresh id', () => {
    seed();
    const added: ProposedChange = {
      id: 'x1',
      kind: 'add',
      elementId: null,
      label: 'Screening hedge',
      before: 'Not on the plan',
      after: '6 m²',
      previous: null,
      next: element({
        id: 'ai-hedge',
        category: 'planting-bed',
        name: 'Screening hedge',
        shape: { kind: 'rect', centre: { x: 3, y: 14 }, width: 3, depth: 1, rotation: 0 },
      }),
    };

    store().applyProposal([added], ['x1']);

    const hedge = store().present.elements.find((entry) => entry.name === 'Screening hedge');
    expect(hedge).toBeDefined();
    expect(hedge!.id).not.toBe('ai-hedge');
  });

  /**
   * The guarantee. A proposal is checked when it is built, but the plan can move on before it is
   * applied — so the store checks again and turns down anything that has become impossible.
   * Trusting the proposal here is the one shortcut this screen cannot take.
   */
  it('re-refuses a change that has become illegal since it was proposed', () => {
    seed();
    const illegal: ProposedChange = {
      id: 'x2',
      kind: 'move',
      elementId: 'p1',
      label: 'Seating patio',
      before: '3, 3 m',
      after: '30, 3 m',
      previous: store().present.elements[0],
      // Straight through the fence — as if the plot had been redrawn after the proposal was built.
      next: element({
        id: 'p1',
        shape: { kind: 'rect', centre: { x: 30, y: 3 }, width: 3, depth: 2, rotation: 0 },
      }),
    };

    const outcome = store().applyProposal([illegal], ['x2']);

    expect(outcome.applied).toEqual([]);
    expect(outcome.refused).toHaveLength(1);
    expect(outcome.refused[0].reason).toContain('boundary');
    expect(store().present.elements[0].shape).toEqual(element({ id: 'p1' }).shape);
  });

  it('refuses to reshape the ground layer even when told to', () => {
    seed();
    const illegal: ProposedChange = {
      id: 'x3',
      kind: 'resize',
      elementId: 'g1',
      label: 'Lawn',
      before: '24 m²',
      after: '4 m²',
      previous: store().present.elements[1],
      next: {
        ...BASE_FILL,
        shape: { kind: 'rect', centre: { x: 3, y: 14 }, width: 2, depth: 2, rotation: 0 },
      },
    };

    const outcome = store().applyProposal([illegal], ['x3']);

    expect(outcome.applied).toEqual([]);
    expect(outcome.refused[0].reason).toContain('ground layer');
  });

  it('reports a change whose element has since been deleted', () => {
    seed();
    const changes = resizeBy('p1', 1.25);
    store().deleteElement('p1');

    const outcome = store().applyProposal(
      changes,
      changes.map((change) => change.id),
    );

    expect(outcome.applied).toEqual([]);
    expect(outcome.refused[0].reason).toContain('no longer');
  });

  it('lets a material change through on the ground layer', () => {
    seed();
    const swap: ProposedChange = {
      id: 'x4',
      kind: 'material',
      elementId: 'g1',
      label: 'Lawn',
      before: 'Standard turf',
      after: 'Wildflower meadow',
      previous: store().present.elements[1],
      next: { ...BASE_FILL, material: 'wildflower' },
    };

    const outcome = store().applyProposal([swap], ['x4']);

    expect(outcome.applied).toEqual(['x4']);
    expect(store().present.elements[1].material).toBe('wildflower');
  });
});

describe('history', () => {
  it('redoes what it undid', () => {
    seed();
    store().beginGesture();
    store().moveElementLive('p1', { x: 5, y: 3 });
    store().endGesture();

    store().undo();
    store().redo();

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBeCloseTo(5, 1);
  });

  it('discards the abandoned future once a new edit lands', () => {
    seed();
    store().beginGesture();
    store().moveElementLive('p1', { x: 5, y: 3 });
    store().endGesture();
    store().undo();
    expect(store().future).toHaveLength(1);

    store().setMaterial('p1', 'concrete');
    expect(store().future).toEqual([]);
  });

  it('has nothing to undo on a freshly seeded plan', () => {
    seed();
    store().undo();

    expect(store().present.elements).toHaveLength(2);
  });
});

describe('the labels toggle', () => {
  /**
   * A viewing preference, so it follows `gridVisible` exactly — including the part that bites.
   * `CLAUDE.md` records that the flag has several edit points and the one people miss is
   * `ephemeralState()`, shared by the test reset and the hydrator: miss it and the setting survives
   * a reload it was never meant to survive.
   */
  it('starts off so the garden remains legible without global labels', () => {
    expect(usePlanEditorStore.getState().labelsVisible).toBe(false);
  });

  it('toggles', () => {
    usePlanEditorStore.getState().toggleLabels();
    expect(usePlanEditorStore.getState().labelsVisible).toBe(true);

    usePlanEditorStore.getState().toggleLabels();
    expect(usePlanEditorStore.getState().labelsVisible).toBe(false);
  });

  it('does not survive a reload, which is the edit point that gets missed', () => {
    usePlanEditorStore.getState().toggleLabels();
    expect(usePlanEditorStore.getState().labelsVisible).toBe(true);

    hydratePlanEditorStore(
      { elements: [], seededFrom: null, pristine: null, revision: null },
      Date.now(),
    );

    expect(usePlanEditorStore.getState().labelsVisible).toBe(false);
  });
});

describe('plant properties and bed membership', () => {
  const bed = element({
    id: 'bed',
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    shape: { kind: 'rect', centre: { x: 3, y: 3 }, width: 5, depth: 5, rotation: 0 },
  });
  const tree = element({
    id: 'tree',
    category: 'planting-bed',
    symbol: 'tree-deciduous',
    shape: { kind: 'point', at: { x: 3, y: 3 }, radius: 0.6 },
  });
  it('updates species, dimensions and status with undo and reload', () => {
    seed([bed, tree]);
    store().replaceSymbol('tree', 'tree-ornamental', 'acer-palmatum-red');
    store().setCanopyDiameter('tree', 2);
    store().setStatus('tree', 'keep');
    const planted = store().present.elements.find((e) => e.id === 'tree')!;
    expect(planted).toMatchObject({
      plantId: 'acer-palmatum-red',
      bedId: 'bed',
      status: 'keep',
      shape: { radius: 1 },
    });
    store().undo();
    expect(store().present.elements.find((e) => e.id === 'tree')?.status).toBeUndefined();
    store().redo();
    const layout = JSON.parse(
      JSON.stringify({
        ...store().present,
        seededFrom: store().seededFrom,
        pristine: store().pristine,
      }),
    );
    hydratePlanEditorStore(layout, Date.now());
    expect(store().present.elements.find((e) => e.id === 'tree')).toMatchObject(planted);
  });
  it('detaches a plant moved out of its bed, and lets a canopy grow past the fence', () => {
    seed([bed, tree]);
    store().setPosition('tree', { x: 3, y: 7 });
    expect(store().present.elements.find((e) => e.id === 'tree')?.bedId).toBeUndefined();

    /*
     * A canopy wider than the plot is **accepted**, and _this reverses_ what this test used to
     * assert. What has to be inside the fence is the trunk — see `legalFootprint` — because a
     * canopy reaching over a boundary is what a garden with trees in it looks like rather than a
     * thing planted next door. The editor, the AI run executor, the assistant's planner and the
     * server's validator all ask that same question of that same shape now, so a tree the user
     * grows here is a tree the save accepts.
     */
    store().setCanopyDiameter('tree', 30);
    expect(store().present.elements.find((e) => e.id === 'tree')?.shape).toMatchObject({
      radius: 15,
    });

    store().undo();
    expect(store().present.elements.find((e) => e.id === 'tree')?.shape).toMatchObject({
      radius: 0.6,
    });
  });

  it('still refuses a tree whose trunk would leave the plot', () => {
    seed([bed, tree]);
    store().setPosition('tree', { x: -4, y: 3 });
    expect(store().present.elements.find((e) => e.id === 'tree')?.shape).toMatchObject({
      at: { x: 3, y: 3 },
    });
    expect(store().clash).not.toBeNull();
  });
});
