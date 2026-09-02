import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { houseWalls, openingNormal } from '@garden-studio/schema';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { OpeningsPanel } from './OpeningsPanel';
import { pointerOffset } from './WallElevationStrip';

/**
 * The panel is plain DOM — no Konva — so the whole flow renders under jsdom: suggest a door, pick a
 * wall, place things on it, and type their measurements.
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

beforeEach(() => {
  resetBoundaryStoreForTests();
  plotWithHouse();
});

describe('the suggestion', () => {
  it('is offered while the house has no openings', () => {
    render(<OpeningsPanel />);

    expect(screen.getByTestId('suggest-patio-door')).toBeInTheDocument();
    expect(screen.getByTestId('openings-count')).toHaveTextContent('None yet');
  });

  /*
   * Offered rather than applied. The whole value of an opening is that the generator trusts it, so
   * a wrong silent door would have the design built confidently around a fiction the user never
   * stated. One tap turns a guess into a statement.
   */
  it('places nothing until it is taken', () => {
    render(<OpeningsPanel />);

    expect(house().openings).toEqual([]);
  });

  it('puts patio doors on the wall facing the back garden when taken', () => {
    const { rerender } = render(<OpeningsPanel />);

    fireEvent.click(screen.getByTestId('suggest-patio-door'));
    rerender(<OpeningsPanel />);

    const [opening] = house().openings;
    expect(opening?.type).toBe('patio-door');
    expect(opening?.width).toBeCloseTo(2.4);

    // At rotation 0 the back garden is up the screen, so the door faces -y.
    expect(openingNormal(house(), opening!)!.y).toBeLessThan(0);
  });

  it('opens the strip for that wall, so the next move is obvious', () => {
    const { rerender } = render(<OpeningsPanel />);

    fireEvent.click(screen.getByTestId('suggest-patio-door'));
    rerender(<OpeningsPanel />);

    expect(store().selectedWallId).toBe(house().openings[0]!.wallId);
    expect(screen.getByTestId('wall-track')).toBeInTheDocument();
  });

  it('stops being offered once there is an opening', () => {
    const { rerender } = render(<OpeningsPanel />);

    fireEvent.click(screen.getByTestId('suggest-patio-door'));
    rerender(<OpeningsPanel />);

    expect(screen.queryByTestId('suggest-patio-door')).not.toBeInTheDocument();
    expect(screen.getByTestId('openings-count')).toHaveTextContent('1 placed');
  });
});

describe('the wall elevation strip', () => {
  function openFirstWall(rerender: (ui: React.ReactElement) => void) {
    fireEvent.click(screen.getByTestId(`pick-wall-${houseWalls(house())[0]!.id}`));
    rerender(<OpeningsPanel />);
  }

  it('asks for a wall before it shows anything', () => {
    render(<OpeningsPanel />);

    expect(screen.getByTestId('wall-strip-hint')).toBeInTheDocument();
    expect(screen.queryByTestId('wall-track')).not.toBeInTheDocument();
  });

  it('shows the chosen wall, its length and its kind', () => {
    const { rerender } = render(<OpeningsPanel />);
    openFirstWall(rerender);

    // The top wall of an 8 x 6 house.
    expect(screen.getByTestId('wall-heading')).toHaveTextContent('Wall 1 · 8.0 m');
    expect(screen.getByTestId('wall-kind')).toHaveValue('external');
  });

  it('places an opening on it', () => {
    const { rerender } = render(<OpeningsPanel />);
    openFirstWall(rerender);

    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<OpeningsPanel />);

    expect(house().openings).toHaveLength(1);
    expect(screen.getByTestId(`opening-${house().openings[0]!.id}`)).toBeInTheDocument();
  });

  /*
   * A party wall is the neighbour's house, so it offers nothing — which is most of the input work
   * saved on a terrace: two walls worth asking about rather than four.
   */
  it('offers nothing on a party wall, and says why', () => {
    const { rerender } = render(<OpeningsPanel />);
    openFirstWall(rerender);

    fireEvent.change(screen.getByTestId('wall-kind'), { target: { value: 'party' } });
    rerender(<OpeningsPanel />);

    expect(screen.queryByTestId('add-opening-patio-door')).not.toBeInTheDocument();
    expect(screen.getByTestId('wall-holds-nothing')).toBeInTheDocument();
  });

  it('offers only a garage door on an attached garage', () => {
    const { rerender } = render(<OpeningsPanel />);
    openFirstWall(rerender);

    fireEvent.change(screen.getByTestId('wall-kind'), { target: { value: 'garage' } });
    rerender(<OpeningsPanel />);

    expect(screen.getByTestId('add-opening-garage-door')).toBeInTheDocument();
    expect(screen.queryByTestId('add-opening-patio-door')).not.toBeInTheDocument();
  });

  it('types a measurement rather than making the user drag to it', () => {
    const { rerender } = render(<OpeningsPanel />);
    openFirstWall(rerender);
    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<OpeningsPanel />);

    // Selecting the block is what opens its fields.
    fireEvent.pointerDown(screen.getByTestId(`opening-${house().openings[0]!.id}`));
    rerender(<OpeningsPanel />);

    const width = screen.getByTestId('opening-width');
    fireEvent.change(width, { target: { value: '3.6' } });
    fireEvent.blur(width);

    expect(house().openings[0]!.width).toBeCloseTo(3.6);
  });

  it('removes one', () => {
    const { rerender } = render(<OpeningsPanel />);
    openFirstWall(rerender);
    fireEvent.click(screen.getByTestId('add-opening-patio-door'));
    rerender(<OpeningsPanel />);

    fireEvent.pointerDown(screen.getByTestId(`opening-${house().openings[0]!.id}`));
    rerender(<OpeningsPanel />);
    fireEvent.click(screen.getByTestId('remove-opening'));

    expect(house().openings).toEqual([]);
  });
});

/**
 * The ruler's arithmetic, on its own. The horizontal axis is metres along the wall from its start
 * corner, which is exactly what `offsetAlongEdge` stores — the number under the pointer and the
 * number in the document are the same number, and that is the whole reason the strip is legible.
 */
describe('pointerOffset', () => {
  it('reads a position on the track as a distance along the wall', () => {
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
