import { beforeEach, describe, expect, it } from 'vitest';
import { LayoutSectionSchema, resolveStructure, standsInside, structureParts } from '@garden-studio/schema';
import type { DesignElement, GeneratedConcept } from '@/lib/concepts';
import { resetBoundaryStoreForTests, useBoundaryStore } from './boundary-store';
import { hydratePlanEditorStore, resetPlanEditorStoreForTests, usePlanEditorStore } from './plan-editor-store';

/**
 * The 3D editor writes the same element the plan draws. These are the promises that makes: width and
 * depth resize the plan's own rect about its centre and keep its turn, height and the configuration
 * move nothing on the ground, every change is one undo entry, and what is saved reads back the same.
 */
const store = () => usePlanEditorStore.getState();
const structurePartsOf = (element: DesignElement) => structureParts(resolveStructure(element)!);

function mapProperty(): void {
  const boundary = useBoundaryStore.getState();
  boundary.addVertexAt({ x: 0, y: 0 });
  boundary.addVertexAt({ x: 20, y: 0 });
  boundary.addVertexAt({ x: 20, y: 16 });
  boundary.addVertexAt({ x: 0, y: 16 });
  boundary.closeShape();
}

const PERGOLA: DesignElement = {
  id: 'pergola-1',
  category: 'structure',
  role: 'feature',
  name: 'Dining pergola',
  symbol: 'pergola',
  material: 'softwood',
  height: 2.4,
  zone: 'back',
  // Turned, so a resize that forgot the local frame would be caught.
  shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 3.6, depth: 3, rotation: 30 },
};

const PATIO: DesignElement = {
  id: 'patio-1',
  category: 'paved-area',
  role: 'feature',
  name: 'Patio',
  zone: 'back',
  shape: { kind: 'rect', centre: { x: 15, y: 4 }, width: 3, depth: 2, rotation: 0 },
};

function concept(elements: DesignElement[]): GeneratedConcept {
  return {
    id: 'c1-0',
    name: 'Test',
    recommended: true,
    summary: '',
    style: 'Modern',
    budget: 'medium',
    maintenance: 'medium',
    requestedFeaturesIncluded: [],
    elements,
  };
}

const pergola = () => store().present.elements.find((element) => element.id === PERGOLA.id)!;
const rect = () => {
  const shape = pergola().shape;
  if (shape.kind !== 'rect') throw new Error('the pergola is a rect');
  return shape;
};

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  mapProperty();
  store().seedFrom(concept([PERGOLA, PATIO]));
});

describe('opening the 3D editor', () => {
  it('opens on a pergola and selects it', () => {
    store().openStructureEdit(PERGOLA.id);
    expect(store().structureEdit).toEqual({ elementId: PERGOLA.id, pieceId: null });
    expect(store().selectedId).toBe(PERGOLA.id);
  });

  it('refuses anything that has no 3D editor', () => {
    store().openStructureEdit(PATIO.id);
    expect(store().structureEdit).toBeNull();
  });

  it('closes when something else is selected, or the structure is deleted', () => {
    store().openStructureEdit(PERGOLA.id);
    store().select(PATIO.id);
    expect(store().structureEdit).toBeNull();

    store().openStructureEdit(PERGOLA.id);
    store().deleteElement(PERGOLA.id);
    expect(store().structureEdit).toBeNull();
  });
});

