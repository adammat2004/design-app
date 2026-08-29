import { beforeEach, describe, expect, it } from 'vitest';
import { featureAnchor, featureArea, summariseFeatures } from '@/lib/features';
import { zoneAt } from '@/lib/zones';
import { resetBoundaryStoreForTests, selectZones, useBoundaryStore } from './boundary-store';
import { resetFeaturesStoreForTests, useFeaturesStore } from './features-store';

const store = () => useFeaturesStore.getState();

/** Step 1's output: a 20 m x 16 m plot with an 8 m x 6 m house in the middle of it. */
function mapProperty(): void {
  const boundary = useBoundaryStore.getState();
  boundary.addVertexAt({ x: 0, y: 0 });
  boundary.addVertexAt({ x: 20, y: 0 });
  boundary.addVertexAt({ x: 20, y: 16 });
  boundary.addVertexAt({ x: 0, y: 16 });
  boundary.closeShape();
  useBoundaryStore.getState().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
}

/** Drops a tree well clear of the house and returns its id. */
function placeTree(at = { x: 2, y: 2 }): string {
  store().startPlacing('tree');
  store().placePointAt(at);

  const feature = store().present.features.at(-1);
  if (!feature) throw new Error('expected a placed feature');
  return feature.id;
}

function placePatio(): string {
  store().startPlacing('patio');
  store().addDraftPoint({ x: 1, y: 12 });
  store().addDraftPoint({ x: 5, y: 12 });
  store().addDraftPoint({ x: 5, y: 15 });
  store().addDraftPoint({ x: 1, y: 15 });
  store().finishDraft();

  const feature = store().present.features.at(-1);
  if (!feature) throw new Error('expected a placed feature');
  return feature.id;
}

function statuses(): string[] {
  return store().present.features.map((feature) => feature.status);
}

beforeEach(() => {
  // Both stores are module singletons and would otherwise leak between cases.
  resetBoundaryStoreForTests();
  resetFeaturesStoreForTests();
  mapProperty();
});

describe('placing features', () => {
  it('starts a point feature as Keep, with no replacement note', () => {
    placeTree();

    const [tree] = store().present.features;
    expect(tree.status).toBe('keep');
    expect(tree.replaceWith).toBeNull();
  });

  it('selects what was just placed and drops back to select mode', () => {
    const id = placeTree();

    expect(store().selectedIds).toEqual([id]);
    expect(store().mode).toBe('select');
    expect(store().placingKind).toBeNull();
  });

  it('names duplicates apart', () => {
    placeTree({ x: 2, y: 2 });
    placeTree({ x: 4, y: 2 });

    expect(store().present.features.map((feature) => feature.name)).toEqual(['Tree', 'Tree 2']);
  });

  it('closes a polygon when the last click lands back on the first point', () => {
    store().startPlacing('patio');
    store().addDraftPoint({ x: 1, y: 12 });
    store().addDraftPoint({ x: 5, y: 12 });
    store().addDraftPoint({ x: 5, y: 15 });
    store().addDraftPoint({ x: 1.1, y: 12.1 });

    expect(store().present.features).toHaveLength(1);
    expect(store().draftPoints).toEqual([]);
  });

  it('refuses to finish a polygon with too few points', () => {
    store().startPlacing('patio');
    store().addDraftPoint({ x: 1, y: 12 });
    store().addDraftPoint({ x: 5, y: 12 });
    store().finishDraft();

    expect(store().present.features).toHaveLength(0);
    expect(store().draftPoints).toHaveLength(2);
  });

  it('ignores a click repeated on the last point, so double-click-to-finish leaves no duplicate', () => {
    store().startPlacing('path');
    store().addDraftPoint({ x: 0, y: 14 });
    store().addDraftPoint({ x: 10, y: 14 });
    store().addDraftPoint({ x: 10, y: 14 });

    expect(store().draftPoints).toHaveLength(2);
  });

  it('gives a line feature its type’s width', () => {
    store().startPlacing('path');
    store().addDraftPoint({ x: 0, y: 14 });
    store().addDraftPoint({ x: 10, y: 14 });
    store().finishDraft();

    const [path] = store().present.features;
    expect(path.geometry).toMatchObject({ kind: 'polyline', width: 1 });
    // 10 m of 1 m path.
    expect(featureArea(path)).toBeCloseTo(10, 6);
  });

  it('snaps placement to the grid while snapping is on', () => {
    placeTree({ x: 2.2, y: 2.3 });

    expect(featureAnchor(store().present.features[0])).toEqual({ x: 2, y: 2.5 });
  });

  it('places exactly where clicked once snapping is off', () => {
    store().toggleSnap();
    placeTree({ x: 2.2, y: 2.3 });

    expect(featureAnchor(store().present.features[0])).toEqual({ x: 2.2, y: 2.3 });
  });
});

