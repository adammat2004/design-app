import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { draftPolygon, polygonArea } from '@/lib/boundary-geometry';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { PlotShapePanel } from './PlotShapePanel';

/** Plain DOM, no Konva, so the whole picker renders under jsdom. */

const store = () => useBoundaryStore.getState();

function plotArea(): number {
  return polygonArea(draftPolygon(store().present));
}

function type(testId: string, value: string): void {
  const field = screen.getByTestId(testId);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

beforeEach(() => {
  resetBoundaryStoreForTests();
});

describe('the shape picker', () => {
  it('is what an empty plot offers', () => {
    render(<PlotShapePanel />);

    expect(screen.getByTestId('plot-shape-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('plot-shape')).not.toBeInTheDocument();
  });

  /*
   * The point of the preset: the plot starts at a real, correctly-scaled size rather than being
   * originated from a blank grid, so the user is adjusting a default instead of inventing one.
   */
  it('lays out a closed, correctly-scaled rectangle', () => {
    render(<PlotShapePanel />);

    fireEvent.click(screen.getByTestId('plot-preset-rectangle'));

    expect(store().present.closed).toBe(true);
    expect(plotArea()).toBeCloseTo(96);
  });

  it('lays out an L-shape with its notch', () => {
    render(<PlotShapePanel />);

    fireEvent.click(screen.getByTestId('plot-preset-lshape'));

    expect(store().present.vertices).toHaveLength(6);
    // 14 x 10 less a 5 x 4 return.
    expect(plotArea()).toBeCloseTo(120);
  });

  it('hands the custom route straight to the drawing tool', () => {
    render(<PlotShapePanel />);

    fireEvent.click(screen.getByTestId('plot-preset-custom'));

    expect(store().boundaryTool).toBe('draw');
    expect(store().present.vertices).toHaveLength(0);
  });
});

describe('the dimension fields', () => {
  it('replace the picker once there is a rectangle', () => {
    const { rerender } = render(<PlotShapePanel />);
    fireEvent.click(screen.getByTestId('plot-preset-rectangle'));
    rerender(<PlotShapePanel />);

    expect(screen.queryByTestId('plot-shape-picker')).not.toBeInTheDocument();
    expect(screen.getByTestId('plot-shape')).toHaveAttribute('data-shape', 'rectangle');
  });

  it('resize the plot without moving it', () => {
    const { rerender } = render(<PlotShapePanel />);
    fireEvent.click(screen.getByTestId('plot-preset-rectangle'));
    rerender(<PlotShapePanel />);

    type('plot-width', '14');
    rerender(<PlotShapePanel />);
    type('plot-depth', '9');

    expect(plotArea()).toBeCloseTo(126);
    expect(store().present.vertices[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('offer the return dimensions for an L-shape', () => {
    const { rerender } = render(<PlotShapePanel />);
    fireEvent.click(screen.getByTestId('plot-preset-lshape'));
    rerender(<PlotShapePanel />);

    expect(screen.getByTestId('plot-shape')).toHaveAttribute('data-shape', 'lshape');

    type('plot-return-width', '6');

    // 14 x 10 less a 6 x 4 return.
    expect(plotArea()).toBeCloseTo(116);
  });

  it('refuse a return that would swallow the plot, rather than crossing the outline', () => {
    const { rerender } = render(<PlotShapePanel />);
    fireEvent.click(screen.getByTestId('plot-preset-lshape'));
    rerender(<PlotShapePanel />);

    type('plot-return-width', '20');

    expect(plotArea()).toBeCloseTo(120);
  });

  /*
   * The consequence of deriving the shape from the outline rather than remembering it: a per-side
   * edit really does stop the plot being a rectangle, and the width and depth fields say so by
   * going away instead of editing a shape that is no longer there.
   */
  it('disappear once a side edit makes it a free-form outline', () => {
    const { rerender } = render(<PlotShapePanel />);
    fireEvent.click(screen.getByTestId('plot-preset-rectangle'));
    rerender(<PlotShapePanel />);

    store().setEdgeLength(0, 9);
    rerender(<PlotShapePanel />);

    expect(screen.queryByTestId('plot-shape')).not.toBeInTheDocument();
    expect(screen.queryByTestId('plot-shape-picker')).not.toBeInTheDocument();
  });

  it('come back for a rectangle drawn by hand', () => {
    const { addVertexAt, closeShape } = store();
    addVertexAt({ x: 0, y: 0 });
    addVertexAt({ x: 10, y: 0 });
    addVertexAt({ x: 10, y: 6 });
    addVertexAt({ x: 0, y: 6 });
    closeShape();

    render(<PlotShapePanel />);

    expect(screen.getByTestId('plot-shape')).toHaveAttribute('data-shape', 'rectangle');
    expect(screen.getByTestId('plot-width')).toHaveValue(10);
  });

  it('offer house placement rather than jumping to it', () => {
    const { rerender } = render(<PlotShapePanel />);
    fireEvent.click(screen.getByTestId('plot-preset-rectangle'));
    rerender(<PlotShapePanel />);

    expect(store().mode).toBe('boundary');

    fireEvent.click(screen.getByTestId('plot-shape-continue'));

    expect(store().mode).toBe('house');
  });
});
