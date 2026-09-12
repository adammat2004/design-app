import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { houseWalls } from '@garden-studio/schema';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { SelectedObjectPanel } from '../SelectedObjectPanel';
import { pointerOffset } from './SegmentTrack';

/**
 * The segment unrolled flat: the arithmetic that turns a pointer into a distance, and the drag
 * that uses it. Shared by the wall strip and the side editor, so the drag is tested once here
 * through the wall — the side's is the same component with different items.
 */

const store = () => useBoundaryStore.getState();

function plotWithHouse(): void {
  const { addVertexAt, closeShape } = store();
  addVertexAt({ x: 0, y: 0 });
  addVertexAt({ x: 20, y: 0 });
  addVertexAt({ x: 20, y: 16 });
  addVertexAt({ x: 0, y: 16 });
  closeShape();
  store().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
}

const house = () => store().present.house!;

/*
 * The drag listens on `window` for `pointermove` / `pointerup`, and jsdom has no `PointerEvent`
 * constructor — a `MouseEvent` with the right type carries `clientX` and reaches the same listener.
 */
const slide = (clientX: number) => window.dispatchEvent(new MouseEvent('pointermove', { clientX }));
const release = () => window.dispatchEvent(new MouseEvent('pointerup'));

beforeEach(() => {
  resetBoundaryStoreForTests();
  plotWithHouse();
});

/**
 * The horizontal axis is metres from the segment's start, which is exactly what `offsetAlongEdge`
 * stores — the number under the pointer and the number in the document are the same number, and
 * that is the whole reason the track is legible.
 */
describe('pointerOffset', () => {
  it('reads a position on the track as a distance along the segment', () => {
    // A 200 px track showing an 8 m wall: half way across is 4 m along.
    expect(pointerOffset(100, 0, 200, 8)).toBeCloseTo(4);
    expect(pointerOffset(50, 0, 200, 8)).toBeCloseTo(2);
  });

  it('allows for where the track actually sits on the page', () => {
    expect(pointerOffset(340, 240, 200, 8)).toBeCloseTo(4);
  });

  it('snaps to 50 mm, fine enough to be exact and coarse enough to be steady', () => {
    expect(pointerOffset(101, 0, 200, 8)).toBeCloseTo(4.05);
  });

  it('has no answer before the track has been laid out', () => {
    expect(pointerOffset(100, 0, 0, 8)).toBe(0);
  });
});

describe('dragging a block along the track', () => {
  function openWallWithDoor() {
    const wallId = houseWalls(house())[0]!.id;
    store().selectWall(wallId);
    store().addOpening(wallId, 'patio-door');
    return house().openings[0]!;
  }

  /*
   * jsdom gives every element a zero-size box, so `pointerOffset` reads 0 — which is the *point*
   * of these cases: what is asserted is that a drag is bracketed into one history entry and that
   * the move lands, not the pixel arithmetic, which is covered above without a layout.
   */
  it('is one undo entry for the whole drag, not one per frame', () => {
    const opening = openWallWithDoor();
    render(<SelectedObjectPanel />);
    const depth = store().past.length;

    const block = screen.getByTestId(`opening-${opening.id}`);
    fireEvent.pointerDown(block);
    slide(40);
    slide(60);
    release();

    // The door moved to the wall's start, clamped to stay on it, in exactly one entry.
    expect(house().openings[0]!.offsetAlongEdge).toBeCloseTo(1.2);
    expect(store().past.length).toBe(depth + 1);

    store().undo();
    expect(house().openings[0]!.offsetAlongEdge).toBeCloseTo(4);
  });

  it('selects the block it is dragging, so the fields below follow it', () => {
    const opening = openWallWithDoor();
    store().select({ kind: 'wall', wallId: opening.wallId });
    render(<SelectedObjectPanel />);

    fireEvent.pointerDown(screen.getByTestId(`opening-${opening.id}`));

    expect(store().selection).toEqual({ kind: 'opening', id: opening.id });
  });

  it('stops listening once the pointer is up, so a later move does nothing', () => {
    const opening = openWallWithDoor();
    render(<SelectedObjectPanel />);

    fireEvent.pointerDown(screen.getByTestId(`opening-${opening.id}`));
    release();

    const after = house().openings[0]!.offsetAlongEdge;
    slide(500);

    expect(house().openings[0]!.offsetAlongEdge).toBeCloseTo(after);
  });
});

describe('the side’s own track', () => {
  it('appears once a side has a gate on it', () => {
    const edgeVertexId = store().present.vertices[1]!.id;
    store().select({ kind: 'edge', edgeVertexId });
    const { rerender } = render(<SelectedObjectPanel />);

    // A side with nothing on it gets no track: there would be nothing to slide.
    expect(screen.queryByTestId('side-track')).toBeNull();

    store().addGate(edgeVertexId, 'pedestrian', 6);
    store().select({ kind: 'edge', edgeVertexId });
    rerender(<SelectedObjectPanel />);

    expect(screen.getByTestId('side-track')).toBeInTheDocument();
    expect(screen.getByTestId(`gate-block-${store().present.gates[0]!.id}`)).toBeInTheDocument();
  });

  it('slides a gate along its side and earns one undo entry', () => {
    const edgeVertexId = store().present.vertices[1]!.id;
    store().addGate(edgeVertexId, 'pedestrian', 6);
    const gate = store().present.gates[0]!;
    store().select({ kind: 'edge', edgeVertexId });
    render(<SelectedObjectPanel />);
    const depth = store().past.length;

    fireEvent.pointerDown(screen.getByTestId(`gate-block-${gate.id}`));
    slide(30);
    release();

    // Clamped against the corner it was dragged past, and one entry for the gesture.
    expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(0.45);
    expect(store().past.length).toBe(depth + 1);

    store().undo();
    expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(6);
  });
});