describe('the house constraint', () => {
  it('refuses a feature dropped on the house and commits nothing', () => {
    store().startPlacing('tree');
    store().placePointAt({ x: 10, y: 8 });

    expect(store().present.features).toHaveLength(0);
    expect(store().past).toHaveLength(0);
    expect(store().clash).not.toBeNull();
  });

  it('allows a feature flush against a house wall', () => {
    store().startPlacing('patio');
    store().addDraftPoint({ x: 6, y: 11 });
    store().addDraftPoint({ x: 14, y: 11 });
    store().addDraftPoint({ x: 14, y: 15 });
    store().addDraftPoint({ x: 6, y: 15 });
    store().finishDraft();

    expect(store().present.features).toHaveLength(1);
  });

  it('drops a drag that would put a feature on the house', () => {
    const id = placeTree();
    const before = featureAnchor(store().present.features[0]);

    store().moveFeatureLive(id, { x: 10, y: 8 });

    expect(featureAnchor(store().present.features[0])).toEqual(before);
  });

  it('refuses a nudge onto the house', () => {
    const id = placeTree({ x: 4.5, y: 8 });
    const before = featureAnchor(store().present.features[0]);

    // The tree's 1.5 m radius already reaches x = 6, so a step right lands it on the wall.
    store().select(id);
    store().nudgeSelection(1, 0);

    expect(featureAnchor(store().present.features[0])).toEqual(before);
  });
});

describe('status', () => {
  it('records a change and leaves it on the undo stack', () => {
    const id = placeTree();
    const historyBefore = store().past.length;

    store().setStatus(id, 'remove');

    expect(statuses()).toEqual(['remove']);
    expect(store().past).toHaveLength(historyBefore + 1);

    store().undo();
    expect(statuses()).toEqual(['keep']);
  });

  it('does not record setting the status it already has', () => {
    const id = placeTree();
    const historyBefore = store().past.length;

    store().setStatus(id, 'keep');

    expect(store().past).toHaveLength(historyBefore);
  });

  it('keeps the replacement note while the answer is still Replace', () => {
    const id = placeTree();
    store().setStatus(id, 'replace');
    store().setReplaceWith(id, 'Deck');

    expect(store().present.features[0].replaceWith).toBe('Deck');
  });

  it('clears the replacement note when the answer changes', () => {
    const id = placeTree();
    store().setStatus(id, 'replace');
    store().setReplaceWith(id, 'Deck');
    store().setStatus(id, 'keep');

    expect(store().present.features[0].replaceWith).toBeNull();
  });

  it('ignores a replacement note on something that is not being replaced', () => {
    const id = placeTree();
    store().setReplaceWith(id, 'Deck');

    expect(store().present.features[0].replaceWith).toBeNull();
  });

  it('treats an emptied note as unset', () => {
    const id = placeTree();
    store().setStatus(id, 'replace');
    store().setReplaceWith(id, 'Deck');
    store().setReplaceWith(id, '   ');

    expect(store().present.features[0].replaceWith).toBeNull();
  });
});

