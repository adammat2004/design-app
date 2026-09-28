import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { resolveStructure } from '@garden-studio/schema';
import type { DesignElement } from '@/lib/concepts';
import { resetBoundaryStoreForTests, useBoundaryStore } from '@/state/boundary-store';
import { resetPlanEditorStoreForTests, usePlanEditorStore } from '@/state/plan-editor-store';
import { StructureInspector, structureTabs } from './StructureInspector';

const PERGOLA: DesignElement = {
  id: 'p1',
  name: 'Pergola',
  category: 'structure',
  role: 'feature',
  zone: 'back',
  symbol: 'pergola',
  material: 'hardwood',
  height: 2.4,
  shape: { kind: 'rect', centre: { x: 8, y: 8 }, width: 3.6, depth: 3, rotation: 20 },
};

const current = () => usePlanEditorStore.getState().present.elements[0]!;

function show() {
  const element = current();
  return render(<StructureInspector element={element} structure={resolveStructure(element)!} unit="m" />);
}

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  const boundary = useBoundaryStore.getState();
  for (const point of [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 16 },
    { x: 0, y: 16 },
  ])
    boundary.addVertexAt(point);
  boundary.closeShape();
  usePlanEditorStore.setState({ selectedId: PERGOLA.id, present: { elements: [PERGOLA] } });
});

describe('StructureInspector', () => {
  /** A tab exists only for what the structure supports; an empty tab is a control that does nothing. */
  it('shows exactly the tabs the definition supports', () => {
    show();
    const labels = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(labels).toEqual(['Size', 'Style', 'Roof', 'Sides', 'Finish', 'Lighting']);
    expect(structureTabs(resolveStructure(PERGOLA)!)).toHaveLength(6);
  });

  it('writes a typed width to the plan rect, keeping its turn and centre', () => {
    show();
    const width = screen.getByTestId('structure-width');
    fireEvent.change(width, { target: { value: '4.5' } });
    fireEvent.blur(width);

    expect(current().shape).toMatchObject({ width: 4.5, depth: 3, rotation: 20, centre: { x: 8, y: 8 } });
  });

  it('keeps a typed size inside what the structure can be', () => {
    show();
    const depth = screen.getByTestId('structure-depth');
    fireEvent.change(depth, { target: { value: '0.5' } });
    fireEvent.blur(depth);
    expect(current().shape).toMatchObject({ depth: 1.8 });
  });

  it('screens a side, lights it and changes its frame without touching the footprint', () => {
    show();
    const shape = structuredClone(current().shape);

    fireEvent.click(screen.getByTestId('structure-tab-sides'));
    fireEvent.click(screen.getByTestId('structure-side-left-slatted'));
    fireEvent.click(screen.getByTestId('structure-tab-lighting'));
    fireEvent.click(screen.getByTestId('structure-lighting'));
    fireEvent.click(screen.getByTestId('structure-tab-finish'));
    fireEvent.click(screen.getByTestId('structure-frame-aluminium-dark'));

    expect(current().structure).toEqual({ sides: { left: 'slatted' }, lighting: true });
    expect(current().material).toBe('aluminium-dark');
    expect(current().shape).toEqual(shape);
  });

  it('says "same as the frame" by leaving the roof finish absent', () => {
    show();
    fireEvent.click(screen.getByTestId('structure-tab-roof'));
    const finish = screen.getByTestId('structure-roof-finish');
    fireEvent.change(finish, { target: { value: 'polycarbonate-opal' } });
    expect(current().structure?.roof?.finish).toBe('polycarbonate-opal');
    fireEvent.change(finish, { target: { value: '' } });
    expect(current().structure?.roof).toBeUndefined();
  });

  it('applies a whole style from the Style tab, and says when it has since been edited', () => {
    const { rerender } = show();
    const shape = structuredClone(current().shape);
    fireEvent.click(screen.getByTestId('structure-tab-style'));
    fireEvent.click(screen.getByTestId('structure-preset-covered'));

    expect(current().shape).toEqual(shape);
    expect(current().structure).toMatchObject({ preset: 'covered', roof: { kind: 'solid', finish: 'polycarbonate-opal' } });

    usePlanEditorStore.getState().setStructure(PERGOLA.id, { lighting: false });
    rerender(<StructureInspector element={current()} structure={resolveStructure(current())!} unit="m" />);
    expect(screen.getByTestId('structure-preset-covered').textContent).toContain('edited');
  });

  it('says which edge a resize will hold', () => {
    show();
    expect(screen.getByTestId('structure-pins').textContent).toBe('Grows evenly about its centre.');
  });

  it('shows what is in the way when a size will not fit, and applies an alternative', () => {
    const bed: DesignElement = {
      id: 'bed',
      name: 'Rear border',
      category: 'planting-bed',
      role: 'fill',
      fillKind: 'accent',
      zone: 'back',
      shape: {
        kind: 'polygon',
        cornerRadius: 0,
        points: [
          { x: 10.5, y: 2 },
          { x: 16, y: 2 },
          { x: 16, y: 14 },
          { x: 10.5, y: 14 },
        ],
      },
    };
    const square = { ...PERGOLA, shape: { ...PERGOLA.shape, rotation: 0 } } as DesignElement;
    usePlanEditorStore.setState({ present: { elements: [square, bed] } });
    show();
    const width = screen.getByTestId('structure-width');
    fireEvent.change(width, { target: { value: '6' } });
    fireEvent.blur(width);

    expect(screen.getByTestId('structure-resize-blocked').textContent).toContain('The rear border is in the way.');
    expect(current().shape).toMatchObject({ width: 3.6 });

    fireEvent.click(screen.getByTestId('structure-alternative-fit'));
    expect(screen.queryByTestId('structure-resize-blocked')).toBeNull();
    const shape = current().shape;
    expect(shape.kind === 'rect' && shape.width).toBeGreaterThan(3.6);
    // Grown about its centre (nothing holds it), so it stops where its side meets the border.
    expect(shape.kind === 'rect' && shape.width).toBeLessThanOrEqual(5);
  });
});