describe('dimensions', () => {
  it('changes the plan footprint when the width changes, keeping the centre and the turn', () => {
    store().setSize(PERGOLA.id, { width: 4.2 });

    expect(rect().width).toBe(4.2);
    expect(rect().depth).toBe(3);
    expect(rect().centre).toEqual(PERGOLA.shape.kind === 'rect' ? PERGOLA.shape.centre : null);
    expect(rect().rotation).toBe(30);
    // And the 3D model is built from that same rect.
    expect(resolveStructure(pergola())!.width).toBe(4.2);
  });

  it('keeps the position and the turn when the depth changes', () => {
    store().setSize(PERGOLA.id, { depth: 2.4 });

    expect(rect().depth).toBe(2.4);
    expect(rect().width).toBe(3.6);
    expect(rect().centre).toEqual({ x: 8, y: 8 });
    expect(rect().rotation).toBe(30);
  });

  it('writes one undo entry per typed dimension', () => {
    const before = store().past.length;
    store().setSize(PERGOLA.id, { width: 4 });
    expect(store().past.length).toBe(before + 1);
    store().undo();
    expect(rect().width).toBe(3.6);
  });

  it('holds a size to the ones the structure is made in', () => {
    store().setSize(PERGOLA.id, { width: 40 });
    expect(rect().width).toBe(6);
  });

  it('refuses a size that would leave the plot rather than clamping it', () => {
    store().setPosition(PERGOLA.id, { x: 17.5, y: 8 });
    store().setSize(PERGOLA.id, { width: 6 });
    expect(rect().width).toBe(3.6);
    expect(store().clash).not.toBeNull();
  });

  it('leaves the footprint alone when only the height changes', () => {
    const shape = structuredClone(pergola().shape);
    store().setHeight(PERGOLA.id, 3);

    expect(pergola().height).toBe(3);
    expect(pergola().shape).toEqual(shape);
    expect(resolveStructure(pergola())!.height).toBe(3);
  });
});

describe('configuration', () => {
  it('changes no geometry when the materials change', () => {
    const shape = structuredClone(pergola().shape);
    store().setMaterial(PERGOLA.id, 'aluminium-dark');
    store().setStructure(PERGOLA.id, { roof: { kind: 'solid', finish: 'polycarbonate-opal' } });

    expect(pergola().material).toBe('aluminium-dark');
    expect(pergola().structure).toEqual({ roof: { kind: 'solid', finish: 'polycarbonate-opal' } });
    expect(pergola().shape).toEqual(shape);
  });

  it('merges one side at a time and records each change for Undo', () => {
    store().setStructure(PERGOLA.id, { sides: { left: 'slatted' } });
    store().setStructure(PERGOLA.id, { sides: { rear: 'slatted' } });
    expect(pergola().structure?.sides).toEqual({ left: 'slatted', rear: 'slatted' });

    store().undo();
    expect(pergola().structure?.sides).toEqual({ left: 'slatted' });
  });

  it('shows the configuration on the plan drawing', () => {
    store().setStructure(PERGOLA.id, { sides: { left: 'slatted' }, lighting: true });
    const groups = new Set(structurePartsOf(pergola()).map((part) => part.group));
    expect(groups.has('side-left')).toBe(true);
    expect(groups.has('light')).toBe(true);
  });

  it('does nothing to an element with no 3D editor', () => {
    store().setStructure(PATIO.id, { lighting: true });
    expect(store().present.elements.find((element) => element.id === PATIO.id)!.structure).toBeUndefined();
  });

  /** The `sameDraft` trap: a change a gesture can carry must earn the gesture its undo entry. */
  it('earns a gesture its undo entry when only the configuration changed', () => {
    const before = store().past.length;
    store().beginGesture();
    usePlanEditorStore.setState((state) => ({
      present: {
        ...state.present,
        elements: state.present.elements.map((element) =>
          element.id === PERGOLA.id ? { ...element, structure: { lighting: true } } : element,
        ),
      },
    }));
    store().endGesture({ silent: true });
    expect(store().past.length).toBe(before + 1);
  });
});

describe('persistence', () => {
  it('reads back a saved plan with an identical structure configuration', () => {
    store().setMaterial(PERGOLA.id, 'aluminium-light');
    store().setHeight(PERGOLA.id, 2.9);
    store().setStructure(PERGOLA.id, {
      preset: 'modern',
      roof: { kind: 'slatted', finish: 'hardwood' },
      sides: { right: 'slatted' },
      lighting: true,
    });
    const saved = pergola();

    // What the layout autosave sends, through the schema the API validates it with.
    const payload = JSON.parse(JSON.stringify({ elements: store().present.elements, seededFrom: 'c1-0', pristine: null }));
    const section = LayoutSectionSchema.parse(payload);

    resetPlanEditorStoreForTests();
    hydratePlanEditorStore(section, Date.now());

    expect(pergola().structure).toEqual(saved.structure);
    expect(pergola().material).toBe('aluminium-light');
    expect(pergola().height).toBe(2.9);
    expect(pergola().shape).toEqual(saved.shape);
  });
});

