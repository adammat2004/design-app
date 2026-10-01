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

describe('precision aids', () => {
  /**
   * The guides used to be drawn and not applied: a dashed line saying "level with the house" over a
   * patio 20 cm off it. A guide that is shown has to be true.
   */
  it('pulls a dragged shape onto an alignment it has come close to', () => {
    seed();
    // The house's left wall is at x = 6. A 3 m patio centred at 7.35 has its left edge at 5.85.
    store().moveElementLive('p1', { x: 7.35, y: 3 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBeCloseTo(7.5, 5);
    expect(store().alignments.length).toBeGreaterThan(0);
  });

  it('pulls flush to the fence, never past it', () => {
    seed();
    // A 3 m patio centred at 18.4 has its right edge at 19.9, a tenth short of the fence at x = 20.
    store().moveElementLive('p1', { x: 18.4, y: 3 });
    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x + shape.width / 2).toBeLessThanOrEqual(20);
  });

  it('leaves a drag alone when snapping is off', () => {
    seed();
    store().toggleSnap();
    store().moveElementLive('p1', { x: 7.35, y: 3 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBeCloseTo(7.35, 5);
  });

  it('tidies a dragged side to the decimetre, and only the side being changed', () => {
    seed([element({ id: 'p1', shape: { kind: 'rect', centre: { x: 3, y: 3 }, width: 3, depth: 2.137, rotation: 0 } })]);
    store().resizeElementLive('p1', { width: 3.1847, depth: 2.137 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.width).toBeCloseTo(3.2, 5);
    expect(shape.kind === 'rect' && shape.depth).toBeCloseTo(2.137, 5);
  });

  it('snaps a dragged rotation to a step, and keeps a typed one exact', () => {
    seed();
    store().rotateElementLive('p1', 31.7);
    let shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.rotation).toBe(30);

    store().rotateElementLive('p1', 22.5, { exact: true });
    shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.rotation).toBe(22.5);
  });

  it('keeps the thing armed when asked, so several can be placed', () => {
    seed([]);
    store().setPlacing('planting-bed');
    store().addElement('planting-bed', { x: 3, y: 14 }, { keepArmed: true });
    expect(store().placingCategory).toBe('planting-bed');

    store().addElement('planting-bed', { x: 3, y: 10 });
    expect(store().present.elements).toHaveLength(2);
    expect(store().placingCategory).toBeNull();
  });

  it('names a copy after the original, counting on from a number', () => {
    seed([element({ id: 'p1', category: 'furniture', name: 'Lounger' })]);
    store().duplicateElement('p1');
    const first = store().present.elements.at(-1)!;
    expect(first.name).toBe('Lounger 2');

    store().duplicateElement(first.id);
    expect(store().present.elements.at(-1)!.name).toBe('Lounger 3');
  });

  it('puts a copy on the other side when the first place is over the fence', () => {
    seed([
      element({
        id: 'p1',
        shape: { kind: 'rect', centre: { x: 18.4, y: 14.5 }, width: 3, depth: 2, rotation: 0 },
      }),
    ]);
    store().duplicateElement('p1');

    expect(store().present.elements).toHaveLength(2);
    const copy = store().present.elements.at(-1)!;
    expect(copy.shape.kind === 'rect' && copy.shape.centre).toEqual({ x: 17.4, y: 13.5 });
  });
});

describe('snapping to the plan', () => {
  /** The house is 8 × 6 centred on (10, 8), so its top-left corner is at (6, 5). */
  it('pulls a corner onto the house corner, and marks what it snapped to', () => {
    seed([element({ id: 'p1', shape: { kind: 'rect', centre: { x: 3, y: 3 }, width: 3.3, depth: 2, rotation: 0 } })]);
    store().beginGesture();
    // Grid-snapped to (4.5, 4), the patio's bottom-right corner is at (6.15, 5): 15 cm off the house.
    store().moveElementLive('p1', { x: 4.52, y: 4.03 });

    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBeCloseTo(4.35, 9);
    expect(store().snapMarker).toEqual({ x: 6, y: 5 });

    store().endGesture();
    expect(store().snapMarker).toBeNull();
  });

  it('reaches a fixed distance on screen whatever the zoom', () => {
    seed([element({ id: 'p1', shape: { kind: 'rect', centre: { x: 3, y: 3 }, width: 3.3, depth: 2, rotation: 0 } })]);
    // Zoomed right in, ten pixels is a couple of centimetres: 15 cm is too far to pull.
    store().moveElementLive('p1', { x: 4.52, y: 4.03 }, { pxPerMetre: 400 });
    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre.x).toBeCloseTo(4.5, 9);
  });

  it('snaps the tape to a corner', () => {
    seed();
    store().setMode('measure');
    store().addMeasurePoint({ x: 6.1, y: 5.1 });
    expect(store().measurement?.from).toEqual({ x: 6, y: 5 });
  });

  it('squares a rotation to the thing beside it, not only to the house', () => {
    seed([
      element({ id: 'p1' }),
      element({
        id: 'b1',
        category: 'planting-bed',
        shape: { kind: 'rect', centre: { x: 4, y: 7 }, width: 3, depth: 1, rotation: 23 },
      }),
    ]);
    store().rotateElementLive('p1', 25);
    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.rotation).toBe(23);
  });
});

