import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { houseWalls, openingCentre, openingNormal } from '@garden-studio/schema';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { SelectedObjectPanel } from '../SelectedObjectPanel';

/**
 * Clicking a wall of the house opens an editor about *that wall*: what sort of wall it is, and the
 * doors and windows in it. The elevation strip does the placing — see its own header for why a wall
 * unrolled flat is the only sane way to put a 900 mm door on a footprint this small on screen.
 *
 * Rendered through `SelectedObjectPanel`, so the routing is covered too: a selected opening shows
 * its wall's editor rather than an editor of its own.
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

function house() {
  return store().present.house!;
}

const wallId = (index: number) => houseWalls(house())[index]!.id;

function selectWall(index: number): void {
  store().selectWall(wallId(index));
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  plotWithHouse();
});

describe('selecting a wall', () => {
  it('names it and gives its length', () => {
    selectWall(0);
    render(<SelectedObjectPanel />);

    // The top wall of an 8 x 6 house.
    expect(screen.getByTestId('wall-heading')).toHaveTextContent('Wall 1');
    expect(screen.getByTestId('wall-heading')).toHaveTextContent('8.0 m');
  });

  it('says which way it faces without naming a compass point', () => {
    selectWall(0);
    render(<SelectedObjectPanel />);

    const detail = screen.getByTestId('wall-heading-detail').textContent ?? '';
    expect(detail).not.toMatch(/north|south|east|west/i);
    expect(detail.length).toBeGreaterThan(0);
  });
});

describe('what sort of wall it is', () => {
  it('offers the three kinds as chips', () => {
    selectWall(0);
    render(<SelectedObjectPanel />);

    expect(screen.getByTestId('wall-kind-external')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('wall-kind-party')).toBeInTheDocument();
    expect(screen.getByTestId('wall-kind-garage')).toBeInTheDocument();
  });

  /*
   * A party wall is the neighbour's house, so it offers nothing — which is most of the input work
   * saved on a terrace: two walls worth asking about rather than four.
   */
  it('offers nothing on a party wall, and says why', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('wall-kind-party'));
    rerender(<SelectedObjectPanel />);

    expect(screen.queryByTestId('add-opening-patio-door')).toBeNull();
    expect(screen.getByTestId('wall-holds-nothing')).toBeInTheDocument();
  });

  it('offers only a garage door on an attached garage', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('wall-kind-garage'));
    rerender(<SelectedObjectPanel />);

    expect(screen.getByTestId('add-opening-garage-door')).toBeInTheDocument();
    expect(screen.queryByTestId('add-opening-patio-door')).toBeNull();
  });

  it('takes away the openings a reclassified wall cannot hold', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<SelectedObjectPanel />);
    expect(house().openings).toHaveLength(1);

    fireEvent.click(screen.getByTestId('wall-kind-party'));
    rerender(<SelectedObjectPanel />);

    // Removed rather than hidden: a door left on a party wall would have the generator route a
    // path to a doorway into next door's kitchen.
    expect(house().openings).toEqual([]);
  });
});

describe('doors and windows', () => {
  it('places one on the wall that was clicked', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<SelectedObjectPanel />);

    const [opening] = house().openings;
    expect(opening?.type).toBe('patio-door');
    expect(opening?.wallId).toBe(wallId(0));
    expect(opening?.width).toBeCloseTo(2.4);
    // At rotation 0 the back garden is up the screen, so the door faces -y.
    expect(openingNormal(house(), opening!)!.y).toBeLessThan(0);
    expect(screen.getByTestId(`opening-${opening!.id}`)).toBeInTheDocument();
  });

  it('places a window, which is a real answer as well as a door', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('add-opening-window'));
    rerender(<SelectedObjectPanel />);

    expect(house().openings[0]!.type).toBe('window');
    expect(house().openings[0]!.sillHeight).toBeCloseTo(0.9);
  });

  it('types a measurement rather than making the user drag to it', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<SelectedObjectPanel />);

    const width = screen.getByTestId('opening-width');
    fireEvent.change(width, { target: { value: '3.6' } });
    fireEvent.blur(width);

    expect(house().openings[0]!.width).toBeCloseTo(3.6);
  });

  it('says how a door opens, which is the one thing about it the plan cannot show', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-opening-back-door'));
    rerender(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('opening-swing-outward'));
    rerender(<SelectedObjectPanel />);

    expect(house().openings[0]!.swing).toBe('outward');
  });

  it('asks nothing about how a window opens', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-opening-window'));
    rerender(<SelectedObjectPanel />);

    expect(screen.queryByTestId('opening-swing-inward')).toBeNull();
  });

  it('removes one', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<SelectedObjectPanel />);

    fireEvent.click(screen.getByTestId('remove-opening'));
    rerender(<SelectedObjectPanel />);

    expect(house().openings).toEqual([]);
  });

  /*
   * The same rule a gate follows: a resize that shortens the wall under a door leaves it unplaced
   * and says so, rather than clamping it somewhere the user never put it.
   */
  it('says when a resize has left a door off its wall, and fits it back on', () => {
    selectWall(0);
    const { rerender } = render(<SelectedObjectPanel />);
    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<SelectedObjectPanel />);
    const [opening] = house().openings;

    // The top wall is 8 m; 3 m leaves a 2.4 m door centred at 4 m hanging off the end.
    store().setHouseSize({ width: 3 });
    rerender(<SelectedObjectPanel />);

    expect(openingCentre(house(), house().openings[0]!)).toBeNull();
    expect(screen.getByTestId(`unplaced-opening-${opening!.id}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`fit-opening-${opening!.id}`));
    rerender(<SelectedObjectPanel />);

    expect(openingCentre(house(), house().openings[0]!)).not.toBeNull();
  });
});

describe('selecting an opening', () => {
  it('shows its wall’s editor, with that opening’s fields open', () => {
    store().addOpening(wallId(1), 'window');
    const [opening] = house().openings;
    store().select({ kind: 'opening', id: opening!.id });

    render(<SelectedObjectPanel />);

    expect(screen.getByTestId('wall-editor')).toBeInTheDocument();
    expect(screen.getByTestId('wall-heading')).toHaveTextContent('Wall 2');
    expect(screen.getByTestId('opening-inspector')).toBeInTheDocument();
  });
});

/** The strip's own arithmetic and its drag live in `SegmentTrack.test.tsx`, beside the component. */
