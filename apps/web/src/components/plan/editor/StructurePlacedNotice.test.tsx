import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { StructurePlacedNotice } from './StructurePlacedNotice';

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  const boundary = useBoundaryStore.getState();
  for (const point of [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ])
    boundary.addVertexAt(point);
  boundary.closeShape();
});

/** Places a symbol from the palette the way the canvas does: arm it, then click. */
function place(symbol: 'pergola' | 'gazebo' | 'bench', category: 'structure' | 'furniture') {
  act(() => {
    usePlanEditorStore.getState().setPlacing(category, symbol);
    usePlanEditorStore.getState().addElement(category, { x: 10, y: 10 });
  });
}

describe('StructurePlacedNotice', () => {
  it('offers the 3D editor for a pergola placed from the palette, and opens it', () => {
    render(<StructurePlacedNotice />);
    place('pergola', 'structure');

    expect(screen.getByTestId('structure-placed-notice').textContent).toContain('Pergola added');
    fireEvent.click(screen.getByTestId('structure-placed-configure'));
    const { structureEdit, selectedId } = usePlanEditorStore.getState();
    expect(structureEdit?.elementId).toBe(selectedId);
    expect(screen.queryByTestId('structure-placed-notice')).toBeNull();
  });

  // An offer that leads nowhere is a control that does nothing.
  it('offers nothing for a thing with no 3D editor', () => {
    render(<StructurePlacedNotice />);
    place('bench', 'furniture');
    expect(screen.queryByTestId('structure-placed-notice')).toBeNull();
  });

  it('goes when the structure is undone or something else is selected', () => {
    render(<StructurePlacedNotice />);
    place('gazebo', 'structure');
    expect(screen.getByTestId('structure-placed-notice')).toBeTruthy();
    act(() => usePlanEditorStore.getState().undo());
    expect(screen.queryByTestId('structure-placed-notice')).toBeNull();

    place('gazebo', 'structure');
    act(() => usePlanEditorStore.getState().select(null));
    expect(screen.queryByTestId('structure-placed-notice')).toBeNull();
  });

  // An AI run or a load adds elements without arming a symbol, and is not a placement.
  it('says nothing about elements that arrive any other way', () => {
    render(<StructurePlacedNotice />);
    act(() =>
      usePlanEditorStore.setState({
        selectedId: 'p1',
        present: {
          elements: [
            {
              id: 'p1',
              category: 'structure',
              role: 'feature',
              zone: 'back',
              symbol: 'pergola',
              shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 3, depth: 3, rotation: 0 },
            },
          ],
        },
      }),
    );
    expect(screen.queryByTestId('structure-placed-notice')).toBeNull();
  });
});