describe('history', () => {
  it('records one entry for a drag, whatever its length', () => {
    const id = placeTree();
    const historyBefore = store().past.length;

    store().beginGesture();
    store().moveFeatureLive(id, { x: 3, y: 3 });
    store().moveFeatureLive(id, { x: 4, y: 4 });
    store().moveFeatureLive(id, { x: 5, y: 5 });
    store().endGesture();

    expect(store().past).toHaveLength(historyBefore + 1);

    store().undo();
    expect(featureAnchor(store().present.features[0])).toEqual({ x: 2, y: 2 });
  });

  it('records nothing for a drag that ends where it started', () => {
    const id = placeTree();
    const historyBefore = store().past.length;

    store().beginGesture();
    store().moveFeatureLive(id, { x: 6, y: 2 });
    store().moveFeatureLive(id, { x: 2, y: 2 });
    store().endGesture();

    expect(store().past).toHaveLength(historyBefore);
  });

  it('covers add, delete and redo', () => {
    const id = placeTree();
    store().deleteFeature(id);
    expect(store().present.features).toHaveLength(0);

    store().undo();
    expect(store().present.features).toHaveLength(1);

    store().redo();
    expect(store().present.features).toHaveLength(0);
  });

  it('discards the abandoned future once a new edit branches off', () => {
    const id = placeTree();
    store().setStatus(id, 'remove');
    store().undo();

    expect(store().future).toHaveLength(1);
    store().setStatus(id, 'replace');
    expect(store().future).toHaveLength(0);
  });

  it('clears the selection on undo, so no panel points at a feature that is gone', () => {
    const id = placeTree();
    store().deleteFeature(id);
    store().undo();

    expect(store().selectedIds).toEqual([]);
  });

  it('does not rewind the property drawn on step 1', () => {
    placeTree();
    const houseBefore = useBoundaryStore.getState().present.house;

    store().undo();
    store().undo();

    expect(useBoundaryStore.getState().present.house).toBe(houseBefore);
    expect(useBoundaryStore.getState().present.closed).toBe(true);
  });
});

describe('renaming', () => {
  it('trims and applies a new name', () => {
    const id = placeTree();
    store().renameFeature(id, '  Oak tree  ');

    expect(store().present.features[0].name).toBe('Oak tree');
  });

  it('refuses an empty name rather than leaving a blank row', () => {
    const id = placeTree();
    store().renameFeature(id, '   ');

    expect(store().present.features[0].name).toBe('Tree');
  });
});

describe('the summary', () => {
  it('counts what is actually placed', () => {
    const tree = placeTree();
    const patio = placePatio();

    store().setStatus(tree, 'remove');
    store().setStatus(patio, 'replace');

    expect(summariseFeatures(store().present.features)).toEqual({
      total: 2,
      keep: 0,
      remove: 1,
      replace: 1,
    });
  });
});

describe('skipping the step', () => {
  it('records the answer without touching the feature list', () => {
    store().setSkipped(true);

    expect(store().skipped).toBe(true);
    expect(store().present.features).toHaveLength(0);
  });
});

describe('reset', () => {
  it('clears the garden but leaves it undoable', () => {
    placeTree();
    store().resetFeatures();

    expect(store().present.features).toHaveLength(0);

    store().undo();
    expect(store().present.features).toHaveLength(1);
  });
});

describe('multi-select', () => {
  it('replaces the selection on a plain select', () => {
    const first = placeTree({ x: 2, y: 2 });
    const second = placeTree({ x: 5, y: 2 });

    store().select(first);
    store().select(second);

    expect(store().selectedIds).toEqual([second]);
  });

  it('adds and removes with an additive select', () => {
    const first = placeTree({ x: 2, y: 2 });
    const second = placeTree({ x: 5, y: 2 });

    store().select(first);
    store().select(second, { additive: true });
    expect(store().selectedIds).toEqual([first, second]);

    store().select(first, { additive: true });
    expect(store().selectedIds).toEqual([second]);
  });

  it('sweeps up everything the marquee touches, not only what it swallows whole', () => {
    const tree = placeTree({ x: 2, y: 2 });
    const patio = placePatio();

    // A box over the tree that only grazes the patio.
    store().beginMarquee({ x: 0, y: 0 });
    store().trackMarquee({ x: 3, y: 12.5 });
    store().commitMarquee();

    expect(store().selectedIds).toContain(tree);
    expect(store().selectedIds).toContain(patio);
    expect(store().marquee).toBeNull();
  });

  /*
   * The box is only reachable with Shift held, which already means "extend the selection" on a
   * click — so a sweep adds to what was picked rather than replacing it.
   */
  it('adds to the selection rather than replacing it', () => {
    const tree = placeTree({ x: 2, y: 2 });
    const patio = placePatio();

    store().select(tree);
    store().beginMarquee({ x: 0, y: 11 });
    store().trackMarquee({ x: 6, y: 16 });
    store().commitMarquee();

    expect(store().selectedIds).toEqual([tree, patio]);
  });

  it('leaves the selection untouched when the marquee lands on empty ground', () => {
    const tree = placeTree({ x: 2, y: 2 });
    store().select(tree);

    store().beginMarquee({ x: 15, y: 1 });
    store().trackMarquee({ x: 18, y: 3 });
    store().commitMarquee();

    expect(store().selectedIds).toEqual([tree]);
  });

  it('does not add the same feature twice', () => {
    const tree = placeTree({ x: 2, y: 2 });
    store().select(tree);

    store().beginMarquee({ x: 0, y: 0 });
    store().trackMarquee({ x: 6, y: 6 });
    store().commitMarquee();

    expect(store().selectedIds).toEqual([tree]);
  });
});