describe('corner editing', () => {
  const BED = element({
    id: 'b1',
    category: 'planting-bed',
    name: 'Border',
    shape: {
      kind: 'polygon',
      points: [
        { x: 2, y: 10 },
        { x: 6, y: 10 },
        { x: 6, y: 13 },
        { x: 2, y: 13 },
      ],
      cornerRadius: 0,
    },
  });

  const points = () => {
    const shape = store().present.elements[0].shape;
    return shape.kind === 'polygon' ? shape.points : [];
  };

  it('drags a corner, snapped, as one undo entry', () => {
    seed([BED]);
    store().toggleSnap();
    const before = store().past.length;
    store().beginGesture();
    store().moveVertexLive('b1', 2, { x: 7.2, y: 13.4 });
    store().endGesture();

    expect(points()[2]).toEqual({ x: 7.2, y: 13.4 });
    expect(store().past.length).toBe(before + 1);
  });

  /** A bow tie has an ordinary vertex list and a quietly wrong area; nothing downstream would say. */
  it('refuses a corner dragged through the outline, and says why', () => {
    seed([BED]);
    store().toggleSnap();
    store().moveVertexLive('b1', 2, { x: 6, y: 9 });
    expect(points()[2]).toEqual({ x: 6, y: 13 });
    expect(store().clash).toBe('That outline would cross itself.');
  });

  it('refuses a corner over the fence', () => {
    seed([BED]);
    store().toggleSnap();
    store().moveVertexLive('b1', 1, { x: 21, y: 10 });
    expect(points()[1]).toEqual({ x: 6, y: 10 });
    expect(store().clash).toContain('boundary');
  });

  it('adds a corner on an edge and removes it again, never below three', () => {
    seed([BED]);
    store().insertVertex('b1', 0, { x: 4, y: 9.5 });
    expect(points()).toHaveLength(5);
    store().deleteVertex('b1', 1);
    expect(points()).toHaveLength(4);
    store().deleteVertex('b1', 0);
    store().deleteVertex('b1', 0);
    expect(points()).toHaveLength(3);
    expect(store().clash).toMatch(/three corners/);
  });

  /** Side indices renumber when a corner is added, so a custom edge plan cannot stay where it was. */
  it('sends custom edging back to automatic when the corner count changes', () => {
    seed([{ ...BED, edges: { mode: 'custom', runs: [] } }]);
    store().insertVertex('b1', 0, { x: 4, y: 9.5 });
    expect(store().present.elements[0].edges).toEqual({ mode: 'auto', runs: [] });
  });

  it('sets a side’s length by moving one corner', () => {
    seed([BED]);
    store().setSideLength('b1', 0, 5);
    expect(points()[1]).toEqual({ x: 7, y: 10 });
    expect(points()[0]).toEqual({ x: 2, y: 10 });
  });

  it('turns a rectangular surface into a free shape with the same corners', () => {
    seed([element({ id: 'p1', shape: { kind: 'rect', centre: { x: 4, y: 4 }, width: 4, depth: 2, rotation: 0 } })]);
    store().convertToPolygon('p1');
    expect(store().present.elements[0].shape).toEqual({
      kind: 'polygon',
      cornerRadius: 0,
      points: [
        { x: 2, y: 3 },
        { x: 6, y: 3 },
        { x: 6, y: 5 },
        { x: 2, y: 5 },
      ],
    });
  });

  /** A pergola or a table *is* its rectangle — its parts, furniture and 3D model are read off it. */
  it('never frees a structure, a piece of furniture or a locked surface', () => {
    for (const over of [
      { category: 'structure' as const, symbol: 'pergola' },
      { category: 'furniture' as const, symbol: 'bench' },
      { locked: true },
    ]) {
      seed([element({ id: 'p1', ...over })]);
      store().convertToPolygon('p1');
      expect(store().present.elements[0].shape.kind).toBe('rect');
    }
  });

  it('opens only on a free shape, and ends when something else is selected', () => {
    seed([BED, element({ id: 'p1' })]);
    store().openVertexEdit('p1');
    expect(store().vertexEdit).toBeNull();
    store().openVertexEdit('b1');
    expect(store().vertexEdit).toEqual({ id: 'b1', selectedIndex: null });
    store().select('p1');
    expect(store().vertexEdit).toBeNull();
  });
});

