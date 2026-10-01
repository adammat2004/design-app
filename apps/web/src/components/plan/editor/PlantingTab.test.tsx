import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DesignElement } from '@/lib/concepts';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { PlantingTab } from './PlantingTab';

const bed: DesignElement = {
  id: 'bed',
  name: 'Border',
  category: 'planting-bed',
  role: 'feature',
  zone: 'back',
  material: 'mix-sunny-gravel',
  shape: { kind: 'rect', centre: { x: 6, y: 4 }, width: 5, depth: 2, rotation: 0 },
};

function current(): DesignElement {
  return usePlanEditorStore.getState().present.elements[0]!;
}

function show() {
  return render(<PlantingTab element={current()} />);
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  const boundary = useBoundaryStore.getState();
  for (const point of [
    { x: 0, y: 0 },
    { x: 12, y: 0 },
    { x: 12, y: 12 },
    { x: 0, y: 12 },
  ])
    boundary.addVertexAt(point);
  boundary.closeShape();
  usePlanEditorStore.setState({ selectedId: 'bed', present: { elements: [bed] } });
});

describe('the Planting tab', () => {
  it('lists the mix with a count to order for each species', () => {
    show();
    expect(screen.getByTestId('planting-mix')).toHaveValue('mix-sunny-gravel');
    // 10 m² × 0.2 at 0.45 m centres.
    expect(screen.getByTestId('planting-line-lavandula-hidcote')).toHaveTextContent('10');
    expect(screen.getByTestId('planting-total')).toHaveTextContent(/to order/);
  });

  it('makes the mix the bed’s own when a share changes, and goes back in one tap', () => {
    const { rerender } = show();
    const share = screen.getByTestId('planting-share-lavandula-hidcote');
    fireEvent.change(share, { target: { value: '50' } });
    fireEvent.blur(share);
    expect(current().planting?.mix.find((entry) => entry.speciesId === 'lavandula-hidcote')?.share).toBeCloseTo(0.5);

    rerender(<PlantingTab element={current()} />);
    fireEvent.click(screen.getByTestId('planting-reset'));
    expect(current().planting).toBeUndefined();
  });

  it('adds a species to a bed that had none', () => {
    usePlanEditorStore.setState({ present: { elements: [{ ...bed, material: 'mixed-border' }] } });
    show();
    fireEvent.change(screen.getByTestId('planting-add'), { target: { value: 'geranium-rozanne' } });
    expect(current().planting?.mix).toEqual([{ speciesId: 'geranium-rozanne', share: 1 }]);
  });

  it('makes no claim about the light without a location, and one with it', () => {
    const { unmount } = show();
    expect(screen.getByTestId('planting-light-unknown')).toBeInTheDocument();
    unmount();

    useBoundaryStore.setState((state) => ({
      present: { ...state.present, location: { latitude: 51.5, longitude: -0.1 } },
    }));
    show();
    expect(screen.getByTestId('planting-light')).toHaveAttribute('data-suits', 'true');
  });
});
