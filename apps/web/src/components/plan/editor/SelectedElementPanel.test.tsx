import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DesignElement } from '@/lib/concepts';
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

describe('the Edges tab', () => {
  const bed = (over: Partial<DesignElement> = {}): DesignElement =>
    ({
      id: 'bed',
      name: 'Border',
      category: 'planting-bed',
      role: 'fill',
      fillKind: 'accent',
      material: 'mixed-border',
      zone: 'back',
      edging: 'brick-edging',
      shape: { kind: 'rect', centre: { x: 10, y: 10 }, width: 4, depth: 2, rotation: 0 },
      ...over,
    }) as DesignElement;

  function select(element: DesignElement) {
    usePlanEditorStore.setState({ selectedId: element.id, present: { elements: [element] } });
  }
  const current = () => usePlanEditorStore.getState().present.elements[0]!;

  it('is offered on a surface and not on a plant', () => {
    render(<SelectedElementPanel />);
    // The tree from the outer beforeEach.
    expect(screen.queryByTestId('element-tab-edges')).toBeNull();
  });

  it('opens the boundary for editing, and shows what Auto chose and why', () => {
    select(bed());
    render(<SelectedElementPanel />);
    fireEvent.click(screen.getByTestId('element-tab-edges'));

    expect(usePlanEditorStore.getState().edgeEdit?.hostId).toBe('bed');
    expect(screen.getByTestId('edges-mode-auto')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('edges-auto')).toHaveTextContent('chosen automatically');
    // Standing on open ground, a brick preference edges every side, each with its reason.
    expect(screen.getAllByTestId('edges-auto-run')).toHaveLength(4);
  });

  it('edits a segment in Custom, offering only the dimensions its treatment has', () => {
    select(bed());
    render(<SelectedElementPanel />);
    fireEvent.click(screen.getByTestId('element-tab-edges'));
    fireEvent.click(screen.getByTestId('edges-mode-custom'));

    const first = current().edges!.runs[0]!;
    fireEvent.click(screen.getByTestId(`edge-segment-${first.id}`));
    expect(screen.getByTestId('edge-treatment-brick')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('edges-width')).toBeInTheDocument();
    expect(screen.getByTestId('edges-height')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('edge-treatment-steel'));
    expect(current().edges!.runs[0]!.treatment).toBe('steel');
    // A blade is specified by its height; its drawn width is a convention, not a field.
    expect(screen.queryByTestId('edges-width')).toBeNull();
    expect(screen.getByTestId('edges-height')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('edge-treatment-flush'));
    expect(screen.queryByTestId('edges-height')).toBeNull();

    fireEvent.click(screen.getByTestId('edges-remove-segment'));
    expect(current().edges!.runs.some((run) => run.id === first.id)).toBe(false);
  });

  it('says what None means', () => {
    select(bed());
    render(<SelectedElementPanel />);
    fireEvent.click(screen.getByTestId('element-tab-edges'));
    fireEvent.click(screen.getByTestId('edges-mode-none'));

    expect(current().edges!.mode).toBe('none');
    expect(screen.getByTestId('edges-none')).toHaveTextContent('will not add any');
  });

  it('closes edge editing when another tab is chosen', () => {
    select(bed());
    render(<SelectedElementPanel />);
    fireEvent.click(screen.getByTestId('element-tab-edges'));
    fireEvent.click(screen.getByTestId('element-tab-details'));
    expect(usePlanEditorStore.getState().edgeEdit).toBeNull();
  });
});

it('draws nothing when nothing is selected', () => {
  usePlanEditorStore.getState().select(null);
  render(<SelectedElementPanel />);
  expect(screen.queryByTestId('selected-element')).toBeNull();
});