describe('presets', () => {
  it('applies a whole style as one undo entry, and never the size', () => {
    const shape = structuredClone(pergola().shape);
    const before = store().past.length;
    store().setStructurePreset(PERGOLA.id, 'screened');

    expect(store().past.length).toBe(before + 1);
    expect(pergola().shape).toEqual(shape);
    expect(pergola().material).toBe('aluminium-dark');
    expect(pergola().height).toBe(2.7);
    expect(pergola().structure).toMatchObject({ preset: 'screened', model: 'modern', lighting: true });
    expect(resolveStructure(pergola())!.sides).toEqual({ left: 'slatted', right: 'open', rear: 'slatted' });
  });
});

/*
 * A pergola flush with the patio's left edge, and a border 0.2 m beyond its own left side: the
 * resize keeps the patio edge and grows towards the border, and refuses when it would reach it.
 */
describe('resizeStructure', () => {
  const FLUSH: DesignElement = {
    ...PERGOLA,
    id: 'pergola-2',
    shape: { kind: 'rect', centre: { x: 12, y: 4 }, width: 3, depth: 2, rotation: 0 },
  };
  const BORDER: DesignElement = {
    id: 'bed-1',
    category: 'planting-bed',
    role: 'fill',
    fillKind: 'accent',
    name: 'Side border',
    zone: 'back',
    shape: {
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 6, y: 2 },
        { x: 10.3, y: 2 },
        { x: 10.3, y: 6 },
        { x: 6, y: 6 },
      ],
    },
  };
  const flush = () => store().present.elements.find((element) => element.id === FLUSH.id)!;
  const flushRect = () => {
    const shape = flush().shape;
    if (shape.kind !== 'rect') throw new Error('rect');
    return shape;
  };

  beforeEach(() => {
    resetPlanEditorStoreForTests();
    store().seedFrom(concept([FLUSH, PATIO, BORDER]));
  });

  it('keeps the edge it shares with the patio and grows away from it, as one undo entry', () => {
    const before = store().past.length;
    const result = store().resizeStructure(FLUSH.id, { width: 3.1 });

    expect(result.status).toBe('ok');
    expect(store().past.length).toBe(before + 1);
    expect(flushRect().width).toBeCloseTo(3.1);
    expect(flushRect().centre.x + flushRect().width / 2).toBeCloseTo(13.5);
  });

  it('changes nothing when something is in the way, and says what', () => {
    const before = store().past.length;
    const result = store().resizeStructure(FLUSH.id, { width: 4 });

    expect(result.status).toBe('blocked');
    expect(store().past.length).toBe(before);
    expect(flushRect().width).toBe(3);
    expect(result.status === 'blocked' && result.conflicts[0]).toMatchObject({ id: 'bed-1', reason: 'overlaps' });
  });

  it('applies an alternative it offered as one undo entry', () => {
    const result = store().resizeStructure(FLUSH.id, { width: 4 });
    if (result.status !== 'blocked') throw new Error('expected the border to be in the way');
    const fit = result.alternatives.find((alternative) => alternative.kind === 'fit')!;

    const before = store().past.length;
    expect(store().applyStructureCandidate(FLUSH.id, fit.element)).toBe(true);
    expect(store().past.length).toBe(before + 1);
    expect(flushRect().width).toBeGreaterThan(3);
    expect(flushRect().width).toBeLessThanOrEqual(3.2);
  });

  /*
   * A handle drag in the 3D view: many frames, one decision. Each frame asks the same question of
   * the structure as it stood when the drag began, so the anchoring cannot drift frame by frame.
   */
  it('makes a whole handle drag one undo entry, planned from where the drag began', () => {
    const before = store().past.length;
    store().beginGesture();
    for (const width of [3.02, 3.05, 3.08, 3.1]) {
      expect(store().resizeStructureLive(FLUSH.id, { width }).status).toBe('ok');
    }
    store().endGesture();

    expect(store().past.length).toBe(before + 1);
    expect(flushRect().width).toBeCloseTo(3.1);
    // Still anchored on the patio's edge after four frames, not walked away from it.
    expect(flushRect().centre.x + flushRect().width / 2).toBeCloseTo(13.5);
  });

  it('leaves the last size that fitted when the drag runs into something', () => {
    store().beginGesture();
    store().resizeStructureLive(FLUSH.id, { width: 3.1 });
    const blocked = store().resizeStructureLive(FLUSH.id, { width: 4 });
    store().endGesture();

    expect(blocked.status).toBe('blocked');
    expect(flushRect().width).toBeCloseTo(3.1);
  });

  it('holds a dragged height to what the structure is made in', () => {
    store().beginGesture();
    store().setStructureHeightLive(FLUSH.id, 12);
    store().endGesture();
    const tallest = resolveStructure(flush())!.definition.dimensions.height.max;
    expect(flush().height).toBe(tallest);
  });

  it('refuses an alternative the plan has since outgrown', () => {
    const result = store().resizeStructure(FLUSH.id, { width: 4 });
    if (result.status !== 'blocked') throw new Error('expected the border to be in the way');
    const fit = result.alternatives.find((alternative) => alternative.kind === 'fit')!;
    // Somebody has dragged the border right up to the pergola in the meantime.
    store().setPosition(BORDER.id, { x: 8.3, y: 4 });

    expect(store().applyStructureCandidate(FLUSH.id, fit.element)).toBe(false);
    expect(flushRect().width).toBe(3);
  });
});

