import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { boundaryRuns, gateCentre, kindForEdge } from '@garden-studio/schema';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { SelectedObjectPanel } from '../SelectedObjectPanel';

/**
 * Clicking a side of the plot opens an editor about *that side*. Plain DOM, so the whole flow
 * renders under jsdom: name it, say what it is made of and how tall, put a gate in it, move the
 * gate, and see what happens when the geometry moves out from under it.
 *
 * Rendered through `SelectedObjectPanel` rather than `SideEditor` directly, because the routing —
 * a selected gate showing its side's editor, a selected wall showing the wall's — is half of what
 * makes the selection model work.
 */

const store = () => useBoundaryStore.getState();

/** A 20 x 16 m plot with a house in it, as step 1 leaves them. */
function plotWithHouse(): void {
  const { addVertexAt, closeShape } = store();
  addVertexAt({ x: 0, y: 0 });
  addVertexAt({ x: 20, y: 0 });
  addVertexAt({ x: 20, y: 16 });
  addVertexAt({ x: 0, y: 16 });
  closeShape();
  store().placeHouseRectangle({ x: 10, y: 8 }, 8, 6);
}

/** The vertex the nth side starts at — what everything on a side is keyed on. */
const edgeId = (index: number) => store().present.vertices[index]!.id;

function selectSide(index: number): void {
  store().select({ kind: 'edge', edgeVertexId: edgeId(index) });
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  plotWithHouse();
});

describe('selecting a side', () => {
  it('names it by its corners and gives its length', () => {
    selectSide(0);
    render(<SelectedObjectPanel />);

    // Side A → B of a 20 x 16 plot.
    expect(screen.getByTestId('side-heading')).toHaveTextContent('Side A → B');
    expect(screen.getByTestId('side-heading')).toHaveTextContent('20.0 m');
  });

  /*
   * Never a compass word: the plot can be drawn at any angle and the canvas can be panned, so the
   * only honest description of a side is where it is relative to the house.
   */
  it('says where it is relative to the house rather than naming a compass point', () => {
    selectSide(0);
    render(<SelectedObjectPanel />);

    const detail = screen.getByTestId('side-heading-detail').textContent ?? '';
    expect(detail).not.toMatch(/north|south|east|west/i);
    expect(detail.length).toBeGreaterThan(0);
  });

  it('shows nothing about a side when nothing is selected', () => {
    // Placing the house selects it, so the empty state needs the selection cleared first.
    store().select(null);
    render(<SelectedObjectPanel />);

    expect(screen.queryByTestId('side-editor')).toBeNull();
    expect(screen.getByTestId('selected-none')).toBeInTheDocument();
  });
});

describe('what the side is made of', () => {
  it('sets the kind, and the plan agrees', () => {
    selectSide(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('side-kind-hedge'));
    rerender(<SelectedObjectPanel />);

    expect(kindForEdge(store().present, edgeId(0))).toBe('hedge');
    expect(screen.getByTestId('side-kind-hedge')).toHaveAttribute('aria-pressed', 'true');
  });

  it('takes a height, and offers the way back to the usual one', () => {
    selectSide(0);
    const { rerender } = render(<SelectedObjectPanel />);

    const height = screen.getByTestId('side-height');
    fireEvent.change(height, { target: { value: '2.4' } });
    fireEvent.blur(height);
    rerender(<SelectedObjectPanel />);

    expect(boundaryRuns(store().present)[0]!.height).toBeCloseTo(2.4);

    fireEvent.click(screen.getByTestId('side-height-reset'));
    rerender(<SelectedObjectPanel />);

    // Back to the kind's own default, which stores nothing rather than a number.
    expect(boundaryRuns(store().present)[0]!.height).toBeCloseTo(1.8);
    expect(screen.queryByTestId('side-height-reset')).toBeNull();
  });

  it('has no height to ask about on an open side', () => {
    selectSide(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('side-kind-open'));
    rerender(<SelectedObjectPanel />);

    expect(screen.queryByTestId('side-height')).toBeNull();
  });
});

describe('the street', () => {
  it('names this side as the street, and gives it back', () => {
    selectSide(2);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('side-street-toggle'));
    rerender(<SelectedObjectPanel />);

    expect(store().present.streetEdgeVertexId).toBe(edgeId(2));
    expect(screen.getByTestId('side-street-toggle')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByTestId('side-street-toggle'));
    expect(store().present.streetEdgeVertexId).toBeNull();
  });

  it('moves the designation rather than adding a second one', () => {
    store().setStreetEdge(edgeId(2));
    selectSide(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('side-street-toggle'));
    rerender(<SelectedObjectPanel />);

    expect(store().present.streetEdgeVertexId).toBe(edgeId(0));
  });
});