describe('group edits', () => {
  it('moves every selected feature by the same delta', () => {
    // Snapping off, so the assertion is about the group mechanics rather than where the grid
    // and the alignment guides happened to pull the pair.
    store().toggleSnap();

    // Both well down the left-hand side, so the whole column stays clear of the house.
    const first = placeTree({ x: 2, y: 2 });
    const second = placeTree({ x: 2, y: 6 });

    store().select(first);
    store().select(second, { additive: true });

    const before = store().present.features.map(featureAnchor);
    store().moveFeatureLive(first, { x: 3, y: 3 });
    const after = store().present.features.map(featureAnchor);

    // The dragged one lands where it was put, and the gap between them is unchanged.
    expect(after[0]).toEqual({ x: 3, y: 3 });
    expect(after[1].x - after[0].x).toBeCloseTo(before[1].x - before[0].x, 6);
    expect(after[1].y - after[0].y).toBeCloseTo(before[1].y - before[0].y, 6);
  });

  it('drops the whole frame if any member would land illegally', () => {
    const clear = placeTree({ x: 2, y: 2 });
    const nearFence = placeTree({ x: 2, y: 14 });

    store().select(clear);
    store().select(nearFence, { additive: true });

    const before = store().present.features.map(featureAnchor);
    // Dragging the clear one down would push the other through the fence, so neither moves.
    store().moveFeatureLive(clear, { x: 2, y: 5 });

    expect(store().present.features.map(featureAnchor)).toEqual(before);
  });

  it('deletes and status-changes the whole selection', () => {
    const first = placeTree({ x: 2, y: 2 });
    const second = placeTree({ x: 5, y: 2 });

    store().select(first);
    store().select(second, { additive: true });
    store().setSelectionStatus('remove');
    expect(statuses()).toEqual(['remove', 'remove']);

    store().select(first);
    store().select(second, { additive: true });
    store().deleteSelection();
    expect(store().present.features).toHaveLength(0);

    store().undo();
    expect(store().present.features).toHaveLength(2);
  });

  it('records nothing when the whole selection already has that status', () => {
    const id = placeTree();
    store().select(id);

    const historyBefore = store().past.length;
    store().setSelectionStatus('keep');

    expect(store().past).toHaveLength(historyBefore);
  });
});