describe('drawing a surface', () => {
  it('draws a shape corner by corner and closes it on the first', () => {
    seed([]);
    store().toggleSnap();
    store().setPlacing('paved-area');
    store().setPlacingTool('polygon');
    for (const at of [
      { x: 2, y: 10 },
      { x: 6, y: 10 },
      { x: 6, y: 13 },
      { x: 4, y: 14 },
    ]) {
      store().addDraftPoint(at);
    }
    store().addDraftPoint({ x: 2.2, y: 10.1 });

    const [drawn] = store().present.elements;
    expect(drawn?.shape.kind === 'polygon' && drawn.shape.points).toHaveLength(4);
    expect(drawn?.category).toBe('paved-area');
    expect(store().placingCategory).toBeNull();
    expect(store().draftPoints).toEqual([]);
  });

  it('squares each corner to the side before it', () => {
    seed([]);
    store().setPlacing('lawn');
    store().setPlacingTool('polygon');
    // Clear of the house, whose wall would otherwise claim the click before the right angle does.
    store().addDraftPoint({ x: 2, y: 12.6 });
    store().addDraftPoint({ x: 4.1, y: 12.9 });
    store().addDraftPoint({ x: 4.3, y: 14.8 });
    expect(store().draftPoints[2]!.x).toBeCloseTo(store().draftPoints[1]!.x, 9);
  });

  it('draws a path and finishes it, at the default width', () => {
    seed([]);
    store().toggleSnap();
    store().setPlacing('gravel-mulch');
    store().setPlacingTool('polyline');
    store().addDraftPoint({ x: 2, y: 12 });
    store().addDraftPoint({ x: 8, y: 12 });
    store().finishDraft();

    const [path] = store().present.elements;
    expect(path?.shape).toEqual({ kind: 'polyline', points: [{ x: 2, y: 12 }, { x: 8, y: 12 }], width: 1 });
  });

  it('draws a screen along the fence line, on the line, at the screen’s own thickness', () => {
    seed([]);
    store().toggleSnap();
    store().setPlacingEnclosure('screen');
    expect(store().placingTool).toBe('polyline');
    store().addDraftPoint({ x: 0, y: 4 });
    store().addDraftPoint({ x: 0, y: 12 });
    store().finishDraft();

    const [screen] = store().present.elements;
    expect(screen).toMatchObject({
      category: 'enclosure',
      material: 'slatted-screen',
      enclosure: { kind: 'screen' },
      shape: { kind: 'polyline', width: 0.08 },
    });
    // It stands on the boundary, which its band straddles: judged on its line, it is legal.
    expect(store().clash).toBeNull();
    expect(store().placingEnclosure).toBeNull();
  });

  it('turns a fence into a wall with the wall’s thickness and material, and back in one undo', () => {
    seed([]);
    store().toggleSnap();
    store().setPlacingEnclosure('fence');
    store().addDraftPoint({ x: 3, y: 12 });
    store().addDraftPoint({ x: 9, y: 12 });
    store().finishDraft();
    const id = store().present.elements[0]!.id;

    store().setEnclosure(id, { kind: 'wall' });
    expect(store().present.elements[0]).toMatchObject({
      material: 'brick-garden-wall',
      enclosure: { kind: 'wall' },
      shape: { width: 0.22 },
    });
    store().undo();
    expect(store().present.elements[0]).toMatchObject({ enclosure: { kind: 'fence' } });
  });

  it('refuses to finish what is not yet a shape, and keeps the drawing', () => {
    seed([]);
    store().setPlacing('paved-area');
    store().setPlacingTool('polygon');
    store().addDraftPoint({ x: 2, y: 10 });
    store().finishDraft();
    expect(store().present.elements).toEqual([]);
    expect(store().draftPoints).toHaveLength(1);
    expect(store().clash).toMatch(/three corners/);
  });

  it('drops a dragged-out rectangle at the size it was dragged', () => {
    seed([]);
    store().setPlacing('planting-bed');
    store().addElement('planting-bed', { x: 5, y: 12 }, { size: { width: 4.2, depth: 1.8 } });
    expect(store().present.elements[0]?.shape).toMatchObject({ kind: 'rect', width: 4.2, depth: 1.8, centre: { x: 5, y: 12 } });
  });

  it('offers a path only for paving and gravel', () => {
    seed([]);
    store().setPlacing('paved-area');
    store().setPlacingTool('polyline');
    store().setPlacing('lawn');
    expect(store().placingTool).toBe('rect');
  });
});

