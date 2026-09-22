import { beforeEach, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { SelectedElementPanel } from './SelectedElementPanel';

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
  usePlanEditorStore.setState({
    selectedId: 'tree',
    present: {
      elements: [
        {
          id: 'tree',
          name: 'Tree',
          category: 'planting-bed',
          role: 'feature',
          zone: 'back',
          symbol: 'tree-deciduous',
          shape: { kind: 'point', at: { x: 4, y: 4 }, radius: 1 },
        },
      ],
    },
  });
});
it('changes species and canopy size from the inspector', () => {
  render(<SelectedElementPanel />);
  fireEvent.change(screen.getByTestId('element-species'), {
    target: { value: 'acer-palmatum-red' },
  });
  const canopy = screen.getByTestId('element-canopy');
  fireEvent.change(canopy, { target: { value: '3' } });
  fireEvent.blur(canopy);
  expect(usePlanEditorStore.getState().present.elements[0]).toMatchObject({
    plantId: 'acer-palmatum-red',
    shape: { radius: 1.5 },
  });
});
it('restores the accepted value after a rejected position edit', () => {
  render(<SelectedElementPanel />);
  fireEvent.click(screen.getByText('Details'));
  const position = screen.getByTestId('element-position-x');
  fireEvent.change(position, { target: { value: '40' } });
  fireEvent.blur(position);
  expect(position).toHaveValue(4);
  expect(usePlanEditorStore.getState().clash).not.toBeNull();
});

it('draws nothing when nothing is selected', () => {
  usePlanEditorStore.getState().select(null);
  render(<SelectedElementPanel />);
  expect(screen.queryByTestId('selected-element')).toBeNull();
});
