import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftPolygon, polygonArea } from '@/lib/boundary-geometry';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { PlotSanityCallout } from './PlotSanityCallout';

/**
 * Plain DOM, no Konva, so it renders under jsdom — which makes it worth asserting the wiring end
 * to end: the warning appears off the real geometry, and its button really rescales the plot.
 */

const store = () => useBoundaryStore.getState();

/** Draws a rectangle from the origin and closes it. */
function drawPlot(width: number, depth: number): void {
  const { addVertexAt, closeShape } = store();
  addVertexAt({ x: 0, y: 0 });
  addVertexAt({ x: width, y: 0 });
  addVertexAt({ x: width, y: depth });
  addVertexAt({ x: 0, y: depth });
  closeShape();
}

function plotArea(): number {
  return polygonArea(draftPolygon(store().present));
}

beforeEach(() => {
  resetBoundaryStoreForTests();
});

describe('PlotSanityCallout', () => {
  it('says nothing about an ordinary garden', () => {
    drawPlot(20, 16);
    render(<PlotSanityCallout />);

    expect(screen.queryByTestId('plot-sanity')).not.toBeInTheDocument();
  });

  /*
   * The warning is about the shape being wrong, and a half-drawn outline is not wrong yet — its
   * wrapping edge is the long line back to the first corner and would trip the band on almost
   * every plot mid-draw.
   */
  it('waits until the outline is closed', () => {
    const { addVertexAt } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 113, y: 0 });
    addVertexAt({ x: 113, y: 74.5 });

    render(<PlotSanityCallout />);

    expect(screen.queryByTestId('plot-sanity')).not.toBeInTheDocument();
  });

  it('names the measurement that tripped the band', () => {
    drawPlot(113, 74.5);
    render(<PlotSanityCallout />);

    expect(screen.getByTestId('plot-sanity')).toHaveAttribute('data-code', 'area-too-large');
    expect(screen.getByTestId('plot-sanity-headline')).toHaveTextContent('8419 m²');
  });

  it('rescales the plot and then has nothing left to say', () => {
    drawPlot(113, 74.5);
    render(<PlotSanityCallout />);

    fireEvent.click(screen.getByTestId('scale-plot-down'));

    expect(plotArea()).toBeCloseTo(84.185);
    expect(screen.queryByTestId('plot-sanity')).not.toBeInTheDocument();
  });

  /*
   * A button that leaves the same banner on screen teaches the user that the fix does not work,
   * so it is only offered when scaling really does clear the warning.
   */
  it('offers no fix when one step would not be enough', () => {
    drawPlot(11300, 7450);
    render(<PlotSanityCallout />);

    expect(screen.getByTestId('plot-sanity')).toBeInTheDocument();
    expect(screen.queryByTestId('scale-plot-down')).not.toBeInTheDocument();
  });

  it('takes "this is right" for an answer', () => {
    drawPlot(113, 74.5);
    render(<PlotSanityCallout />);

    fireEvent.click(screen.getByTestId('dismiss-plot-sanity'));

    expect(screen.queryByTestId('plot-sanity')).not.toBeInTheDocument();
    // Dismissing is a judgement about the plot, not an edit to it.
    expect(plotArea()).toBeCloseTo(8418.5);
  });

  it('speaks up again when a different band is crossed', () => {
    drawPlot(113, 74.5);
    render(<PlotSanityCallout />);

    fireEvent.click(screen.getByTestId('dismiss-plot-sanity'));
    expect(screen.queryByTestId('plot-sanity')).not.toBeInTheDocument();

    // Two steps down from 8,419 m² lands at 0.84 m² — out of band at the other end.
    act(() => store().scalePlot(0.01));

    expect(screen.getByTestId('plot-sanity')).toHaveAttribute('data-code', 'area-too-small');
  });
});