describe('selecting several', () => {
  const two = () => [
    element({ id: 'p1' }),
    element({ id: 'p2', name: 'Bench pad', shape: { kind: 'rect', centre: { x: 3, y: 7 }, width: 2, depth: 1, rotation: 0 } }),
    BASE_FILL,
  ];

  it('adds with Shift and takes away again, the last one primary', () => {
    seed(two());
    store().select('p1');
    store().select('p2', { additive: true });
    expect(store().selectedIds).toEqual(['p1', 'p2']);
    expect(store().selectedId).toBe('p2');
    store().select('p2', { additive: true });
    expect(store().selectedIds).toEqual(['p1']);
    expect(store().selectedId).toBe('p1');
  });

  /** The AI run selects on every animation frame; a fresh array each time re-renders at frame rate. */
  it('does not change state when the selection did not change', () => {
    seed(two());
    store().select('p1');
    const before = store();
    store().select('p1');
    expect(store()).toBe(before);
  });

  it('moves the whole selection by the dragged one, as one undo entry', () => {
    seed(two());
    store().select('p1');
    store().select('p2', { additive: true });
    store().toggleSnap();
    const undo = store().past.length;
    store().beginGesture();
    store().moveElementLive('p1', { x: 5, y: 3 });
    store().endGesture();

    const [p1, p2] = store().present.elements;
    expect(p1!.shape.kind === 'rect' && p1!.shape.centre).toEqual({ x: 5, y: 3 });
    expect(p2!.shape.kind === 'rect' && p2!.shape.centre).toEqual({ x: 5, y: 7 });
    expect(store().past.length).toBe(undo + 1);
  });

  it('refuses the whole move when one member would cross the fence', () => {
    seed(two());
    store().selectMany(['p1', 'p2']);
    store().toggleSnap();
    // p2 is 4 m below p1; taking p1 to y = 13 would put p2 at 17, past the fence at 16.
    store().moveElementLive('p1', { x: 3, y: 13 });
    const [p1, p2] = store().present.elements;
    expect(p1!.shape.kind === 'rect' && p1!.shape.centre).toEqual({ x: 3, y: 3 });
    expect(p2!.shape.kind === 'rect' && p2!.shape.centre).toEqual({ x: 3, y: 7 });
    expect(store().clash).toContain('boundary');
  });

  it('sweeps a selection with the marquee, touching counts, and never the ground', () => {
    seed(two());
    store().beginMarquee({ x: 0.5, y: 2.5 });
    store().trackMarquee({ x: 2.5, y: 7 });
    expect(store().commitMarquee()).toBe(true);
    expect(store().selectedIds).toEqual(['p1', 'p2']);
  });

  it('deletes and duplicates the group as one undo entry each', () => {
    seed(two());
    store().selectMany(['p1', 'p2']);
    const undo = store().past.length;
    store().duplicateSelection();
    expect(store().present.elements).toHaveLength(5);
    expect(store().selectedIds).toHaveLength(2);
    expect(store().past.length).toBe(undo + 1);

    store().deleteSelection();
    expect(store().present.elements.map((entry) => entry.id)).toEqual(['p1', 'p2', 'g1']);
    expect(store().selectedIds).toEqual([]);
  });

  it('gives a material to a group of one kind, and not to a mixed one', () => {
    seed([...two(), element({ id: 'b1', category: 'planting-bed' })]);
    store().selectMany(['p1', 'p2']);
    store().setMaterialForSelection('porcelain');
    expect(store().present.elements.filter((entry) => entry.material === 'porcelain')).toHaveLength(2);

    store().selectMany(['p1', 'b1']);
    store().setMaterialForSelection('concrete');
    expect(store().present.elements.some((entry) => entry.material === 'concrete')).toBe(false);
  });

  it('lets go of what an undo took off the plan, and selects what a redo brings back', () => {
    seed(two());
    store().select('p1');
    store().duplicateElement('p1');
    const copy = store().selectedId!;
    store().undo();
    expect(store().selectedIds).not.toContain(copy);
    expect(store().selectedId).toBeNull();

    store().redo();
    expect(store().selectedIds).toEqual([copy]);
  });

  it('selects what an undone delete puts back', () => {
    seed(two());
    store().selectMany(['p1', 'p2']);
    store().deleteSelection();
    store().undo();
    expect(store().selectedIds).toEqual(['p1', 'p2']);
  });
});