describe('openings in a side', () => {
  it('offers a gate, a driveway and an open gap', () => {
    selectSide(1);
    render(<SelectedObjectPanel />);

    expect(screen.getByTestId('add-gate-pedestrian')).toBeInTheDocument();
    expect(screen.getByTestId('add-gate-vehicle')).toBeInTheDocument();
    expect(screen.getByTestId('add-gate-open')).toBeInTheDocument();
  });

  it('adds one at the first place it fits, and opens its row', () => {
    selectSide(1);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('add-gate-pedestrian'));
    rerender(<SelectedObjectPanel />);

    const [gate] = store().present.gates;
    expect(gate?.edgeVertexId).toBe(edgeId(1));
    expect(gate?.offsetAlongEdge).toBeCloseTo(8);
    // Added and selected, so the editor it belongs to is open on it.
    expect(screen.getByTestId(`toggle-gate-${gate!.id}`)).toHaveAttribute('aria-expanded', 'true');
  });

  it('gives a driveway a car’s width', () => {
    selectSide(1);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('add-gate-vehicle'));
    rerender(<SelectedObjectPanel />);

    expect(store().present.gates[0]!.width).toBeCloseTo(3);
    expect(screen.getByTestId('side-gates')).toHaveTextContent('Driveway');
  });

  it('types a width and a distance from the corner', () => {
    selectSide(1);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-gate-pedestrian'));
    rerender(<SelectedObjectPanel />);

    const width = screen.getByTestId('gate-width');
    fireEvent.change(width, { target: { value: '1.2' } });
    fireEvent.blur(width);

    const offset = screen.getByTestId('gate-offset');
    fireEvent.change(offset, { target: { value: '4' } });
    fireEvent.blur(offset);

    expect(store().present.gates[0]!.width).toBeCloseTo(1.2);
    expect(store().present.gates[0]!.offsetAlongEdge).toBeCloseTo(4);
  });

  it('changes a gate into a driveway', () => {
    selectSide(1);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-gate-pedestrian'));
    rerender(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('gate-kind-vehicle'));
    rerender(<SelectedObjectPanel />);

    expect(store().present.gates[0]!.kind).toBe('vehicle');
    expect(store().present.gates[0]!.width).toBeCloseTo(3);
  });

  it('removes one', () => {
    selectSide(1);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-gate-pedestrian'));
    rerender(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId(`remove-gate-${store().present.gates[0]!.id}`));
    rerender(<SelectedObjectPanel />);

    expect(store().present.gates).toEqual([]);
    expect(screen.queryByTestId('side-gates')).toBeNull();
  });

  /*
   * The rule that makes every geometry change safe: a gate the plot has moved out from under is
   * kept, drawn nowhere, and *said* — never clamped somewhere plausible, and never deleted.
   */
  it('says when a gate has ended up off its side, and fits it back on', () => {
    store().addGate(edgeId(1), 'pedestrian', 14);
    const [gate] = store().present.gates;
    store().setEdgeLength(1, 8);
    selectSide(1);

    const { rerender } = render(<SelectedObjectPanel />);

    expect(screen.getByTestId(`gate-unplaced-${gate!.id}`)).toBeInTheDocument();
    expect(gateCentre(store().present, store().present.gates[0]!)).toBeNull();

    fireEvent.click(screen.getByTestId(`fit-gate-${gate!.id}`));
    rerender(<SelectedObjectPanel />);

    expect(gateCentre(store().present, store().present.gates[0]!)).not.toBeNull();
    expect(screen.queryByTestId(`gate-unplaced-${gate!.id}`)).toBeNull();
  });

  it('offers no fit for a gate wider than the side it is on', () => {
    store().addGate(edgeId(1), 'vehicle', 8);
    const [gate] = store().present.gates;
    store().setEdgeLength(1, 2);
    selectSide(1);

    render(<SelectedObjectPanel />);

    expect(screen.getByTestId(`gate-unplaced-${gate!.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`fit-gate-${gate!.id}`)).toBeNull();
    // Removing it is still offered: it is the other honest answer.
    expect(screen.getByTestId(`remove-gate-${gate!.id}`)).toBeInTheDocument();
  });
});

describe('selecting a gate', () => {
  it('shows its side’s editor, with that gate expanded', () => {
    store().addGate(edgeId(1), 'pedestrian', 6);
    const [gate] = store().present.gates;
    store().select({ kind: 'gate', id: gate!.id });

    render(<SelectedObjectPanel />);

    expect(screen.getByTestId('side-editor')).toBeInTheDocument();
    expect(screen.getByTestId('side-heading')).toHaveTextContent('Side B → C');
    expect(screen.getByTestId('gate-width')).toBeInTheDocument();
  });
});
