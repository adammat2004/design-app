import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readPlanDocument } from '@garden-studio/schema';
import { previewCounts } from '@/lib/ar/preview';
import { sceneOfPlan } from '@/lib/ar/scene';
import { hydrateBoundaryStore, resetBoundaryStoreForTests } from '@/state/boundary-store';
import { useGardenPreviewStore } from '@/state/garden-preview-store';
import { hydratePlanEditorStore, resetPlanEditorStoreForTests } from '@/state/plan-editor-store';
import { GardenPreview } from './GardenPreview';

const document = readPlanDocument(
  JSON.parse(readFileSync(join(__dirname, '../../../scripts/fixtures/suburban.plan.json'), 'utf8')),
);

beforeEach(() => {
  resetBoundaryStoreForTests();
  resetPlanEditorStoreForTests();
  hydrateBoundaryStore(document.site, 'm', 'Suburban', 0);
  hydratePlanEditorStore(document.layout, 0);
  useGardenPreviewStore.setState({ open: true });
});

describe('GardenPreview', () => {
  it('reports the scene it draws — the same one the builder makes for this plan', () => {
    render(<GardenPreview />);
    const viewport = screen.getByTestId('garden-preview-viewport');
    const expected = previewCounts(
      sceneOfPlan(
        { site: document.site, elements: document.layout.elements, projectName: 'Suburban', projectId: null, revision: null, documentVersion: 4 },
        'desktop',
      ).scene,
    );
    expect(Number(viewport.dataset.surfaces)).toBe(expected.surfaces);
    expect(Number(viewport.dataset.solids)).toBe(expected.solids);
    expect(Number(viewport.dataset.models)).toBe(expected.models);
    expect(Number(viewport.dataset.plants)).toBe(expected.plants);
    expect(viewport.dataset.origin).toBe('garden-door');
  });

  it('says so rather than showing a blank box where there is no WebGL', () => {
    // jsdom has no WebGL, which is exactly the case to cover.
    render(<GardenPreview />);
    expect(screen.getByTestId('garden-preview-no-webgl')).toBeTruthy();
    expect(screen.getByTestId('garden-preview-viewport').dataset.webgl).toBe('false');
  });

  it('closes on Back and on Escape', () => {
    render(<GardenPreview />);
    fireEvent.click(screen.getByTestId('garden-preview-close'));
    expect(useGardenPreviewStore.getState().open).toBe(false);
    act(() => useGardenPreviewStore.setState({ open: true }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(useGardenPreviewStore.getState().open).toBe(false);
  });

  it('switches between the door and the overview', () => {
    render(<GardenPreview />);
    const viewport = screen.getByTestId('garden-preview-viewport');
    expect(viewport.dataset.view).toBe('door');
    fireEvent.click(screen.getByTestId('garden-preview-view-overview'));
    expect(viewport.dataset.view).toBe('overview');
    expect(screen.getByTestId('garden-preview-view-overview').getAttribute('aria-pressed')).toBe('true');
  });
});