describe('the user lock', () => {
  it('holds an element still by hand, and says why', () => {
    seed();
    store().toggleLocked(['p1']);
    expect(store().present.elements[0].locked).toBe(true);

    store().moveElementLive('p1', { x: 8, y: 3 });
    const shape = store().present.elements[0].shape;
    expect(shape.kind === 'rect' && shape.centre).toEqual({ x: 3, y: 3 });

    store().resizeElementLive('p1', { width: 5 });
    expect(store().clash).toMatch(/locked/i);
    store().deleteElement('p1');
    expect(store().present.elements.map((entry) => entry.id)).toContain('p1');
  });

  /** The lock is on geometry by hand: a name or a material still changes. */
  it('still lets a person change what does not move anything', () => {
    seed();
    store().toggleLocked(['p1']);
    store().setMaterial('p1', 'porcelain');
    store().renameElement('p1', 'Quoted terrace');
    expect(store().present.elements[0]).toMatchObject({ material: 'porcelain', name: 'Quoted terrace' });
  });

  /** Against the designer it holds everything, its material included. */
  it('refuses every line of a proposal about a locked element', () => {
    seed([element({ id: 'p1', material: 'stone-pavers' }), BASE_FILL]);
    store().toggleLocked(['p1']);
    const changes = materialSwaps({ p1: 'concrete' });
    const outcome = store().applyProposal(changes, changes.map((change) => change.id));
    expect(outcome.applied).toEqual([]);
    expect(outcome.refused[0]?.reason).toMatch(/locked/i);
    expect(store().present.elements[0].material).toBe('stone-pavers');
  });

  it('unlocks all when every one is locked, locks all otherwise, as one undo', () => {
    seed([element({ id: 'p1' }), element({ id: 'p2', shape: { kind: 'rect', centre: { x: 8, y: 3 }, width: 2, depth: 2, rotation: 0 } }), BASE_FILL]);
    const before = store().past.length;
    store().toggleLocked(['p1', 'p2', 'g1']);
    expect(store().present.elements.filter((entry) => entry.locked).map((entry) => entry.id)).toEqual(['p1', 'p2']);
    expect(store().past.length).toBe(before + 1);

    store().toggleLocked(['p1', 'p2']);
    expect(store().present.elements.some((entry) => entry.locked)).toBe(false);
  });
});

describe('view groups', () => {
  it('hides a whole group from what is drawn, and lets go of a selection inside it', () => {
    seed([element({ id: 'p1' }), element({ id: 'f1', category: 'furniture', name: 'Bench' })]);
    store().select('f1');
    store().toggleGroup('furniture');

    expect(store().hiddenGroups).toEqual(['furniture']);
    expect(store().selectedId).toBeNull();

    store().toggleGroup('furniture');
    expect(store().hiddenGroups).toEqual([]);
  });

  it('is a view preference, not an edit', () => {
    seed();
    const before = store().past.length;
    store().toggleGroup('hardscape');
    expect(store().past.length).toBe(before);
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
  it('gives a tree its new species’ height and spread, not the old one’s', () => {
    seed([bed, { ...tree, height: 12 }]);
    store().replaceSymbol('tree', 'tree-deciduous', 'sorbus-aucuparia');
    const rowan = store().present.elements.find((e) => e.id === 'tree')!;
    expect(rowan.height).toBeLessThan(12);
    expect(rowan.shape).toMatchObject({ radius: expect.any(Number) });
    expect((rowan.shape as { radius: number }).radius).not.toBe(0.6);
  });

  it('plants a bed with a mix of its own, and a chosen mix replaces it in one undo step each', () => {
    seed([{ ...bed, material: 'mix-sunny-gravel' }, tree]);
    store().setPlanting('bed', { mix: [{ speciesId: 'festuca-glauca', share: 3 }, { speciesId: 'thymus-serpyllum', share: 1 }] });
    const own = store().present.elements.find((e) => e.id === 'bed')!;
    expect(own.planting?.mix.map((entry) => entry.share)).toEqual([0.75, 0.25]);

    store().setMaterial('bed', 'mix-shade-woodland');
    const chosen = store().present.elements.find((e) => e.id === 'bed')!;
    expect(chosen.material).toBe('mix-shade-woodland');
    expect(chosen.planting).toBeUndefined();

    store().undo();
    expect(store().present.elements.find((e) => e.id === 'bed')!.planting).toBeDefined();
    // A material that is not a mix is only the drawing base: the bed's own mix stays.
    store().setMaterial('bed', 'mixed-border');
    expect(store().present.elements.find((e) => e.id === 'bed')!.planting).toBeDefined();
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