/*
 * What stands inside: a gazebo with a table in it, edited from the 3D editor without ever calling
 * `select`, which would close it.
 */
describe('the pieces inside', () => {
  const GAZEBO: DesignElement = {
    id: 'gazebo-1',
    category: 'structure',
    role: 'feature',
    name: 'Gazebo',
    symbol: 'gazebo',
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 3.6, depth: 3.2, rotation: 30 },
  };
  const TABLE: DesignElement = {
    id: 'table-1',
    category: 'furniture',
    role: 'feature',
    name: 'Dining set for four',
    symbol: 'dining-set-4',
    height: 0.75,
    zone: 'back',
    shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 2.4, depth: 2.4, rotation: 30 },
  };
  const find = (id: string) => store().present.elements.find((element) => element.id === id);

  beforeEach(() => {
    resetPlanEditorStoreForTests();
    store().seedFrom(concept([GAZEBO, TABLE]));
    store().openStructureEdit(GAZEBO.id);
  });

  it('picks a piece up without closing the editor', () => {
    store().selectPiece(TABLE.id);
    expect(store().structureEdit).toEqual({ elementId: GAZEBO.id, pieceId: TABLE.id });
  });

  it('swaps it for the new thing at its own size, as one undo entry', () => {
    const before = store().past.length;
    store().swapPiece(TABLE.id, 'sofa-set');
    expect(store().past.length).toBe(before + 1);
    expect(find(TABLE.id)).toMatchObject({ symbol: 'sofa-set', height: 0.8, name: 'Lounge set' });
    expect(find(TABLE.id)!.shape).toMatchObject({ width: 3, depth: 2.4 });
  });

  it('refuses a swap that will not fit, and changes nothing', () => {
    const before = store().past.length;
    store().swapPiece(TABLE.id, 'dining-set-6');
    expect(store().past.length).toBe(before);
    expect(find(TABLE.id)!.symbol).toBe('dining-set-4');
    expect(store().clash).toMatch(/will not fit/);
  });

  it('adds a piece centred and picks it up; removing it lets go', () => {
    store().deleteElement(TABLE.id);
    const id = store().addPiece(GAZEBO.id, 'bench')!;
    expect(find(id)).toMatchObject({ category: 'furniture', symbol: 'bench' });
    expect(store().structureEdit?.pieceId).toBe(id);
    store().deleteElement(id);
    expect(store().structureEdit).toEqual({ elementId: GAZEBO.id, pieceId: null });
  });

  it('holds a dragged piece inside, and the whole drag is one undo entry', () => {
    store().deleteElement(TABLE.id);
    const id = store().addPiece(GAZEBO.id, 'bench')!;
    const before = store().past.length;
    store().beginGesture();
    store().movePieceLive(id, { x: 30, y: 30 });
    store().movePieceLive(id, { x: 40, y: 8 });
    store().endGesture();
    expect(store().past.length).toBe(before + 1);
    const bench = find(id)!;
    const gazebo = find(GAZEBO.id)!;
    expect(standsInside(gazebo, bench)).toBe(true);
  });

  it('turns a piece a quarter where it still fits', () => {
    store().turnPiece(TABLE.id);
    expect(find(TABLE.id)!.shape).toMatchObject({ rotation: 120 });
  });
});