describe('shape editing', () => {
  /** The patio corners, for readability in the cases below. */
  function corners(): { x: number; y: number }[] {
    const patio = store().present.features[0];
    return patio.geometry.kind === 'polygon' ? patio.geometry.points : [];
  }

  it('moves a corner and leaves one history entry per gesture', () => {
    const id = placePatio();
    store().setEditingShape(id);

    const historyBefore = store().past.length;
    store().beginGesture();
    store().moveVertexLive(id, 0, { x: 2, y: 12 });
    store().moveVertexLive(id, 0, { x: 3, y: 12 });
    store().endGesture();

    expect(corners()[0]).toEqual({ x: 3, y: 12 });
    expect(store().past).toHaveLength(historyBefore + 1);

    store().undo();
    expect(corners()[0]).toEqual({ x: 1, y: 12 });
  });

  it('adds a corner part way along a side', () => {
    const id = placePatio();
    store().insertVertex(id, 0, { x: 3, y: 12 });

    expect(corners()).toHaveLength(5);
    expect(corners()[1]).toEqual({ x: 3, y: 12 });
  });

  it('removes a corner', () => {
    const id = placePatio();
    store().deleteVertex(id, 0);

    expect(corners()).toHaveLength(3);
  });

  it('refuses to take a polygon below three corners', () => {
    const id = placePatio();
    store().deleteVertex(id, 0);
    store().deleteVertex(id, 0);

    expect(corners()).toHaveLength(3);
  });

  it('refuses a corner dragged onto the house', () => {
    const id = placePatio();
    store().setEditingShape(id);

    const before = corners();
    store().moveVertexLive(id, 0, { x: 10, y: 8 });

    expect(corners()).toEqual(before);
  });

  it('refuses a corner dragged over the fence', () => {
    const id = placePatio();
    store().setEditingShape(id);

    const before = corners();
    store().moveVertexLive(id, 0, { x: -5, y: 12 });

    expect(corners()).toEqual(before);
  });

  it('selects the shape it is about to reshape', () => {
    const id = placePatio();
    store().setEditingShape(id);

    expect(store().selectedIds).toEqual([id]);
  });
});

describe('resize, rotate and rounding', () => {
  function placeShed(): string {
    store().startPlacing('shed');
    store().placeRectangle({ x: 3, y: 3 }, 2.5, 2);

    const feature = store().present.features.at(-1);
    if (!feature) throw new Error('expected a placed feature');
    return feature.id;
  }

  it('resizes and rotates, both undoable as one gesture', () => {
    const id = placeShed();
    const historyBefore = store().past.length;

    store().beginGesture();
    store().resizeFeatureLive(id, { width: 4 });
    store().rotateFeatureLive(id, 90);
    store().endGesture();

    expect(store().present.features[0].geometry).toMatchObject({ width: 4, rotation: 90 });
    expect(store().past).toHaveLength(historyBefore + 1);

    store().undo();
    expect(store().present.features[0].geometry).toMatchObject({ width: 2.5, rotation: 0 });
  });

  it('refuses a resize that would reach the house', () => {
    const id = placeShed();
    const before = store().present.features[0].geometry;

    store().resizeFeatureLive(id, { width: 20 });

    expect(store().present.features[0].geometry).toEqual(before);
  });

  it('rounds corners, undoably, and the area follows', () => {
    const id = placePatio();
    const square = featureArea(store().present.features[0]);

    store().setCornerRadius(id, 0.5);

    expect(store().present.features[0].geometry).toMatchObject({ cornerRadius: 0.5 });
    expect(featureArea(store().present.features[0])).toBeLessThan(square);

    store().undo();
    expect(featureArea(store().present.features[0])).toBeCloseTo(square, 6);
  });
});

describe('the boundary constraint', () => {
  it('refuses a feature placed outside the plot', () => {
    store().startPlacing('tree');
    store().placePointAt({ x: 40, y: 40 });

    expect(store().present.features).toHaveLength(0);
    expect(store().clash).not.toBeNull();
  });

  it('refuses one straddling the fence', () => {
    store().startPlacing('tree');
    // A 1.5 m radius canopy centred half a metre in hangs over the boundary.
    store().placePointAt({ x: 0.5, y: 8 });

    expect(store().present.features).toHaveLength(0);
  });
});

describe('zone re-derivation', () => {
  it('reports a different zone once an edit carries a feature across the line', () => {
    // At 0 degrees the house faces +y, so the front garden is below it and the back above.
    const id = placeTree({ x: 10, y: 14 });
    const zones = () => selectZones(useBoundaryStore.getState());

    expect(zoneAt(featureAnchor(store().present.features[0]), zones())?.id).toBe('front');

    store().select(id);
    store().beginGesture();
    store().moveFeatureLive(id, { x: 10, y: 2 });
    store().endGesture();

    expect(zoneAt(featureAnchor(store().present.features[0]), zones())?.id).toBe('back');
  });
});
